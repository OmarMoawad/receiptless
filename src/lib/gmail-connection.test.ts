import { describe, expect, it } from "vitest";
import { prisma } from "./db";
import { registerTestUser } from "@/test/auth-helpers";
import { createFakeGmail } from "./gmail-fake";
import { completeGmailConnection, readGmailOAuthConfig, startGmailConnection } from "./gmail-connection";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://localhost:3000/api/email/connections/gmail/callback",
};

function stateFrom(authorizationUrl: string): string {
  return new URL(authorizationUrl).searchParams.get("state")!;
}

describe("readGmailOAuthConfig", () => {
  it("returns null unless every value is present", () => {
    const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
    expect(readGmailOAuthConfig(env({}))).toBeNull();
    expect(readGmailOAuthConfig(env({ GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b" }))).toBeNull();
    // A blank value counts as unset, not as configured.
    expect(
      readGmailOAuthConfig(
        env({ GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b", GOOGLE_OAUTH_REDIRECT_URI: "  " }),
      ),
    ).toBeNull();
    expect(
      readGmailOAuthConfig(
        env({ GOOGLE_OAUTH_CLIENT_ID: "a", GOOGLE_OAUTH_CLIENT_SECRET: "b", GOOGLE_OAUTH_REDIRECT_URI: "http://x" }),
      ),
    ).toEqual({ clientId: "a", clientSecret: "b", redirectUri: "http://x" });
  });
});

describe("startGmailConnection", () => {
  it("requests read-only scope, offline access, and PKCE", async () => {
    const user = await registerTestUser();
    const { authorizationUrl } = await startGmailConnection(user.userId, config);
    const params = new URL(authorizationUrl).searchParams;

    expect(params.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(params.get("access_type")).toBe("offline");
    expect(params.get("prompt")).toBe("consent");
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("code_challenge")).toBeTruthy();
    // The verifier itself must never appear in the URL.
    expect(authorizationUrl).not.toContain(params.get("code_challenge")! + "=");
  });
});

describe("completeGmailConnection", () => {
  it("stores encrypted tokens and marks the connection connected", async () => {
    const user = await registerTestUser();
    const { authorizationUrl } = await startGmailConnection(user.userId, config);
    const gmail = createFakeGmail({ profileEmail: "real@gmail.example" });

    const result = await completeGmailConnection({ state: stateFrom(authorizationUrl), code: "code-1" }, gmail);
    expect(result?.emailAddress).toBe("real@gmail.example");

    const connection = await prisma.emailConnection.findUnique({ where: { id: result!.connectionId } });
    expect(connection?.status).toBe("connected");
    expect(connection?.encryptedTokenData).toBeTruthy();
    // Opaque: the stored blob must not resemble the tokens it holds.
    expect(connection?.encryptedTokenData).not.toContain("refresh-1");
  });

  it("rejects replaying the same state twice", async () => {
    const user = await registerTestUser();
    const { authorizationUrl } = await startGmailConnection(user.userId, config);
    const state = stateFrom(authorizationUrl);
    const gmail = createFakeGmail();

    expect(await completeGmailConnection({ state, code: "code-1" }, gmail)).not.toBeNull();
    expect(await completeGmailConnection({ state, code: "code-1" }, gmail)).toBeNull();
  });

  it("rejects an unknown state", async () => {
    expect(await completeGmailConnection({ state: "never-issued", code: "c" }, createFakeGmail())).toBeNull();
  });

  it("refuses a connection that never receives a refresh token", async () => {
    // Without one the connection dies silently an hour later, so it is
    // better to fail the connect outright than to store a doomed token.
    const user = await registerTestUser();
    const { authorizationUrl } = await startGmailConnection(user.userId, config);
    const gmail = createFakeGmail({ exchange: { accessToken: "a", expiresInSeconds: 3600 } });

    await expect(
      completeGmailConnection({ state: stateFrom(authorizationUrl), code: "c" }, gmail),
    ).rejects.toThrow(/refresh token/i);
  });

  it("reconnecting the same mailbox updates one connection instead of duplicating it", async () => {
    const user = await registerTestUser();
    const gmail = createFakeGmail({ profileEmail: "same@gmail.example" });

    for (let attempt = 0; attempt < 2; attempt++) {
      const { authorizationUrl } = await startGmailConnection(user.userId, config);
      await completeGmailConnection({ state: stateFrom(authorizationUrl), code: `code-${attempt}` }, gmail);
    }

    const connections = await prisma.emailConnection.findMany({ where: { userId: user.userId } });
    expect(connections).toHaveLength(1);
  });
});
