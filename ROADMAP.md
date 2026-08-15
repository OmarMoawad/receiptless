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

- ~~**First: upgrade Vercel to Pro and finish the observability
  criterion.**~~ **Deferred, and no longer first.** Session 10 required
  error tracking *and* a log drain; the drain is Pro-only and this account
  is on Hobby, so it went unmet. Investigating it in Session 1 shrank it to
  almost nothing: preview protection is already on Hobby, Hobby function
  duration is already 300s, and the drain's day-to-day value is covered for
  free by the uptime monitor, cron heartbeat and app-level logging live
  since 2026-08-19. Pro still buys exactly one thing — the platform log
  stream for post-mortem of a *killed* invocation, where app-level logging
  dies with the process.

  It leads nothing now. The trigger that changes that is **charging
  anyone money**: Vercel's Hobby tier is for personal, non-commercial use,
  so the day Receiptless takes payment a paid plan becomes a terms
  requirement rather than an observability upgrade, and the drain arrives
  with it. A real incident that a killed-invocation post-mortem would have
  solved is the other trigger. See `RECEIPTLESS_STATE.md` — "What
  un-defers it" — for all three, including why a working payment card is
  not a reason on its own.
- Real search (full-text, eventually semantic) across merchants, items, notes
- Warranty/return views surfaced in the UI, not just stored in the schema
- ~~CSV/PDF export~~ (session 5), ~~tax-category tagging~~ (session 6),
  multi-currency with historical FX (session 7 — needs an FX rate source)

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

## Sponsored receipts (documented intent, not built)

A small, opt-in revenue stream that works whether a receipt is digital or
physical: a merchant, or a third-party sponsor unrelated to that specific
purchase (the way transit tickets and parking receipts already carry
local ad slots), pays for a short, clearly-labeled footer line — *"This
receipt was sponsored by {Sponsor}"* — shown on the digital receipt and,
eventually, printed on the physical paper strip too.

- **Digital receipts**: a `sponsorLine` (display text) + optional
  `sponsorUrl`, set at the `Merchant` level (a default for every receipt
  from that merchant) with an optional per-`Receipt` override for
  one-off sponsorships. Rendered as a visually and structurally separate
  footer everywhere a receipt is displayed — vault list, receipt detail,
  the `/claim/[token]` page — never mixed into line-item or total data,
  the same discipline the `VerificationLevel` ladder already applies to
  keeping "what a merchant attests" separate from "what receiptless
  infers."
- **Printed receipts**: the harder half, and the reason this is
  documented rather than built now — receiptless doesn't print anything
  itself; the physical receipt comes out of the merchant's own POS/
  terminal printer. This only becomes real once **Phase 4's terminal
  integration** (above) exists: a payment-authorization terminal that
  already calls `POST /api/merchant/receipts` at the point of sale is the
  natural place to also return an ESC/POS-formatted footer command for
  the receipt printer, so the sponsor line rides along on paper receipts
  too, not just the digital claim flow. There is no print path to inject
  a footer into before Phase 4 lands, so this half is sequenced strictly
  after it, not before.
- **Merchant API surface**: sponsor assignment is authenticated merchant
  (or receiptless-sold sponsor slot) configuration for **Phase 3's**
  merchant API/dashboard, not open input on the unauthenticated `POST
  /api/merchant/receipts` MVP endpoint — the same "revisit once Phase 3
  merchant API keys exist" discipline already applied to
  `Merchant.website` (see RECEIPTLESS_STATE.md's Phase-0 fixes log, which
  hit exactly this class of bug once already: unauthenticated input must
  never be able to overwrite another merchant's shared reference data,
  and a sponsor line is exactly that kind of shared, merchant-level
  field).
- **Commercial fit**: a fourth revenue lever alongside the three below —
  small, high-volume, low-friction (a footer line, not an interruption),
  and it monetizes the receipt itself rather than the vault or the user,
  so it reaches even a receiptless user who never opens the app, since it
  rides on the physical receipt they walk out with.

