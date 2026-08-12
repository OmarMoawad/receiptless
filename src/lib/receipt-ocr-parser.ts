/**
 * Pure text-parsing half of Session 5's OCR flow (RECEIPTLESS_STATE.md) —
 * deliberately separated from src/lib/ocr.ts's actual Tesseract.js
 * invocation so this heuristic parsing logic is unit-testable against
 * plain fixture strings, without needing a real image or a WASM OCR
 * engine running inside vitest. Everything this returns is a *suggestion*
 * — ReceiptForm shows it for the user to review/edit, never auto-submits
 * it, and a receipt created from it still lands at the schema's default
 * VerificationLevel.UNVERIFIED (createReceiptSchema has no field for a
 * client to claim otherwise) — matching the ladder's own rule that OCR
 * output must never claim MERCHANT_VERIFIED.
 */
export type OcrItemSuggestion = { name: string; priceMinor: number };

export type OcrReceiptSuggestion = {
  merchant: string | null;
  totalMinor: number | null;
  currency: string | null;
  items: OcrItemSuggestion[];
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
};

// Amount right-aligned at (or near) the end of a line — the common layout
// for both a receipt's line items and its total/tax/subtotal rows. A short
// trailing tail ("T1" tax-category codes, a stray "*", OCR noise) is
// tolerated after the amount — real scans routinely misread the last
// couple of characters on a line, and requiring an exact end-of-line match
// was silently discarding otherwise-good matches on real photos.
const AMOUNT_AT_END = /([$€£]?)\s?(\d{1,3}(?:[,.]\d{3})*[.,]\d{2})[\s*]{0,3}[A-Za-z0-9%]{0,4}\s*$/;

// Tesseract occasionally drops a decimal point entirely on a low-contrast
// scan, misreading e.g. "$23.75" as "$23 75" (a plain space where the "."
// should be) — confirmed on a real total line during Session 5's
// click-through (2026-08-12). Deliberately narrower than AMOUNT_AT_END:
// requires an explicit leading currency symbol immediately before the
// digits, since a bare "<number> <number>" pair with no currency marker
// is too ambiguous (quantities, phone numbers, dates all look like that)
// to safely reinterpret as a garbled amount.
const CURRENCY_SPACE_DECIMAL_AT_END = /[$€£]\s?(\d{1,3})\s+(\d{2})\s*$/;

/** Tries the normal amount shape first, then the space-for-decimal-point repair above. */
function matchAmountMinor(line: string): number | null {
  const normal = line.match(AMOUNT_AT_END);
  if (normal) return parseMoneyToMinor(normal[2]);
  const repaired = line.match(CURRENCY_SPACE_DECIMAL_AT_END);
  if (repaired) return parseMoneyToMinor(`${repaired[1]}.${repaired[2]}`);
  return null;
}

const TOTAL_LINE = /\btotal\b/i;
const TOTAL_LINE_FALLBACK = /\bamount\s?due\b/i;
// "Total Saved"/"You Saved" lines are a discount summary, not the amount
// charged — confirmed on a real receipt where "TOTAL SAVED: $52.50"
// printed *after* the real "TOTAL $0.52" line, so the bottom-up scan in
// guessTotalMinor picked the wrong one before this exclusion existed.
const NON_TOTAL_TOTAL_LINE = /\b(sub\s?total|pre-?tax|total\s+saved|you\s+saved|total\s+savings)\b/i;
const SKIP_LINE = /\b(subtotal|sub total|tax|change|cash|card|balance|visa|mastercard|amex|debit|credit|tender|thank you|receipt|date|time)\b/i;

/** Standard iterative Levenshtein distance — short inputs only (word-length strings). */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dist = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j++) dist[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost);
    }
  }
  return dist[rows - 1][cols - 1];
}

/**
 * Real OCR frequently misreads the word "Total" itself into something an
 * exact-substring match never catches ("Jotal", "Tote.") — confirmed
 * against two different real receipts during Session 5's click-through
 * (2026-08-12), both otherwise reading most of the line correctly. Only
 * used as a fallback (see guessTotalMinor) after an exact match fails, and
 * only against words in the typical 3-7 letter range close to "total"'s
 * own length, to keep the false-positive rate down — an edit distance of 2
 * still rejects unrelated words like "date" or "cash" but accepts the
 * observed OCR errors above.
 */
