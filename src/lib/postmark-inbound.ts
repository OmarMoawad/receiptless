import { z } from "zod";
import type { InboundEmail } from "./inbound-email";

const MAX_BODY_LENGTH = 50_000;

const postmarkInboundSchema = z.object({
  MessageID: z.string().min(1).max(512),
  MailboxHash: z.string().min(1).max(256),
  From: z.string().min(1).max(512),
  Subject: z.string().max(2_000).nullish(),
  TextBody: z.string().optional().default(""),
  HtmlBody: z.string().optional().default(""),
  Date: z.string().max(200).nullish(),
});

/**
 * The Date header is sender-controlled, so it is bounded the same way the
 * body is: unparseable values become null (the caller falls back to its
 * own clock) rather than propagating an Invalid Date into a receipt.
 */
function parseHeaderDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>|<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export function normalizePostmarkInbound(input: unknown): InboundEmail {
  const parsed = postmarkInboundSchema.parse(input);
  const text = (parsed.TextBody.trim() ? parsed.TextBody : htmlToText(parsed.HtmlBody)).slice(0, MAX_BODY_LENGTH);
  return {
    provider: "postmark",
    providerMessageId: parsed.MessageID,
    mailboxToken: parsed.MailboxHash,
    from: parsed.From,
    subject: parsed.Subject ?? null,
    text,
    receivedAt: parseHeaderDate(parsed.Date),
  };
}
