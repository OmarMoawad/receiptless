# Choosing an FX rate provider (session 7, step 4)

**Checked 2026-08-21 against each provider's current pricing and terms**,
because `RECEIPTLESS_STATE.md` says not to pick one from memory: terms and
pricing move, and the shortlist has to be re-checked at the moment of
choosing. If you are reading this more than a few months later, re-check
it again — the *method* below survives, the numbers may not.

**Nothing needs buying today.** Manual rate entry works end to end and is
a permanent path, not a stopgap. This document exists so the decision is
made deliberately rather than under pressure.

## The finding that reframes the decision

The question is not "which aggregator". It is **mid-market rate or
Central Bank of Egypt rate**, and those are different numbers.

Receiptless's output is a tax summary. An Egyptian accountant filing
against EGP figures expects the **CBE official rate** for the day, not a
mid-market aggregate from a commercial feed. A mid-market rate is the
right answer for "what was this worth"; the CBE rate is the right answer
for "what do I put on the return". They diverge, and EGP is exactly the
currency where they diverge most.

That distinction should be settled before the vendor is, because it
eliminates most of the shortlist on its own.

## What was checked

| Option | EGP history | Commercial use on free tier | Card to sign up | Notes |
| --- | --- | --- | --- | --- |
| **Frankfurter** | **No** | free, unlimited | none | Already eliminated: ECB reference rates exclude EGP. |
| **exchangerate.host** free | Yes | Ambiguous, and the ToS broadly prohibits "exploitation" without distinguishing tiers | **Yes — card required to obtain the free key** | **No HTTPS on the free plan.** Hard disqualifier on its own. 100 req/month. |
| **CurrencyAPI** free | Yes | **No — explicitly "Private Use"** | — | Disqualified for a commercial product by its own pricing page. |
| **CurrencyAPI** Small | Yes | Yes | Yes | $9.99/mo, 15,000 req/mo. Mid-market rates. The cheapest unambiguously-licensed general feed found. |
| **Open Exchange Rates** | Yes, but **historical/time-series is Enterprise-tier** | — | Yes | $47/mo for the tier that has the endpoint. Disproportionate to the need. |
| **CBE via Apify actor** | **Yes — official CBE rates**, buy/sell/mid, 19 currencies | Pay-per-result on the **free** plan, no card | Yes (Apify account, no card) | Free tier is **$15/1,000 results** ($11 only at the discounted Business tier), drawn from Apify's **$5/month free credit**. Receiptless fetches once per pair per date, so real usage is a few results a month — well inside the free credit. Community-maintained, not an official CBE product. |
| **CBE direct** | Authoritative | Free | none | **Blocked.** A request to the CBE rates page returns "The requested URL was rejected" — there is a WAF in front of it and no documented public API. A serverless function would be blocked the same way. |

## Why the volume argument matters more than the price

The snapshot design means the API is called **once per currency pair per
date**, not once per receipt. A rate is fetched, written to `fx_rates`,
and copied onto the receipt; every later read uses the stored copy, and
re-converting a receipt never re-fetches.

So realistic usage is on the order of *tens* of requests a month — a few
foreign currencies across the days you actually bought something. Every
paid tier above is priced for a volume this app will not approach for
years. **Do not buy on quota.** Buy on licence and on which rate is the
correct one.

## Decision (2026-08-21)

**CBE via the Apify actor, mid rate (`conversion_rate`), on Apify's free
plan.** Omar confirmed the summary is filed in Egypt, so CBE is the
correct source, and chose the mid side. The actor is wired as
`ApifyCbeProvider` (`src/lib/fx/providers/apify-cbe.ts`); turning it on is
four environment variables, in `docs/SETUP-ACCOUNTS.md`. The card question
that shadowed this whole decision does not apply to this route — Apify's
free plan needs none.

The reasoning that led here is kept below.

## Recommendation

1. **Settle mid-market vs CBE first.** If the tax summary is meant to be
   filed in Egypt, CBE is the correct rate and most of the table is
   irrelevant.
2. **If CBE: the Apify actor is the only reachable route.** On the free
   plan it costs $15/1,000 results drawn from Apify's $5/month credit —
   and because receiptless fetches once per currency pair per date and
   stores the result, real usage is a handful of results a month, far
   inside that credit. (An earlier draft here quoted "$0.50–$2.50 for a
   year"; that assumed the discounted rate and a small pull. A *bulk*
   full-year, all-19-currencies download at the free rate would be nearer
   $100 — but the app never does that, so the free credit is the correct
   frame.) The obvious objection — depending on a
   community-maintained scraper — is the one risk this session already
   designed for: rates are snapshotted onto receipts, so the actor
   disappearing cannot retroactively change any figure already recorded.
   It would stop *new* automatic conversions, and manual entry would
   still work. That is a recoverable failure, not a data-integrity one.
3. **If mid-market: CurrencyAPI Small at $9.99/mo** is the cheapest
   option whose commercial licence is stated plainly rather than inferred.
4. **Either way, the blocker is the card, not the price.** Every viable
   option requires one, including the "free" tiers — which is the same
   wall Vercel Pro hit, since Egypt-reachable prepaid and virtual cards
   were refused there. Solve that before evaluating anything else; it
   determines whether this decision is available at all.

## What is deliberately not decided here

Whether Receiptless takes payment. That question already gates the Vercel
Pro deferral, and it gates this one too — a "private use only" free tier
is fine for a personal vault and not fine for a product that charges. The
two deferrals should be resolved together rather than separately.

## Sources

- [exchangerate.host pricing](https://exchangerate.host/pricing) and [terms](https://exchangerate.host/terms)
- [CurrencyAPI pricing](https://currencyapi.com/pricing)
- [Open Exchange Rates plans](https://openexchangerates.org/signup)
- [CBE historical rates actor (Apify)](https://apify.com/maged120/central-bank-of-egypt-historical-rates)
- [Central Bank of Egypt](https://www.cbe.org.eg/) — rates page rejected the request
