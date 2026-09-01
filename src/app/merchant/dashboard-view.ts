import type { MerchantRole } from "@/generated/prisma/client";
import { roleHasCapability } from "@/lib/merchant/types";

/**
 * Phase 3 Session 1. The pure decision of which dashboard controls a given
 * role may see, kept out of the React component so it can be unit-tested at
 * the same altitude as the rest of this repo (which has no DOM-render test
 * harness — the interactive UI itself is verified by the Session 1 browser
 * click-through gate).
 *
 * Hiding a control is a convenience, never the authority: the server
 * re-checks every capability on each request, so a hidden button that is
 * somehow invoked is still refused. This view-model exists so the two agree.
 */
export type DashboardControls = {
  canManageLocations: boolean;
  canManageMembers: boolean;
  canManageKeys: boolean;
  canManageAccount: boolean;
};

export function dashboardControlsFor(role: MerchantRole): DashboardControls {
  return {
    canManageLocations: roleHasCapability(role, "locations.manage"),
    canManageMembers: roleHasCapability(role, "members.manage"),
    canManageKeys: roleHasCapability(role, "keys.manage"),
    canManageAccount: roleHasCapability(role, "account.manage"),
  };
}
