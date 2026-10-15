# QuickBooks operator guide

## What is live now

The reusable connector and Drummonds production app registration are installed.
The real DRUMMOND HEATING grant is verified. Three unattended full scans have
completed across all 13 approved accounting collections. The third finished on
15 October 2026 at 12:07 UTC with 1,354 saved pages, 134,706 observations,
zero source conflicts, and matching page/permit receipts. The six-hour policy
recorded its next due time for 18:07 UTC. The current run and connection status
are in
OpenFolk → selected client → Modules → QuickBooks accounting connection.

The LIVE customer catalogue retains roughly 4,311 QuickBooks main accounts
alongside 1,553 Commusoft customer source records. Those are provider records,
not deduplicated customers. Twenty-four QuickBooks identities were individually
reviewed and linked to existing Commusoft customer cards by 15 October. Other
records remain separate until reviewed; an enabled module, OAuth grant or saved
page count does not establish complete identity matching or reconciled accounts.

## Connecting another authorised client

1. Select that client explicitly through OpenFolk; do not move the operator's
   profile or impersonate their staff. Use an authorised logged support account.
2. Confirm app ownership, applicable client-specific policy/terms and consent
   authority. The current published Drummonds legal pages do not cover another
   client. The existing app is temporarily Drummonds-owned; do not assume app
   ownership or tokens can be transferred to OpenFolk later.
3. Choose the correct environment/registration and record a reason. Connect via
   Intuit. Review the actual company and Accounting permission, which includes
   write capability although this implementation only reads accounting records.
4. Verify returned CompanyInfo and realm before confirming the company. A wrong
   company must not replace an existing source identity. Capture remains paused.
5. Enable that client's input and approve a bounded scan with explicit record
   types, page/request limits and deadline. Source identities include the tenant,
   environment, realm, entity and provider ID; never merge on display name alone.

## Current processing arrangement

The production hosted dispatcher and dedicated accounting worker are enabled.
They process Drummonds' recorded six-hour recurring policy without this Mac.
Each cycle is limited to 3,000 read-only accounting requests over 24 hours;
the next cycle is due six hours after the previous one completes. A held,
expired, failed or request-limited run requires review. Do not restart or widen
one simply because a status poll times out. Three completed unattended cycles
and normal token renewal are recorded in
[the V2 handoff](LEARN-QUICKBOOKS-V2-HANDOFF.md) and its linked evidence.

The worker retains source versions, page receipts and import checkpoints. It
does not reconcile provider deletions or automatically approve cross-provider
customer or job identities. Verify current run state and due time in OpenFolk
before making a freshness claim to a client.

An Intuit HTTP 429 keeps the same page checkpoint, consumes its attempted
request, and pauses that realm's reads for at least 60 seconds or the longer
`Retry-After` value. The worker permits at most five attempts at one position
within the approved request/deadline bounds, then stops for operator review.
Do not bypass the pacing gate or restart a bounded run to evade this limit.

## Reviewing the result

- Check each entity's saved counts, record conflicts, last observation and run
  state. A request limit is a checkpoint, not a completed traversal. Pauses and
  errors retain source pages, versions and original references.
- QuickBooks `Customer` includes main accounts and job/subcustomer records. For
  Drummonds, the first completed customer traversal saved 13,158 records: 4,310
  main accounts and 8,848 jobs/subcustomers; 315 records are inactive. Do not
  describe this as 13,158 separate customer businesses.
- Customer-card finance requires reviewed links. Use Client information, select
  the customer, provide an operator reason, then load retained QuickBooks
  customers. Compare current source identity, name, contact and address evidence
  before saving a link. Existing reviewed links remain auditable; new candidates
  must not be silently auto-approved. Commusoft remains authoritative for current
  job codes; preserve original QuickBooks job references. A reviewed parent
  customer card includes transactions on its QuickBooks-native child accounts,
  unless a child was explicitly linked elsewhere, unlinked, changed identity or
  has conflicted source evidence. This hierarchy is not a Commusoft job link. A
  customer-level invoice is not proof of its relationship to a particular job.
- Finance is restricted to company owners/admins and authorised logged support.
  Check dates and currencies; do not sum unlike currencies or describe captured
  balances as reconciled accounts. Disconnect does not delete retained history.

## Stopping and recovering

Pause connection stops capture; module disable retains data. Resolve an error or
expired grant through the recorded controls, then explicitly approve a continuation
from the saved run. Respect the old request cap; never edit it to extend approval.
Disconnect is a provider revocation and must be an intentional owner decision.
Keep credentials server-side and recovery copies in the approved secure stores.
