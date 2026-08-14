import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./db";
import { GMAIL_SCOPE, type GmailApiClient, type OAuthTokenResponse } from "./gmail-client";
import { packTokens, unpackTokens, type StoredTokens } from "./oauth-token-crypto";

/**
 * Session 9: the OAuth connect/refresh/disconnect lifecycle for a scanned
 * Gmail mailbox. Mirrors IDent's comms/gmail-service.ts, which solved the
 * same problem first — including the two hardening items its own review
 * added afterwards (PKCE, and dedup on the provider account id), applied
 * here from the start rather than as a follow-up.
 */

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
/**
 * Refresh this far before actual expiry, so a token doesn't expire
 * mid-scan between the check and the API call it authorizes.
 */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export class GmailNotConfiguredError extends Error {
  constructor() {
    super("Gmail scanning is not configured.");
    this.name = "GmailNotConfiguredError";
  }
}

export type GmailOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function readGmailOAuthConfig(env: NodeJS.ProcessEnv = process.env): GmailOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

/**
 * Builds the consent URL and records the single-use state + PKCE verifier
 * it commits to. `access_type=offline` + `prompt=consent` is what makes
 * Google return a refresh token — without both, a reconnect can silently
 * yield an access token only, and scanning breaks an hour later.
 */
export async function startGmailConnection(
  userId: string,
  config: GmailOAuthConfig,
): Promise<{ authorizationUrl: string }> {
  const state = base64url(randomBytes(24));
  const pkceVerifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(pkceVerifier).digest());

  await prisma.oAuthConnectChallenge.create({
    data: {
      userId,
      provider: "gmail",
      state,
      pkceVerifier,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: url.toString() };
}

/**
 * Consumes a state value exactly once, whether or not the rest of the
 * callback succeeds, so it can never be replayed. The guarded update is
 * what makes two near-simultaneous callbacks for the same state safe:
 * only one can win.
 */
async function consumeChallenge(state: string): Promise<{ userId: string; pkceVerifier: string } | null> {
  return prisma.$transaction(async (tx) => {
    const pending = await tx.oAuthConnectChallenge.findFirst({
      where: { state, consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!pending) return null;
    const claimed = await tx.oAuthConnectChallenge.updateMany({
      where: { id: pending.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (claimed.count === 0) return null;
    return { userId: pending.userId, pkceVerifier: pending.pkceVerifier };
  });
}

function toStoredTokens(response: OAuthTokenResponse, previousRefreshToken?: string): StoredTokens {
  const refreshToken = response.refreshToken ?? previousRefreshToken;
  if (!refreshToken) {
    // Without a refresh token the connection would work for one hour and
    // then silently stop. Better to refuse the connection outright.
    throw new Error("Google returned no refresh token — reconnect with prompt=consent.");
  }
  return {
    accessToken: response.accessToken,
    refreshToken,
    expiresAt: Date.now() + response.expiresInSeconds * 1000,
  };
}

export type CompleteConnectionResult = { connectionId: string; emailAddress: string };

export async function completeGmailConnection(
  input: { state: string; code: string },
  apiClient: GmailApiClient,
): Promise<CompleteConnectionResult | null> {
  const challenge = await consumeChallenge(input.state);
  if (!challenge) return null;

  const tokens = toStoredTokens(await apiClient.exchangeCode(input.code, challenge.pkceVerifier));
  const profile = await apiClient.getProfile(tokens.accessToken);

  // Keyed on the Google account id, so reconnecting the same mailbox
  // updates that connection rather than accumulating duplicates.
  const connection = await prisma.emailConnection.upsert({
    where: {
      userId_provider_providerAccountId: {
        userId: challenge.userId,
        provider: "gmail",
        providerAccountId: profile.emailAddress,
      },
    },
    update: {
      status: "connected",
      encryptedTokenData: packTokens(tokens),
      providerAccountEmail: profile.emailAddress,
    },
    create: {
      userId: challenge.userId,
      provider: "gmail",
      providerAccountId: profile.emailAddress,
      providerAccountEmail: profile.emailAddress,
      status: "connected",
      encryptedTokenData: packTokens(tokens),
    },
  });

  return { connectionId: connection.id, emailAddress: profile.emailAddress };
}

/**
 * Returns a usable access token, refreshing and persisting first when the
 * stored one is at or near expiry. Returns null when the connection has no
 * token material at all (disconnected), which is how a disconnected
 * account stops being scanned rather than erroring on every attempt.
 */
export async function getActiveAccessToken(connectionId: string, apiClient: GmailApiClient): Promise<string | null> {
  const connection = await prisma.emailConnection.findUnique({ where: { id: connectionId } });
  if (!connection?.encryptedTokenData || connection.status !== "connected") return null;

  const stored = unpackTokens(connection.encryptedTokenData);
  if (stored.expiresAt - REFRESH_BUFFER_MS > Date.now()) return stored.accessToken;

  const refreshed = toStoredTokens(await apiClient.refresh(stored.refreshToken), stored.refreshToken);
  await prisma.emailConnection.update({
    where: { id: connectionId },
    data: { encryptedTokenData: packTokens(refreshed) },
  });
  return refreshed.accessToken;
}

/**
 * Disconnects by clearing the token material outright, not just flipping a
 * status label — "no tokens stored" is a guarantee no future scan can
 * accidentally ignore, the way a status check could be forgotten.
 */
export async function disconnectGmail(connectionId: string, userId: string): Promise<boolean> {
  const result = await prisma.emailConnection.updateMany({
    where: { id: connectionId, userId },
    data: { status: "disconnected", encryptedTokenData: null },
  });
  return result.count > 0;
}
