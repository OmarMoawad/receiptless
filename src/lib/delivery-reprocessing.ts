import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import type { InboundEmail } from "./inbound-email";
import { reapplyToExistingDelivery, type RetainedEmail } from "./inbound-email-ingestion";

/**
 * Review findings #6 and #7: the parser now refuses to import a message
 * it cannot read, which stopped the $0.00 rows — but it also meant those
 * messages were marked seen and could never be looked at again. This is
 * the other half: a controlled way to run today's parser over the
 * messages yesterday's parser could not read.
 *
 * "Controlled" is the operative word. It is owner-scoped, bounded per
 * call, driven by an explicit request rather than a background job, and
 * it never touches a delivery that already produced a receipt — so
 * running it twice cannot duplicate anything or rewrite history.
 */

/** One call's ceiling — a bounded unit of work inside a normal request. */
export const MAX_REPROCESS_PER_CALL = 50;

/**
 * After this many failed attempts a delivery stops being retried
 * automatically and is marked `discarded`, keeping its reason.
 *
 * Some mail is simply not a receipt — a newsletter matched by a search
 * query — and retrying it on every future call would mean the queue never
 * drains and the owner's "unparsed" count never becomes meaningful. The
 * tombstone keeps it out of the queue without letting the message be
 * re-fetched and re-queued from scratch.
 */
export const MAX_ATTEMPTS_BEFORE_DISCARD = 5;

export type ReprocessResult = {
  considered: number;
  receiptsCreated: number;
  stillUnparsed: number;
  discarded: number;
};

function isRetainedEmail(value: unknown): value is RetainedEmail {
  return typeof value === "object" && value !== null && typeof (value as RetainedEmail).text === "string";
}

function toInboundEmail(
  provider: InboundEmail["provider"],
  providerMessageId: string,
  retained: RetainedEmail,
): InboundEmail {
  return {
    provider,
    providerMessageId,
    // Reprocessing never re-resolves a mailbox: the delivery row already
    // records whose it is, and re-deriving ownership from a stored token
    // would be a second, weaker path to the same answer.
    mailboxToken: null,
    // `from` is non-optional on InboundEmail and the parser reads it, so a
    // retained row that somehow lost it reprocesses as an empty sender
    // rather than crashing the whole batch.
    from: retained.from ?? "",
    subject: retained.subject,
    text: retained.text,
    receivedAt: retained.receivedAt ? new Date(retained.receivedAt) : null,
  };
}

/**
 * Runs the current parser over this owner's unparsed deliveries.
 *
 * Reuses the existing delivery row and re-enters the *same*
 * parse-and-store path first-time ingestion uses, rather than
 * reimplementing it: a reprocessed message must produce exactly what it
 * would have produced if it had parsed the first time — same merchant
 * handling, same plausibility checks, same trusted clock — and a second
 * implementation would drift from the first the moment either changed.
 */
export async function reprocessUnparsedDeliveries(
  userId: string,
  options: { limit?: number } = {},
): Promise<ReprocessResult> {
  const limit = Math.min(options.limit ?? MAX_REPROCESS_PER_CALL, MAX_REPROCESS_PER_CALL);

  const pending = await prisma.inboundEmailDelivery.findMany({
    where: {
      userId,
      status: "unparsed",
      attempts: { lt: MAX_ATTEMPTS_BEFORE_DISCARD },
      // Rows migrated from before retention exist but hold no message, so
      // there is nothing to re-run. They stay visible in the review list
      // and are what scripts/repair-legacy-receipts.mjs is for.
      retainedEmail: { not: Prisma.DbNull },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const result: ReprocessResult = { considered: 0, receiptsCreated: 0, stillUnparsed: 0, discarded: 0 };

  for (const delivery of pending) {
    if (!isRetainedEmail(delivery.retainedEmail)) continue;
    result.considered += 1;

    const email = toInboundEmail(
      delivery.provider as InboundEmail["provider"],
      delivery.providerMessageId,
      delivery.retainedEmail,
    );

    /**
     * The row is **reused, never deleted**.
     *
     * An earlier version deleted the delivery first — the unique
     * (provider, providerMessageId) key made that look necessary for
     * re-ingestion — and restored it in a `catch` if the retry threw.
     * That is safe against an exception and unsafe against the failure
     * that actually happens on a serverless host: a process killed
     * mid-flight runs no `catch`, so the row and its retained message
     * vanished while the Gmail cursor had already moved past the
     * message. One badly timed timeout, one silently lost receipt, and
     * nothing to notice it with.
     *
     * Reusing the row removes the window entirely. There is no instant at
     * which the message exists nowhere: the transaction either links it
     * to a new receipt or leaves the row exactly as it was.
     */
    const outcome = await reapplyToExistingDelivery(userId, delivery.id, email);

    if (outcome.status === "created") {
      result.receiptsCreated += 1;
      continue;
    }

    // Still unreadable. applyParsedReceipt has already incremented
    // attempts on the row; retire it once it has had enough tries.
    const attempts = delivery.attempts + 1;
    const discarded = attempts >= MAX_ATTEMPTS_BEFORE_DISCARD;
    if (discarded) {
      await prisma.inboundEmailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "discarded",
          // A discarded message keeps its reason and loses its body: the
          // owner still sees that something was skipped and why, without
          // the app holding a copy of mail it has decided it cannot use.
          retainedEmail: Prisma.DbNull,
        },
      });
    }

    if (discarded) result.discarded += 1;
    else result.stillUnparsed += 1;
  }

  return result;
}

export type DeliveryReviewItem = {
  id: string;
  provider: string;
  status: string;
  failureReason: string | null;
  subject: string | null;
  attempts: number;
  createdAt: Date;
};

/**
 * The review half. Without this, "12 messages were not imported" is a
 * number with nothing behind it — the owner cannot tell whether the app
 * missed twelve receipts or skipped twelve newsletters, which is the
 * difference between a bug and correct behaviour.
 *
 * Returns the subject line and nothing else from the message body: enough
 * to recognise a message, not a re-render of someone's mail in a list
 * view.
 */
export async function listUnimportedDeliveries(userId: string, limit = 100): Promise<DeliveryReviewItem[]> {
  const rows = await prisma.inboundEmailDelivery.findMany({
    where: { userId, status: { in: ["unparsed", "discarded"] } },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    status: row.status,
    failureReason: row.failureReason,
    subject: isRetainedEmail(row.retainedEmail) ? row.retainedEmail.subject : null,
    attempts: row.attempts,
    createdAt: row.createdAt,
  }));
}
