/**
 * Phase 2 session 7. What a "minor unit" is, per currency.
 *
 * Everything in receiptless before this session assumed two decimal
 * places — `toMinorUnits` multiplies by 100 and `formatMinorUnits`
 * divides by it. That assumption is wrong for a real chunk of the world:
 * JPY and KRW have no minor unit at all, and the Gulf dinars have three
 * digits. Converting 1000 JPY as though it were ¥10.00 is not a rounding
 * error, it is a factor of a hundred.
 *
 * So a conversion has to know the scale of *both* sides, and it has to
 * know which table it read them from — hence the version below travelling
 * in every snapshot. A future correction to this table must not silently
 * change what an old conversion meant.
 *
 * **This is a hand-maintained subset, not the ISO 4217 register.** Saying
 * so plainly matters more than the version string looking official: the
 * table covers the currencies receiptless can actually see today plus the
 * non-two-digit ones that would otherwise be silently wrong. An unknown
 * code fails closed rather than defaulting to 2 — a wrong scale is a
 * wrong number in someone's tax summary, and "I don't know this currency"
 * is a far better outcome than a confident hundredfold error.
 */

export const CURRENCY_METADATA_VERSION = "receiptless-currency-table@1";

/** Currencies with no minor unit. */
const ZERO_DECIMAL = [
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW",
  "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
] as const;

/** Currencies with three digits after the separator. */
const THREE_DECIMAL = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"] as const;

/**
 * Two-decimal currencies are not defaulted into — they are listed, so an
 * unrecognised code is recognisably unknown rather than quietly assumed.
 * EGP is here deliberately: it is the currency this app most needs and
 * the one that eliminated the obvious rate provider (see
 * RECEIPTLESS_STATE.md).
 */
const TWO_DECIMAL = [
  "AED", "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EGP", "EUR",
  "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "KES", "MAD", "MXN", "MYR",
  "NGN", "NOK", "NZD", "PHP", "PLN", "QAR", "RON", "SAR", "SEK", "SGD",
  "THB", "TRY", "TWD", "USD", "ZAR",
] as const;

const SCALES: ReadonlyMap<string, number> = new Map([
  ...ZERO_DECIMAL.map((code) => [code, 0] as const),
  ...TWO_DECIMAL.map((code) => [code, 2] as const),
  ...THREE_DECIMAL.map((code) => [code, 3] as const),
]);

export class UnknownCurrencyError extends Error {
  constructor(public readonly code: string) {
    super(
      `Unknown currency "${code}". Its minor-unit scale is not in ${CURRENCY_METADATA_VERSION}, ` +
        `and assuming two decimal places would silently produce a wrong amount.`,
    );
    this.name = "UnknownCurrencyError";
  }
}

export function isKnownCurrency(code: string): boolean {
  return SCALES.has(code.trim().toUpperCase());
}

/** Digits after the decimal separator. Throws rather than guessing. */
export function minorUnitScale(code: string): number {
  const normalised = code.trim().toUpperCase();
  const scale = SCALES.get(normalised);
  if (scale === undefined) throw new UnknownCurrencyError(normalised);
  return scale;
}

export function knownCurrencies(): string[] {
  return [...SCALES.keys()].sort();
}
