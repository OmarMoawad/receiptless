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

1. **Hosted Postgres** — Neon (chosen 2026-08-15). Branching is the most
   useful part for previews: each preview can get its own database branch
   instead of sharing production's. Copy the **pooled** connection string.

   Three things that went wrong the first time through, all worth getting
   right while the database is still empty:

   - **Take the pooled string, not the direct one.** The dashboard shows
     the direct endpoint by default; the pooled host has a `-pooler`
     segment (`ep-xxx-pooler.<region>.aws.neon.tech`). Vercel's functions
     open a connection per invocation and will exhaust the direct
     endpoint's limit.
   - **Pick the region deliberately.** Neon's default is not necessarily
     near you — the first attempt landed in `sa-east-1` (São Paulo) for a
     user in Cairo. Recreating an empty project is free; migrating a
     populated one is not.
   - **Do not run `npx neonctl@latest init` in this repo.** It writes the
     production `DATABASE_URL` into `.env`, and this repo's test suite is
     destructive against whatever `DATABASE_URL` names. `npm test` would
     then delete production data. `src/test/guard-local-database.ts` now
     refuses to run in that situation, but the simplest answer is to paste
     the string into Vercel and leave `.env` pointed at the local
     container.
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
| `EMAIL_OAUTH_ENCRYPTION_KEY` | **if Gmail scanning** | Generate with `openssl rand -base64 32`. The built-in fallback is committed to this repo and is refused in any deployed environment. **Part of the all-or-nothing Gmail group — see the warning below** |
| `OCR_SERVICE_URL` | if OCR | The self-hosted Surya service |

`missingProductionConfig` (`src/lib/deployment.ts`) enforces the required
rows and the all-or-nothing rule for inbound email — a half-configured
Postmark setup would mean a webhook reachable without both credentials.

> **Trap, found while rehearsing this runbook (Session 10 Part B).**
> The four Gmail variables are one all-or-nothing group, and
> `EMAIL_OAUTH_ENCRYPTION_KEY` is in it. Setting *only* the encryption key
> — the natural thing to do, since it is the one you generate yourself and
> the others come from Google — makes `/api/health` return 503 listing the
> three Google variables as missing. That is the gate working as designed,
> but it reads like a bug. **Set all four together, or none of them.**

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

Run the checker rather than eyeballing it:

```bash
node scripts/verify-deployment.mjs https://<your-domain>
```

It checks readiness shape, database reachability, the encryption-key gate,
the merchant endpoint being 404 from outside, error tracking being active,
HTTPS/HSTS, and that the endpoint leaks no configuration *values*. It also
prints the checks it cannot make from outside — backups, log drain, real
consent, rollback rehearsal — so a green run never quietly means "verified
except the hard parts".

`GET /api/health` reports readiness without exposing any values:

```json
{ "status": "ok", "database": "ok", "missingConfig": [], "insecureConfig": [], "merchantApiEnabled": false, "errorTrackingEnabled": true }
```

It returns 503 while anything required is missing *or unsafe*, listing
every problem at once. `missingConfig` is what isn't set;
`insecureConfig` is what is set but must not be used — currently just the
committed dev encryption key. Check specifically that `merchantApiEnabled`
is `false` and both arrays are empty.

## 6. Backups — do not skip

> **Current state (2026-08-15):** Neon history retention on this project
> is **6 hours**, confirmed in the console. Point-in-time restore is
> possible only inside that window; there is no daily snapshot behind it
> on this tier. **A restore has never been performed** — the window is
> confirmed, the ability to use it is not. See RECEIPTLESS_STATE.md's
> "Backup posture" for the standing decision and when to revisit.

Hosted Postgres providers vary: some retain point-in-time recovery only on
paid tiers. Confirm the retention window before real receipts exist, not
after. This is part of the hard gate above, not an optimization.

## 7. Rollback — rehearse it before you need it

Session 10's exit criteria require this **documented *and* rehearsed at
least once**. A procedure nobody has run is a hypothesis.

### The procedure

Vercel keeps every previous deployment. Rolling back is promoting an older
one, not rebuilding:

1. Vercel dashboard → project → **Deployments**.
2. Find the last deployment known good — the one that was live before the
   current one.
3. **⋯ → Promote to Production** (older Vercel UIs call this "Rollback").
4. Confirm with the readiness endpoint, not the dashboard's green tick:

   ```bash
   node scripts/verify-deployment.mjs https://<your-domain>
   ```

   `/api/health` must report `status: "ok"` and empty `missingConfig` and
   `insecureConfig`.

CLI equivalent, if you prefer it:

```bash
vercel rollback <deployment-url> --token <token>
```

### The part that actually needs thought: the database

**Promoting an old build does not roll back a migration.** This is the
whole reason DEPLOYMENT.md §4 insists migrations be additive and run
*before* the build that needs them:

