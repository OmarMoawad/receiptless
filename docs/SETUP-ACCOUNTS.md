# Account setup — your half

This file collects the steps only you can do: they need an account, a
card, or a consent screen. I can't create accounts, accept terms, or type
credentials — and you should not paste any secret from these steps into
our chat. They go straight into Vercel's environment-variable UI or your
`.env`, never here.

> ## Status — read this before working through anything
>
> **Sections 1–8 (Session 10 Part B) are DONE, 2026-08-15.** Production is
> live at https://receiptless-theta.vercel.app with 12/12 automated checks
> and a rollback rehearsed at 42s. Neon, Cloudflare R2, Vercel, Google
> OAuth and Sentry are all set up, and a real Gmail account has since
> imported real receipts. **Do not work through 1–8 again** — they are
> kept as the record of how production was built, and because a rebuild
> or a second environment would follow the same steps.
>
> **Section 9 onwards is the only outstanding work**, and even that is
> optional: it wires an automatic FX rate source, and manual rate entry
> already works end to end without it.
>
> Each section is dated. When a new one is added, say plainly here
> whether it is done, so this file never again reads as though all of it
> is outstanding.

Within a section, work top to bottom; each step's output feeds the next.
Tell me when a step is done and I'll verify what's verifiable from
outside.

---

## 1. Neon — hosted Postgres

