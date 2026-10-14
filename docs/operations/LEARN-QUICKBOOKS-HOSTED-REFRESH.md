# Drummonds hosted QuickBooks refresh

14 October 2026. Status: Chris approved activation; worker access, secure recovery
and dispatch are verified. The logged LIVE operator enabled Drummonds' six-hour,
3,000-request policy at 10:13 UTC. The normal hosted tick created verification run
`af4983d5-2c01-4cae-a585-d2aa5ae2f841` at 10:14 UTC and renewed the existing token.
The normal hosted scheduler has saved ten pages / 1,000 observations by 10:16 UTC.
Full-cycle completion and the next due time remain acceptance checks; initial
progress alone is not completed unattended refresh.

## Verified foundation

- The two approved history runs traversed all 13 requested collections and
  retained 134,569 records. SalesReceipt returned an empty collection. Current
  connection is paused, token generation 3, and no refresh lease is outstanding.
- TEST and LIVE have the inactive revision-checked approval/read/tick functions.
  Synthetic PostgreSQL checks cover bounded cycles, immediate first verification,
  pause, incomplete baseline, banned actor, master switch and connection changes.
- LIVE shared worker v78 preserves the exact v77 source closure, including its
  recent Slack observation release. Only its QuickBooks dispatch configuration
  and page-draining helper changed. The ordinary ten-job batch/auth/lease/filter
  probe and the retained Slack-source proof probe passed on the compiled artifact.
- Dedicated LIVE accounting worker v2 checks the recurring queue, then claims
  existing approved work. Its compiled seven-case guard probe passed; an
  unconfigured hosted request returns 503 and no-store.
- Existing runtime inventory and all credential/configuration name/value
  fingerprints are preserved. A raw secret-metadata comparison also included
  update timestamps and did not match; the retained complete fingerprint digest
  independently proves all original 50 values plus both approved QuickBooks
  settings. Timestamp changes are not attributed to a particular cause.
- Isolated operator controls are released from Git SHA
  `e42a0feb519fd70793c03bcc62a7d50c2c2f2e30`, Vercel deployment
  `dpl_DwxESEPPsP1XpDWXXSLzstN47Byp`; stable-domain operator controls and the saved policy were verified.

## Approved activation

Create one new internal trigger key, at least 32 random bytes, in production
Supabase `tgbnakbxwcqjeimygroz` as `LEARN_QUICKBOOKS_WORKER_KEY`. Store a recovery
copy in this Mac's Keychain and a separate concealed field in the existing
**Openfolk ServiceOS** 1Password item. Never print it, commit it, or place it in a
browser URL. Record rotation within 90 days. Set only
`LEARN_QUICKBOOKS_DISPATCH_ENABLED=true`; preserve other provider settings.

The shared internal key can wake QuickBooks's queue of separately approved client
runs. It exposes only aggregate execution results and cannot accept a company or
query selector. Tenant/realm/recorded-actor checks and request/lease limits govern
actual accounting reads. This activates only Drummonds' ongoing policy.

Through the existing logged Chris operator session, approve production tenant
`00000000-0000-0000-0000-000000000001`, connection
`04d68333-fc13-42c2-a500-789f386f015c`, realm `1197397945`:

- First verification cycle immediately; later cycles six hours after the previous
  cycle finishes. Capture duration is additional to that interval.
- Full reads of Customer, Invoice, Payment, CreditMemo, SalesReceipt, Estimate,
  Vendor, Bill, BillPayment, Purchase, VendorCredit, Account and Item, including
  inactive supported list records. Up to 100 records/page.
- **Maximum 3,000 accounting requests per cycle**, including failures; each cycle
  expires within 24 hours. Cap/expiry/failure holds require explicit review.
- Existing OAuth grant and ordinary token refresh only. No new Intuit grant,
  accounting writes, payments, payroll, AI/model training or automatic matching.
- Policy persists until paused/revoked. Pausing fences its active run and keeps
  sources, versions and evidence. Changed connection/authority/master switches
  cannot silently create another cycle.

## Acceptance and recovery

Read back key/config fingerprints in memory, check denied requests and an
empty-queue authorised call, then observe the existing scheduled platform tick.
After approval, verify the first generated run's exact identity, limits and actor;
observe real hosted page receipts and the completed full cycle. Compare duplicate
versions/conflicts and retained customer-link identities, verify the next due time
and records visible on linked live cards. Keep all financial claims qualified as
retained unreconciled records. This is refresh, not source-deletion reconciliation.

Rollback: pause the recorded policy/connection through the controls, disable only
the QuickBooks dispatcher, verify in-flight fencing and retained records. Do not
roll shared worker code back over a later unrelated release. Exact v77 and prior
accounting worker artifacts remain in private verification storage for a guarded
runtime rollback if needed. Recovery copies use the already-approved secure
stores; any required local Touch ID must be completed by Chris.

