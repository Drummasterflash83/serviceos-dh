# Drummonds TEST import continuations and remaining coverage

## Fixed update periods — implemented locally, 12 October

Migration `20261101540000_learn_commusoft_update_windows.sql` and prepared
production package `017_commusoft_update_windows.sql` now bind canonical UTC
`updatedFrom`/`updatedBefore` values through operator approval, durable worker
scope, credential permit, page commit and resume. The transport sends the
documented `lastUpdatedOnDateTime[gte]`/`[lt]` filters. Full imports remain
unfiltered; partial, malformed and reversed ranges are rejected, and new
approvals cannot select a future end time.

Operator controls describe UTC bounds and retained history. Completion is labelled
as one update period. Contact planning continues to use the latest completed
**unfiltered** property traversal, even after a changed-property window completes.
The archive rehearsal proves old versions, pages, targets and all original data
remain preserved. [Local acceptance](evidence/learn-production-update-windows-2026-10-12.json).

This is the manual bounded-refresh foundation. No recurring approval, successful
watermark advancement, deletion reconciliation or automatic canonical update is
implemented by it. No real-provider filtered request or hosted install has occurred.
The current TEST customer-contact traversal continues on its previously installed
runtime; do not replace that runtime while its preservation-bound batch is running.

## Current operator continuation and refresh gap — 12 October

The retired temporary run below is retained evidence, not the current access route.
Chris's existing ongoing TEST operator session is now verified. The subsequent
operator-approved traversal completed all 871 sites; the refreshed customer-contact
pass reached 900 of 1,550 at 17:30 UTC and resumed under its original request
ceiling and expiry. That terminal batch verified all 194 protected datasets.
Do not reset its counters, start a competing worker, or replace its checkpoint.
[Verified checkpoint](evidence/learn-commusoft-contact-checkpoint-900-2026-10-12.json).

The completed-collection worker currently stops at `collection_exhausted`. The new
infrastructure tick dispatches already-approved work but does not create an ongoing
Commusoft refresh. This remains a delivery gap.

