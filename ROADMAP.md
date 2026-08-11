# receiptless — roadmap

## What this actually is

The narrow version of this product is "an app for photographing receipts and
seeing spending charts." That already exists in many forms and isn't
defensible.

The version this roadmap builds toward:

**receiptless is an interoperable digital receipt identity and delivery
layer.** Instead of a paper slip, a purchase generates a structured digital
receipt that reaches the customer's private receipt vault through whichever
channel is available — QR claim link, retailer account, email, POS API,
NFC/BLE where technically possible, or eventually a standardized
machine-to-machine handoff at the point of payment authorization.

```
purchase → receipt automatically received → itemized data normalized
  → permanently searchable → warranty/return/tax data preserved
  → spending intelligence generated automatically
```

Payment infrastructure answers *how did I pay*. receiptless answers
*what did I buy* — and keeps that answer forever. That positions it adjacent
to payment infrastructure without requiring receiptless to become a payment
processor itself.

**Positioning:** not "another expense tracker." *Every receipt.
Automatically. Forever.* One place for everything you've bought — receipts,
warranties, returns, and spending, organized without you doing anything.
Paper reduction is a real and pleasant side effect, not the primary pitch —
the sharper hook is "I never lose proof of purchase again," because that's
what actually drives someone to change behavior at checkout.

## Relationship to IDent (documented intent, not built)

