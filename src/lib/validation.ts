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
export const MAX_WARRANTY_MONTHS = 600;
export const MAX_RETURN_WINDOW_DAYS = 3650;
const POSTGRES_INT_MAX = 2_147_483_647;

export const warrantyMonthsSchema = z.number().int().positive().max(MAX_WARRANTY_MONTHS);
export const returnWindowDaysSchema = z.number().int().positive().max(MAX_RETURN_WINDOW_DAYS);
export const minorUnitSchema = z.number().int().min(0).max(POSTGRES_INT_MAX);

const coverageShape = {
  warrantyMonths: warrantyMonthsSchema,
  returnWindowDays: returnWindowDaysSchema,
};

export const receiptItemInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().max(100).optional(),
  category: categorySchema.default("OTHER"),
  quantity: z.number().positive().default(1),
  unitPriceMinor: z.number().int(),
  totalPriceMinor: z.number().int(),
  taxMinor: z.number().int().optional(),
  discountMinor: z.number().int().optional(),
  warrantyMonths: coverageShape.warrantyMonths.optional(),
  returnWindowDays: coverageShape.returnWindowDays.optional(),
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

/**
 * Phase 2 session 4: entering warranty/return metadata after the fact.
 *
 * Both fields are `.nullable()` here where `receiptItemInputSchema` above
 * has them merely optional, and the difference is the whole point of a
 * PATCH: *absent* means "leave this as it is", *null* means "clear it".
 * Collapsing the two would make a mistyped warranty impossible to undo.
 *
 * The upper bounds are sanity limits, not policy — 50 years of warranty
 * and 10 years of returns are both far beyond anything a real merchant
 * offers, and they stop a typo'd 24000 from rendering a date in the year
 * 4000 as though it were meaningful.
 */
export const itemCoverageSchema = z
  .object({
    warrantyMonths: coverageShape.warrantyMonths.nullable().optional(),
    returnWindowDays: coverageShape.returnWindowDays.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.warrantyMonths !== undefined || value.returnWindowDays !== undefined,
    { message: "Provide at least one coverage field" },
  );

export const receiptItemCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: categorySchema.default("OTHER"),
  quantity: z.number().positive().default(1),
  // Defaulted rather than required: this route exists so someone can track
  // a warranty on a receipt whose line items were never captured (manual
  // entry records no items at all, and two of the four email adapters
  // return none). Making them state a price they may not have to hand
  // would be an obstacle in front of the only feature they came for.
  unitPriceMinor: minorUnitSchema.default(0),
  totalPriceMinor: minorUnitSchema.default(0),
  warrantyMonths: coverageShape.warrantyMonths.nullable().optional(),
  returnWindowDays: coverageShape.returnWindowDays.nullable().optional(),
});
