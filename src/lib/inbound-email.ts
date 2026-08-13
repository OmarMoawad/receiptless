export type InboundEmail = {
  provider: "postmark";
  providerMessageId: string;
  mailboxToken: string;
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