receiptless is being developed as a standalone product, and stays that
way for now — no code or repo merge planned. Separately, Omar is building
[IDent](https://github.com/OmarMoawad/IDent) (`/Users/Omar/IDent`), a
broader personal-identity platform. The decision (2026-08-10, captured in
IDent's own ROADMAP.md/ARCHITECTURE.md/IDent_STATE.md): if the two
integrate later, IDent becomes receiptless's **identity authority**, not
its owner:

- receiptless would store an `ownerSubjectId` referencing IDent's
  `identity_id` once receiptless has real multi-user accounts (Phase 1,
  above) and IDent has a consent/scoped-alias system (neither exists
  yet) — not a duplicated user/auth table of its own.
- **Repos stay separate**, integrated through explicit API contracts
  (identity resolution, consent checks), not a monorepo merge.
- Merchant-facing checkout would eventually use a scoped, pseudonymous
  identifier per merchant relationship rather than one identifier handed
  to every merchant — this is a real, not-yet-designed IDent-side gap
  (see IDent_STATE.md's future architecture gaps log), and receiptless is
  the first concrete driver for it.
- Branding likely stays "receiptless" (possibly "Receiptless — by IDent"
  later) rather than being absorbed into the IDent name.

Nothing here changes this roadmap's own phases below — they're written to
stand on their own regardless of whether the IDent integration ever
happens.

## The five layers

1. **Capture** — QR, camera/OCR, email, POS API, NFC/BLE, manual entry.
   These are connectors, not the product.
2. **Normalization** — every input becomes one canonical Receipt object
   (merchant, line items, taxes, discounts, payment metadata, warranty/return
   metadata, verification level), regardless of which connector produced it.
3. **Vault** — the consumer-facing core: permanent, searchable purchase
   history. *"Everything I bought from Carrefour in 2026." "What's still
   under warranty?" "I need to return this."*
4. **Intelligence** — budgets, category trends, subscription detection,
   price-change/inflation tracking, tax export. The charts from the first
   build are one module here, not the product's identity.
5. **Network** — the ambitious endgame: merchants integrate against a
   receiptless API/SDK, and eventually checkout terminals themselves speak
   the claim-token protocol natively. This layer is genuinely a
   business-development problem, not a coding problem — sequenced
   accordingly below.

## Data model direction

A receipt isn't just `merchant + total + date`. The canonical object this
schema is converging toward:

```
Receipt
 ├── Merchant (+ location, once POS data supports it)
 ├── line items (product, quantity, unit price, discount, tax, SKU)
 ├── subtotal / taxes / discounts / fees / total (integer minor units, never float)
 ├── payment metadata
 ├── warranty / return metadata
 ├── verification level (UNVERIFIED → IMPORTED → MERCHANT_VERIFIED → signed)
 └── source + claim-token provenance
```

Item-level data is where most of the long-term value lives: knowing you
bought *an iPhone, a USB cable, aspirin, milk* unlocks warranty tracking,
return windows, and personal inflation data in a way "Apple — $1,200" never
will.

## Phase 0 — Canonical foundation (done)

- `Merchant` + `Receipt` + `ReceiptItem` schema — line items, integer
  minor-unit money (no floats for currency, ever), verification levels
- **QR claim-token protocol**: `POST /api/merchant/receipts` simulates a
  merchant/terminal pushing an authoritative receipt server-side and getting
  back an opaque, expiring claim token — never raw receipt data in the QR
  image itself. `GET /api/claim/:token` and the `/claim/:token` web page
  resolve it. This is deliberately sequenced *before* BLE/NFC: it needs no
  Bluetooth stack, no iOS NFC workaround, and any POS that can display a QR
  can participate — no protocol negotiation required on the merchant side.
- Legacy inline QR payload parsing kept as a fallback for retailers who
  print a QR but haven't integrated the merchant API
- Zod validation at every API boundary (amount types, currency, dates, enum
  values, payload size) instead of trusting raw request bodies
- Minimal vault search (`/api/search`) across merchant and item names —
  proof that "find my AirPods receipt" works before investing in a real
  search index
- PWA capture (QR scan, photo, manual), monthly/annual dashboard

## Phase 1 — Reliable ingestion + accounts (Weeks 1–6)

- Real hosting (Vercel) + Postgres, replacing SQLite
- Multi-user accounts (auth), each vault scoped to a user
- Real object storage for receipt photos (S3/R2)
- OCR on photo uploads (Tesseract.js or a cloud OCR API) to auto-fill
  merchant/items instead of pure manual entry
- Email receipt ingestion: forward-to address or Gmail/Outlook OAuth scan +
  parser — most digital receipts already arrive this way today, so this is
  a large ingestion-coverage win independent of any merchant partnership
- Per-retailer parser adapters built on the `parseInlinePayload` seed

This phase is broken into an 8-session, work-one-per-day cadence in
[RECEIPTLESS_STATE.md](./RECEIPTLESS_STATE.md) — read that for the actual
build order, dependencies, and what needs Omar's input (provider/account
choices) vs. what's solo-buildable right now. This bullet list is the
*what*; RECEIPTLESS_STATE.md is the *in what order, one day at a time*.

## Phase 2 — Vault maturity (Months 2–3)

- Real search (full-text, eventually semantic) across merchants, items, notes
- Warranty/return views surfaced in the UI, not just stored in the schema
- CSV/PDF export, tax-category tagging, multi-currency with historical FX

## Phase 3 — Merchant API / SDK (Months 3–5)

- Authenticated merchant API (API keys, rate limiting, sandbox, developer
  docs) built on the claim-token protocol from Phase 0
- First real POS pilot partner (Square, Clover, Toast, or Shopify — whichever
  already exposes e-receipt hooks, since that's the lowest-friction integration)
- Receipt authenticity ladder made real: merchants can cryptographically sign
  receipts (`merchant private key → signature(receipt hash) → verified with
  merchant public key`), moving a receipt from `MERCHANT_VERIFIED` to
  genuinely `SIGNED`. This is what eventually makes receiptless receipts
  usable as real proof for returns, warranty claims, insurance, and audits —
  not just a personal spending log.

## Phase 4 — Merchant terminals & payment-authorization integration (Months 4–8)

This is the adoption unlock the rest of the roadmap depends on, so it gets
its own phase rather than being folded into "POS integrations."

Waiting for every existing POS vendor to voluntarily add receipt-push
support is slow and outside our control. The alternative: build or partner
on a **merchant terminal that combines payment authorization with receipt
issuance natively** — the way Paymob (and similar regional payment
gateways) already provide merchants with a terminal that authorizes the
transaction. If receiptless is integrated at that same layer, receipt
issuance stops being a bolt-on integration a retailer has to choose to
build, and becomes something that happens automatically the moment a
payment authorizes:

```
Payment authorized
   → terminal calls receiptless (POST /api/merchant/receipts)
   → claim token generated
   → customer taps/scans at the terminal, no phone number or email typed
```

Two paths, not mutually exclusive:
- **Partner** with an existing payment-authorization provider (Paymob or
  similar) to add receipt issuance as a feature of their existing terminal
  footprint — much faster distribution than building hardware from scratch
- **Build** a lightweight software terminal (tablet/phone-based) for
  merchants who don't yet have a modern POS, targeting SMBs first

Either path is a partnerships/BD-heavy phase, not a solo-coding phase —
sequenced here deliberately, after the API/SDK exists to integrate against.

## Phase 5 — Native apps + platform NFC (Months 6–9)

- React Native / Expo app for iOS and Android
- Real platform NFC (Android HCE read/write, iOS Core NFC read — Apple
  restricts third-party NFC writing/HCE, so iOS NFC capture stays
  read-only regardless of how this is built)
- Push notifications, offline-first local cache with sync
- Opportunistic Web Bluetooth / Web NFC support lands earlier for
  Android Chrome users specifically, but native apps are what make
  NFC/BLE actually reliable across both platforms

## Phase 6 — Financial intelligence (Months 7–10)

- Budgets and spend alerts, automatic category rules
- Subscription detection, merchant-level and price-change analysis
- Personal inflation tracking computed from actual historical item prices —
  an unusually interesting dataset once line-item history exists at scale
- Optional bank/card statement reconciliation to catch receipts the user
  never captured

## Phase 7 — Security & compliance (Months 9–11)

- Encryption at rest for financial data, audit log
- GDPR/CCPA-compliant export and deletion
- Privacy policy, terms of service, data retention policy
- Security review before wider launch

## Phase 8 — Marketplace submission & launch (Months 11–13)

- App Store + Google Play submission — budget for 1–4 weeks of review
  cycles and possible rejection/resubmission rounds
- Marketing site, pricing, onboarding polish
- Public launch; feedback loop back into Phase 3/4/6 priorities

---

## Commercial model

The consumer vault can likely stay free or near-free — a receipt network
benefits enormously from low adoption friction, and consumers are not the
side most willing to pay. Revenue is more plausible from:

- **Retailers/merchants** — receipt infrastructure, API access, analytics
- **Businesses** — expense-management ingestion, accounting-platform integrations
- **Manufacturers** — warranty/product registration data
- **Consumers** — optional premium tier (extended history, advanced intelligence)

## What's genuinely hard here — read this before trusting the roadmap blindly

Phases 3 and 4 are the ones most likely to slip, and not for coding reasons.
POS/payment-provider partnerships depend on other companies' willingness to
integrate or partner, which isn't controllable on a schedule the way writing
code is. Everything through Phase 2 is buildable and testable solo, in the
open, without needing anyone else's cooperation. Treat Phases 3+ as
aspirational sequencing, not a committed schedule — worth revisiting scope
and pace explicitly once Phase 2 is real and in front of actual users.

Earlier drafts of this document claimed QR + photo + email receipts would
cover "90%+" of real-world capture. That number was invented, not measured —
removed until there's actual usage data to back a claim like that.
