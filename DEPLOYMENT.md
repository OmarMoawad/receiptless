# Deploying receiptless

Session 8 (see [RECEIPTLESS_STATE.md](RECEIPTLESS_STATE.md)) prepared
everything code-side. **Nothing here has been run against a real Vercel
project or a hosted Postgres** — those accounts don't exist yet, and
creating them needs Omar. This document is the runbook for when they do,
plus the checks that must pass before real data is allowed near a public
deployment.

## Before you deploy: the hard gate

RECEIPTLESS_STATE.md's own rule is that no real data reaches a public
deployment before secrets management and backups exist for that
environment. Nothing below removes that gate — it makes it checkable.

## 1. Create the accounts (needs Omar)

1. **Hosted Postgres** — Neon, Supabase, or Vercel Postgres. Any is fine;
   Neon's branching is the most useful for preview deployments, since each
   preview can get its own database branch instead of sharing production's.
   Copy the pooled connection string.
2. **Vercel project** — import the GitHub repo. Framework preset is
   detected from `vercel.json` (Next.js).
3. **Object storage** — a real S3 or R2 bucket, replacing local MinIO. R2
   has no egress fees, which suits receipt images. Create an access key
   scoped to that one bucket, not an account-wide key.

## 2. Set environment variables

Set these in Vercel for **production and preview separately** — a preview
deployment is publicly reachable and must never point at the production
database.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Pooled connection string |
| `S3_ENDPOINT` | yes | Bucket endpoint |
| `S3_REGION` | yes | |
| `S3_BUCKET` | yes | |
| `S3_ACCESS_KEY_ID` | yes | Scoped to this bucket only |
| `S3_SECRET_ACCESS_KEY` | yes | |
| `POSTMARK_INBOUND_ADDRESS` | if inbound email | All three or none |
| `POSTMARK_WEBHOOK_USERNAME` | if inbound email | |
| `POSTMARK_WEBHOOK_PASSWORD` | if inbound email | Generate, don't invent |
| `MERCHANT_API_ENABLED` | no | **Leave unset.** See below |
| `OCR_SERVICE_URL` | if OCR | The self-hosted Surya service |

`missingProductionConfig` (`src/lib/deployment.ts`) enforces the required
rows and the all-or-nothing rule for inbound email — a half-configured
Postmark setup would mean a webhook reachable without both credentials.

## 3. The merchant endpoint is closed by default

`POST /api/merchant/receipts` is unauthenticated and unrate-limited: it
creates database rows and claim tokens for anyone who can reach it. It
exists to simulate a POS terminal until Phase 3's merchant API keys land.

It is therefore **disabled automatically in any deployed environment** and
returns 404 there. Locally it stays on with no configuration. Only set
`MERCHANT_API_ENABLED=true` on a deployment you are deliberately using for
a demo, and unset it afterwards. The flag fails closed — only the exact
string `true` enables it.

## 4. Migrations

`vercel.json`'s build command runs `prisma migrate deploy` before
`next build`, so a deploy applies pending migrations. Two consequences
worth knowing before the first real deploy:

- A failing migration fails the build, so a bad migration does not reach
  production half-applied.
- Migrations run against whichever `DATABASE_URL` that environment has, so
  preview environments must not share production's database.

## 5. Verify the deploy

`GET /api/health` reports readiness without exposing any values:

```json
{ "status": "ok", "database": "ok", "missingConfig": [], "merchantApiEnabled": false }
```

It returns 503 while anything required is missing, listing every missing
key at once. Check specifically that `merchantApiEnabled` is `false`.

## 6. Backups — do not skip

Hosted Postgres providers vary: some retain point-in-time recovery only on
paid tiers. Confirm the retention window before real receipts exist, not
after. This is part of the hard gate above, not an optimization.

## Still open

- Rate limiting on the auth endpoints. Vercel's platform rate limiting or
  an edge middleware would be the cheapest option; not built.
- No error tracking or log drain configured.
- The OCR service (`ocr-service/`) is a separate container and has no
  hosting story — it is not part of this Vercel deployment. Photo OCR will
  not work in production until it does.
