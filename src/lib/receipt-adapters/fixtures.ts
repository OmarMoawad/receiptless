/**
 * ⚠️ SYNTHETIC FIXTURES — NOT REAL RECEIPTS.
 *
 * RECEIPTLESS_STATE.md's Session 7 entry asks for tests against "real
 * (anonymized) sample receipt text/HTML fixtures". Omar's own receipt
 * emails were not available when this session was built (2026-08-13), so
 * every fixture below is hand-written to be *representative* of a format,
 * not copied from a real message.
 *
 * What that means for anyone reading a green test run here: these tests
 * prove the adapters behave correctly on the formats as described, and
 * prove the registry dispatches between them. They do **not** prove any
 * real retailer's email actually looks like this. Validating that — and
 * tuning the detect()/parse() rules against genuine mail — is explicitly
 * deferred to a future session, and is the first thing to do when real
 * samples exist. Replace these fixtures with anonymized real ones at that
 * point rather than adding more synthetic ones alongside them.
 */
import type { InboundEmail } from "../inbound-email";

export function fixtureEmail(overrides: Partial<InboundEmail> & { text: string }): InboundEmail {
  return {
    provider: "postmark",
    providerMessageId: "fixture-message",
    mailboxToken: "fixture-mailbox",
    from: "receipts@example.com",
    subject: null,
    receivedAt: null,
    ...overrides,
  };
}

/** Format A: itemized order summary, the common e-commerce confirmation shape. */
export const ORDER_SUMMARY_TEXT = `Thanks for your order!

Order #A-558210
Placed on 2026-07-04

2 x Flat white                    7.00
1 x Almond croissant              3.75
3 x Sparkling water               4.50

Subtotal                         15.25
Delivery                          2.00
Tax                               1.22
Order total                      18.47

Paid with Visa ending 4242
`;

/** Format B: labelled key/value, the single-charge ride/fuel/subscription shape. */
export const KEY_VALUE_TEXT = `Your trip receipt

Merchant: City Rides
Date: 12 August 2026
Trip: Zamalek to New Cairo
Distance: 18.4 km
Total: EGP 245.50
Payment: Card ending 1180
`;

/** Format C: printed point-of-sale slip emailed as plain text. */
export const POS_SLIP_TEXT = `CORNER GROCERY
14 Road 9, Maadi

Milk 1L                  $2.40
Bread                    $1.80
Eggs (12)                $3.60

SUBTOTAL                 $7.80
TAX                      $0.62
TOTAL                    $8.42

Thank you for shopping with us
2026-08-01
`;
