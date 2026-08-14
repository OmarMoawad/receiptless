import type { GmailApiClient, GmailMessage, OAuthTokenResponse } from "./gmail-client";

/**
 * An in-memory GmailApiClient for tests: the network boundary is the one
 * thing tests must never cross, and a fake implementing the real interface
 * keeps that honest without mocking module internals.
 */
export type FakeGmailOptions = {
  messages?: GmailMessage[];
  profileEmail?: string;
  /** Message ids whose getMessage should throw, to exercise error isolation. */
  failingIds?: string[];
  /**
   * Message ids that return normally but whose *body* makes ingestion
   * throw. Needed to test the cursor clamp: a message must be dated before
   * it fails, which a getMessage-level throw never is.
   */
  poisonIds?: string[];
  exchange?: OAuthTokenResponse;
  refreshResponse?: OAuthTokenResponse;
};

export type FakeGmail = GmailApiClient & {
  calls: { refresh: number; exchange: number; list: number; get: string[] };
  lastListOptions: { after?: Date; max: number } | null;
};

export function createFakeGmail(options: FakeGmailOptions = {}): FakeGmail {
  const messages = options.messages ?? [];
  const failing = new Set(options.failingIds ?? []);
  const poison = new Set(options.poisonIds ?? []);
  const calls = { refresh: 0, exchange: 0, list: 0, get: [] as string[] };

  const fake: FakeGmail = {
    calls,
    lastListOptions: null,

    async exchangeCode() {
      calls.exchange += 1;
      return options.exchange ?? { accessToken: "access-1", refreshToken: "refresh-1", expiresInSeconds: 3600 };
    },

    async refresh() {
      calls.refresh += 1;
      return options.refreshResponse ?? { accessToken: "access-refreshed", expiresInSeconds: 3600 };
    },

    async getProfile() {
      return { emailAddress: options.profileEmail ?? "scanned@gmail.example" };
    },

    async listReceiptMessageIds(_accessToken, listOptions) {
      calls.list += 1;
      fake.lastListOptions = listOptions;
      return messages.slice(0, listOptions.max).map((message) => message.id);
    },

    async getMessage(_accessToken, id) {
      calls.get.push(id);
      if (failing.has(id)) throw new Error(`simulated Gmail failure for ${id}`);
      const message = messages.find((candidate) => candidate.id === id);
      if (!message) throw new Error(`no fake message ${id}`);
      // POISON is a body the ingestion pipeline rejects, so the failure
      // happens after toInboundEmail has read the Date header.
      return poison.has(id) ? { ...message, bodyText: "__POISON__" } : message;
    },
  };

  return fake;
}

export function fakeMessage(overrides: Partial<GmailMessage> & { id: string }): GmailMessage {
  return {
    from: "Shop <receipts@shop.example>",
    subject: "Your receipt",
    date: "Tue, 4 Aug 2026 10:15:00 +0000",
    bodyText: "Shop\nTea $2.00\nTOTAL $2.00",
    ...overrides,
  };
}