**Hard constraint, non-negotiable when this is built**: sponsored content
must never alter, obscure, or become indistinguishable from the actual
merchant receipt data — no mixing a sponsor line into `notes`,
`rawPayload`, or a `ReceiptItem`. The eventual data model should keep
sponsorship in its own table (e.g. a `ReceiptSponsorship` row referencing
`Receipt`/`Merchant`, not new columns bolted onto `Receipt` itself), the
same separation-of-concerns discipline the `VerificationLevel` ladder
already applies to keeping "what a merchant attests" distinct from "what
receiptless infers." A receipt is a financial record first; sponsorship
is a clearly-labeled, removable, auditable layer on top of it, never a
dependency for basic receipt access.

Not scheduled as its own numbered session in Phase 1's cadence
(RECEIPTLESS_STATE.md) — the digital half is buildable once Phase 3's
merchant API exists, and the printed half strictly depends on Phase 4's
terminal integration, neither of which exists yet. Revisit concrete scope
and scheduling once those phases are real, the same "aspirational
sequencing, not a committed schedule" caveat this roadmap already applies
to Phases 3+ (see "What's genuinely hard here" below).

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
- **Spending guardrails** — the module that acts on all of the above
  instead of just charting it, including a 1–10 need score per purchase,
  written up in its own section below because it carries product and
  ethical constraints the rest of Phase 6 does not

## Spending guardrails — AI that argues for *not* buying (documented intent, not built)

Every other module in Phase 6 describes what was spent. This one is the
only part of the roadmap whose job is to reduce it.

**The thesis.** Consumption is not a neutral default that people arrive at
on their own. It is actively manufactured — advertising, status signalling,
subscription defaults, financing offers that reframe an unaffordable price
as a small monthly one, and a culture in which the people who benefit most
from the spending celebrate it as taste, success, or self-care. The cost of
falling for that is not evenly distributed: someone with slack in their
budget loses a bit of money on a purchase they didn't need, while someone
without slack loses rent, or takes on debt at a rate that compounds against
them. The people with the least room for error are the ones with the least
access to anyone whose incentive is to talk them out of a purchase — a
financial advisor is a product sold to people who already have assets.
That asymmetry is the actual problem worth solving here, and it is why this
belongs in the product rather than staying a slogan.

**Why receiptless specifically can do this, and a bank app can't.** A card
statement sees `APPLE STORE — $1,200`. A budgeting app built on statement
data therefore cannot say anything more useful than "you spent a lot on
electronics." receiptless's canonical `ReceiptItem` history sees *an
iPhone, a case, a cable, and AppleCare* — separate items, with unit prices,
quantities, dates, and merchants, going back as far as the vault does.
Item-level history is what makes a specific, checkable, non-obvious claim
possible instead of a category-level scold. Concretely, the claims this
data supports and statement data does not:

- **You already own this.** The vault knows the user bought a phone charger
  three months ago; the fourth one is a duplicate, not a need.
- **Replacement churn.** Item history shows how long an item lasted before
  it was bought again — a $12 item rebought every two months is a $72/year
  item, and a cheaper-per-unit purchase is not always the cheaper one.
- **Price per use, where it's derivable.** Not always knowable, and it must
  not be faked when it isn't.
- **Subscription and recurring-fee creep**, including the ones that renewed
  after a price increase the user never re-consented to. Cancelling is a
  pure win with no lifestyle cost, which makes it the highest-value and
  least presumptuous thing this module can surface.
- **Personal inflation against personal income**, computed from the user's
  own historical item prices (Phase 6 already builds the price series) —
  the honest version of "things feel more expensive," with the specific
  items named.
- **Purchases that arrived with a financing or BNPL line on the receipt** —
  the single spending pattern most likely to be genuinely harmful, and one
  that the receipt itself carries evidence of.

**Pre-purchase, not just post-mortem.** A monthly report arrives after the
money is gone. The intervention worth building is at the moment of the
decision: a lookup that answers *do I already own this, how long did the
last one last, what did I pay, how many did I buy this year* before the
purchase — reachable from the app, and eventually at the terminal itself
once Phase 4's payment-authorization integration exists, since that is the
one moment when the customer, the item, and the price are all known and the
transaction hasn't happened yet. The receipt-issuance path and the
"should I buy this" path are the same integration seen from two sides.

