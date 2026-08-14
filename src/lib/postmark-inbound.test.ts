import { describe, expect, it } from "vitest";
import { normalizePostmarkInbound } from "./postmark-inbound";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    MessageID: "message-1",
    MailboxHash: "mailbox-token",
    From: "shop@example.com",
    Subject: "Your receipt",
    TextBody: "SHOP\nTOTAL $12.50",
    HtmlBody: "<p>ignored</p>",
    ...overrides,
  };
}

describe("normalizePostmarkInbound", () => {
  it("normalizes the provider contract and prefers plain text", () => {
    expect(normalizePostmarkInbound(payload())).toEqual({
      provider: "postmark",
      providerMessageId: "message-1",
      mailboxToken: "mailbox-token",
      from: "shop@example.com",
      subject: "Your receipt",
      text: "SHOP\nTOTAL $12.50",
      receivedAt: null,
    });
  });

  it("parses the Date header when present, and ignores an unparseable one", () => {
    expect(normalizePostmarkInbound(payload({ Date: "Tue, 4 Aug 2026 10:15:00 +0000" })).receivedAt).toEqual(
      new Date("2026-08-04T10:15:00Z"),
    );
    expect(normalizePostmarkInbound(payload({ Date: "not a date" })).receivedAt).toBeNull();
  });

  it("turns HTML into bounded inert text when plain text is absent", () => {
    const result = normalizePostmarkInbound(
      payload({
        TextBody: "",
        HtmlBody: `<style>.hidden{}</style><script>alert(1)</script><h1>Store &amp; Co</h1><p>Total&nbsp;$9.00</p>${"x".repeat(60_000)}`,
      }),
    );
    expect(result.text).toContain("Store & Co");
    expect(result.text).toContain("Total $9.00");
    expect(result.text).not.toContain("alert(1)");
    expect(result.text.length).toBe(50_000);
  });

  it("rejects a payload without provider identity or mailbox routing", () => {
    expect(() => normalizePostmarkInbound(payload({ MessageID: "" }))).toThrow();
    expect(() => normalizePostmarkInbound(payload({ MailboxHash: "" }))).toThrow();
  });
});
