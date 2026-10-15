# QuickBooks LIVE integration and LEARN V2 handoff

Status checked 15 October 2026, 12:08 UTC. This is an operational handoff, not
an assertion that every Drummonds customer or job has been reconciled.

## Working and verified

- The Drummonds QuickBooks Online company is connected in LIVE through the
  separate OpenFolk ServiceOS Intuit app. The connector is tenant-scoped and
  performs accounting reads only. Production Vault retains the OAuth grant;
  accounting source records and history remain intact.
- Three unattended full scans have now completed across the 13 approved
  accounting collections. The third resumed from a premature 401 at page 210,
  then traversed all 13 collections at 12:07 UTC on 15 October. It saved 1,354
  pages and 134,706 observations, with 1,355 of 3,000 allowed read-only requests.
  Page receipts, unique permits and observations match; there are zero
  wrong-tenant pages, source conflicts or run errors.
- The unattended worker renewed the same OAuth grant twice during this run,
  advancing token generation 11 to 13 without a fresh company consent. The
  completed run paused capture and the existing six-hour policy recorded its
  next due time as 15 October 18:07 UTC. No local Mac or human session is needed.
  [Completed-cycle evidence](evidence/learn-quickbooks-third-unattended-cycle-2026-10-15.json).
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
- The native QuickBooks subaccount hierarchy is now included under a reviewed
  parent card, within explicit source, identity and review boundaries. TEST and
  LIVE readers have matching verified definitions, and their stable frontend
  aliases show the matching source-limit wording. The signed-in Dan Breen LIVE
  card shows three Commusoft jobs with three QuickBooks invoices and three
  payments; that card has no child account, so child inclusion is proven by
  isolated PostgreSQL tests rather than a LIVE example.
  [Release evidence](evidence/learn-quickbooks-card-hierarchy-release-2026-10-15.json).
- The SQL 401 recovery was rehearsed in a rolled-back synthetic TEST case,
  installed and body/permission-verified in TEST and LIVE, then used once on the
  failed LIVE run. A second 401 at the same checkpoint hard-stops for review.
  [Recovery evidence](evidence/learn-quickbooks-401-recovery-2026-10-15.json).

## Operational closeout and ongoing guardrails

- The third unattended scan and six-hour scheduler handoff pass the connector
  acceptance checks. Keep monitoring future runs through OpenFolk; a fresh 401
  after the bounded recovery stops for review rather than looping indefinitely.
- The 24 reviewed links were rechecked after completion: 24 audit events,
  24 existing cards, zero identity drift and zero missing or conflicted linked
  sources. Ordinary signed-in customer-card access passed. Do not silently
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
- On the 15 October signed-in LIVE LEARN page, the newest-card list included
  bounce-mail addresses as customer titles. This is a separate customer-card
  source/classification quality issue for V2 to inspect before claiming the
  whole catalogue is clean. It did not alter the 24 reviewed QuickBooks links.

The QuickBooks connector is reusable for future client tenants; no Drummonds
realm, credential or mapping is hard-coded into shared customer identity keys.
The operator controller must keep per-client connection status and recovery
visible without claiming a stale or failed scan succeeded.
