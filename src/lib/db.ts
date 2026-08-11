import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Session 1 (RECEIPTLESS_STATE.md): swapped SQLite for Postgres, mirroring
// IDent's own Phase 0A infra move — no schema *shape* change, just the
// storage layer. The fallback matches docker-compose.yml's fixed local-dev
// credentials exactly (same convention as IDent's own db/pool.ts) — this
// is what lets `npm run test` work without vitest needing its own .env
// loading, since vitest (unlike `next dev`) doesn't load .env by default.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? "postgresql://receiptless:receiptless@localhost:5433/receiptless",
});

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