### The benchmark methodology — occupation cohorts and thresholded bands

"Are you overspending?" is unanswerable against an absolute number, because
$400/month on groceries means something different for a night-shift nurse
with two kids in Cairo than for a single software engineer in Berlin. The
methodology this module uses is **comparison against a condition-adjusted
peer cohort**, with explicit thresholds, rather than a flat budget the user
is asked to invent for themselves.

**1. Cohort key.** A peer group is defined by the combination, never by
occupation alone (occupation without location or household size produces
nonsense comparisons):

```
cohort = occupation class × cost-of-living zone × household size
         × income band × life stage
```

- **Occupation class** comes from a standard taxonomy — ISCO-08 or
  O*NET/SOC — not free text, so cohorts are stable, mergeable when sparse,
  and comparable to public statistics. Free-text job titles fragment the
  population and leak identity.
- **Occupation is declared, never inferred.** The user states it at
  onboarding and can decline; nothing is derived from purchase patterns to
  guess where someone works. Once the IDent integration exists, occupation
  is better modelled as a *consented, scoped identity claim* resolved from
  IDent than as another column receiptless stores itself — the same
  identity-authority split the IDent section above already describes.
- **Sparse cohorts roll up, not down**: if the exact cell is too small,
  generalize along one axis (occupation class → major group, city → region)
  until the size threshold is met, and say which level the comparison is
  actually being made at.

**2. Normalization, before any comparison.** Raw currency totals are not
comparable across a cohort. Each category is normalized to a **share of
disposable spend** — category spend ÷ total tracked spend for the period —
with share-of-declared-income used instead when the user has provided
income. Comparing shares rather than absolutes is what keeps a
higher-earning peer from making a lower-earning one look frugal by default.

**3. Environmental and conditional adjustment.** The benchmark is a moving
band, not a fixed number, because the conditions around the spending move:

- **Local inflation per category**, not headline CPI — food, fuel, and rent
  diverge sharply, and the vault's own item-level price series (Phase 6's
  personal-inflation work) is a second, independent source for this.
- **Seasonality and calendar conditions** — Ramadan and Eid, back-to-school,
  winter heating, holiday gifting. Comparison is always like-period against
  like-period, never December against a yearly average.
- **Shocks** — currency devaluation, a fuel-price jump, a regional supply
  disruption. A cohort-wide jump in a category is a condition, not a
  behaviour, and must move the band rather than flag every member of the
  cohort at once. This is the single most important guard against the
  system telling an entire country it overspent the month prices rose.
- **Personal conditions the user declares** — a move, a new child, a
  medical event, a job change. These re-baseline the user's own history
  and temporarily suspend comparison rather than producing a spike of
  flags at the worst possible moment in someone's life.

The signal is the **residual after adjustment**: how the user sits against
their cohort *once the shared conditions are removed*.

**4. Thresholds.** Robust statistics only — cohort **median and
interquartile range**, never mean and standard deviation, since spending
distributions are heavily right-skewed and a handful of large purchases
would drag a mean-based threshold into uselessness. Per category, per
period:

| Band | Rule | What it means |
|---|---|---|
| Well above | > P90 sustained across ≥3 of the last 6 comparable periods | Strong signal, worth surfacing |
| Above | > P75 sustained across ≥3 periods | Worth a look, phrased as a fact |
| Typical | P25–P75 | Not surfaced at all |
| Below | < P25 | Not surfaced for discretionary categories — see the hazards |
| Well below | < P10 on an *essential* category | Hardship check, never a nudge to spend |

**Sustained, not single-period, is the load-bearing part of that table.**
One expensive month is noise — a laptop, a wedding, a car repair — and a
system that flags it is a system people stop reading. The single-period
version of this feature was deliberately rejected.

