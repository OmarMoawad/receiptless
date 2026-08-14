# Session 10 Part B — your half

Everything here needs an account, a card, or a consent screen, so it has to
be you. I can't create accounts, accept terms, or type credentials — and
you should not paste any secret from these steps into our chat. They go
straight into Vercel's environment-variable UI or your `.env`, never here.

Work top to bottom; each step's output feeds the next. Tell me when a step
is done and I'll verify what's verifiable from outside.

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
