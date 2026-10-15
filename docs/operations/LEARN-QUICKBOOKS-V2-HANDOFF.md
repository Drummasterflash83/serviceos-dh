# QuickBooks LIVE integration and LEARN V2 handoff

Status checked 15 October 2026, 11:05 UTC. This is an operational handoff, not
an assertion that every Drummonds customer or job has been reconciled.

## Working and verified

- The Drummonds QuickBooks Online company is connected in LIVE through the
  separate OpenFolk ServiceOS Intuit app. The connector is tenant-scoped and
  performs accounting reads only. Production Vault retains the OAuth grant;
  accounting source records and history remain intact.
- Two unattended full scans completed on 14 October across the 13 approved
  accounting collections. The third scan was resumed after a premature 401 with
  a single guarded token-refresh allowance. It had advanced from 210 to 771
  saved pages at this checkpoint, with no current run error. This third scan is
  still in progress and is **not** a completed-cycle acceptance result.
- The unattended worker renewed the existing OAuth grant before its 11:06 UTC
  expiry: token generation 11 became 12, and ten more pages were retained on
  the same run afterward. All 771 page receipts, unique permits and 76,679
  observations reconcile with zero wrong-tenant pages and source conflicts.
  [Refresh evidence](evidence/learn-quickbooks-unattended-refresh-2026-10-15.json).
- LIVE retains 134,706 latest QuickBooks source records across the collections,
  with zero unresolved source conflicts at this checkpoint. This is a source
  record count, not a count of distinct customers or reconciled transactions.
- The protected LIVE customer catalogue shows Commusoft and QuickBooks sources
  together, but groups them only through reviewed canonical-card links. The
  OpenFolk operator UI now has 24 audited QuickBooks customer links to 24 cards.
  Nineteen links were added on 15 October after unique exact name, email, phone
  and recorded-address corroboration with the current Commusoft source and card.
  Seven of the first eight new cards were signed-in verified with both published
  Commusoft jobs and captured QuickBooks financial records. The eighth has a
  reviewed accounting customer identity but no direct captured finance. All
  eleven later cards were also opened and checked: three have both published jobs
  and captured finance, four have jobs but no direct captured finance, and four
  have neither a published job nor a direct transaction. An empty result is not
  a claim that the provider has no work or finance for that customer.
- A read-only integrity check found 24 link audit events, 24 existing distinct
  cards, zero changed QuickBooks identities, zero missing latest customer
  records and zero conflicted linked sources. It did not infer invoice-to-job
  relationships.
- Customer finance is readable only by Drummonds admins and logged OpenFolk
  support operators. The reader withholds figures when a linked QuickBooks
  identity changes or a source is conflicted. Invoices, payments and credits
  stay distinct; no job profit is inferred from a customer-level accounting
  link.
- The SQL 401 recovery was rehearsed in a rolled-back synthetic TEST case,
  installed and body/permission-verified in TEST and LIVE, then used once on the
  failed LIVE run. A second 401 at the same checkpoint hard-stops for review.
  [Recovery evidence](evidence/learn-quickbooks-401-recovery-2026-10-15.json).

## Needs finishing before QuickBooks operational sign-off

- Let the resumed third scan traverse all 13 collections and reconcile saved
  pages, observations, unique permits and source conflicts. Verify an ordinary
  subsequent six-hour unattended cycle starts and completes under the same
  3,000-request, 24-hour policy. If a fresh token also receives 401, investigate
  the Intuit grant instead of retrying indefinitely.
- Recheck the 24 reviewed links after the scan, including source-identity drift,
  actor audit and ordinary signed-in customer-card access. Do not silently
  auto-approve additional identities.
- Keep the first client app's ownership visible: its Intuit registration is in
  Drummonds' developer workspace. Future OpenFolk-owned app migration requires
  separate client reauthorisation; connector code and source identity keys are
  designed to survive that migration.

## LEARN V2 identity and job context

- QuickBooks and Commusoft are retained as separate provider inputs. The LIVE
  source catalogue has approximately 4,311 QuickBooks main accounts and 1,553
  Commusoft customer records. Those records are not a deduplicated customer
  total. Only the 24 reviewed pairs above may display as combined canonical
  cards today. Other sources remain browsable under their provider labels.
- A read-only 15 October diagnostic found 576 uniquely corroborated candidate
  source pairs under conservative field rules; 552 lacked a published Commusoft
  card at that moment. These are review candidates, not authorised links. V2's
  current card-publication work may change those counts. Generic organisational
  names or address-only matches need extra evidence, even when many financial
  records are present. Two currently published candidates remain deliberately
  unlinked: a surname-only household and an organisation with name/address but
  no corroborating email or phone.
- LEARN V2 should own the broader customer identity publication/review queue,
  contacts and sites, and the job-to-accounting crosswalk. Commusoft remains
  authoritative for current job codes; older QuickBooks references stay source
  evidence. Do not attach a customer-level invoice to a specific job without a
  verified source relationship.

The QuickBooks connector is reusable for future client tenants; no Drummonds
realm, credential or mapping is hard-coded into shared customer identity keys.
The operator controller must keep per-client connection status and recovery
visible without claiming a stale or failed scan succeeded.