**5. Minimum cohort size, as a privacy invariant.** No comparison is
computed or shown unless the cohort contains at least **k = 50 contributing
users** in the comparison period, and cohort aggregates carry
differential-privacy noise. Occupation + city + household size + spending
pattern is re-identifying at small n — a benchmark that quietly leaks "the
one other pharmacist in this town" is a privacy breach wearing a chart.
Cohort statistics are aggregate-only: no drill-down, no "similar users
also bought," no export of cohort membership.

**6. Cold start, which is the honest hard part.** On day one there are no
cohorts, and no amount of engineering fixes that. The bootstrap is
**public data** — national household-expenditure surveys and statistics
offices' CPI basket weights, which publish exactly this shape of data by
household type and region — used as the initial benchmark and labelled as
such, with internal cohorts switched on per-cell only once k is met.
Anything that claims a peer comparison before that data exists is fabricated,
and this document has already had to delete one invented number (see the
"90%+ capture" note above); don't add a second.

**7. Validation before it ships.** Back-test thresholds against held-out
users, measure the false-flag rate, and set an explicit budget for how
often a user is flagged at all. A benchmark that flags most people most
months has no information in it, and is indistinguishable from nagging.

#### Hazards specific to peer comparison

Benchmarking against peers is the part of this module most capable of
producing the opposite of its intent, and each of these is a build
requirement, not a caveat:

- **"You spend less than your peers" is a licence to spend.** Social
  comparison pushes both directions, and the whole premise of this section
  is that consumption norms are manufactured — reproducing a cohort's norm
  and calling it a target simply outsources the manufacturing to the
  cohort. **Below-median on discretionary categories is never surfaced**,
  and no copy anywhere frames a peer figure as a level to reach.
- **Cohort norms encode existing inequality.** Peers in a low-paid
  occupation underspending on healthcare is not a healthy baseline to
  measure against; it is a description of constraint. Essentials therefore
  carry an **absolute adequacy floor** from external reference budgets, not
  just a relative peer band — the peer comparison can say "typical for your
  cohort" while the absolute check still says "below what this household
  needs," and both are shown.
- **Under-spending on essentials is a hardship signal, not a compliment.**
  Well-below-P10 on food, medicine, or heating is surfaced privately and
  gently, with relevant support resources where they exist, and is never
  framed as savings success, never gamified, and never leaves the user's
  own vault.
- **Cohort data must never be sold, exported, or exposed to any party who
  could price against the user** — merchants, employers, insurers, lenders,
  landlords. "Spending percentile by occupation" is exactly the dataset
  that becomes a discriminatory pricing input in someone else's product.
  This is a permanent prohibition, not a Phase-3 monetization option, and
  it applies to the aggregate cohort statistics as well as to individual
  data.
- **Contribution is opt-in and reversible.** A user's receipts only join
  cohort aggregates with explicit consent, revocable, with the receiving
  benchmark recomputed without them. Using the benchmarks and contributing
  to them are separate consents.

### Need scoring — rating a purchase 1–10, and the formula behind it

Every scored purchase gets a **need score from 1 to 10**: 10 is something
the household cannot go without, 1 is something bought purely because it
was in front of the user. The score is what makes every other part of this
module concrete — a duplicate-purchase warning, a cohort band, or a
pre-purchase check all become "you're about to spend a third of this
month's discretionary budget on a 3."

**There is no single accepted formula for this, and any source claiming one
should be distrusted.** What does exist is three well-established pieces
that compose into one, and using them is what keeps this from being a
number invented to look rigorous:

**1. The economic anchor — income elasticity of demand (YED).** Economics
already has an empirical, non-opinion definition of "necessity," and it is
not a survey of what feels essential: a good's income elasticity is the
percent change in quantity demanded over the percent change in income, and
**the threshold sits at exactly 1**. Between 0 and 1 the good is a
necessity (as income rises, spending on it rises more slowly — the Engel
curve is flatter than a ray through the origin); above 1 it is a luxury;
below 0 it is an inferior good. This is the single strongest component
available, and unusually, **receiptless can actually estimate it** — the
cohort structure above supplies exactly the income bands and item-level
quantities an Engel curve needs, which almost no consumer app is in a
position to compute. Mapped to a utility in `[0,1]`, monotone decreasing
and neatly centred on the literature's own threshold:

