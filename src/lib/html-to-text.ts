/**
 * Bounded, inert HTML-to-text. Extracted from postmark-inbound.ts in
 * Session 9 so the Gmail scan path (gmail-client.ts) flattens HTML bodies
 * with exactly the same rules as the webhook path — one definition of
 * "what an email body becomes", regardless of which connector delivered
 * it. Script and style content is dropped outright rather than being
 * turned into text.
 */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function htmlToText(html: string): string {
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

