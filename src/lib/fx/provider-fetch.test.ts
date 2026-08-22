import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { resolveRate } from "./rates";
import type { FxRateProvider, FxRateQuote } from "./provider";

/**
 * These cover the wiring that was missing until it was caught by an
 * end-to-end check: `resolveRate` reading the configured provider's id but
 * never actually calling `fetchRate`, so a configured provider populated
 * nothing and every conversion fell through to "unavailable".
 *
 * A fake provider stands in for the real Apify one, with a unique `id` per
 * test so the provider rows it writes never collide across the suite's
 * shared Postgres.
 */
class FakeProvider implements FxRateProvider {
  public calls = 0;
  constructor(
    public readonly id: string,
    public readonly policyVersion: string,
    private readonly quote: FxRateQuote | null,
  ) {}

  async fetchRate(): Promise<FxRateQuote | null> {
    this.calls += 1;
    return this.quote;
  }
}

const OWNER = "no-such-owner"; // Only the provider path is exercised here.

describe("resolveRate reaching a provider on a miss", () => {
  it("fetches, persists, and returns a rate that was not on file", async () => {
    const source = `fake-${randomUUID().slice(0, 8)}`;
    const provider = new FakeProvider(source, "fake@1", {
      rate: "0.0199",
      effectiveDate: new Date(Date.UTC(2026, 2, 5)),
      providerReference: "ref-1",
    });

    const resolved = await resolveRate(
      { ownerId: OWNER, base: "EGP", quote: "USD", on: new Date(Date.UTC(2026, 2, 5)) },
      provider,
    );

    expect(provider.calls).toBe(1);
    expect(resolved?.rate).toBe("0.0199");
    expect(resolved?.source).toBe(source);

    // The fetched rate was actually written to fx_rates, as a shared
    // provider row (no owner).
    const stored = await prisma.fxRate.findMany({ where: { source } });
    expect(stored).toHaveLength(1);
    expect(stored[0].ownerId).toBeNull();
    expect(stored[0].rate).toBe("0.0199");
    expect(stored[0].providerReference).toBe("ref-1");
    expect(stored[0].fetchedAt).not.toBeNull();
  });

  it("does not fetch a second time for a rate it already stored", async () => {
    const source = `fake-${randomUUID().slice(0, 8)}`;
    const provider = new FakeProvider(source, "fake@1", {
      rate: "0.0207",
      effectiveDate: new Date(Date.UTC(2026, 2, 5)),
    });
    const query = { ownerId: OWNER, base: "EGP", quote: "USD", on: new Date(Date.UTC(2026, 2, 5)) };

    await resolveRate(query, provider);
    await resolveRate(query, provider);
    await resolveRate(query, provider);

    // The fetch is the billable, rate-limited part — it must happen once.
    expect(provider.calls).toBe(1);
    expect(await prisma.fxRate.count({ where: { source } })).toBe(1);
  });

  it("returns null and stores nothing when the provider has no rate", async () => {
    const source = `fake-${randomUUID().slice(0, 8)}`;
    const provider = new FakeProvider(source, "fake@1", null);

    const resolved = await resolveRate(
      { ownerId: OWNER, base: "EGP", quote: "USD", on: new Date(Date.UTC(2026, 2, 5)) },
      provider,
    );

    expect(resolved).toBeNull();
    expect(await prisma.fxRate.count({ where: { source } })).toBe(0);
  });

  it("marks a rate that reached back over a non-trading day", async () => {
    const source = `fake-${randomUUID().slice(0, 8)}`;
    // Asked for the 8th (a Sunday); provider answers with the 6th.
    const provider = new FakeProvider(source, "fake@1", {
      rate: "1.27",
      effectiveDate: new Date(Date.UTC(2026, 2, 6)),
    });

    const resolved = await resolveRate(
      { ownerId: OWNER, base: "GBP", quote: "USD", on: new Date(Date.UTC(2026, 2, 8)) },
      provider,
    );

    expect(resolved?.reachedBack).toBe(true);
    expect(resolved?.effectiveDate.toISOString().slice(0, 10)).toBe("2026-03-06");
  });

  it("rejects and does not persist a provider rate dated outside the window", async () => {
    const source = `fake-${randomUUID().slice(0, 8)}`;
    // The resolver owns the seven-day lookback; a provider that answers with
    // a rate 30 days stale must not have it stored and silently reused.
    const provider = new FakeProvider(source, "fake@1", {
      rate: "0.0207",
      effectiveDate: new Date(Date.UTC(2026, 1, 3)),
    });

    const resolved = await resolveRate(
      { ownerId: OWNER, base: "EGP", quote: "USD", on: new Date(Date.UTC(2026, 2, 5)) },
      provider,
    );

    expect(resolved).toBeNull();
    expect(await prisma.fxRate.count({ where: { source } })).toBe(0);
  });

  it("lets an owner's manual rate win without ever calling the provider", async () => {
    const source = `fake-${randomUUID().slice(0, 8)}`;
    const provider = new FakeProvider(source, "fake@1", {
      rate: "0.0100",
      effectiveDate: new Date(Date.UTC(2026, 2, 5)),
    });

    // A real owner with a manual rate for the same pair and day.
    const user = await prisma.user.create({
      data: { username: `fx_${randomUUID().slice(0, 12)}`, passwordHash: "x" },
    });
    await prisma.fxRate.create({
      data: {
        ownerId: user.id,
        base: "EGP",
        quote: "USD",
        effectiveDate: new Date(Date.UTC(2026, 2, 5)),
        rate: "0.0207",
        source: "manual",
        sourcePolicyVersion: "manual-entry@1",
      },
    });

    const resolved = await resolveRate(
      { ownerId: user.id, base: "EGP", quote: "USD", on: new Date(Date.UTC(2026, 2, 5)) },
      provider,
    );

    expect(resolved?.rate).toBe("0.0207");
    expect(resolved?.source).toBe("manual");
    // The manual rate short-circuits before the provider is consulted.
    expect(provider.calls).toBe(0);
  });
});
