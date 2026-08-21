import { describe, expect, it } from "vitest";
import { CONVERSION_POLICY_VERSION, convertAmount, parseRate } from "./convert";
import { formatCanonicalDecimal, parseCanonicalDecimal, divideRoundHalfUp } from "./decimal";
import { CURRENCY_METADATA_VERSION, UnknownCurrencyError, minorUnitScale } from "./currency-metadata";

describe("currency metadata", () => {
  it("knows the currencies that are not two-decimal", () => {
    expect(minorUnitScale("JPY")).toBe(0);
    expect(minorUnitScale("KWD")).toBe(3);
    expect(minorUnitScale("USD")).toBe(2);
    expect(minorUnitScale("EGP")).toBe(2);
  });

  it("fails closed on a currency it does not know, rather than assuming two", () => {
    // The whole point: a wrong scale is a hundredfold error in someone's
    // tax summary, and "I don't know" is a far better outcome.
    expect(() => minorUnitScale("ZZZ")).toThrow(UnknownCurrencyError);
  });

  it("normalises case and surrounding space", () => {
    expect(minorUnitScale(" jpy ")).toBe(0);
  });
});

describe("canonical decimals", () => {
  it("accepts canonical text and rejects every equivalent spelling of it", () => {
    expect(parseCanonicalDecimal("1.5", 12).digits).toBe(15n);
    // Same value, non-canonical: storing both would make two snapshots
    // that look different mean the same thing.
    for (const equivalent of ["1.50", "01.5", "1.500", "+1.5", "1."]) {
      expect(() => parseCanonicalDecimal(equivalent, 12)).toThrow(/canonical/);
    }
  });

  it("rejects a rate more precise than the policy supports", () => {
    expect(() => parseCanonicalDecimal("1.0000000000001", 12)).toThrow(/decimal places/);
  });

  it("rejects anything that is not a number at all", () => {
    for (const junk of ["", "  ", "abc", "1e5", "1,5", "NaN", "Infinity"]) {
      expect(() => parseCanonicalDecimal(junk, 12)).toThrow();
    }
  });

  it("round-trips through the unscaled form", () => {
    for (const text of ["0", "1", "1.5", "48.7213", "0.000001"]) {
      const parsed = parseCanonicalDecimal(text, 12);
      expect(formatCanonicalDecimal(parsed.digits, parsed.scale)).toBe(text);
    }
  });

  it("rounds halves away from zero, symmetrically", () => {
    expect(divideRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divideRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divideRoundHalfUp(15n, 10n)).toBe(2n);
    expect(divideRoundHalfUp(-5n, 10n)).toBe(-1n);
  });

  it("requires a rate to be positive", () => {
    expect(() => parseRate("0")).toThrow(/positive/);
    expect(() => parseRate("-1.5")).toThrow(/positive/);
  });
});

describe("convertAmount", () => {
  it("converts between two two-decimal currencies", () => {
    // £10.00 at 1.27 USD per GBP = $12.70
    const result = convertAmount({
      sourceMinor: 1000,
      sourceCurrency: "GBP",
      targetCurrency: "USD",
      rate: "1.27",
    });
    expect(result.targetMinor).toBe(1270);
    expect(result.sourceScale).toBe(2);
    expect(result.targetScale).toBe(2);
  });

  it("respects a zero-decimal source currency", () => {
    // 1000 JPY is ¥1000, not ¥10.00. At 0.0064 GBP per JPY that is £6.40.
    // Getting the scale wrong here is a hundredfold error, which is the
    // reason currency-metadata.ts exists at all.
    const result = convertAmount({
      sourceMinor: 1000,
      sourceCurrency: "JPY",
      targetCurrency: "GBP",
      rate: "0.0064",
    });
    expect(result.targetMinor).toBe(640);
    expect(result.sourceScale).toBe(0);
  });

  it("respects a three-decimal target currency", () => {
    // $10.00 at 0.307 KWD per USD = 3.070 KWD = 3070 fils.
    const result = convertAmount({
      sourceMinor: 1000,
      sourceCurrency: "USD",
      targetCurrency: "KWD",
      rate: "0.307",
    });
    expect(result.targetMinor).toBe(3070);
    expect(result.targetScale).toBe(3);
  });

  it("carries everything needed to reproduce it without a provider call", () => {
    const result = convertAmount({
      sourceMinor: 12345,
      sourceCurrency: "EGP",
      targetCurrency: "USD",
      rate: "0.0207",
    });

    expect(result.rate).toBe("0.0207");
    expect(result.currencyMetadataVersion).toBe(CURRENCY_METADATA_VERSION);
    expect(result.conversionPolicyVersion).toBe(CONVERSION_POLICY_VERSION);

    // 123.45 EGP × 0.0207 = 2.555415 USD. The unrounded value keeps the
    // digits the money rounding discards, so the rounding is auditable
    // rather than something to take on trust — and it is canonical text,
    // so trailing zeros are absent and the scale is pinned by the policy
    // version rather than by the string's length.
    expect(result.unroundedResult).toBe("2.555415");
    expect(result.targetMinor).toBe(256);

    // Reproducing from the snapshot's own fields gives the same answer,
    // with no provider call and no rate table.
    expect(convertAmount({ ...result, sourceMinor: 12345 }).targetMinor).toBe(result.targetMinor);
  });

  it("rounds exactly once, at the end", () => {
    // 333 minor units at 1/3 is 111 exactly; a rate rounded first would
    // drift. 0.333333333333 × 333 = 110.999999999889 → 111.
    const result = convertAmount({
      sourceMinor: 333,
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      rate: "0.333333333333",
    });
    expect(result.targetMinor).toBe(111);
  });

  it("does not lose precision the way a float would", () => {
    // 0.1 + 0.2 territory: a double-based conversion of this rate drifts.
    const result = convertAmount({
      sourceMinor: 100_000_00,
      sourceCurrency: "USD",
      targetCurrency: "EGP",
      rate: "48.7213",
    });
    // 100000.00 × 48.7213 = 4,872,130.00 EGP exactly.
    expect(result.targetMinor).toBe(487_213_000);
  });

  it("refuses an unknown currency on either side", () => {
    expect(() =>
      convertAmount({ sourceMinor: 100, sourceCurrency: "ZZZ", targetCurrency: "USD", rate: "1" }),
    ).toThrow(UnknownCurrencyError);
    expect(() =>
      convertAmount({ sourceMinor: 100, sourceCurrency: "USD", targetCurrency: "ZZZ", rate: "1" }),
    ).toThrow(UnknownCurrencyError);
  });

  it("refuses a non-integer source amount", () => {
    expect(() =>
      convertAmount({ sourceMinor: 10.5, sourceCurrency: "USD", targetCurrency: "EUR", rate: "1" }),
    ).toThrow(TypeError);
  });
});
