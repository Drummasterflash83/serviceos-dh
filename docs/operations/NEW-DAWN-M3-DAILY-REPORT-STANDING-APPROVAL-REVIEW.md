# New Dawn M3: proposed standing approval for daily QuickBooks report evidence

**State:** Source proposal only. No standing approval has been given for this
workflow. Do not install the migration, deploy or invoke the worker, store a
trigger key, enable the policy, or schedule a call on the basis of this document.
Chris's earlier approval covered one refresh and two reads for 19 October; it
does not authorize recurring access.

## Exact proposed scope for review

- Tenant: Drummonds in LIVE only; use its existing confirmed **production**
  QuickBooks connection and recorded realm ID. The connection and app IDs must
  be rechecked against the production control plane before enabling.
- Once per completed Europe/London accounting day, after 04:00 local time, read
  only (1) the FY27 **accrual ProfitAndLoss** report from **1 April 2026 through
  yesterday** and (2) **AgedReceivables** as at yesterday, with `Report_Date`
  aging. No older daily catch-up is automatic.
- If the saved access token is near expiry, use the existing scoped OAuth
  refresh lease once for that run. This changes only the stored token pair and
  generation; it does not alter books. A lease timeout or uncertain result is
  held for human review rather than retried.
- Store both raw responses only in the existing private immutable report
  receipts. Preserve their report headers, hashes, validation states and
  operator audit events. The client home can display only separately published,
  labelled summaries; the scheduled worker returns counts and state only.
- At most two QuickBooks report GETs per claimed day. A partial, unexpected or
  failed pair is held. It is not silently retried or called fresh.
- This proposal does not authorize accounting edits, invoices, payments, email,
  supplier communication, a new mailbox, user access, provider reconnection,
  client publication, or any cross-tenant read.

## Technical boundaries

The new policy starts with no row and defaults Off. An authenticated OpenFolk
operator with existing control-plane and QuickBooks authority must record an
explicit approval reference, exact FY27 start, reason and confirmed company/app
identity. Routine full-source imports may change the connection revision; each
individual report request still freezes that revision and token generation.
Every service run revalidates that operator's live authority, the active
QuickBooks module, confirmed company and app identity, and current policy
revision. Each report GET also checks its captured connection revision and
token generation. Disabling or changing the policy fences the report GET path.
The runner has a dedicated infrastructure key and ignores request bodies and
tenant selectors. **No host schedule is included in this source change.**

Before any future enablement, review the migration in
`supabase/migrations/20261112170000_new_dawn_daily_quickbooks_reports.sql`, the
worker in `supabase/functions/learn-quickbooks-daily-reports/index.ts`, and a
rollback-only SQL rehearsal. Obtain Chris's express standing authorization for
the exact company, dates, frequency, token refresh, private retention and
activation. Then install on TEST, rehearse the authorization and failure fences,
review the LIVE migration separately, deploy the worker, record the standing
approval via the control RPC, and finally add a monitored daily trigger. A
successful scheduled run and missed-run alert should be verified before calling
daily capture operational.

## Residual risk and stop conditions

OAuth refresh rotates a provider credential. If approval is withdrawn during an
in-flight token exchange, the credential may be left uncertain; the existing
refresh lease treats that as authentication required. A report may also be
accepted before approval is disabled but the pair left held afterward. These
are explicit review states, not a reason to retry unattended. The 85-second
worker budget and five-minute SQL claim limit are intentionally conservative.
Any failed pair, stale source, changed company, revoked operator grant, inactive
app, paused module, expired refresh permission or missed day needs operator
review. This workflow does not solve the separate Commusoft job-to-invoice
bridge or the FY27 net-profit target decision.
