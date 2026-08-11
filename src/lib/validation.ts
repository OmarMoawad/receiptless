import { z } from "zod";
import { CATEGORIES } from "@/lib/categories";

const SOURCES = [
  "QR",
  "PHOTO",
  "MANUAL",
  "NFC",
  "BLUETOOTH",
  "EMAIL",
  "POS_API",
] as const;

const categorySchema = z.enum(CATEGORIES);
const sourceSchema = z.enum(SOURCES);

export const receiptItemInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional(),
  category: categorySchema.default("OTHER"),
  quantity: z.number().positive().default(1),
  unitPriceMinor: z.number().int(),
  totalPriceMinor: z.number().int(),
  taxMinor: z.number().int().optional(),
  discountMinor: z.number().int().optional(),
  warrantyMonths: z.number().int().positive().optional(),
  returnWindowDays: z.number().int().positive().optional(),
});

export const createReceiptSchema = z.object({
  merchant: z.string().trim().min(1).max(200),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .default("USD"),
  totalMinor: z.number().int(),
  subtotalMinor: z.number().int().optional(),
  taxMinor: z.number().int().optional(),
  discountMinor: z.number().int().optional(),
  feeMinor: z.number().int().optional(),
  category: categorySchema.default("OTHER"),
  purchasedAt: z.iso.datetime({ offset: true }).or(z.iso.date()),
  source: sourceSchema.default("MANUAL"),
  // No inline image field here (Session 4, RECEIPTLESS_STATE.md) — a photo
  // is uploaded separately via POST /api/receipts/[id]/photo once the
  // receipt exists, so it goes through real object storage from the start
  // instead of ever touching an inline data: URL.
  rawPayload: z.string().max(10_000).optional(),
  notes: z.string().max(2_000).optional(),
  items: z.array(receiptItemInputSchema).max(200).optional(),
});

export const merchantReceiptSchema = createReceiptSchema.extend({
  source: sourceSchema.default("POS_API"),
  merchantWebsite: z.string().url().optional(),
  claimTtlMinutes: z.number().int().positive().max(60 * 24 * 30).default(60 * 24),
});
