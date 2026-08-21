import {
  divideRoundHalfUp,
  formatCanonicalDecimal,
  parseCanonicalDecimal,
  type CanonicalDecimal,
} from "./decimal";
import { CURRENCY_METADATA_VERSION, minorUnitScale } from "./currency-metadata";

/**
 * Phase 2 session 7. Converting one amount, once, reproducibly.
 *
 * The requirement the whole session serves: **store the rate used at
 * purchase time, and never convert on read with today's rate.** A tax
 * summary that silently re-converts last year's receipts at this
 * morning's rate produces a different number every time it is opened,
 * and the person filing a return has no way to know which one their
 * accountant saw.
 *
 * So conversion is a pure function of inputs that are all recorded, and
 * its output carries everything needed to reproduce it without a provider
 * call: the rate, both currencies, both minor-unit scales, the metadata
 * version those scales came from, the policy version that fixed the
 * precision and rounding, and both the unrounded and rounded results.
 */

/**
 * Bump this — never edit the constants below in place — when precision or
 * rounding changes. Old snapshots keep their own version and stay
 * reproducible; new conversions get the new one. That is the entire
 * reason the version travels in the snapshot.
 */
export const CONVERSION_POLICY_VERSION = "fx-conversion@1";

/**
 * Rates are quoted to at most this many decimal places. Twelve is chosen
 * to be comfortably beyond any published FX series (ECB publishes 4–6,
 * commercial feeds rarely exceed 8) without being unbounded — an
 * unbounded scale is an unbounded storage and comparison surface.
 */
export const MAX_RATE_SCALE = 12;

/**
 * Digits kept in the intermediate result before the final rounding to
 * minor units. This is what "unrounded" means in a snapshot: not the
 * exact rational, which may not terminate, but a value at a fixed scale
 * well beyond the money scale, so the final rounding is reproducible.
 */
export const CALCULATION_SCALE = 12;

export type ConversionInput = {
  /** Integer minor units in the source currency. */
  sourceMinor: number;
  sourceCurrency: string;
  targetCurrency: string;
  /**
   * Quote-currency units for **one** unit of base currency, as canonical
   * decimal text. The direction is fixed and stated rather than inferred:
   * base is the source currency, quote is the target.
   */
  rate: string;
};

export type ConversionResult = {
  targetMinor: number;
  /** The intermediate value at CALCULATION_SCALE, before money rounding. */
  unroundedResult: string;
  rate: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceScale: number;
  targetScale: number;
  currencyMetadataVersion: string;
  conversionPolicyVersion: string;
};

/** Rejects a rate that is not canonical, not positive, or too precise. */
export function parseRate(rate: string): CanonicalDecimal {
  const parsed = parseCanonicalDecimal(rate, MAX_RATE_SCALE);
  if (parsed.digits <= 0n) {
    throw new RangeError(`A rate must be positive; received "${rate}".`);
  }
  return parsed;
}

/**
 * Converts, in integer arithmetic throughout.
 *
 *   target = sourceMinor / 10^sourceScale × rate × 10^targetScale
 *
 * Rearranged so there is exactly one division, taken last, at the point
 * where rounding is intended:
 *
 *   target = (sourceMinor × rateDigits × 10^targetScale)
 *            / (10^sourceScale × 10^rateScale)
 *
 * A single rounding step is not a detail. Rounding the rate, then the
 * subtotal, then the total accumulates error in a way that shows up as a
 * few pence of disagreement across a year of receipts — the exact class
 * of bug the integer-minor-unit convention exists to prevent.
 */
export function convertAmount(input: ConversionInput): ConversionResult {
  const { sourceMinor, rate } = input;
  if (!Number.isInteger(sourceMinor)) {
    throw new TypeError(`sourceMinor must be an integer; received ${sourceMinor}.`);
  }

  const sourceCurrency = input.sourceCurrency.trim().toUpperCase();
  const targetCurrency = input.targetCurrency.trim().toUpperCase();
  const sourceScale = minorUnitScale(sourceCurrency);
  const targetScale = minorUnitScale(targetCurrency);
  const parsedRate = parseRate(rate);

  const numerator = BigInt(sourceMinor) * parsedRate.digits;
  const denominator = 10n ** BigInt(sourceScale) * 10n ** BigInt(parsedRate.scale);

  // The unrounded intermediate, at a fixed scale beyond the money scale.
  const unroundedDigits = divideRoundHalfUp(numerator * 10n ** BigInt(CALCULATION_SCALE), denominator);
  const unroundedResult = formatCanonicalDecimal(unroundedDigits, CALCULATION_SCALE);

  // The money result: one division, rounded once, into target minor units.
  const targetMinorBig = divideRoundHalfUp(numerator * 10n ** BigInt(targetScale), denominator);
  if (targetMinorBig > BigInt(Number.MAX_SAFE_INTEGER) || targetMinorBig < BigInt(-Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`Converted amount ${targetMinorBig} is outside the safe integer range.`);
  }

  return {
    targetMinor: Number(targetMinorBig),
    unroundedResult,
    rate: parsedRate.text,
    sourceCurrency,
    targetCurrency,
    sourceScale,
    targetScale,
    currencyMetadataVersion: CURRENCY_METADATA_VERSION,
    conversionPolicyVersion: CONVERSION_POLICY_VERSION,
  };
}
