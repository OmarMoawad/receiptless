import { describe, expect, it, vi } from "vitest";
import { parseRate } from "../convert";
import {
  ApifyCbeProvider,
  cbeRateToCanonicalString,
  fromCbeDate,
  quoteFromRows,
  toCbeDate,
  type CbeRow,
} from "./apify-cbe";

/**
 * The real payload, captured from a live actor run on 2026-08-21 for
 * 1–5 March 2026 with currencies USD and EUR. Kept verbatim — including
 * the numbers as JSON doubles — so these tests exercise the exact shape
 * and precision the provider has to survive, not a tidied-up version of it.
 */
const SAMPLE: CbeRow[] = [
  {
    date: "05/03/2026",
    base: "USD",
    base_name: "US Dollar",
    target: "EGP",
    target_name: "Egyptian Pound",
    buy: 50.0887,
    sell: 50.2271,
    conversion_rate: 50.1579,
  },
  {
    date: "05/03/2026",
    base: "EGP",
    base_name: "Egyptian Pound",
    target: "USD",
    target_name: "US Dollar",
    buy: 0.0199,
    sell: 0.02,
    conversion_rate: 0.0199,
  },
];

/** An inclusive window that comfortably contains the SAMPLE rows' 05/03. */
const SAMPLE_WINDOW = {
  from: new Date(Date.UTC(2026, 1, 26)),
  on: new Date(Date.UTC(2026, 2, 5)),
};