```
u_elasticity = 1 / (1 + YED)        # YED=0 → 1.0, YED=1 → 0.5, YED=2 → 0.33
```

**2. The social anchor — the consensual/deprivation method.** Elasticity
describes a good's behaviour across a population; it says nothing about
whether people consider it a necessity of life. Poverty research has
measured that directly since the 1980s by asking large samples which items
are necessities, and the **proportional deprivation index** refinement
exists precisely because different population groups answer differently —
which is the right structure here, since the cohort is already defined.
So `u_consensus = p`, the share of the *user's own cohort* rating that
category a necessity, rather than a national average that flattens them.

**3. The aggregation — multi-attribute utility theory (MAUT).** The
standard way to combine incompatible criteria (currency, months, counts)
into one score: normalize each to `[0,1]`, weight them so the weights sum
to 1, and take the weighted sum. The 1–10 presentation is then just
`N = 1 + 9·U`.

Composed, with the population terms above joined by the terms only the
vault can supply:

```
U = w₁·u_elasticity      # necessity as economics defines it (YED)
  + w₂·u_consensus       # necessity as the user's cohort defines it
  + w₃·u_unowned         # 0 if a working one is already owned, →1 if none
  + w₄·u_urgency         # elapsed ÷ expected lifetime of the one owned
  + w₅·u_cost_per_use    # expected uses ÷ price — hardest to source, see below
  + w₆·u_irreplaceable   # no adequate substitute already in the vault

N = round(1 + 9·U)        Σwᵢ = 1
```

#### What each term actually requires, and whether receiptless will have it

The formula above is easy to write and much harder to source. Before any
of it is built, this is the honest inventory — deliberately written as
inputs rather than as functional forms, because for several terms the
undefined symbol *is* the hard part, and giving it an equation would hide
that rather than solve it.

| Term | Needs | Have it? |
|---|---|---|
| `u_elasticity` | Cohort income bands × item quantities over time | **Not yet** — gated on the same k = 50 cohorts as the benchmark above. Published elasticity estimates bootstrap it in the meantime |
| `u_consensus` | Which categories the user's cohort calls necessities | **No** — needs a survey we would have to run ourselves; published deprivation-survey data bootstraps it |
| `u_unowned` | Prior purchases of the same product, matched across merchants | **Partly** — the receipts exist; matching them doesn't. GTIN/SKU works where present, fuzzy item-name normalization where it isn't, and that normalization is the unsolved part |
| `u_urgency` | Expected lifetime per product category | **No** — derivable from observed repurchase intervals at scale, but see the caveat below |
| `u_cost_per_use` | Expected number of uses | **Structurally absent — see below** |
| `u_irreplaceable` | A substitutability graph over product categories | **No** — a product taxonomy project in its own right, not a term to be estimated |

Two of those need saying plainly rather than leaving in a table cell:

- **`u_cost_per_use` may not be buildable at all, and was overstated when
  first written here.** A receipt vault observes *purchases*, never *uses*.
  It can see that running shoes were rebought after fourteen months; it
  cannot see whether anyone ran in them. The only routes to expected uses
  are asking the user directly — friction at exactly the wrong moment — or
  inferring it from repurchase, which is not the same quantity. Treat this
  term as unproven and be willing to drop it.
- **`u_urgency`'s repurchase-interval proxy measures replacement
  *behaviour*, not product *lifetime*.** People replace working phones and
  keep broken toasters. Fitted naively, this term would score the churn
  the module exists to discourage as urgency, which is the failure
  inverted — it needs a signal that the previous item actually stopped
  working, which receipts alone don't carry either.

