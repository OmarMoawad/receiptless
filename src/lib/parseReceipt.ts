import type { CategoryName } from "@/lib/categories";

export type ParsedReceipt = {
  merchant: string;
  amount: number;
  currency: string;
  category: CategoryName;
  purchasedAt: string;
};

const CLAIM_PATH_PATTERN = /\/claim\/([A-Za-z0-9_-]+)/;
const CLAIM_SCHEME_PATTERN = /^receiptless:\/\/claim\/([A-Za-z0-9_-]+)/;

/**
 * A QR payload is either a claim link (opaque token, no receipt data in the
 * image itself — see the claim-token protocol in ROADMAP.md) or a legacy
 * inline payload (JSON or pipe-delimited) for retailers not yet on the
 * merchant API. This distinguishes the two so the scanner can route
 * accordingly instead of guessing.
 */
export function extractClaimToken(payload: string): string | null {
  const schemeMatch = payload.match(CLAIM_SCHEME_PATTERN);
  if (schemeMatch) return schemeMatch[1];
  const pathMatch = payload.match(CLAIM_PATH_PATTERN);
  if (pathMatch) return pathMatch[1];
  return null;
}

/**
 * Legacy inline payload parser for QR codes that encode receipt data
 * directly (JSON or merchant|amount|currency|isoDate) rather than a claim
 * token. Kept for retailers who can print a QR but can't yet integrate the
 * merchant API — expected to matter less over time as the claim protocol
 * spreads (see ROADMAP.md, Phase 1).
 */
export function parseInlinePayload(payload: string): ParsedReceipt {
  try {
    const json = JSON.parse(payload);
    return {
      merchant: json.merchant ?? "Unknown merchant",
      amount: Number(json.amount) || 0,
      currency: json.currency ?? "USD",
      category: (json.category as CategoryName) ?? "OTHER",
      purchasedAt: json.purchasedAt ?? new Date().toISOString(),
    };
  } catch {
    const parts = payload.split("|").map((p) => p.trim());
    const [merchant, amount, currency, purchasedAt] = parts;
    return {
      merchant: merchant || "Unknown merchant",
      amount: Number(amount) || 0,
      currency: currency || "USD",
      category: "OTHER",
      purchasedAt: purchasedAt || new Date().toISOString(),
    };
  }
}
