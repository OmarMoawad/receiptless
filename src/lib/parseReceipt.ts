export type CategoryName =
  | "GROCERIES"
  | "DINING"
  | "TRANSPORT"
  | "UTILITIES"
  | "HEALTH"
  | "SHOPPING"
  | "ENTERTAINMENT"
  | "TRAVEL"
  | "EDUCATION"
  | "OTHER";

export type ParsedReceipt = {
  merchant: string;
  amount: number;
  currency: string;
  category: CategoryName;
  purchasedAt: string;
};

/**
 * QR receipts commonly encode a JSON payload or a delimited string
 * (merchant|amount|currency|isoDate). Real POS integrations vary a lot,
 * so this is intentionally permissive for the MVP and expected to be
 * replaced by per-retailer adapters in later phases (see ROADMAP.md).
 */
export function parseQrPayload(payload: string): ParsedReceipt {
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