**A term whose data never materializes gets removed and its weight
redistributed — never estimated by a model to fill the gap.** That is
precisely the "the AI does not invent numbers" constraint below, applied
where it is most tempting to break: a missing input inside an otherwise
working formula is the easiest place in this entire module to quietly
substitute a plausible guess. Four of the six terms are gated on scale or
on data that does not exist today, so the first version that ships is a
two-term score — and it should say so on its face rather than presenting
six terms' worth of confidence.

#### The design decisions inside that formula, which matter more than the algebra

- **A gate runs before the model, and outranks it.** Anything in the
  adequacy basket — medicine, food staples, utilities, childcare,
  transport to work, medical devices, anything the user marks essential —
  is **pinned at 10 without being scored at all**. It is not given a high
  weight; it never enters the formula. A model that can output a 6 for
  insulin is a model that will eventually output a 6 for insulin.
- **Need and affordability are two axes, never multiplied into one.**
  The obvious move is a `w₇·budget_strain` term that pulls the score down
  when something is expensive. It is wrong, and MAUT itself says why: the
  additive form is only valid when criteria are utility-independent, and
  need and affordability are anything but. Merging them lets "I really
  need this" cancel out "this breaks my month," which is the exact
  reasoning this module exists to interrupt. So a purchase is reported as
  **need 9 / strain high** — two numbers, both visible, no single blended
  verdict hiding the tension between them.
- **The scale is ordinal, not cardinal.** A 7 is not 1.4× as needed as a
  5. Displayed as bands with the score, never used in arithmetic
  downstream (no "average need score," no month-over-month need index),
  because averaging an ordinal scale manufactures precision that isn't
  there.
- **Weights belong to the user, with published defaults.** The constraint
  above — that "unnecessary" is the user's judgement and never the
  model's — is enforceable here in a way it isn't in prose: `wᵢ` is
  literally an editable vector. The defaults ship visible and documented,
  not tuned silently.
- **Thin data produces a range, not a number.** With no cohort elasticity
  estimate and no purchase history for a category, the honest output is
  "4–7, low confidence," or no score at all. A confident-looking integer
  derived from two receipts is the same class of error as this document's
  deleted "90%+ capture" claim.
- **Calibration is a shipping requirement.** Sanity-check monotonicity
  (more owned ⇒ never a higher score; longer remaining life ⇒ never
  higher), and check that users agree with the extremes — the 1s and the
  10s — since those are what the module actually acts on.

#### Where this must never be used

- **It is not a purchase permission, and nothing is ever blocked.** The
  score is shown; the user buys what they want. A guardrail that becomes a
  gate gets circumvented and deserves to be.
- **It never leaves the vault.** A per-user "need score" history is an
  almost perfect creditworthiness and vulnerability proxy — exactly what a
  lender, insurer, or employer would pay for, and exactly the
  discrimination input the cohort-data prohibition above already forbids.
  The same prohibition covers this, explicitly, including any aggregate
  or derived form of it.
- **It is not applied to other people's purchases.** No shared-household
  scoring of a partner's or a child's spending, no exportable report that
  turns this into an instrument of control over someone with less power in
  the household. Single-user, self-directed, or it isn't built.

