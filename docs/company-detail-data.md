# Company detail data contract

The company detail route accepts only a visible Step Bro book account
(`accounts.id = co-{companies.id}`). Authentication and stable-ID access checks
run before live detail or payment data is returned. Access matches the existing
Accounts views: authenticated Harper operators can read the visible book, and
the requested company must exist in that same local book snapshot. Missing or
non-book company IDs return not found.

## Displayed fields

- Company ID and name: `public.companies.id` and `company_name`.
- DBA: not displayed. The live company schema has no authoritative DBA column.
- Company status: not displayed. `companies.stage`, Jade phase/phase detail, and
  order lifecycle answer different questions; none is a single authoritative
  company status.
- Source: derived from each visible order's non-deleted
  `deals_v2.is_instant_quote` values using Step Bro's existing classifier. An
  account is IQ/Broker only when all displayed orders agree; mixed data is
  labeled Mixed rather than coerced.
- Producer: `companies.producer_assigned` resolves by
  `producers.user_slug`; only `producers.active = true` is shown.
  `orders_temp.producer` remains an order-level assignment and is not used as a
  fallback for the company card. Multiple order-level producers therefore do
  not overwrite the company assignment.
- Location: the single address stored directly on `companies`
  (`company_street_address_1/2`, `company_city`, `company_state`,
  `company_postal_code`). No country column exists, so country is not guessed.
- Contacts: `companies_contacts.company_id = companies.id`, ordered
  deterministically by creation time and contact ID. The table has no role,
  primary-contact, deleted-at, or active flag, so the UI does not invent those
  labels or filter on the unrelated `contact_status` lifecycle text.

## Orders and financials

Orders reuse the two-minute Step Bro book snapshot. `orders_temp.id` is the
order grain and joins to `deals_v2.order_number`; deleted rows/deals and
unrecognized stages are excluded by the existing book contract.

- Bound: at least one linked non-deleted `deal_stage = bound`.
- Pending: no bound deal and at least one `sold`, `confirmed`, or `paid` deal.
- Lost: no bound/pending deal and at least one `lost` deal.
- Policy number: only a bound deal's `deals_v2.policy_number`.
- Carrier: `insurance_carriers.name` by carrier code, then the existing deal
  fallback.
- Premium: `orders_temp.total_premium`, once per unique visible order. The
  company total includes visible Bound, Pending, and Lost orders and excludes
  taxes and fees.
- Revenue: the existing Step Bro definition, the stored
  `orders_temp.total_revenue`, once per unique visible order. It is not
  recomputed from premium, payments, commission, or fees. In the live
  eligibility set, 588 rows differ from
  `commission_revenue + harper_service_fee`, so presenting that sum as the
  universal formula would be incorrect.

Both totals become unavailable if any contributing order is missing its
authoritative value. Arithmetic stays fixed-point (cents for premium and
six-decimal micros for revenue) until final display rounding.

The live cross-check found 233 companies where a direct order/deal join
produces extra rows. The page aggregates the already-deduplicated
`orders_temp.id` grain, preventing those deal rows from multiplying either
financial total.

## Payment history

The authoritative customer-payment path is:

`backwards_compatibility.company_account.company_id`
→ `cpq.payment.account_id`
→ `insurance.invoice.id`
→ `insurance.invoice.legacy_order_id` (`orders_temp.id`).

Refunds come from `cpq.refund.payment_id → cpq.payment.id`. Payment links,
attempts, settlements, returns, failures, cancellations, and refunds are
separate event states:

- `initiated` → Link Sent
- `processing` → Processing
- `settled` → Settled
- `failed` → Failed
- `returned` → Returned
- `cancelled` → Voided
- refund `pending/completed/failed` → Refund Pending/Refunded/Refund Failed

`public.payments` is the legacy BigBrother projection visible in the reference
screenshot; it does not safely distinguish the complete lifecycle. For
example, the sample company's legacy “Processing” row is `returned` in
`cpq.payment`. `insurance.payment` contains policy commissions, not customer
payments, and is excluded.

Only amount, currency, status, purpose/type, status-appropriate timestamp,
legacy order ID, and a masked reference suffix leave the server. Hosted URLs,
payment-link keys, processor payloads, instruments, and bank/card details are
never selected. The latest event and count load with the page; full history is
authorized and fetched in bounded pages only after expansion.

## Cross-checks

- Company `917669` / normalized account `52221`: both Supabase and Harper Tools
  resolve 365 Business Solutions, LLC, Andre Terrell, Ashley King, order
  `10617`, premium `$782.00`, and revenue `$578.20`. The normalized payment
  path identifies two initiated links and one returned payment; none is paid.
- Company `909463` / normalized account `44318`: both paths resolve Scent Works
  K9 Academy with multiple contacts, two eligible orders, payment history, and
  a refund. Direct unique-order totals are `$37,583.00` premium and `$4,758.30`
  revenue.
