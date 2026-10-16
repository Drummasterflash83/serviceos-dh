# Build 01 — current Commusoft job freshness

## Working and verified

**16 October 2026, 07:20 UTC (08:20 BST):** the read-only current-jobs scheduler is
installed in TEST and LIVE and enabled only for Drummonds' existing approved LIVE
account. Five normal worker windows completed, with no incomplete windows. Latest
retained jobs page: **07:18:07 UTC**; current-jobs watermark: **07:16:03 UTC**.
The contact crawl resumed and completed all 871 site-contact targets. The full
cycle then completed and advanced its independent watermark to 02:13:04 UTC.
A changed-record page proves that window's traversal, not a new observation of
every retained job.

[Sanitized acceptance evidence](evidence/learn-build01-commusoft-current-jobs-2026-10-16.json)
contains separately timestamped scheduler and coverage readbacks. Before the
change, jobs were waiting behind the contact traversal: at 05:59 UTC their latest
page was from 02:18 UTC. The first independent window committed four observations
at 06:12:21 UTC. The second normal completion proves the lane recurs; the third completed while the full cycle was idle, with its full-cycle watermark unchanged.

The scheduler makes jobs eligible every 15 minutes during contact traversal and
between full cycles. It reuses the existing tenant, connection, approval, quota,
worker, immutable source writer and receipt gates. It waits for active leases,
saves the exact contact checkpoint and full-cycle due time, and restores them
after completion, failure, expiry or pause. Only completed source pages and a
successful finish receipt advance the separate jobs watermark. Five-minute
overlap, two-minute upper lag, a 24-hour maximum window, existing page budgets
and one-hour expiry bound each pass. This is an eligibility cadence, not a
15-minute delivery guarantee. Native properties/jobs phases are not interrupted.

Validation passed: 138 adapter tests; the real disposable PostgreSQL traversal,
recurring and current-jobs suites; and a TEST rollback probe using the guarded
source writer, changed jobs, exact contact resume, tenant denial and preservation
checks. Exact installed functions and migration ledgers match both source files
in both environments. TEST's real retained Drummonds capture remains inactive
and historical (latest jobs page 12 October); synthetic TEST acceptance is not
fresh real-provider acceptance.

One existing LIVE job was reviewed in the existing signed-in Drummonds UI and
updated to the latest retained completed status, preserving its reviewed customer
and source history. At the 07:20 UTC coverage readback, all **1,004 published jobs**
used their latest effective retained versions, with no missing canonical customer.
An unzoned source completion date remains excluded from duration and scoring.
The live Drummonds branding and frontend were unchanged.

One additional source site, its open job and 59 historical jobs with existing
reviewed customer relationships were linked through the signed-in UI. All saved
batches returned zero attention items. The new open-job card is visible with code
`006` preserved; source business-unit code `001` also remains text. The card
truthfully shows recorded open status, no linked communications, unconfirmed owner
and unassessed scoring. This verifies card presentation, not independent job progress.

24 clearly named contacts with reviewed parents and no observed name/channel
collision were then linked through the same UI. That brought LIVE to 100 reviewed contact
links. The expanded readback verifies every linked canonical person, customer card,
source-parent card match and active contact-to-customer edge. All 24 recorded
site-contact links match their source-parent site and have active site edges. All
checks report zero missing or mismatched relationships. TEST reports the same
checks clean for its one retained reviewed contact, without new provider activation.

Five further contacts were linked to existing reviewed people after checking exact
provider contact IDs against the customer source and saved account-holder evidence.
Three had explicit account-holder decisions backed by the customer export; two
older customer reviews were corroborated against that export. Each current UI
candidate search returned one matching person, and each saved batch had zero
attention items. No new person was created by these five links. The final readback
shows **105 reviewed contacts**, with all relationship checks still clean. The
fifth normal current-jobs window also completed with no incomplete windows.

The fourth jobs window encountered a missing-page success settlement, which the
worker correctly rejected. Its normal second attempt then completed with a durable
source page and finish receipt. No manual restart or watermark advance on the
rejected settlement occurred. An initially failed contact search recovered on
read-only reload/retry; no schema change was needed. A new source job arrived
during review, so the current coverage denominator increased by one.

Source codes remain strings, including leading zeros. The observed provider
business codes are carried in description/business-unit text; numeric source job
IDs remain separate identities. No QuickBooks mapping was inferred or altered.
No provider write, webhook registration or provider setting change was made.

## Needs finishing

LIVE retains 12,650 jobs, including 289 open/pending/on-hold jobs. Ten of those
open-work jobs are published: **279 remain unlinked**. The blockers include 25
jobs whose referenced property is absent from the retained source and unreviewed
customer/site relationships. The full open-work breakdown is in the evidence.
The 25 missing-parent jobs reference 17 distinct nonzero source IDs; no reference
is null or zero. Five parent IDs (11 jobs) match the 13 October private export/API
difference. That dated evidence does not establish present visibility for every
missing property. The provider UI/API discrepancy and a documented-detail HTTP
404 were previously verified; replaying the same full traversal is not a proven
fix. See [provider coverage evidence](evidence/learn-commusoft-provider-coverage-2026-10-13.json).