1. https://neon.tech → sign up (GitHub login is fine).
2. Create project: name `receiptless`, region closest to you (`eu-central-1`
   if you're in Cairo — lowest latency of the EU options).
3. On the project dashboard, copy the **pooled** connection string. It has
   `-pooler` in the host. Vercel's serverless functions need the pooled one;
   the direct string will exhaust connections.
4. **Check the retention window now, not later** (Settings → History /
   point-in-time restore). Free tier is currently 24 hours. Your own hard
   gate in `RECEIPTLESS_STATE.md` says backups must exist *before* real
   receipts do — if 24h isn't enough for you, this is the moment to upgrade
   or accept it deliberately.

Gives you: `DATABASE_URL`

---

## 2. Cloudflare R2 — receipt photo storage

1. https://dash.cloudflare.com → sign up → **R2** in the sidebar. R2 asks
   for a card even on the free tier; the 10 GB/month free allowance is far
   beyond this.
2. Create bucket: `receiptless-prod`, automatic region.
3. **R2 → Manage API Tokens → Create API Token.**
   - Permissions: **Object Read & Write**
   - Specify bucket: **`receiptless-prod` only** — not "all buckets". Your
     DEPLOYMENT.md calls this out and it's right.
4. Copy the Access Key ID, Secret Access Key, and the **S3 API endpoint**
   (looks like `https://<accountid>.r2.cloudflarestorage.com`).

Gives you: `S3_ENDPOINT`, `S3_BUCKET=receiptless-prod`, `S3_REGION=auto`,
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`

---

## 3. Vercel — the deployment

1. https://vercel.com → sign up with GitHub.
2. **Add New → Project → import `OmarMoawad/receiptless`.**
3. Framework preset should auto-detect Next.js from `vercel.json`. Leave
   the build command alone — it is deliberately `prisma generate && next
   build` with **no** migration step (see DEPLOYMENT.md §4 for why).
4. **Do not deploy yet.** Add the environment variables first (step 6),
   otherwise the first deploy boots misconfigured and `/api/health` will
   503 — harmless, but noisy.

Note the production URL Vercel assigns you
(`receiptless-<hash>.vercel.app`). Step 4 needs it.

---

## 4. Google Cloud — the OAuth client

This is the highest-leverage credential in either repo: it unblocks
Receiptless's Gmail scanner **and** IDent's Gmail/Calendar sync.

1. https://console.cloud.google.com → new project `receiptless`.
2. **APIs & Services → Library → enable "Gmail API".**
3. **APIs & Services → OAuth consent screen:**
   - User type: **External**
   - App name `receiptless`, your email for support and developer contact
   - **Scopes: add `.../auth/gmail.readonly` and nothing else.** The code
     requests read-only and Google will show users exactly what you list
     here — asking for more than you use is the thing that makes a consent
     screen scary and a verification review slow.
   - **Test users: add your own Gmail address.** While the app is in
     "Testing" only listed users can consent, which is what you want for a
     first slice. No verification review needed at this stage.
4. **Credentials → Create Credentials → OAuth client ID:**
   - Type: **Web application**
   - Authorised redirect URI — must match **exactly**, no trailing slash:
     ```
     https://<your-vercel-domain>/api/email/connections/gmail/callback
     ```
   - Add a second one for local testing if you want it:
     ```
     http://localhost:3000/api/email/connections/gmail/callback
     ```
5. Copy the Client ID and Client Secret.

Gives you: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`GOOGLE_OAUTH_REDIRECT_URI`

> **Verified against the code**, not guessed: the route is
> `src/app/api/email/connections/gmail/callback/route.ts`, and the scope
> constant is `GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"`
> in `src/lib/gmail-client.ts`. My first draft of this file had the path
> wrong (`/api/email/gmail/callback`) — a mismatch here fails at consent
> with `redirect_uri_mismatch`, so use the path above exactly.

---

## 5. Sentry — error tracking

1. https://sentry.io → sign up → create project → platform **Next.js**,
   name `receiptless`.
2. Copy the **DSN**.
3. Auth token for source maps: **Settings → Auth Tokens → Create**, scope
   `project:releases`. Optional — without it the build still works, you
   just get minified stack traces.
4. **Log drain (the other half of the exit criterion):** Vercel project →
   **Settings → Log Drains**, or install the Sentry integration from
   Vercel's marketplace, which wires the drain for you.

Gives you: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (same value),
`SENTRY_AUTH_TOKEN` (optional)

---

## 6. Generate the encryption key yourself

Do **not** let anything invent this one. In your terminal:

```bash
openssl rand -base64 32
```

Gives you: `EMAIL_OAUTH_ENCRYPTION_KEY`

The repo ships a committed dev fallback and the code **refuses to start
with it** in any deployed environment — `insecureProductionConfig()`
reports it by name through `/api/health`. That refusal is deliberate and
you should not work around it.

---

## 7. Set the variables in Vercel

Vercel → project → **Settings → Environment Variables**. Set each for
**Production** and **Preview separately**. A preview deployment is publicly
reachable; it must never hold the production database URL.

| Variable | Value from |
| --- | --- |
| `DATABASE_URL` | Neon pooled string (step 1) |
| `S3_ENDPOINT` | R2 S3 API endpoint (step 2) |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `receiptless-prod` |
| `S3_ACCESS_KEY_ID` | R2 token (step 2) |
| `S3_SECRET_ACCESS_KEY` | R2 token (step 2) |
| `GOOGLE_OAUTH_CLIENT_ID` | step 4 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | step 4 |
| `GOOGLE_OAUTH_REDIRECT_URI` | step 4, exact match |
| `EMAIL_OAUTH_ENCRYPTION_KEY` | step 6 |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | step 5 |
| `MERCHANT_API_ENABLED` | **leave unset** — fails closed, returns 404 in production |

Leave all `POSTMARK_*` unset. Inbound email is deliberately out of this
slice — it needs a domain, and the point of Session 10 is *one* path
working end to end. `missingProductionConfig()` enforces all-or-nothing on
that group, so partial Postmark config would fail readiness.

---

## 8. Run the migration — before promoting the build

Migrations are deliberately not part of the build. From your machine:

```bash
DATABASE_URL='<neon pooled string>' npx prisma migrate deploy
```

Ordering matters: run this **before** the build that needs the schema, so
old code briefly meets a new schema rather than the reverse.

---

## Then hand back to me

Once the deploy is live, give me **the production URL only** — no keys, no
connection strings. I'll run the verification script I'm writing now
against it: `/api/health` shape, the merchant endpoint returning 404, the
encryption-key gate, security headers, and the rollback rehearsal.

---

# Session 7 step 4 — the FX rate provider (your half)

Added 2026-08-21, after the shortlist was checked against live terms
(`docs/fx-provider-comparison.md`). **You answered the question that
decides it: the tax summary is filed in Egypt, so the correct rate is the
Central Bank of Egypt rate**, not a mid-market aggregate. That eliminates
every commercial aggregator in the comparison and leaves one route.

**Nothing here is urgent.** Manual rate entry already works end to end and
is a permanent path. If any step below stalls, stop — nothing breaks.

## 9. The card problem, which may not exist for this route

The comparison concluded the blocker was a card, since every aggregator
demanded one even for a "free" key. **The CBE route is the exception, and
it is worth trying before spending any effort on payment.**

Apify's Free plan gives **$5 of platform credit per month and explicitly
requires no credit card to sign up.** The CBE actor is pay-per-result at
about $11 per 1,000 results, and a **full year** of rates for all 19 CBE
currencies is roughly 6,800 results — about **$0.50–$2.50**. That is a
year of data inside a single month's free credit, and Receiptless needs
far less: the snapshot design fetches once per currency pair per date.

**The one thing to check, because it decides everything after it:** some
pay-per-event actors cap free-plan users at a limited number of results
before requiring a paid plan, and each actor states this on its own page.
Look for it in step 10.2 before assuming the free plan is enough.

**If it turns out a paid plan is required**, in order of what is most
likely to work from Egypt:

1. **PayPal.** Apify accepts PayPal for subscriptions, not only cards.
   This is the lever worth pulling first: it is a different rail from the
   direct card processor that refused prepaid and virtual cards at
   Vercel, and PayPal accounts in Egypt can be funded from a local bank
   card.
2. **A bank-issued Egyptian Visa/Mastercard** — from CIB, NBE, Banque
   Misr, QNB Alahli or similar. The distinction that mattered at Vercel
   was **bank-issued versus prepaid/virtual**, not Egyptian versus not:
   Vercel refused the prepaid and virtual cards, which have prepaid BINs.
   A real debit or credit card on a bank BIN is a different proposition.
   Two things usually have to be switched on explicitly, in the bank's
   app or by phone: **online/e-commerce transactions**, and
   **international transactions**, sometimes with a separate
   foreign-currency limit that defaults to zero.
3. **Do not bother with a Meeza card** — it is a domestic scheme and will
   not clear an international charge.

I can't do any of this part: creating accounts, accepting terms and
entering payment details are yours, and I should not be the one agreeing
to a licence that binds your product.

## 10. Apify account and the CBE actor

1. https://apify.com → **Sign up**. GitHub login is fine, and no card is
   requested on the Free plan. Note the plan says **$5 free credit per
   month** — that is the budget this whole feature runs on.
2. Open the actor:
   https://apify.com/maged120/central-bank-of-egypt-historical-rates
   - Read the **Pricing** section on that page. Confirm it is
     pay-per-result and check whether it caps free-plan users. **This is
     the check that decides whether you need step 9's payment path.**
   - Note that it is **community-maintained, not an official CBE
     product.** It reads CBE's own published rates, so the data is
     official; the tool around it is not. That risk is already designed
     for — rates are snapshotted onto receipts, so if this actor ever
     disappears, no recorded figure moves. New automatic conversions
     stop, and manual entry still works.
3. **Run it once by hand before wiring anything**, from the actor page.
   Ask for a short range you can check — say `2026-03-01` to `2026-03-05`
   — and look at the output. You are checking two things:
   - EGP rates are actually present for those dates, and
   - which of **buy / sell / mid** you want.
4. **Decide buy, sell, or mid — and ask whoever files your return.** CBE
   publishes a buy and a sell rate; the mid is a derived convenience.
   Which one belongs on an Egyptian return is a question about Egyptian
   tax practice, not about this codebase, and I should not guess at it.
   Whatever you choose becomes part of the stored snapshot, so changing
   your mind later means an explicit reprocessing run, not a silent
   restatement.
5. **Settings → Integrations → API tokens** → copy your **Personal API
   token**.

**Do not paste that token into our chat.** It goes into Vercel, below.

## 11. Set the variables in Vercel

Same place as step 7: Vercel → project → **Settings → Environment
Variables**, set for **Production and Preview separately**.

| Variable | Value |
| --- | --- |
| `FX_PROVIDER` | `apify-cbe` |
| `APIFY_TOKEN` | your Personal API token from step 10.5 |
| `APIFY_CBE_ACTOR` | `maged120/central-bank-of-egypt-historical-rates` |
| `FX_CBE_RATE_SIDE` | `buy`, `sell` or `mid` — your answer from step 10.4 |

`FX_PROVIDER` is the switch. Leave it unset and `configuredProvider()`
returns `null`, which is today's behaviour: manual entry only, and the
visible "rate unavailable" state. Nothing fails closed-off or half-wired
because a variable is missing — the null path is the same one that runs
when a provider simply has no rate for a day, so it stays exercised.

Set these on **Preview** too, or don't set them there at all. Either is
fine; what matters is not putting a production token on a preview that is
publicly reachable if you would rather it not be.

## 12. Then hand back to me

Tell me:

- **which side you chose** (buy/sell/mid), and
- **whether the free plan was enough** or you had to take a paid plan.

Not the token. With those two facts I'll write the adapter against the
existing `FxRateProvider` interface in `src/lib/fx/provider.ts` — a
fetched rate is stored in `FxRate` exactly like a manual one, and the
snapshot on the receipt is identical in shape, so nothing above the
interface changes. Then `configuredProvider()` stops returning `null`,
and every receipt that currently shows "rate unavailable" converts the
next time it is opened, because capture is idempotent and reads never
move a figure that is already recorded.
