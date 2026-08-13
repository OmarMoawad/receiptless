export type InboundEmail = {
  /**
   * Which connector delivered this. Part of the idempotency key on
   * InboundEmailDelivery, so the same message arriving via two connectors
   * is two deliveries, but the same connector retrying is one.
   */
  provider: "postmark" | "gmail";
  providerMessageId: string;
  /**
   * Session 6's forward-to path resolves the owning user from this token.
   * The Session 9 OAuth path already knows the user from the connection
   * being scanned, so it has no mailbox token — hence null.
   */
  mailboxToken: string | null;
  from: string;
  subject: string | null;
  text: string;
  /**
   * The email's own Date header, when the provider supplied a parseable
   * one. Used as the purchase-date fallback for a receipt whose body
   * prints no readable date (see receipt-adapters/registry.ts) — closer to
   * the truth than the ingestion clock, which can be days later for a
   * forwarded receipt. Null when absent or unparseable; the caller falls
   * back to its own clock.
   */
  receivedAt: Date | null;
};
