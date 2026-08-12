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
// for both a receipt's line items and its total/tax/subtotal rows.
const AMOUNT_AT_END = /([$€£]?)\s?(\d{1,3}(?:[,.]\d{3})*[.,]\d{2})\s*$/;

const TOTAL_LINE = /\btotal\b/i;
const NON_TOTAL_TOTAL_LINE = /\b(sub\s?total|pre-?tax)\b/i;
const SKIP_LINE = /\b(subtotal|sub total|tax|change|cash|card|balance|visa|mastercard|amex|debit|credit|tender|thank you|receipt|date|time)\b/i;

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

/**
 * The first non-empty line that isn't itself a price/date-looking line —
 * real printed receipts put the merchant/store name at the very top, above
 * the address and any items.
 */
function guessMerchant(lines: string[]): string | null {
  for (const line of lines) {
    if (AMOUNT_AT_END.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    return line;
  }
  return null;
}

/**
 * Scans bottom-up for a line containing "total" but not "subtotal"/
 * "pre-tax" — the grand total is typically the last such line, printed
 * after (below) any subtotal/tax breakdown.
 */
function guessTotalMinor(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!TOTAL_LINE.test(line) || NON_TOTAL_TOTAL_LINE.test(line)) continue;
    const match = line.match(AMOUNT_AT_END);
    if (match) return parseMoneyToMinor(match[2]);
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
    if (SKIP_LINE.test(line) || TOTAL_LINE.test(line)) continue;
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