describe("CBE date format", () => {
  it("writes the DD/MM/YYYY the actor expects, in UTC", () => {
    expect(toCbeDate(new Date(Date.UTC(2026, 2, 5)))).toBe("05/03/2026");
    expect(toCbeDate(new Date(Date.UTC(2026, 0, 1)))).toBe("01/01/2026");
  });

  it("reads it back, and rejects an impossible date rather than rolling over", () => {
    expect(fromCbeDate("05/03/2026")?.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    // 31 February must not silently become 2 or 3 March.
    expect(fromCbeDate("31/02/2026")).toBeNull();
    expect(fromCbeDate("2026-03-05")).toBeNull();
    expect(fromCbeDate("garbage")).toBeNull();
  });
});

describe("bridging a JSON double to a canonical rate string", () => {
  it("reproduces CBE's published precision exactly", () => {
    // These are the values that would otherwise arrive as doubles. Each
    // must come back as the exact text CBE published, and must pass the
    // canonical-decimal validator the rest of the system enforces.
    for (const [value, expected] of [
      [50.1579, "50.1579"],
      [0.0199, "0.0199"],
      [0.02, "0.02"],
      [50.2271, "50.2271"],
    ] as const) {
      const text = cbeRateToCanonicalString(value);
      expect(text).toBe(expected);
      // Not merely equal-looking: actually accepted as a canonical rate.
      expect(parseRate(text!).text).toBe(expected);
    }
  });

  it("refuses a value it cannot represent, rather than guessing", () => {
    expect(cbeRateToCanonicalString(undefined)).toBeNull();
    expect(cbeRateToCanonicalString(0)).toBeNull();
    expect(cbeRateToCanonicalString(-1)).toBeNull();
    expect(cbeRateToCanonicalString(Number.NaN)).toBeNull();
    // A magnitude that serialises in exponential form is outside CBE's
    // range and is refused so it can never become a wrong rate.
    expect(cbeRateToCanonicalString(1e-7)).toBeNull();
  });
});

describe("picking the row for a pair", () => {
  it("reads the mid rate for the requested direction", () => {
    const quote = quoteFromRows(SAMPLE, "EGP", "USD", "mid", SAMPLE_WINDOW);
    expect(quote?.rate).toBe("0.0199");
    expect(quote?.effectiveDate.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(quote?.providerReference).toBe("cbe:05/03/2026:EGP/USD:mid");
  });

  it("reads the other direction from the same payload", () => {
    // Requesting one currency returns both directions, so USD->EGP is
    // present in the very same response as EGP->USD.
    expect(quoteFromRows(SAMPLE, "USD", "EGP", "mid", SAMPLE_WINDOW)?.rate).toBe("50.1579");
  });

  it("honours the chosen side", () => {
    expect(quoteFromRows(SAMPLE, "USD", "EGP", "buy", SAMPLE_WINDOW)?.rate).toBe("50.0887");
    expect(quoteFromRows(SAMPLE, "USD", "EGP", "sell", SAMPLE_WINDOW)?.rate).toBe("50.2271");
    expect(quoteFromRows(SAMPLE, "USD", "EGP", "mid", SAMPLE_WINDOW)?.rate).toBe("50.1579");
  });

  it("returns null for a pair the payload does not contain", () => {
    expect(quoteFromRows(SAMPLE, "EUR", "USD", "mid", SAMPLE_WINDOW)).toBeNull();
  });

  it("selects the newest valid row in the window, whatever the row order", () => {
    // A range request returns several days. The published Friday rate must
    // win over an older Thursday one even when the actor lists Thursday
    // last — selection is by effective date, not response order.
    const thursday: CbeRow = {
      date: "05/03/2026",
      base: "EGP",
      target: "USD",
      conversion_rate: 0.0198,
    };
    const friday: CbeRow = {
      date: "06/03/2026",
      base: "EGP",
      target: "USD",
      conversion_rate: 0.0199,
    };
    const window = { from: new Date(Date.UTC(2026, 2, 1)), on: new Date(Date.UTC(2026, 2, 8)) };

    const fromEitherOrder = (rows: CbeRow[]) => quoteFromRows(rows, "EGP", "USD", "mid", window);
    expect(fromEitherOrder([thursday, friday])?.effectiveDate.toISOString()).toBe(
      "2026-03-06T00:00:00.000Z",
    );
    expect(fromEitherOrder([friday, thursday])?.rate).toBe("0.0199");
  });

  it("rejects a row dated before the window floor or after the purchase date", () => {
    const stale: CbeRow = { date: "20/02/2026", base: "EGP", target: "USD", conversion_rate: 0.02 };
    const future: CbeRow = { date: "10/03/2026", base: "EGP", target: "USD", conversion_rate: 0.021 };
    // Window is 01–08 March; both rows are outside it in opposite directions.
    const window = { from: new Date(Date.UTC(2026, 2, 1)), on: new Date(Date.UTC(2026, 2, 8)) };
    expect(quoteFromRows([stale], "EGP", "USD", "mid", window)).toBeNull();
    expect(quoteFromRows([future], "EGP", "USD", "mid", window)).toBeNull();
    // The in-window row survives even when out-of-window rows sit beside it.
    const inWindow: CbeRow = { date: "05/03/2026", base: "EGP", target: "USD", conversion_rate: 0.0199 };
    expect(quoteFromRows([stale, inWindow, future], "EGP", "USD", "mid", window)?.rate).toBe("0.0199");
  });
});

describe("ApifyCbeProvider.fetchRate", () => {
  function fakeFetch(
    rows: CbeRow[],
    capture?: (url: string, body: unknown, init: RequestInit) => void,
  ) {
    return vi.fn(async (url: string, init: RequestInit) => {
      capture?.(url, JSON.parse(String(init.body)), init);
      return new Response(JSON.stringify(rows), { status: 200 });
    });
  }

  /** Headers as a plain object, however the caller expressed them. */
  function headersOf(init: RequestInit): Record<string, string> {
    return Object.fromEntries(new Headers(init.headers).entries());
  }

  const MARCH_5 = { from: new Date(Date.UTC(2026, 1, 26)), on: new Date(Date.UTC(2026, 2, 5)) };

  it("requests the whole window and the non-EGP currency, then returns the mid", async () => {
    let sentUrl = "";
    let sentBody: Record<string, unknown> = {};
    const provider = new ApifyCbeProvider({
      token: "tok",
      side: "mid",
      fetchImpl: fakeFetch(SAMPLE, (url, body) => {
        sentUrl = url;
        sentBody = body as Record<string, unknown>;
      }),
    });

    const quote = await provider.fetchRate("EGP", "USD", MARCH_5);

    expect(quote?.rate).toBe("0.0199");
    // Requested the non-EGP side, the inclusive window, mid only, no cross.
    expect(sentBody.currencies).toEqual(["USD"]);
    expect(sentBody.fromDate).toBe("26/02/2026");
    expect(sentBody.toDate).toBe("05/03/2026");
    expect(sentBody.includeConversionRate).toBe(true);
    expect(sentBody.includeBuySell).toBe(false);
    expect(sentBody.includeCrossRates).toBe(false);
    // The actor id uses the API's ~ form, and the token is NOT in the URL.
    expect(sentUrl).toContain("central-bank-of-egypt-historical-rates");
    expect(sentUrl).not.toContain("tok");
    expect(sentUrl).not.toContain("token=");
  });

  it("sends the token as a Bearer Authorization header, never in the URL", async () => {
    let sentUrl = "";
    let sentInit: RequestInit = {};
    const provider = new ApifyCbeProvider({
      token: "secret-token",
      fetchImpl: fakeFetch(SAMPLE, (url, _body, init) => {
        sentUrl = url;
        sentInit = init;
      }),
    });

    await provider.fetchRate("EGP", "USD", MARCH_5);

    expect(headersOf(sentInit).authorization).toBe("Bearer secret-token");
    expect(sentUrl).not.toContain("secret-token");
  });

  it("puts the side into the policy version so a change is a new version", () => {
    expect(new ApifyCbeProvider({ token: "t", side: "mid" }).policyVersion).toBe("cbe-mid@1");
    expect(new ApifyCbeProvider({ token: "t", side: "buy" }).policyVersion).toBe("cbe-buy@1");
  });

  it("asks for cross rates only when neither side is EGP", async () => {
    let sentBody: Record<string, unknown> = {};
    const provider = new ApifyCbeProvider({
      token: "t",
      fetchImpl: fakeFetch([], (_url, body) => {
        sentBody = body as Record<string, unknown>;
      }),
    });

    await provider.fetchRate("EUR", "USD", MARCH_5);
    expect(sentBody.includeCrossRates).toBe(true);
    expect(sentBody.currencies).toEqual(["EUR", "USD"]);
  });

  it("discovers Friday's rate for a Sunday purchase in one range request", async () => {
    // Purchase on Sunday 08/03; the actor returns the range and the newest
    // trading day in it is Friday 06/03. One call, no retry loop.
    const friday: CbeRow = { date: "06/03/2026", base: "EGP", target: "USD", conversion_rate: 0.0199 };
    let calls = 0;
    const provider = new ApifyCbeProvider({
      token: "t",
      fetchImpl: vi.fn(async () => {
        calls += 1;
        return new Response(JSON.stringify([friday]), { status: 200 });
      }),
    });

    const quote = await provider.fetchRate("EGP", "USD", {
      from: new Date(Date.UTC(2026, 2, 1)),
      on: new Date(Date.UTC(2026, 2, 8)),
    });

    expect(calls).toBe(1);
    expect(quote?.effectiveDate.toISOString()).toBe("2026-03-06T00:00:00.000Z");
  });

  it("returns null when the actor has no row for the pair", async () => {
    const provider = new ApifyCbeProvider({ token: "t", fetchImpl: fakeFetch([]) });
    expect(await provider.fetchRate("EGP", "USD", MARCH_5)).toBeNull();
  });

  it("throws on a non-OK response rather than inventing a rate", async () => {
    const provider = new ApifyCbeProvider({
      token: "t",
      fetchImpl: vi.fn(async () => new Response("nope", { status: 429, statusText: "Too Many Requests" })),
    });
    await expect(provider.fetchRate("EGP", "USD", MARCH_5)).rejects.toThrow(/429/);
  });
});