- **Additive migration** (new nullable column, new table) — the old code
  ignores it. Rolling back the deployment is sufficient and safe. This is
  the only case the current release process is designed for, and it is now
  **enforced rather than hoped for**: `npm run check:migrations` fails CI
  on `DROP COLUMN`, `DROP TABLE`, renames, `SET NOT NULL`, `ADD COLUMN
  NOT NULL` without a default, and data-destroying statements.

  > Writing this check immediately found one: `20260811201429_add_receipt_image_key`
  > drops `Receipt.imageUrl` and adds `imageKey` in a single migration —
  > exactly the pattern this section warns against. It is safe *only*
  > because it predates any deployment, so no released code ever ran
  > against the post-drop schema and there is no rollback target it could
  > break. It sits in an explicit allowlist in the script with that
  > reasoning attached, rather than being silently skipped. The rule had
  > been stated and violated once already before anything enforced it.
- **Destructive migration** (dropped or renamed column, tightened
  constraint) — the old code will break against the new schema, and
  rolling back the app alone makes things worse rather than better. The
  answer is not a clever down-migration under pressure; it is not shipping
  destructive migrations in the same release as code that depends on them.
  Split them across two releases with a period where both schemas work.

Neon's point-in-time restore is the last resort for a genuinely bad
migration. **Confirm your retention window before you need it** — on the
free tier it is short, and a restore window that expired is not a backup.

### Rehearsal — DONE, 2026-08-15

Performed on the live deployment while the database was still empty.
Rollback was visible in under 5 s; **recovery took 42 s** from clicking
promote to `/api/health` reporting `status: "ok"`, polled every 5 s. The
rolled-back build correctly returned 503 rather than serving broken.

Full record in RECEIPTLESS_STATE.md, including what the rehearsal did
*not* cover: both builds were the same commit differing only in
environment, so no migration boundary was crossed.

Repeat this whenever the release process changes. The steps below are the
procedure.

### Rehearsal steps

The rehearsal is the deliverable, not the document. With no real receipts
in the database yet, the cost of a mistake is zero, which is exactly why
this is the moment:

1. Note the current production deployment URL and its commit SHA.
2. Push a trivial visible change (a word in the footer) and let it deploy.
3. Confirm the change is live.
4. Promote the previous deployment, following the steps above.
5. Confirm the change is **gone** and `verify-deployment.mjs` still passes.
6. Record in RECEIPTLESS_STATE.md: the date, the two SHAs, and how long
   steps 4–5 took. That elapsed time is your real recovery time, and it is
   the number worth knowing before an incident rather than during one.

Until step 6 exists in the state file, this criterion is **not met**, and
should be reported as not met rather than as "documented".

## 8. Commit identity — Vercel will refuse to deploy without it

Vercel blocks a deployment when it cannot tie the commit's author email to
an account with access to the team. Hit for real on 2026-08-15:

```
Vercel didn't deploy this pull request.
GitHub couldn't verify an account for commit 356925c.
```

**Cause:** this repository had **no `user.email` configured at all**, so
git fell back to a machine-derived address (`Omar@Noureldins-MacBook-Air.local`)
that belongs to no account anywhere.

It went unnoticed for nine sessions because production deploys kept
working: merging through GitHub's web UI creates a merge commit authored
by GitHub with the account's own noreply address, and Vercel was
satisfied by *that*. Only pull-request previews, which are checked against
the branch's head commit, were blocked. A green production deploy was
hiding a broken identity on every commit.

**Fix**, in each repository:

```bash
git config user.email "<id>+<user>@users.noreply.github.com"
```

The GitHub noreply address is the right choice: it is tied to the account,
so Vercel can verify it, and it keeps a real address out of a public git
history.

Existing commits need re-authoring — setting the config does not change
them:

```bash
git rebase origin/main --exec 'git commit --amend --no-edit --reset-author'
```

Then force-push the branch. **Note:** GitHub sometimes does not update an
open PR's head after a force-push. Pushing an ordinary commit afterwards
makes it re-sync.

## 9. Smoke-test the journey a human walks

```bash
npm run smoke -- https://<your-domain>
```

Registers a throwaway account, signs in, loads the vault, and confirms the
connected-account UI is present. It exists because two features shipped to
production this session that 219 passing tests could not see — there was
no sign-in UI at all, and no Gmail UI at all. Both backends worked and
were tested; neither was reachable.

**Every test in this repo calls the API directly**, and a test that posts
to `/api/auth/login` proves the endpoint works while saying nothing about
whether a human can reach it. This is a floor, not a ceiling: it uses
`fetch` rather than a browser, so it cannot catch a component that throws
at render. A Playwright suite would be strictly better and is worth a
Phase 2 session.

It leaves a throwaway account behind — point it at a deployment where that
is acceptable.

## Still open

- Rate limiting on the auth endpoints. Vercel's platform rate limiting or
  an edge middleware would be the cheapest option; not built.
- ~~No error tracking or log drain configured.~~ Sentry is wired in
  (Session 10 Part B): `src/lib/observability.ts`, with request bodies,
  cookies, headers, query *values*, emails and IPs scrubbed before an
  event leaves the process, and Session Replay deliberately disabled —
  it would record the receipt vault on screen. Set `SENTRY_DSN` and
  `NEXT_PUBLIC_SENTRY_DSN`; the SDK is inert without them. The log-drain
  half is a Vercel project setting, not code.
- The OCR service (`ocr-service/`) is a separate container and has no
  hosting story — it is not part of this Vercel deployment. Photo OCR will
  not work in production until it does.
