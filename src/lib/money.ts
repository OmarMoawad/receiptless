/**
 * Money is always stored and summed as integer minor units (cents) — never
 * a float — so aggregation across months/years and many receipts doesn't
 * accumulate floating-point rounding error.
 */
export function toMinorUnits(decimalAmount: number): number {
  return Math.round(decimalAmount * 100);
}

export function fromMinorUnits(minorUnits: number): number {
  return minorUnits / 100;
}

export function formatMinorUnits(minorUnits: number, currency = "USD"): string {
  return fromMinorUnits(minorUnits).toLocaleString(undefined, {
    style: "currency",
    currency,
  });
}
