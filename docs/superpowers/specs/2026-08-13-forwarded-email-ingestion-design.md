# Forwarded Email Ingestion Design

## Scope

Session 6 adds the first email-ingestion path: each signed-in user receives an opaque forwarding address, and a Postmark-compatible inbound webhook turns forwarded receipt emails into owner-scoped Receipt records. The implementation ends at a tested local/provider-contract integration. Purchasing a domain, configuring DNS, creating a Postmark server, and deploying a public webhook remain founder-operated activation steps.

OAuth mailbox scanning, retailer-specific adapters, attachments/OCR, and background processing are outside this session.

## Architecture

The provider boundary has two layers:

1. A Postmark adapter validates and normalizes the provider payload into an internal `InboundEmail` value.
2. A provider-neutral ingestion service resolves the mailbox token, deduplicates the provider message, parses receipt content, and creates the Receipt transactionally.

This keeps Postmark field names out of receipt parsing and persistence. A later provider can implement the same normalized contract without changing ingestion behavior.

## Data Model

`InboundEmailAddress` belongs to one User and contains a unique, cryptographically random mailbox token. The token is used as Postmark's `MailboxHash` plus-address component. One active address per user is sufficient for this session.

`InboundEmailDelivery` records provider and provider message ID with a unique constraint. It links the delivery to its user and, when ingestion succeeds, to the created Receipt. This makes Postmark retries idempotent and preserves a small operational audit record without retaining an entire raw email indefinitely.

The Receipt remains the canonical imported object:

- `ownerId`: resolved user
- `source`: `EMAIL`
- `verification`: `IMPORTED`
- `rawPayload`: normalized receipt text used by the parser, bounded in length
- merchant, total, currency, purchase date, category, and items: parser output or conservative defaults

## HTTP Interfaces

`GET /api/email/forwarding-address` requires the existing session cookie. It lazily creates the user's random mailbox token and returns a display address derived from `POSTMARK_INBOUND_ADDRESS`. It returns a configuration error when the base address is absent rather than inventing a production domain.

`POST /api/webhooks/email/postmark` is public because Postmark calls it. It requires HTTP Basic credentials from `POSTMARK_WEBHOOK_USERNAME` and `POSTMARK_WEBHOOK_PASSWORD`, compared without timing-sensitive early exits. Authentication failure returns 403, which Postmark treats as terminal. Valid duplicate or unknown-mailbox deliveries return a successful ignored result so retries cannot amplify bad mail. Structurally invalid authenticated payloads return a clear client error.

## Parsing and Data Flow

The adapter prefers `TextBody`; when only HTML exists, it produces bounded readable text by removing non-content tags and decoding common entities without executing or rendering HTML. The normalized body flows through a pure email-receipt parser that reuses the existing receipt heuristic primitives where practical.

The parser never upgrades authenticity. Missing or ambiguous values use conservative defaults and remain visible as imported data for later user review. Sender-controlled content cannot select another owner; ownership comes only from the opaque mailbox token resolved server-side.

The service transaction is:

1. Resolve mailbox token to a user.
2. Reserve the unique provider message ID.
3. Normalize and parse the message.
4. Upsert the merchant without mutating existing shared merchant metadata.
5. Create the owner-scoped imported Receipt.
6. Link the delivery record to the Receipt.

## Error Handling and Security

- Webhook credentials and Postmark configuration stay in environment variables and `.env.example` contains placeholders only.
- Payload size, body length, address length, and item count are bounded before persistence.
- Duplicate provider IDs are acknowledged without creating another receipt.
- Unknown mailbox tokens are acknowledged and ignored without revealing whether a token exists.
- Existing Merchant records are never updated from unauthenticated email content.
- Attachments and remote HTML resources are ignored this session.
- Logs and responses do not expose mailbox-token ownership or webhook secrets.

Postmark does not provide HMAC signatures for these webhooks; its documented protection is HTTP Basic authentication, optionally combined with IP allowlisting. IP allowlisting is deployment infrastructure and is documented but not hard-coded because provider ranges can change.

## Testing

Tests cover adapter normalization, text-versus-HTML preference, invalid payloads, Basic authentication, tenant routing, unknown aliases, duplicate retries, conservative parsing, imported verification level, owner scoping, and the rule that inbound content cannot mutate an existing Merchant. Existing receipt, auth, OCR, storage, typecheck, lint, and build checks remain green.

## Documentation and Roadmap State

`.env.example`, README/setup guidance, `RECEIPTLESS_STATE.md`, and roadmap progress are updated only after verification. The state file records code completion separately from the still-pending real Postmark/domain click-through.