## Activation evidence — 14 October, 10:14 UTC

- Existing trigger key recovered from Keychain and compared in memory with the
  new concealed `serviceos_quickbooks_worker_production` field in **Openfolk
  ServiceOS**. The field was read back and all prior item fields/metadata preserved.
- Production `LEARN_QUICKBOOKS_WORKER_KEY` and
  `LEARN_QUICKBOOKS_DISPATCH_ENABLED=true` read back by fingerprint; every other
  secret value remained identical. No credential value was printed.
- Hosted missing-key POST is denied with 403/no-store. Correct-key empty-queue
  request returned numeric `claimed: 0`, state `idle`, 200/no-store. The local
  provisioning check initially expected a boolean rather than the worker's numeric
  contract; it was corrected and reconciled using the same saved key. No second
  key or duplicate provisioning was created. Rotation due 12 January 2027.
- Logged policy revision 1 selects connection
  `04d68333-fc13-42c2-a500-789f386f015c`, production realm `1197397945`, tenant
  `00000000-0000-0000-0000-000000000001`. Its first hosted run echoes that realm,
  tenant and recorded actor, all 13 types, 100/page, 3,000 requests and 24h expiry.
- Two reviewed financial customer links remain unchanged at activation. No
  automatic matching, accounting writes, new human authority or AI was enabled.

At 10:16 UTC the scheduled run had ten saved pages and 1,000 observations, no
import error, matching recorded actor/tenant, token generation 4 and unchanged
reviewed-link fingerprint. No local provider runner was used for these pages.

## Source-variant correction — 14 October, 10:58 UTC

The first repeat scan exposed 13 newer computed Customer balance/update-time
variants and two Invoice reference-list permutations under unchanged SyncTokens.
The tested source-variant migration is verified in TEST and LIVE, with private
helpers and unchanged original commit permissions/unrelated functions. It
recognises only those narrowly compatible cases. Identity/amount changes,
unknown same-time changes, malformed dates and changes to invoice line order
remain held; existing unknown flags are never automatically erased.

Fifteen earlier false flags were checkpointed and corrected only after all pairs
of their retained versions passed compatibility. Locked pointer and immutable
version fingerprint checks passed; 15 system-maintenance receipts were read back,
zero flags remained, and the five reviewed financial links were unchanged. All
original versions remain retained. No provider call or new authority was used.

Actual-commit and rollback regression checks pass alongside the existing complete
OAuth/import/finance/refresh/export/disconnect checks. At 10:58 UTC the normal
hosted scan had 430 saved pages and 42,907 observations, zero current conflicts
and preserved reviewed links. Full traversal and next-due verification remain
pending. The read-only hosted-refresh evidence script verifies both before
writing completed acceptance evidence.

## Supplier balance variants — 14 October, 11:22 UTC

The first hosted scan later observed four Vendor balance/update-time variants.
The supplier-specific extension is verified in TEST and LIVE; it permits only
Balance and a distinct explicit LastUpdatedTime with otherwise identical supplier
identity/metadata. Customer-only BalanceWithJobs changes are not ignored for
suppliers. The complete existing synthetic regression suite and supplier identity/
field-boundary checks pass. No new helpers/grants or accounting writes were added.

Four checkpointed supplier flags were reconciled only after pairwise compatibility
and retained-version fingerprint checks. Readback confirms four system receipts,
zero remaining conflicts and unchanged five reviewed financial links. At 11:22 UTC
the unattended cycle had 657 pages and 65,269 observations. Full traversal and the
next six-hour due time still require acceptance; no account reconciliation or
complete customer matching is claimed.

## First unattended cycle accepted — 14 October, 12:55 UTC

Run `af4983d5-2c01-4cae-a585-d2aa5ae2f841` traversed all 13 requested collections
at 12:38:09 UTC. The actual hosted scheduler saved 1,353 pages / 134,599
observations using 1,353 of its 3,000 permitted accounting requests. Pages,
observations and reserved requests reconcile. The connection paused after
traversal, token generation is 6, and no refresh lease remains. The recorded
policy stays enabled; its next due time is exactly six hours later,
18:38:09 UTC (19:38 UK time). Five reviewed financial links are unchanged.

Final inspection found seven newer computed ledger-balance snapshots and five
payee-reference display-name variants. Ledger identity/other fields remained
identical; purchase reference IDs/types and every other field remained identical.
The tested private-helper update is verified in TEST and LIVE with existing
permissions/unrelated functions preserved. Twelve checkpointed corrections
passed pairwise compatibility and immutable-source fingerprint guards, with
system audit receipts and no provider calls. Unknown differences remain held.
Readback confirms zero conflicts. All source versions and history remain retained.

[Complete-cycle acceptance](evidence/learn-quickbooks-first-hosted-cycle-2026-10-14.json).
This verifies unattended capture and next-due calculation; it is not reconciliation
of financial accounts or complete cross-provider customer/job matching.
