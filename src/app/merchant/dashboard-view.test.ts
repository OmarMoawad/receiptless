import { describe, expect, it } from "vitest";
import { dashboardControlsFor } from "./dashboard-view";

describe("merchant dashboard role-aware controls", () => {
  it("gives an OWNER every control", () => {
    expect(dashboardControlsFor("OWNER")).toEqual({
      canManageLocations: true,
      canManageMembers: true,
      canManageKeys: true,
      canManageAccount: true,
    });
  });

  it("lets an ADMIN manage locations, members and keys but not the account itself", () => {
    expect(dashboardControlsFor("ADMIN")).toEqual({
      canManageLocations: true,
      canManageMembers: true,
      canManageKeys: true,
      canManageAccount: false,
    });
  });

  it("lets a DEVELOPER manage keys only (locations read, not manage)", () => {
    expect(dashboardControlsFor("DEVELOPER")).toEqual({
      canManageLocations: false,
      canManageMembers: false,
      canManageKeys: true,
      canManageAccount: false,
    });
  });

  it("gives a VIEWER no mutation controls at all", () => {
    expect(dashboardControlsFor("VIEWER")).toEqual({
      canManageLocations: false,
      canManageMembers: false,
      canManageKeys: false,
      canManageAccount: false,
    });
  });
});
