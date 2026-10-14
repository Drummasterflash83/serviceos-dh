# QuickBooks operator guide

## What is live now

The reusable connector and Drummonds production app registration are installed.
The real DRUMMOND HEATING grant is verified. The first approved pass retained
49,893 records and paused at 500 requests: customers and invoices traversed,
payments checkpointed after 15,100 records. Other entity types remain pending.
This is not continuous sync.
Do not equate an enabled module, completed OAuth flow or saved page count with
complete/reconciled accounts. Current status and counts are in OpenFolk → selected
client → Modules → QuickBooks accounting connection.

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

## Current processing requirement

The hosted QuickBooks worker exists, but its dedicated trigger/dispatch has not
been enabled. The first Drummonds run uses the exact repository worker with a
local runner pinned to the approved run ID. Queuing another import in the UI
alone does not guarantee that it will be processed. Do not leave a queued import
unattended without a verified worker arrangement.

A hosted dispatcher can process already-authorised bounded runs independently of
this Mac once separately configured and verified. It does not itself create new
recurring scans. Recurring refresh policy, source-change/deletion reconciliation
and a sustained operating test are separate finishing work, not completed features.

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
  customers. Compare identifying evidence before saving a link. No automatic
  links were created by the first capture. Commusoft remains authoritative for
  current job codes; preserve the original QuickBooks job references.
- Finance is restricted to company owners/admins and authorised logged support.
  Check dates and currencies; do not sum unlike currencies or describe captured
  balances as reconciled accounts. Disconnect does not delete retained history.

## Stopping and recovering

Pause connection stops capture; module disable retains data. Resolve an error or
expired grant through the recorded controls, then explicitly approve a continuation
from the saved run. Respect the old request cap; never edit it to extend approval.
Disconnect is a provider revocation and must be an intentional owner decision.
Keep credentials server-side and recovery copies in the approved secure stores.