Sources for the three anchors, so the formula can be checked rather than
taken on faith: income elasticity thresholds and Engel-curve shape —
[Oxford Reference](https://www.oxfordreference.com/display/10.1093/oi/authority.20110803095751949)
and [ScienceDirect's overview](https://www.sciencedirect.com/topics/economics-econometrics-and-finance/income-elasticity-of-demand);
the consensual/deprivation method and its proportional index —
[Poverty and Social Exclusion](https://www.poverty.ac.uk/definitions-poverty/consensual-method)
and [Minimum Income Standards and Reference Budgets](https://www.cambridge.org/core/books/minimum-income-standards-and-reference-budgets/B10B0B41342C1A49BC58B3DF8CF34F41);
MAUT's weighted-additive model and its utility-independence condition —
[ML Wiki](http://mlwiki.org/index.php/Multi-Attribute_Utility_Theory).

### The constraints, which are the hard part

These are not caveats to be trimmed later. A module that argues against
people's purchases is a module that can do real harm if built carelessly,
and every one of these is a design requirement.

- **"Unnecessary" is the user's judgement, never the model's.** The system
  has no basis for deciding that someone's hobby, their kid's birthday
  present, or their one indulgence of the month is waste. What it can do is
  surface facts the user didn't have (*you have bought this eleven times
  this year*) and enforce goals the user set themselves. Anything that
  reads as a stranger's opinion about how someone should live gets the app
  deleted, and deservedly.
- **Essentials are never flagged. Hard rule.** Medicine, food, childcare,
  utilities, rent, transport to work, medical devices, and anything the
  user marks as essential are excluded from nudges entirely — no
  "consider cheaper alternatives," no streaks, no comparisons. The worst
  realistic failure of this feature is talking someone out of a
  prescription refill to hit a savings target, and it is precisely the
  less-advantaged user this section is written for who is most exposed to
  it. Exclusion must be structural (an essential-category allowlist checked
  before any nudge is generated), not a tone guideline.
- **Cheap is not the same as good, and frugality is not a moral score.**
  A convenience purchase can be the rational choice for someone with no
  time, no kitchen, or no car; a "wasteful" $4 coffee can be the only
  affordable thing in a week. Advice that assumes the reader has time,
  storage, transport, and the cash to buy in bulk is advice written for
  the advantaged, wearing the costume of thrift. No shame mechanics: no
  streaks to break, no red faces, no leaderboards, no "you failed this
  month."
- **Guidance about the user's own spending, not financial advice.** This
  module must not recommend investments, credit products, debt
  consolidation, or any specific financial product, and must not present
  itself as a substitute for a licensed advisor. That line is both a
  regulatory boundary and the thing that keeps the feature honest — the
  moment it recommends products it becomes the sales channel it exists to
  counter.
- **The AI does not invent numbers.** Aggregation, duplicate detection,
  price series, and recurrence detection are deterministic queries over the
  vault. A model's role is explanation, classification of messy item names,
  and phrasing — on top of computed figures, never as the source of them.
  Every surfaced claim must link back to the specific receipts it came
  from, or it doesn't ship.
- **Where the data goes is an unsettled decision, not a detail.** Sending a
  user's itemized purchase history to a third-party model is a materially
  different privacy posture than anything in the vault today, and it
  collides directly with two commitments already on the books: Phase 7's
  encryption-at-rest work, and the client-side E2E-encryption question
  logged in `RECEIPTLESS_STATE.md`'s open decisions (E2E and
  server-side model analysis are in genuine tension — if the server can't
  read the receipts, it can't analyse them either). On-device or
  self-hosted inference, or a strict processing agreement with no training
  on user data, needs deciding *before* any of this is built, not after.

### The revenue conflict, stated plainly

receiptless's "Commercial model" section sells merchant API access,
manufacturer warranty data, and a sponsored footer line on receipts.
A module whose purpose is to reduce purchases is structurally in conflict
with all three, and pretending otherwise would make it worthless — an
anti-spending advisor funded by the sellers is an advertisement.

The resolution, which has to hold in code and not just in intent:

- **Sponsorship data never reaches the guardrail module.** No sponsor or
  merchant may suppress, soften, or reorder a nudge; being a paying
  merchant buys placement of a labelled footer line and nothing else. The
  separation the "Sponsored receipts" section already demands at the data
  level (sponsorship in its own table, never mixed into receipt data) is
  the same separation this needs at the logic level.
- **No merchant-visible signal.** Merchants must never learn that a user
  was nudged away from them; that turns the module into an advertising
  product from the other direction.
- **This is the strongest case for the consumer premium tier**, and the
  only revenue line whose incentives point the same way as the feature: the
  user pays, so the user is the customer. If the guardrails only ever pay
  for themselves through consumer subscriptions, that is the correct
  outcome, not a shortfall — and the argument for keeping the *detection*
  of subscription creep and duplicate purchases in the free tier is that
  the people who most need it are the least able to pay for it.

### Sequencing, honestly

Not a numbered session, and not schedulable yet. It depends on enough
line-item history per user to say anything true — which means real
ingestion at real volume (Phases 1–2), not a demo vault. Two things do
follow from that:

- The **need score is the first thing to build and the cheapest to test**:
  its ownership, urgency and cost-per-use terms run off the vault alone,
  and the elasticity and consensus terms can start from published data
  before any cohort exists. A version with `w₁ = w₂ = 0` is a working
  score on day one.
- A **deterministic v0 with no AI in it at all** — duplicate detection,
  recurring-charge detection, repurchase intervals, price-change alerts —
  is buildable as soon as the vault has real data, and is where most of the
  actual value is. It is also the honest test of the premise: if the plain
  version doesn't change what people buy, no model on top of it will.
- The **pre-purchase check at the terminal** is gated on Phase 4 and
  inherits every one of that phase's partnership risks.
- The **peer benchmarking above is gated on user scale, not on code** —
  k = 50 per cohort cell means thousands of users before more than a
  handful of cells are live, so the public-data bootstrap is not a
  temporary shim but the way this actually launches, and probably how it
  stays for most cohorts for a long time. It is the one part of this
  section that cannot be built solo ahead of adoption, which puts it
  behind Phase 6's other modules rather than alongside them.

Revisit scope and scheduling once Phase 2 is real and in front of users —
the same "aspirational sequencing, not a committed schedule" caveat this
document applies to Phases 3+ below.

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
- **Consumers** — optional premium tier (extended history, advanced
  intelligence, and the spending guardrails above — the one revenue line
  whose incentives align with the user rather than against them)
- **Sponsors** — a paid "This receipt was sponsored by X" footer line on
  digital and (eventually) printed receipts; see "Sponsored receipts"
  above for the full writeup and its Phase 3/4 dependencies

Three of those five lines pay receiptless more when users buy more, which
is a direct conflict with the "Spending guardrails" section above. That
conflict is real and is not resolved by good intentions — see that
section's "revenue conflict" rules for the separation this requires.

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

## Post-production revisit list

Technical decisions made for pragmatic reasons today, worth re-evaluating
once circumstances change — logged so they don't get silently forgotten.
The OCR engine item below is not like the others on this list: it's a
real blocker for commercial use, not just a "worth revisiting" note — see
its own flag in `RECEIPTLESS_STATE.md`'s Session 5 follow-up.

- **OCR engine: Surya's model weights are non-commercially licensed —
  needs Omar's explicit decision, not just a hardware upgrade.** Session
  5's OCR feature (`ocr-service/`) runs Surya (`surya-ocr==0.6.2`)
  instead of PaddleOCR purely because PaddleOCR's official pip binaries
  crashed on the arm64 (Apple Silicon) dev machine this was built on — a
  native-arm64 segfault and, under emulated amd64, an illegal instruction
  (see `RECEIPTLESS_STATE.md`'s Session 5 follow-up for the full story).
  That part is a hardware-compatibility problem, worth retrying on an
  x86_64 host or once PaddlePaddle's arm64 wheels mature. But Surya's own
  model weights (`vikp/surya_det3`/`vikp/surya_rec2`) are licensed
  **CC-BY-NC-SA-4.0** — strictly non-commercial, confirmed directly
  against HuggingFace's model-card metadata, not assumed — which directly
  conflicts with this document's own "Commercial model" section above.
  Three real options once this needs resolving, not just "wait for better
  hardware": (1) retry PaddleOCR/PP-StructureV3 (Apache 2.0, plus better
  table/layout handling for receipts specifically) once hardware allows;
  (2) benchmark **docTR** (github.com/mindee/doctr) — PyTorch-based like
  Surya so no arm64 compatibility risk, and genuinely Apache 2.0 end to
  end (code and weights), making it a cleaner drop-in than either Surya
  or PaddleOCR on this exact point; (3) negotiate a commercial license
  for Surya's weights directly, or accept the newer `surya-ocr` release's
  ~$5M funding/revenue-threshold OpenRAIL license if Receiptless stays
  under that. Not a decision to make silently — flag it back to Omar when
  this repo gets anywhere near a real commercial deployment.
