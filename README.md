# receiptless

**Every receipt. Automatically. Forever.**

An interoperable digital receipt identity and delivery layer. A purchase
generates a structured digital receipt that reaches your private receipt
vault through whichever channel is available — QR claim link, photo, email,
POS API, or eventually NFC/BLE — gets normalized into one canonical format,
and stays permanently searchable: warranty windows, return windows, tax
categorization, and spend intelligence, all generated automatically instead
of hand-entered.

See [ROADMAP.md](./ROADMAP.md) for the full plan — canonical receipt schema,
the QR claim-token protocol, merchant API/SDK, receipt authenticity/
signatures, merchant terminal + payment-authorization integration, native
apps with platform NFC, and financial intelligence.

See [RECEIPTLESS_STATE.md](./RECEIPTLESS_STATE.md) for exactly what's
currently done vs. pending, and the session-by-session cadence Phase 1 is
being built in — read that before writing any code here.

## Stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind
- [Prisma](https://www.prisma.io) + Postgres via the `@prisma/adapter-pg` driver adapter
- [Vitest](https://vitest.dev) for tests, run against a real local Postgres (no mocked DB)
- [Zod](https://zod.dev) for API input validation
- [jsQR](https://github.com/cozmo/jsQR) for in-browser QR decoding
- [Recharts](https://recharts.org) for the spend dashboards
- PWA manifest + service worker for install-to-home-screen on any device

## Getting started

```bash
cp .env.example .env
npm install
docker compose up -d          # starts Postgres on localhost:5433
npm run db:generate           # generate the Prisma client
npm run db:migrate            # apply migrations
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks (same as CI)

```bash
npm run typecheck
npm run test
npm run build
```

## Data model

`Merchant` → `Receipt` → `ReceiptItem`, with money always stored as integer
minor units (cents) rather than floats, and a `verification` ladder
(`UNVERIFIED` → `IMPORTED` → `MERCHANT_VERIFIED`, with cryptographic
signatures planned) so the system can eventually distinguish a photographed
receipt from an authoritative one issued by the merchant.

## The QR claim-token protocol

Instead of encoding receipt data directly in a QR image, a merchant/terminal
calls `POST /api/merchant/receipts` to create the receipt server-side and
gets back an opaque, expiring, **single-use claim token**. The QR (or link)
encodes only that token. Scanning it hits `GET /api/claim/:token` or the
`/claim/:token` web page, which resolves the real receipt and marks it
claimed — atomically, so it can't be claimed twice, and any later request
with the same token (even before it expires) is rejected with `409` rather
than silently re-serving the receipt. See `src/lib/claim.ts`.

Why this instead of embedding data in the QR: no sensitive receipt data sits
in a scannable image indefinitely, tokens expire, are single-use, and are
revocable, receipts can be signed, and any POS that can display a QR can
participate — no
Bluetooth stack or iOS NFC workaround required. See `ROADMAP.md` for why
this is sequenced ahead of NFC/BLE.

Legacy inline QR payloads (raw JSON or `merchant|amount|currency|date`) are
still parsed as a fallback for retailers who print a QR without integrating
the merchant API — see `src/lib/parseReceipt.ts`.

## Project structure

- `src/app/page.tsx` — dashboard (monthly/annual charts)
- `src/app/receipts` — vault list (with search) + capture flow (QR / photo / manual)
- `src/app/claim/[token]` — public claim-link resolution page
- `src/app/api/receipts` — consumer create/list
- `src/app/api/merchant/receipts` — merchant/terminal push (claim-token issuance)
- `src/app/api/claim/[token]` — claim-token resolution API
- `src/app/api/search` — vault search
- `src/app/api/reports` — monthly/annual aggregation
- `src/lib/validation.ts` — Zod schemas for every write path
- `src/lib/money.ts` — minor-unit money helpers
- `prisma/schema.prisma` — `Merchant` / `Receipt` / `ReceiptItem` models

## Notes

- Receipt photos are currently stored inline as data URLs for MVP simplicity;
  Phase 1 of the roadmap moves this to object storage (S3/R2).
- There's no multi-user auth yet — every receipt lives in one shared vault.
  Auth lands in Phase 1.
- `/api/merchant/receipts` is unauthenticated and meant for local/demo use —
  Phase 3 adds real merchant API keys before this is exposed publicly. It
  intentionally marks everything it creates `UNVERIFIED`, not
  `MERCHANT_VERIFIED`: that label must mean "an authenticated merchant key
  created this," which doesn't exist until Phase 3 lands. It also never
  updates an *existing* merchant's `website` from request input — only sets
  one when creating a brand-new `Merchant` row — since an unauthenticated
  caller shouldn't be able to mutate shared reference data by name alone.
- NFC/Bluetooth capture isn't implemented yet — see the roadmap for why
  that's sequenced after the claim-token protocol and merchant API rather
  than first (platform + retailer-partnership dependent, not just code).
