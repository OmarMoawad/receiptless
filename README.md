# receiptless

Paperless receipts, tracked automatically. Capture receipts by scanning a QR
code or uploading a photo, and see monthly/annual spend broken down by
category — installable as a PWA on any phone or desktop.

See [ROADMAP.md](./ROADMAP.md) for the full 1-year plan (native apps,
NFC/Bluetooth capture, POS/retailer integrations, marketplace launch).

## Stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript + Tailwind
- [Prisma](https://www.prisma.io) + SQLite (dev) via the `better-sqlite3` driver adapter
- [jsQR](https://github.com/cozmo/jsQR) for in-browser QR decoding
- [Recharts](https://recharts.org) for the spend dashboards
- PWA manifest + service worker for install-to-home-screen on any device

## Getting started

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

- `src/app/page.tsx` — dashboard (monthly/annual charts)
- `src/app/receipts` — receipt list + capture flow (QR / photo / manual)
- `src/app/api/receipts` — create/list receipts
- `src/app/api/reports` — monthly/annual aggregation endpoints
- `src/lib/parseReceipt.ts` — QR payload parser (seed for per-retailer adapters, see roadmap Phase 4)
- `prisma/schema.prisma` — `Receipt` model

## Notes

- Receipt photos are currently stored inline as data URLs for MVP simplicity;
  Phase 1 of the roadmap moves this to object storage (S3/R2).
- There's no auth yet — this is a single-user local MVP. Auth lands in Phase 1.
- NFC/Bluetooth capture isn't implemented yet — see the roadmap for why that's
  sequenced later (platform + retailer-partnership dependent, not just code).