function fuzzyMatchesTotal(word: string): boolean {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length < 3 || cleaned.length > 7) return false;
  return levenshtein(cleaned, "total") <= 2;
}

function lineFuzzyMatchesTotal(line: string): boolean {
  return line.split(/\s+/).some(fuzzyMatchesTotal);
}

/**
 * Converts a matched amount string (e.g. "$12.99", "1,234.56", "12,99")
 * into integer minor units. Assumes the last "." or "," in the string is
 * the decimal separator (both conventions appear on real receipts) and
 * strips any thousand separators before it.
 */
function parseMoneyToMinor(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  if (lastSep === -1) return null;
  const wholePart = cleaned.slice(0, lastSep).replace(/[.,]/g, "");
  const fractionPart = cleaned.slice(lastSep + 1);
  if (!/^\d+$/.test(wholePart) || !/^\d{2}$/.test(fractionPart)) return null;
  return Number(wholePart) * 100 + Number(fractionPart);
}

function detectCurrency(text: string): string | null {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  return null;
}

// A merchant name needs at least one real word in it — real OCR output on
// a noisy/busy receipt photo is full of short junk lines (a stray border
// character misread as ": E", a lone digit, page-scan artifacts) that
// would otherwise "win" simply by being first and not amount-shaped.
// Requiring 2+ consecutive letters filters those out without requiring
// the line to be clean.
const LOOKS_LIKE_A_WORD = /[A-Za-z]{2,}/;

/**
 * The first non-empty, plausibly-a-name line — real printed receipts put
 * the merchant/store name at the very top, above the address and any
 * items, but real OCR output on that same region is often the noisiest
 * part of the scan (small print, sometimes a logo/graphic in the way), so
 * "first line" alone isn't a safe enough filter on its own.
 */
function guessMerchant(lines: string[]): string | null {
  for (const line of lines) {
    if (AMOUNT_AT_END.test(line)) continue;
    if (!LOOKS_LIKE_A_WORD.test(line)) continue;
    return line;
  }
  return null;
}

/**
 * Scans bottom-up for a line containing "total" but not "subtotal"/
 * "pre-tax" — the grand total is typically the last such line, printed
 * after (below) any subtotal/tax breakdown. Two fallback tiers, tried in
 * order, only if the exact match above finds nothing: an "amount due"
 * line (common on receipts that never print the literal word "total"),
 * then a fuzzy match on "total" itself (see fuzzyMatchesTotal) — real OCR
 * scans routinely misread that one word ("Jotal", "Tote.") while reading
 * the rest of the same line correctly.
 */
function guessTotalMinor(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!TOTAL_LINE.test(line) || NON_TOTAL_TOTAL_LINE.test(line)) continue;
    const minor = matchAmountMinor(line);
    if (minor !== null) return minor;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!TOTAL_LINE_FALLBACK.test(line)) continue;
    const minor = matchAmountMinor(line);
    if (minor !== null) return minor;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (NON_TOTAL_TOTAL_LINE.test(line) || !lineFuzzyMatchesTotal(line)) continue;
    const minor = matchAmountMinor(line);
    if (minor !== null) return minor;
  }
  return null;
}

/**
 * Any line with a trailing amount that isn't itself a total/tax/payment
 * line is treated as a candidate line item: everything before the amount
 * is the item name.
 */
function guessItems(lines: string[]): OcrItemSuggestion[] {
  const items: OcrItemSuggestion[] = [];
  for (const line of lines) {
    if (SKIP_LINE.test(line) || TOTAL_LINE.test(line) || TOTAL_LINE_FALLBACK.test(line) || lineFuzzyMatchesTotal(line)) {
      continue;
    }
    const match = line.match(AMOUNT_AT_END);
    if (!match) continue;
    const priceMinor = parseMoneyToMinor(match[2]);
    if (priceMinor === null) continue;
    const name = line.slice(0, match.index).trim();
    if (!name) continue;
    items.push({ name, priceMinor });
  }
  return items;
}

export function parseReceiptText(rawText: string): OcrReceiptSuggestion {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return {
    merchant: guessMerchant(lines),
    totalMinor: guessTotalMinor(lines),
    currency: detectCurrency(rawText),
    items: guessItems(lines),
  };
}
