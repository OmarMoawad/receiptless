# receiptless — 1-year roadmap

Paperless receipt capture with monthly/annual financial reporting, delivered
cross-platform. This roadmap sequences the full vision (NFC, Bluetooth, WiFi,
QR, native apps, marketplace launch) into a year, ordered by what's cheap and
high-leverage first.

**Honest caveat up front:** "receive receipts via NFC/Bluetooth from any
retailer" is not purely an engineering problem — it requires the retailer's
POS to support pushing a receipt over that channel, and almost none do today.
Apple also restricts third-party NFC writing/HCE on iOS. So the realistic
path is: QR + photo + email-forwarded receipts cover ~90%+ of real-world
capture in year one, while NFC/BLE become available opportunistically as
POS partners are onboarded (Phase 4) and as native apps unlock platform NFC
APIs (Phase 3). This is sequenced deliberately so the product is useful long
before that partnership work lands.

## Phase 0 — MVP scaffold (done, day 1)
- Next.js PWA, installable on any phone/desktop via the browser
- Receipt capture: QR code scan (camera, `jsQR`), photo upload, manual entry
- SQLite + Prisma data layer, monthly/annual spend dashboard with charts
- Repo live, pushed private to GitHub

## Phase 1 — MVP hardening (Weeks 1–4)
- Deploy to a real host (Vercel) with Postgres (Neon/Supabase) replacing SQLite
- Single-user auth (email/password or magic link)
- Real object storage for receipt photos (S3/R2) instead of inline data URLs
- Basic OCR on uploaded photos (Tesseract.js client-side, or a cloud OCR API)
  to auto-fill merchant/amount instead of pure manual entry
- Closed beta with a handful of real users, daily-driver testing

## Phase 2 — Browser-native transfer (Months 2–3)
- Web Bluetooth API support for BLE beacon/peripheral receipt push
  (Android Chrome only — iOS Safari doesn't expose this)
- Web NFC API read support (Android Chrome only, same iOS limitation)
- Make the capture flow gracefully degrade: NFC/BLE where available, QR/photo
  everywhere else — this is the "works on all devices" guarantee for year one

## Phase 3 — Native apps (Months 3–5)
- React Native / Expo app for iOS and Android
- Unlocks real platform NFC (Android HCE read/write, iOS Core NFC read)
- Push notifications for new receipts, offline-first local cache with sync
- Camera capture UX improvements (auto-crop, auto-focus on receipt edges)

## Phase 4 — Retailer & POS integrations (Months 4–7)
- Partner integrations with POS platforms that already expose e-receipt APIs
  (Square, Clover, Toast, Shopify) — this is the actual unlock for "any
  transfer means," not a generic protocol
- Email receipt ingestion: forward-to address or Gmail/Outlook OAuth scan +
  parser, since most digital receipts already arrive this way today
- Per-retailer parser adapters (the `parseReceipt.ts` stub in the MVP is the
  seed of this)

## Phase 5 — Financial reporting maturity (Months 6–9)
- Budgets and spend alerts, category rules/auto-tagging
- CSV/PDF export, tax-category tagging
- Multi-currency support with historical FX rates
- Optional bank/card statement reconciliation (Plaid-style) to catch receipts
  the user never captured

## Phase 6 — Security & compliance (Months 7–10)
- Encryption at rest for financial data, audit log
- GDPR/CCPA-compliant data export and deletion
- Privacy policy, terms of service, data retention policy
- Penetration test / security review before wider launch

## Phase 7 — Marketplace submission (Months 9–11)
- App Store + Google Play submission (expect 1–4 weeks of review cycles,
  possible rejection/resubmission rounds — buffer for this explicitly)
- Marketing site, pricing page, onboarding flow polish
- App store screenshots, privacy nutrition labels, support channel

## Phase 8 — Public launch (Months 11–12)
- Public launch, monitor real usage, fix the inevitable long tail of bugs
- Feedback loop into Phase 4/5 priorities (which POS integrations matter,
  which report views people actually use)
- Infra scaling pass based on real load

---

Each phase assumes continued solo (or near-solo) part-time development.
Phases 4 and 7 are the ones most likely to slip — POS partnerships depend on
other companies' willingness to respond, and app store review timelines
aren't fully controllable. Everything before Phase 2 is already usable
end-to-end today.
