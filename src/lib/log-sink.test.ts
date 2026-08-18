import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, redact } from "./log-sink";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LOG_SINK_URL;
  delete process.env.LOG_SINK_TOKEN;
});

/**
 * A log sink is a third-party system with its own retention and its own
 * breach surface, so anything that reaches it must be treated as
 * disclosed. These are the assertions that keep that true as fields get
 * added — "don't log secrets" is exactly the rule that decays, and
 * IDent's session 20 shipped an ingest token to its request log for
 * precisely that reason.
 */
describe("redaction", () => {
  it("removes credentials and message bodies, keeping the shape", () => {
    const safe = redact({
      event: "test",
      password: "hunter2",
      sessionToken: "abc",
      rawPayload: "the whole email",
      retainedEmail: { text: "..." },
      merchant: "Brew Bar",
      totalMinor: 350,
    });

    expect(safe.password).toBe("[redacted]");
    expect(safe.sessionToken).toBe("[redacted]");
    expect(safe.rawPayload).toBe("[redacted]");
    expect(safe.retainedEmail).toBe("[redacted]");
    // Non-sensitive fields survive, or the logs would be useless.
    expect(safe.merchant).toBe("Brew Bar");
    expect(safe.totalMinor).toBe(350);
  });

  it("never drops the event name", () => {
    expect(redact({ event: "scan.completed" }).event).toBe("scan.completed");
  });
});

describe("sending", () => {
  it("does nothing at all when no sink is configured", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    logEvent({ event: "scan.completed", messagesSeen: 25 });

    // Local development and any deployment without a sink stay silent —
    // no wasted request, no error, no dependency on a vendor.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts NDJSON with the token when configured", async () => {
    process.env.LOG_SINK_URL = "https://sink.example/ingest";
    process.env.LOG_SINK_TOKEN = "sink-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    logEvent({ event: "scan.completed", messagesSeen: 25, password: "hunter2" });
    // Outside a request scope `after()` throws and the send runs in the
    // background, so give the microtask a turn.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sink.example/ingest");
    expect(init.headers.authorization).toBe("Bearer sink-token");

    const line = JSON.parse(String(init.body).trim());
    expect(line.event).toBe("scan.completed");
    expect(line.messagesSeen).toBe(25);
    expect(line.password).toBe("[redacted]");
    // Every line carries when, where and which build wrote it.
    expect(line.at).toBeTruthy();
    expect(line.sha).toBeTruthy();
  });

  it("never throws when the sink is unreachable", async () => {
    process.env.LOG_SINK_URL = "https://sink.example/ingest";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    // A telemetry failure must not become an application failure.
    expect(() => logEvent({ event: "scan.completed" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