No unlinked job with an already reviewed parent remained at the final audit.
65 contacts with reviewed parents still need identity decisions: 29 have channel
overlaps; the other 36 include repeated person names, partial/joint names, buildings,
shared-mailbox labels and occupier labels. Two contacts have prior identity-review
holds. Parent readiness and matching names alone do not settle contact identity;
these records remain available for explicit review.

Retained properties: 2,425, with 152 reviewed links; retained contacts: 2,969, with
105 reviewed links. These counts are coverage, not a claim of complete cards.

Investigate missing parents through authorized read-only source evidence, then
review the customer/site/job relationships. Continue to preserve uncertain dates
and identities instead of manufacturing scoring evidence.

## Blocked externally

135 unreviewed customers underlying open work need authoritative person/company
classification. Earlier provider UI evidence already establishes customerType
ID-to-label names, including 1 Private customer, 2 Company, 4 School or College,
5 Property Management, 6 Care Home, 7 Religious building, 8 Hospitality,
9 Government Building, 10 Private Landlord and 13 Accounting Name. These labels
and creation routes are not a complete canonical person/company policy. Chris is
seeking Heidi's confirmation of actual usage, mixed-type exceptions and the
account-holder versus named-contact distinction. A draft was prepared
for Chris; no message was sent. Classification and full relationship acceptance
remain incomplete pending that evidence. The remaining contact identities also
need corroboration beyond shared endpoints or matching names, and missing source
parents need provider visibility evidence. Safe links supported by the current
reviewed-parent and exact account-holder evidence have been exhausted.

## Release and recovery

Deployed immutable migrations:

- `20261103300000_learn_commusoft_current_jobs.sql` — SHA-256
  `59c6b1535c34cccc4d4275cf411c1e0f857c096fce562dd9c3c40fb88c72c355`.
- `20261103310000_learn_commusoft_current_jobs_idle.sql` — SHA-256
  `349a839000ed90ff7eaf86891320edc83c1e1c68e2b3262fa4b8111afb86df8f`.

The second migration preserves idle full-cycle due time and frontend-compatible
recurring states. Do not edit or blindly replay either deployed source. LIVE uses
its standard migration ledger; TEST uses `of_test_deploy.migrations`.

```sh
node --test supabase/functions/_shared/commusoft/*.test.ts src/lib/learn-commusoft*.test.ts
python3 scripts/verify/learn-commusoft-contact-traversal.py --current-jobs
node scripts/verify/learn-commusoft-current-jobs-release.mjs readback test
node scripts/verify/learn-commusoft-current-jobs-release.mjs readback live
node scripts/verify/learn-commusoft-build01-readback.mjs live
```

Private release journals, baseline functions, rollback SQL and UI proof are in
`.verification-results/commusoft-current-jobs-20261016/`, excluded from Git. The
release tool performs rollback rehearsals, transactional preservation checks,
exact baseline/ACL checks and post-apply verification. Installation is inert until
explicit account activation. The existing authorized server-side access is reused;
credentials are never emitted or committed.

To stop only this lane, run the release tool with `pause live`. Let the existing
worker drain/restore any active window; confirm `active_jobs_window: false` before
restoring the exact original scheduler from the private
`live-rollback-scheduler.sql`. Do not restore it while a contact scope is suspended.
Keep all source data, receipts and review history. The separate idle-patch rollback
files restore the immediately preceding function version only. No frontend build
or Vercel promotion is required for these backend-only changes.

## Earlier webhook investigation (05:04 UTC, historical)

The following investigation predates the deployed polling solution. Its webhook
boundary remains inert and is not required by the current-jobs scheduler.

Commusoft's [webhook documentation](https://developer.commusoft.com/webhooks-2114965m0)
describes signed, thin notifications for job creation and updates. It specifies
an HMAC-SHA256 over the delivery timestamp, a period and the raw JSON body;
the event identifies a job but does not contain the current job record. A
successful event therefore must trigger a guarded, read-only GET through the
existing tenant and connection, then commit an actual source version before
any card can change. Delivery alone is never job-progress evidence. The
provider can retry, and a paused webhook can lose events, so the existing
polling cycle remains a reconciliation path.

An inert local [`webhook_boundary.ts`](../../supabase/functions/_shared/commusoft/webhook_boundary.ts)
now verifies the documented signature and freshness window, exact application
and client identities, UK API origin and positive job ID. It accepts only
`job.created` and `job.updated`; property, delete and other event types remain
out of scope. Its return value contains only an event ID, action, job ID and
source timestamp, never the supplied body or a job status. Three synthetic
boundary tests and repository TypeScript pass. This is **not** a receiver, a
subscription, a durable hint, a source fetch or a publication path.

Before activation, the implementation must add durable event-ID deduplication,
revalidate the current approved tenant/connection in the persistence
transaction, reserve the existing Commusoft quota, fetch the fixed job endpoint
without trusting the event URL, retain the source response through the current
versioned writer, handle 404/deletion without erasing history, and test retries,
revocation, stale events and provider gaps in TEST. It must prove a LIVE
job-change-to-card journey and preserve a slower full-list reconciliation.
Registering the webhook in Commusoft changes a source-provider setting; the
current Build 01 authorization expressly excludes that action. It needs an
exact-scope approval after the complete receiver and processor are reviewable.
