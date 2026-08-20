import { describe, expect, it } from "vitest";
import { receiptItemInputSchema } from "@/lib/validation";

describe("receipt item coverage validation", () => {
  const baseItem = {
    name: "Kettle",
    quantity: 1,
    unitPriceMinor: 100,
    totalPriceMinor: 100,
  };

  it.each([
    [{ warrantyMonths: 601 }, "warranty"],
    [{ returnWindowDays: 3651 }, "return window"],
  ])("applies shared bounds to receipt creation for %s", (coverage, _label) => {
    expect(receiptItemInputSchema.safeParse({ ...baseItem, ...coverage }).success).toBe(false);
  });
});
