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
| `GOOGLE_OAUTH_CLIENT_ID` | if Gmail scanning | All four or none |
| `GOOGLE_OAUTH_CLIENT_SECRET` | if Gmail scanning | |
| `GOOGLE_OAUTH_REDIRECT_URI` | if Gmail scanning | Must match Google exactly |
| `EMAIL_OAUTH_ENCRYPTION_KEY` | **if Gmail scanning** | Generate with `openssl rand -base64 32`. The built-in fallback is committed to this repo and is refused in any deployed environment |
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

## 4. Migrations — a release step, not a build step

The build command is `prisma generate && next build`. It deliberately does
**not** run `prisma migrate deploy`.

An earlier draft did, which was wrong: Vercel builds every preview and can
build concurrently, so schema migrations would run from any preview build
and potentially two at once. Compilation and schema change are different
operations with different blast radii, and only one of them should be
triggered by pushing a branch.

Run migrations as an explicit release step against the intended database:

```bash
DATABASE_URL='<production connection string>' npx prisma migrate deploy
```

Do this **before** promoting the build that needs the new schema, so the
old code briefly runs against the new schema rather than the reverse.
That ordering means every migration must be backwards-compatible with the
currently-deployed code — additive columns, no destructive renames in the
same release.

`/api/health` reports `database: "unreachable"` if the app cannot reach
the database at all, but it does **not** verify the schema is current;
confirm `prisma migrate status` separately.

## 5. Verify the deploy

`GET /api/health` reports readiness without exposing any values:

```json
{ "status": "ok", "database": "ok", "missingConfig": [], "insecureConfig": [], "merchantApiEnabled": false }
```

It returns 503 while anything required is missing *or unsafe*, listing
every problem at once. `missingConfig` is what isn't set;
`insecureConfig` is what is set but must not be used — currently just the
committed dev encryption key. Check specifically that `merchantApiEnabled`
is `false` and both arrays are empty.

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
