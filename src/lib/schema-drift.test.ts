import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `readdirSync` is a *named* import in schema-drift.ts, so the binding is
 * resolved at module load and a `vi.spyOn` after the fact cannot reach it.
 * The module has to be mocked, hoisted, with a switch this file can flip
 * per test.
 */
const control = vi.hoisted(() => ({ impl: null as null | (() => unknown) }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readdirSync: (...args: unknown[]) =>
      control.impl ? control.impl() : (actual.readdirSync as (...a: unknown[]) => unknown)(...args),
  };
});

const { checkSchemaState } = await import("./schema-drift");

afterEach(() => {
  control.impl = null;
});

/**
 * The incident this exists to prevent: on 2026-08-19 production ran code
 * needing three tables the database did not have. `SELECT 1` succeeded
 * throughout, so `/api/health` reported 200 and the uptime monitor stayed
 * green while every login returned 500. The failure was found by trying
 * to log in.
 */
describe("schema drift", () => {
  it("reports ok when the database has every migration this build expects", async () => {
    // The real comparison, against the real migrations directory and the
    // real local database.
    const state = await checkSchemaState();
    expect(state.status).toBe("ok");
    expect(state.pending).toEqual([]);
  });

  it("names the migrations that are missing", async () => {
    // Exactly the incident: the build knows a migration the database has
    // never applied. Naming it is the difference between "something is
    // wrong" and a one-command fix.
    control.impl = () => [{ name: "29990101000000_not_yet_applied", isDirectory: () => true }];

    const state = await checkSchemaState();

    expect(state.status).toBe("behind");
    expect(state.pending).toEqual(["29990101000000_not_yet_applied"]);
  });

  it("reports unknown, not drift, when the migrations directory cannot be read", async () => {
    // A check that cries wolf gets muted, and a muted check is worse than
    // no check at all — so an unreadable directory must never look like
    // an outage.
    control.impl = () => {
      throw new Error("ENOENT");
    };

    expect((await checkSchemaState()).status).toBe("unknown");
  });

  it("reports unknown when the directory is readable but empty", async () => {
    control.impl = () => [];
    expect((await checkSchemaState()).status).toBe("unknown");
  });
});
