import { describe, expect, it } from "vitest";
import { parseCoverageInput } from "@/components/CoverageEditor";

describe("coverage editor input validation", () => {
  it("rejects values beyond the server limits before submitting", () => {
    expect(parseCoverageInput("601", 600)).toBeUndefined();
    expect(parseCoverageInput("3651", 3650)).toBeUndefined();
  });

  it("keeps empty input distinct from invalid input", () => {
    expect(parseCoverageInput("", 600)).toBeNull();
    expect(parseCoverageInput("12", 600)).toBe(12);
  });
});
