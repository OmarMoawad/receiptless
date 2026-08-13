import { prisma } from "./db";
import { getActiveAccessToken } from "./gmail-connection";
import type { GmailApiClient, GmailMessage } from "./gmail-client";
import type { InboundEmail } from "./inbound-email";
import { ingestEmailForUser } from "./inbound-email-ingestion";

/**
 * Session 9: scan a connected mailbox for receipts and ingest them
 * through the same pipeline the forward-to webhook uses.
 *
 * On-demand, like IDent's Gmail sync — a user-triggered action rather than
 * a poller, so one scan bounds itself to something that finishes inside a
 * normal request.
 */
const MAX_MESSAGES_PER_SCAN = 25;
const MAX_BODY_LENGTH = 50_000;

export type GmailScanResult = {
  status: "scanned" | "not-connected";
  messagesSeen: number;
  receiptsCreated: number;
  duplicates: number;
  /** Messages that threw during parse/ingest. See the isolation note below. */
  failures: number;
};

function parseHeaderDate(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toInboundEmail(message: GmailMessage): InboundEmail {
  return {
    provider: "gmail",
    providerMessageId: message.id,
    // The OAuth path knows the user from the connection being scanned;
    // there is no forward-to token involved.
    mailboxToken: null,
    from: message.from,
    subject: message.subject,
    text: message.bodyText.slice(0, MAX_BODY_LENGTH),
    receivedAt: parseHeaderDate(message.date),
  };
}

/**
 * Scans one connection. Per-message failures are counted and skipped, not
 * propagated: the roadmap's own requirement for this session is that
 * "parsing failures on a real inbox don't take down ingestion for every
 * other user", and the same reasoning applies within a single mailbox —
 * one unparseable message must not abandon the twenty-four after it.
 */
export async function scanGmailConnection(
  connectionId: string,
  userId: string,
  apiClient: GmailApiClient,
): Promise<GmailScanResult> {
  const empty = { messagesSeen: 0, receiptsCreated: 0, duplicates: 0, failures: 0 };

  const connection = await prisma.emailConnection.findFirst({ where: { id: connectionId, userId } });
  if (!connection) return { status: "not-connected", ...empty };

  const accessToken = await getActiveAccessToken(connectionId, apiClient);
  // A disconnected connection has no token material, so it simply stops
  // being scanned rather than erroring.
  if (!accessToken) return { status: "not-connected", ...empty };

  const ids = await apiClient.listReceiptMessageIds(accessToken, {
    after: connection.lastScannedAt ?? undefined,
    max: MAX_MESSAGES_PER_SCAN,
  });

  let receiptsCreated = 0;
  let duplicates = 0;
  let failures = 0;
  let newestSeen = connection.lastScannedAt ?? null;

  for (const id of ids) {
    try {
      const message = await apiClient.getMessage(accessToken, id);
      const email = toInboundEmail(message);
      const result = await ingestEmailForUser(userId, email);
      if (result.status === "created") receiptsCreated += 1;
      if (result.status === "duplicate") duplicates += 1;
      if (email.receivedAt && (!newestSeen || email.receivedAt > newestSeen)) newestSeen = email.receivedAt;
    } catch {
      failures += 1;
    }
  }

  // Only advanced past messages actually processed, so a failed scan
  // doesn't skip the window it never managed to read.
  if (newestSeen && newestSeen !== connection.lastScannedAt) {
    await prisma.emailConnection.update({ where: { id: connectionId }, data: { lastScannedAt: newestSeen } });
  }

  return { status: "scanned", messagesSeen: ids.length, receiptsCreated, duplicates, failures };
}
