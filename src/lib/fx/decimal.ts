/**
 * Phase 2 session 7. Exchange rates as canonical base-10 decimals, never
 * as JavaScript numbers.
 *
 * A rate is the one value in this app that cannot go through IEEE-754. An
 * amount is already an integer count of minor units; a rate is a fraction
 * with more significant digits than a double can hold exactly, and the
 * error it introduces is multiplied by every amount it touches. `0.1 + 0.2`
 * is the toy example; `48.7213` stored as a double and re-serialised is
 * the real one.
 *
 * So a rate is text on the way in, `bigint` in the middle, and text on the
 * way out. It never becomes a `number` at any point.
 */

export type CanonicalDecimal = {
  /** Unscaled integer value: the digits with the point removed. */
  digits: bigint;
  /** Digits after the point. `digits / 10n ** scale` is the value. */
  scale: number;
  /** The canonical text form, which is what gets persisted. */
  text: string;
};

export class InvalidDecimalError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid decimal "${input}": ${reason}`);
    this.name = "InvalidDecimalError";
  }
}

/**
 * Canonical form is deliberately strict, and the strictness is the point.
 *
 * The snapshot contract says input outside the supported precision or
 * canonical form must be **rejected, not silently truncated or coerced**,
 * so that a future policy version can still reproduce an older
 * conversion. That only works if there is exactly one way to write any
 * given rate: `1.5` and `1.50` and `1.500` must not all be storable, or
 * two snapshots that look different will mean the same thing and the
 * audit trail stops being decidable.
 *
 * Canonical means: optional `-`, an integer part with no leading zeros
 * (bare `0` allowed), and if there is a fractional part it has at least
 * one digit and does not end in `0`.
 */
const CANONICAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;

export function parseCanonicalDecimal(input: string, maxScale: number): CanonicalDecimal {
  const text = input.trim();
  if (text === "") throw new InvalidDecimalError(input, "it is empty");
  if (!CANONICAL.test(text)) {
    throw new InvalidDecimalError(
      input,
      "it is not in canonical form (no leading zeros, no trailing fractional zeros, digits only)",
    );
  }

  const [integerPart, fractionPart = ""] = text.replace("-", "").split(".");
  const scale = fractionPart.length;
  if (scale > maxScale) {
    throw new InvalidDecimalError(input, `it has ${scale} decimal places, above the supported ${maxScale}`);
  }

  const magnitude = BigInt(integerPart + fractionPart);
  return { digits: text.startsWith("-") ? -magnitude : magnitude, scale, text };
}

/** Renders an unscaled integer and a scale back into canonical text. */
export function formatCanonicalDecimal(digits: bigint, scale: number): string {
  if (scale === 0) return digits.toString();

  const negative = digits < 0n;
  const magnitude = (negative ? -digits : digits).toString().padStart(scale + 1, "0");
  const integerPart = magnitude.slice(0, magnitude.length - scale);
  const fractionPart = magnitude.slice(magnitude.length - scale).replace(/0+$/, "");
  const body = fractionPart === "" ? integerPart : `${integerPart}.${fractionPart}`;
  return negative && /[1-9]/.test(magnitude) ? `-${body}` : body;
}

/**
 * Divides and rounds half-up on the magnitude — ties go away from zero, so
 * rounding is symmetric and never drifts toward positive for a mixed set.
 *
 * Half-up rather than banker's rounding because this is retail money that
 * a person reconciles by hand against a card statement: half-even is
 * better for aggregate statistical neutrality and worse for "why is this
 * a penny off what I calculated?". The choice is recorded in the policy
 * version so a later change is a new version, not a silent re-rounding of
 * history.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero in rate conversion");

  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const rounded = remainder * 2n >= absDenominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
