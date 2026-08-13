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
  // The timestamp of the *oldest* message that failed this scan. The
  // cursor may never move past it — see the note below.
  let earliestFailure: Date | null = null;
  // Set when a message failed without yielding a date — see the catch below.
  let undatedFailure = false;

  for (const id of ids) {
    // Fetched before the try so a failure still yields a timestamp to
    // clamp the cursor with; a message we cannot even date is handled by
    // the conservative fallback below.
    let receivedAt: Date | null = null;
    try {
      const message = await apiClient.getMessage(accessToken, id);
      const email = toInboundEmail(message);
      receivedAt = email.receivedAt;
      // Test-only sentinel: lets a test simulate an ingestion failure on a
      // message that was successfully fetched and dated, which is the only
      // shape that exercises the cursor clamp below.
      if (process.env.NODE_ENV === "test" && email.text === "__POISON__") {
        throw new Error("simulated ingestion failure");
      }
      const result = await ingestEmailForUser(userId, email);
      if (result.status === "created") receiptsCreated += 1;
      if (result.status === "duplicate") duplicates += 1;
      if (email.receivedAt && (!newestSeen || email.receivedAt > newestSeen)) newestSeen = email.receivedAt;
    } catch {
      failures += 1;
      if (receivedAt) {
        if (!earliestFailure || receivedAt < earliestFailure) earliestFailure = receivedAt;
      } else {
        // Failed before it could be dated (the fetch itself threw), so
        // there is no timestamp to clamp against and no safe way to know
        // which part of the window was covered. Don't move at all.
        undatedFailure = true;
      }
    }
  }

  /**
   * The cursor must never move past a message that failed, or that message
   * is excluded by every future `after:` query and is lost permanently.
   *
   * Gmail returns messages newest-first, so a failure at 10:00 alongside a
   * success at 11:00 would otherwise advance the cursor to 11:00 and skip
   * the 10:00 message forever. Clamping to just before the earliest
   * failure means the next scan re-reads it — at the cost of re-reading
   * the successes after it too, which is harmless because ingestion is
   * idempotent on (provider, providerMessageId).
   */
  let nextCursor = newestSeen;
  if (undatedFailure) {
    // Nothing can be safely claimed as covered — leave the cursor exactly
    // where it was so the whole window is re-scanned.
    nextCursor = connection.lastScannedAt ?? null;
  } else if (earliestFailure) {
    const clamped = new Date(earliestFailure.getTime() - 1000);
    nextCursor = !nextCursor || clamped < nextCursor ? clamped : nextCursor;
    // Never move the cursor backwards from where it already was — that
    // would re-scan mail already known to be handled.
    if (connection.lastScannedAt && nextCursor < connection.lastScannedAt) nextCursor = connection.lastScannedAt;
  }

  if (nextCursor && nextCursor.getTime() !== connection.lastScannedAt?.getTime()) {
    await prisma.emailConnection.update({ where: { id: connectionId }, data: { lastScannedAt: nextCursor } });
  }

  return { status: "scanned", messagesSeen: ids.length, receiptsCreated, duplicates, failures };
}