The official [core API patterns](https://developer.commusoft.com/core-concepts-and-patterns-1985393m0)
document numeric ID cursors and date comparison operators. The saved property
schema describes a `lastUpdatedOnDateTime` range; jobs expose that filter too.
The [contact endpoint](https://developer.commusoft.com/list-property-contacts-28546275e0)
requires a property scope. Advancing only the highest imported ID would miss edits
to older records. Date-filter behaviour still needs bounded real-provider evidence.

Implementation requirements derived from the current queue and source contracts:

- Store each refresh's fixed lower/upper update bounds in its approved scope,
  credential permit and retained page. Start its pagination at the beginning;
  never reuse a historical traversal's final ID as an update watermark.
- Advance the successful refresh boundary only after the bounded traversal is
  durably exhausted. Retain failed/partial windows, use overlap for reconciliation,
  and disclose provider timestamp/timezone uncertainty.
- Keep contact parent plans based on a **complete unfiltered property traversal**.
  A completed changed-property window is not a complete list of customer/site IDs.
  Existing scope validation and the contact-plan query must change together.
- Preserve versioned raw observations. Existing canonical projections hold changed
  sources for reconciliation; an import alone must not claim customer cards are current.
- Add logged operator controls, recurring-window state and tenant/module admission
  before enabling a schedule. No new approval, provider request or hosted change
  was made during this review.

[Commusoft webhooks](https://developer.commusoft.com/webhooks-2114965m0) can signal
property and job changes, but the listed objects do not include contacts. Their
notifications carry resource IDs and require authenticated follow-up reads. A
future webhook route needs signature verification, event deduplication and recovery
for delivery gaps; it cannot replace contact reconciliation or historical coverage.

## Latest result — 12 October, 09:56 UTC

Approved continuation `d764008e` ran within its 60-minute access window and
retired at **09:55:57 UTC**, before its 09:58:53 expiry. Both capture flags are
paused, no import job is running, the exact temporary grant has ended and the
login is banned with its temporary password removed from the private journal.
All original protected dataset fingerprints remain preserved.

Retained TEST source coverage is now:

- Properties: **25 pages / 2,418 unique records**, traversal end observed.
- Jobs: **127 pages / 12,611 unique records**, traversal end observed; resumed
  from the retained 100-page checkpoint without replacing earlier source pages.
- Customer contacts: **386 pages / 850 unique records**, incomplete against the
  stored plan of 1,547 customer parents. Pages can be empty or continue a parent.
- Work-address contacts: not started by this continuation.

The run used 413 import permits plus six bounded diagnostic GET attempts,
within the approved maximum of 4,000. The first worker returned 503 before claim;
its exact response and unchanged queued state were inspected before retry.
No canonical publication, provider writes, schedules or production changes occurred.

Reference reconciliation remains necessary: **1,553 jobs** reference **169
properties** absent from the property traversal (1,522 completed, 27 ongoing,
four on hold). Three sampled property detail requests returned authenticated
JSON 404 responses. An earlier three-request diagnostic used the wrong header
and default user agent and received HTML 403; this was our diagnostic error,
corrected to the already working Bearer request and OpenFolk user agent. It is
not evidence of an external access outage. The three 404s do not explain every
missing property or prove deletion.

Next: prepare a new authorised continuation from the saved contact checkpoint;
never reactivate this retired identity or restart the completed traversals.
Finish both contact collections, reconcile absent relationships and timestamp
limitations, then verify canonical publication, incremental updates and signed-in
source-to-card delivery. No completeness claim or requirement is waived.
[Sanitised run and retirement evidence](evidence/learn-commusoft-continuation-retired-2026-10-12.json).

## Earlier readiness — 12 October, 08:56 UTC

The same prepared run passes full read-only preflight on TEST 079. The 100-page
jobs checkpoint, existing encrypted Commusoft credential and paused capture are
unchanged; no login, grant or provider request has been created.

All 78 original dataset fingerprints were reproduced after excluding only 14
exact recorded synthetic tenants and four exact synthetic voicemail objects,
and reading the 35 original interactions in their prior column shape. The two
columns added by TEST 061 remain null for all those original interactions.
Every fixture tenant is archived, its marker is exact, related fixture logins
are inactive, and both voicemail buckets remain private. Unknown changes reject
the reconciliation. Two original and two current scans match; the refreshed
baseline now includes and protects all additions. Original journal bytes and
older baselines are retained separately. Do not rerun the one-shot refresh.

The Auth compatibility check accepts precisely the TEST 071 source-version
retention trigger, then applies the complete earlier Auth/authority contract.
Both Commusoft endpoints are revision 5 with the exact executable bundle hashes
previously verified at revision 4, ACTIVE status and JWT verification. Revision
counters alone are no longer treated as code changes; endpoint identity, bundle
bytes, minimum reviewed revision, import-map state and JWT enforcement are pinned.
Thirty-two focused tests pass, including changed original rows, unknown additions,
OR-predicate grouping, private storage, fixture authority and runtime code drift.

**Chris approved this continuation on 12 October after the 08:56 preflight.**
Activation is the next step. The identity, 60-minute duration
and 4,000-request budget below remain unchanged. [Readiness evidence](evidence/learn-commusoft-continuation-079-2026-10-12.json).

## Earlier readiness — 11 October, 13:17 UTC

Release 059 changes only the job review projection and preserves every source
row. The same prepared continuation passed its full read-only preflight at
13:17:18 UTC against catalog `2be2b5f2e08de7901b487f43fa3e9b17`.
All 78 protected dataset fingerprints still match the retained baseline; no
rebaseline or historical fixture refresh was needed. Current worker/Auth checks,
credential binding, paused capture and the 100-page incomplete jobs checkpoint
passed. Seventeen focused continuation/playback-refresh tests pass. The historical
058 playback refresh remains pinned to 058 and must not be rerun.

No account or grant has been created, and no provider request has been made.
The same identity, 60-minute duration and 4,000-request cap remain proposed.
**The existing access approval request remains pending. No import was activated.**

[Sanitized readiness](evidence/learn-commusoft-continuation-059-2026-10-11.json).

## Earlier readiness — 11 October, 12:38 UTC

The original continuation now passes its full read-only preflight against TEST
release 058. All 78 original dataset fingerprints match after a narrowly scoped
reconciliation of the approved, retired playback run `73e083fe`. Exactly nine
tables gained known fixture rows: one call, two recording metadata rows, one
interaction/person/company/card/profile, two tenant directory rows, and one
generated storage object. No unknown differences were accepted.

The check verified exact playback run markers, banned account, removed membership,
private bucket and generated object's size. It excluded only exact fixture row IDs
and the exact bucket/object name when comparing to the old baseline, then checked
two current and two original-data scans. All original hashes matched. The refreshed
baseline includes and protects those additions. Previous bytes are retained in the
private `commusoft-continuation-before-refresh-058.json`; both older baseline
histories remain in the current journal too. Do not repeat this one-shot refresh
or overwrite any original proof.

Continuation catalog is now `b35981f6b70c615e9e234540ddff1777`; the saved-result
catalog separately matched installed release 058. The earlier 057 refresh remains
pinned to its historical schema. Twenty-one focused checks pass, including
unretired/wrong identities, changed old rows, extra additions, drift and scope changes.

Full preflight passed at 12:38:34 UTC: current Auth contract, worker/verifier,
credential binding, paused capture, original 100-page jobs checkpoint and all 78
preserved datasets. Zero requests and zero active continuation grants. Identity,
60-minute limit and maximum 4,000 read-only requests are unchanged.
**The existing access approval request remains pending. No import was activated.**

[Sanitized refreshed readiness](evidence/learn-commusoft-continuation-playback-refresh-2026-10-11.json).

## Earlier readiness — 11 October, 12:07 UTC

The same prepared run now passes a fresh **read-only preflight** against the
installed TEST release 057 environment. The original 60-minute grant proposal,
login, tenant, 4,000-request cap, collection order and 100-page jobs checkpoint
are unchanged. No access or provider request has been activated; the pending
explicit approval is still required.

Later Phone acceptance retained two archived synthetic companies. They added two
recordings, two transcripts, two insights, six sync runs and eight audit rows.
Removing only those two exactly identified fixtures from the comparison reproduced
**all 78 original fingerprints**, with no remaining difference. The one-time
compatibility refresh preserved the original private journal and original
baseline, then captured a new baseline which **includes and protects** the added
fixtures. It does not permanently exclude them. Unknown additions, changed old
rows, fixture identity changes and drift between scans all reject the refresh.
The completed refresh must not be rerun or replaced with a blanket rebaseline.

The continuation reader now pins `147379faf1b523f103ceac7abc52c615`. Its older Auth
fixture check also needed to recognise the exact three nullable transcript
provenance columns and recording-run foreign key installed by release 055.
The new matcher validates each addition and then applies every original Auth and
work-authority trigger check. All other contract fields matched. The prepared
Phone playback runner uses the same strict compatibility check, with its separate
activation approval unchanged.

Twenty focused checks pass. Hosted preflight verified the schema, Auth contract,
Commusoft worker/verification v4 with JWT checks, original credential binding,
two paused capture flags, unchanged jobs checkpoint and all 78 current baseline
fingerprints. There are zero continuation provider requests and active grants.
[Sanitized evidence](evidence/learn-commusoft-continuation-refresh-2026-10-11.json).

To recheck without activating anything:

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-commusoft-continuation-session.mjs preflight
```

This updates only the private local readiness journal. Every activation still
reruns its own checks and requires the exact approved run ID.

Run `d764008e-8c8f-4837-999a-8d38b5e6e2d5` is prepared against TEST
`saatxzwxvdvqevbnskxy`. Read-only preparation passed at 21:30 UTC, 10 October.
No new user, grant, provider request, queue job or database write has occurred.
The original approved run remains retired; its private journal is not changed.

## Scope for approval

Reuse Drummonds TEST tenant `f8c114fa-fee7-4983-8970-f6e7f5fd3129`, its verified
Commusoft connection and existing encrypted Vault credential. Continue the original
job approval from its exact retained 100-page checkpoint. Allow at most **500
additional job pages**, then **2,000 customer-contact pages** and **1,500 work-address
contact pages**, with 100 records per page. Contacts are queried per property; a
page can contain no contacts. A complete jobs traversal is required before customer
contacts start, and customer contacts must finish before work-address contacts start.

A new synthetic login, `learn-continuation-d764008e@example.invalid`, would receive
a **60-minute OpenFolk admin grant**, which can administer all TEST clients. The
runner restricts operations to this existing Drummonds tenant. The run permits no
more than **4,000 read-only provider requests** and stops dispatch at least two
minutes before grant expiry. Time or page limits can leave collection coverage
incomplete; they never imply success. No provider writes, canonical publication,
payroll, schedule or production changes are included.

Afterward, pause capture, end the exact new grant, rotate the temporary password
and ban that login. Retain sources, page receipts, the checkpoint and the encrypted
credential. New approval is required for this new operator access; the earlier
approval and retired identity are not reused.

## Preservation and verification

The frozen baseline covers 78 TEST datasets. It preserves all earlier tenants,
provider connections, Vault bindings, canonical jobs/cards, communication sources,
and the existing Drummonds source pages, versions and observations. Only the exact
mutable account/controller rows, new session identity/grant, credential pacing gate
and new import appends are excluded. Retained contact plans are selected through
their original input-request timestamps. New-source append allowances do not exclude
old Drummonds source history.

Twenty-eight focused tests pass across continuation, the retired-session boundary
and application continuation parsing. Cases include changed scope, incorrect
approval, uncertain activation/worker responses, exhausted limits, expired authority,
foreign jobs, exact checkpoint preservation, collection sequencing and cleanup
identity mismatch. The generated continuation and contact definitions pass the
actual application validator. Hosted read-only preflight initially confirmed release 044,
worker/verification v4 with JWT checks, the existing verified credential binding,
two paused flags, no active Commusoft jobs or OpenFolk admin grants, and the retained
incomplete jobs checkpoint. This does not claim a positive hosted continuation run.

## Execution and recovery

Use `scripts/verify/learn-commusoft-continuation-session.mjs` with the explicit TEST
allowlist. The private journal is `.verification-results/commusoft-continuation-session.json`;
never print it or commit it. Do not repeat `prepare`, overwrite this journal, unban
the retired identity, or reset the original import checkpoint.

After approval, run `activate`, `enable`, `resume-jobs`, then bounded `worker-step`
phases. Start each contact collection only after the preceding traversal is complete.
Every mutating phase requires `--approved-run d764008e-8c8f-4837-999a-8d38b5e6e2d5`.
An uncertain input uses `check-input`; an uncertain worker uses `check-worker` and
must retain its handle until a terminal database outcome is confirmed. Unknown
activation requires read-only inspection, never replay. `retire` removes the exact
grant and pauses capture even after access expiry, then checks the identity before
banning it. `status` verifies preservation without reopening access.

[Prepared evidence](evidence/learn-commusoft-continuation-prepared-2026-10-10.json).

## Read-only search release compatibility — 21:45 UTC

TEST release 045 adds retained-record search without changing import functions,
source data or existing review authority. The continuation's exact schema check
now pins `1d4abe822677de6bcc22597cf4b02c66`. Its original 78-dataset baseline still
matches. The prepared run remains unactivated, with zero new provider requests
and access grants; its user, tenant, 60-minute duration and 4,000-request limit are
unchanged. Twenty-eight continuation/boundary tests pass. This update does not
replace the pending user approval or reopen the retired original session.
