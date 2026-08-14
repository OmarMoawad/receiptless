/**
 * Parsing primitives shared by the format adapters. These deliberately
 * live here rather than in receipt-ocr-parser.ts: that module's helpers
 * are tuned for *OCR* text (tolerating misread characters, garbled
 * "Jotal" lines, dropped decimal points), whereas email receipts are
 * machine-generated and exact. Reusing the OCR-tolerant versions here
 * would import false-positive risk that email text never justifies.
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

const CURRENCY_CODES = ["USD", "EUR", "GBP", "EGP", "AED", "SAR", "JPY", "CAD", "AUD"];

/**
 * Converts an amount string ("$12.99", "1,234.56", "12,99", "EGP 45.00")
 * into integer minor units. The last "." or "," is treated as the decimal
 * separator — both conventions appear on real receipts — and anything
 * before it is thousands grouping. Returns null rather than guessing when
 * there is no two-digit fractional part, so a bare integer ("Qty 2") can
 * never be silently read as an amount.
 */
export function parseAmountToMinor(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const lastSep = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
  if (lastSep === -1) return null;
  const whole = cleaned.slice(0, lastSep).replace(/[.,]/g, "");
  const fraction = cleaned.slice(lastSep + 1);
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(fraction)) return null;
  return Number(whole) * 100 + Number(fraction);
}

/** An explicit ISO code wins over a bare symbol — "EGP 45.00" is unambiguous, "$" is not. */
export function detectCurrency(text: string): string | null {
  const upper = text.toUpperCase();
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`\\b${code}\\b`).test(upper)) return code;
  }
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  return null;
}

/**
 * Only accepts formats that are unambiguous or explicitly ordered, and
 * rejects anything Date itself would coerce into a surprise (Date's own
 * parsing of "03/04/2026" is locale-dependent and silently wrong half the
 * time). A receipt with an unreadable date is better left for the caller
 * to fall back on than confidently dated to the wrong day.
 */
/**
 * Date.UTC silently rolls impossible dates forward — Date.UTC(2026, 1, 31)
 * is 3 March, and 29 February in a non-leap year becomes 1 March. A
 * receipt printing an impossible date is corrupt input, and quietly filing
 * it under a different (wrong) day is worse than admitting we can't read
 * it. So every component is read back off the constructed date and must
 * match what was captured.
 */
function utcDateExact(year: number, month: number, day: number, hour = 0, minute = 0): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month, day, hour, minute));
  if (Number.isNaN(date.getTime())) return null;
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute;
  return roundTrips ? date : null;
}

export function parseReceiptDate(raw: string): Date | null {
  const text = raw.trim();

  // ISO-8601 (2026-08-13, optionally with a time) — unambiguous.
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?\b/);
  if (iso) {
    return utcDateExact(
      Number(iso[1]),
      Number(iso[2]) - 1,
      Number(iso[3]),
      Number(iso[4] ?? 0),
      Number(iso[5] ?? 0),
    );
  }

  // "13 August 2026" / "August 13, 2026" — the month name removes the
  // day/month ordering ambiguity that pure-numeric formats have.
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthNames = months.map((month) => month.slice(0, 3)).join("|");
  const dayFirst = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})[a-z]*\\.?,?\\s+(\\d{4})\\b`, "i"));
  const monthFirst = text.match(new RegExp(`\\b(${monthNames})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "i"));
  if (dayFirst || monthFirst) {
    const day = Number(dayFirst ? dayFirst[1] : monthFirst![2]);
    const monthToken = (dayFirst ? dayFirst[2] : monthFirst![1]).toLowerCase();
    const year = Number(dayFirst ? dayFirst[3] : monthFirst![3]);
    const month = months.findIndex((name) => name.startsWith(monthToken));
    // Same exact-round-trip rule as the ISO path — "31 February 2026" is
    // corrupt input, not a date in March.
    if (month >= 0) return utcDateExact(year, month, day);
  }

  return null;
}

/**
 * The display name from an RFC-5322 From header ("Corner Shop
 * <receipts@corner.example>"), falling back to the domain's own second-
 * level label when the sender set no display name. Generic mailbox labels
 * ("no-reply", "receipts") are never used as a merchant name — they name
 * the mailbox, not the business.
 */
export function merchantFromSender(from: string): string | null {
  const named = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  if (named) {
    const display = named[1].trim();
    if (display && !/^(no[-\s]?reply|do[-\s]?not[-\s]?reply|receipts?|orders?|support)$/i.test(display)) {
      return display;
    }
  }

  const domain = from.match(/@([^\s>]+)/)?.[1];
  if (!domain) return null;
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  // Drop the public suffix ("co.uk" is two labels, ".com" one) by taking
  // the label before the final one or two suffix labels.
  const suffixLength = labels.length >= 3 && labels[labels.length - 2].length <= 3 ? 2 : 1;
  const name = labels[labels.length - 1 - suffixLength];
  if (!name || name.length < 2) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
