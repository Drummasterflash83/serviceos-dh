# LEARN V1 — build and preservation record

## Current direction

Chris confirmed on 9 October: reuse existing credentials; Drummonds is the only
current client, with configuration that permits adapting the service to others.
All existing connections and historical inputs must remain. Continue building.

Cards must include configurable performance scorecards from the foundation:
customer-selected scales (such as 0–50 or 0–100), criteria, targets and weights;
individual and team response, work residence, handoff speed, job completion,
return visits and provider-supported driving measures. The longer-term intention
is reviewed reward/bonus modelling. Scores alone do not change pay.

This extends the 1 October scorecard contract. Missing or disputed evidence is
unassessed, not zero. Preserve quality, safety, job complexity, shared work, leave,
business hours and dependencies when defining measures. No public ranking or
inferred personality/emotion scoring is part of this build.

## Recovered source, without replacing earlier work

The working branch is `codex/learn-v1`, based on recovered commit
`dbb987f1d21334810139eedf79b7784c3bddb9e7`, tree
`455899d2a6d2198c0ed4086052acecbb2af1d2e6` from
`/Users/chrisdrummond/Documents/Ai Assistant/OpenFolk-main-source`.
Its provenance records the combined source inputs. It is a reconstructed snapshot,
not the entire historical Git graph.

The Dropbox handover ZIP was verified against all 1,350 supplied checksums and its
README read first. Its baseline `13b5543` is older than the recovered source.
The earlier `/Users/chrisdrummond/serviceos-dh` checkout retains 605 commits across
its refs and existing uncommitted work. It has not been modified by this build.
The recovered LEARN sync-attempt changes from bridge worktree
`eecfa5f0-9552-4268-8f09-471157abb60c` were carried into this branch rather than lost.

## Verified live inventory

Read-only observation: **2026-10-09 15:53:00 UTC**. Supabase project
`tgbnakbxwcqjeimygroz`, verified tenant `Drummond Heating`, ID
`00000000-0000-0000-0000-000000000001`. Existing verification credentials were reused
in process memory; no credentials or customer payloads were copied into source.

| Stored data | Exact count |
|---|---:|
| Email message rows | 18,404 |
| Phone call rows | 4,319 |
| Recording rows | 2,879 |
| Recordings with storage pointers | 2,879 |
| Recordings without storage pointers | 0 |
| Transcript rows (all statuses) | 2,879 |
| Normalised interactions | 22,731 |
| Customer cards | 3,147 |
| Canonical jobs | 0 |
| Team members | 8 |
| Receptionist voicemails | 0 |

The observation was produced by `scripts/verify/learn-inventory.mjs`. It performs
only GET/HEAD requests, requires an explicit project allowlist and tenant, and
prints aggregates. It starts no sync, processing job, migration or provider call.

These counts confirm substantial stored history, not complete provider coverage.
Transcript rows are not all necessarily completed. A storage pointer does not prove
the audio object exists or plays. Counts alone do not prove preservation of every
individual row. This is an inventory, not a backup or restore test. Provider retention,
storage integrity, backup retention and restore evidence still need checking.

## Implemented locally

### Additional preservation evidence

A fixed-cutoff inventory at **2026-10-09 16:09:53 UTC**, completed at 16:10:20,
recorded 18,407 emails, 4,320 call rows, 2,880 recording rows, 2,880 transcript
rows, 22,738 interactions and 3,148 customer cards. Jobs and receptionist
voicemails remained at zero. There were eight team members, 30 email accounts
and three tenant connector rows. These are observations of stored records,
not a guarantee of provider coverage or connection health.

Of the transcripts, **2,874 were completed and six failed**. All 2,880 recording
pointers matched private storage objects larger than 44 bytes. This is stronger
evidence than pointers alone, but does not establish playable audio: a separate
read of the first 64 bytes found one failed WAV with zero data bytes and two
with only 65 data bytes. The other three failures had much larger payloads;
their legacy error classification does not establish a cause. Three recently
completed examples had readable headers with the same format tag as the failed
examples. No retry, retranscription or provider recovery was started.

A follow-up scan at **16:18:14 UTC**, completed at 16:18:44, compared the individual
IDs and storage metadata with that baseline. No previously recorded IDs were
missing across the 11 tables, no recording pointers changed, and no inventoried
storage objects were missing or had changed size/update metadata. Emails rose to
18,417 and customer cards to 3,149. This comparison does not fingerprint message
contents or prove preservation before the first baseline.

`scripts/verify/learn-preservation.mjs` writes an ignored private manifest of
record IDs and hashed storage pointers/metadata; no message or transcript text
is downloaded. Comparing manifests detects missing old IDs even if new records
make the total rise. A comparison distinguishes preserved, changed and unverified
results. It remains a nontransactional inventory, not a backup or restore test.
`scripts/verify/learn-audio-audit.mjs` reads bounded audio headers and safe failure
metadata without storing audio or logging provider error prose. Header parsing
handles binary bytes, buffer offsets and RIFF chunk padding; unseen data chunks
remain unknown instead of becoming zero.

### Product changes

- Slack history now has an executable additive migration,
  `20261029130000_learn_slack_history.sql`, superseding the older preview proposal.
  It stores original provider message JSON and immutable observed revisions,
  updates the existing interaction projection, and advances the account checkpoint
  in the same transaction. Replays do not duplicate versions or reset processing;
  an older provider edit cannot replace the current message. Existing interaction
  review metadata and canonical links survive source updates. Invalid pages roll
  back in full. This migration has **not** been applied to TEST or production.
- The reader retains author IDs, blocks and other provider message fields in its
  bounded raw payload. Malformed timestamps and oversized records are rejected.
  This remains bounded public-channel history, not thread, attachment, deletion,
  private-channel or complete-workspace ingestion.

Read-only live checks on 9 October returned no Drummonds Slack rows in
`provider_connections`, `tenant_connectors` (filtered to Slack), or
`customer_slack_connections`. No Slack secret was read or created. The actual
worker now has a credential-owning transport implementation (release 010 below), but still requires
deployment and approved channel configuration before it can ingest. A notification token would not alone
establish history permissions. The existing secret broker can support a future
tenant-scoped binding; its existence does not prove a stored Slack credential.
See [Slack ingestion](../operations/LEARN-SLACK-INGESTION.md) for exact prerequisites
and remaining gaps. The runtime now validates stored consent and the bot's real
workspace/channel, reuses the tenant's brokered credential, imports one page per
job, and requests delayed continuation within its approved budget. HTTP rate
limits carry a minimum delay into the queue's existing finite retry policy.

The Slack card also has an owner/admin setup dialog for an existing configured
connection. Its additive setup RPC stores an immutable approval and a queued job
atomically, supports idempotent retries, and refuses to overwrite an active or
unfinished channel window. A completed window's settings/checkpoint are retained
when the next window is approved. This is a bounded manual import flow; app
installation, continuous sync, import-progress controls and historical expansion
remain incomplete. The setup migration is local and **not deployed**.

- Customer, job and team card browsing over the existing canonical tables, with
  tenant filtering, pagination and company-defined team groups.
- Bounded evidence drill-down joining existing interactions, graph links and
  intelligence objects. Typed ownership references prevent matching a company UUID
  to a person merely because identifiers collide. Missing sources remain visible.
- Unified email/phone/Slack evidence rendering when linked records exist. This does
  not implement Slack ingestion or claim that it is working.
- Sync-attempt status from the preserved LEARN work, distinguishing idle, running,
  success, failure and unavailable reads.
- Read-only transcript status counts on the Birchills source card. Completed,
  failed, pending and processing are counted independently through user RLS;
  unavailable counts stay unknown. Older status responses remain compatible
  without inventing transcript counts. No transcript text is exposed by this read.
- A deterministic scoring evaluator with configurable scales, relative weights,
  direction-aware scoring anchors, minimum samples, freshness, coverage and source
  requirements. Missing required measures withhold the total; weights do not silently
  redistribute. Draft simulation is separate from a published-policy assessment.
- Version and period isolation; explicit correction chains; disputed evidence
  withholds scoring. Team rates pool outcome counts instead of averaging people’s
  percentages. Work-residence calculations union overlapping intervals and separate
  elapsed ownership, business time and approved exclusions.
- Scoring-rule settings for all members or a selected company team group, including
  custom criteria. Suggested templates have zero weight until configured.
- An additive draft-saving RPC using existing `config_versions` and
  `operating_profile_entries`. It retains each revision, checks optimistic concurrency,
  validates owner/admin and tenant/group authority and always saves a draft. It does
  not publish policy, create measurements, issue scores or alter pay.

No source data tables were deleted, reset or reimported. No provider setting,
credential, phone routing or connection was changed. No production deployment or
live migration has been performed by this branch.

## Validation

- Application TypeScript check passed.
- Review-harness TypeScript check and build passed.
- Production build passed, including 47 existing prebuild checks.
- 37 focused Node tests passed across card reads, scoring, settings, launch
  validation and the status handler.
- Draft RPC tested in an isolated PostgreSQL 15 container with no network. Checks
  covered append-only revision history, stale-edit rejection, foreign tenant/group
  rejection, viewer/unauthenticated rejection, invalid-rule rollback, no direct
  configuration write grant and no policy activation. The container was removed.
  The fixture uses minimal existing schema contracts; this is not proof of compatibility
  with every deployed migration or RLS behavior in the complete application.
- Browser review used synthetic data with provider traffic blocked. Customer
  findings, evidence links/excerpts and narrow-screen dialogs were checked. Team
  filtering and an office-specific 0–50 scoring draft save/reload were checked.
  No browser console errors were observed during that settings flow.
- `git diff --check` passed.
- Slack storage validation uses `python3 scripts/verify/learn-slack-sql.py`: an
  isolated PostgreSQL 15 container, no network/host mounts, synthetic records, and
  the real existing interactions-table migration. It checks atomic page/checkpoint
  writes, stale checkpoint rejection, replay, immutable revisions, older edits,
  rollback, revocation, claimed-job/expiry/channel guards, tenant RLS and grants.
  The container is removed afterward. Other fixture tables model existing column
  contracts; full deployed-schema and concurrent-worker acceptance remain pending.
  All 26 Slack reader/binding/worker tests passed, including raw-payload retention
  and oversized/malformed-record rejection.
- The following transport increment passed 35 Slack/queue tests, including
  synthetic HTTP transport through the real binding and worker, plus SQL checks
  for revocation between provider response and publication. This does not prove
  live connector operation or deployment.
- Setup increment: four client tests passed, application and preview TypeScript
  checks passed, and the preview and production builds passed (including the 47
  existing prebuild checks). SQL fixture checks passed for
  owner/tenant authority, missing roles, preview sessions, atomic approval/enqueue,
  idempotent retry, incomplete-checkpoint protection and prior-window retention.
  Browser testing used only synthetic data; workspace mismatch was rejected and
  a valid submission showed queued status with no console errors.
- Scorecard authority follow-up: the draft RPC now rejects missing roles and
  active view-as sessions. The client rejects save acknowledgements that change
  an existing policy's identity (initial server-assigned IDs remain supported).
  Fifteen score/settings tests and the application TypeScript check passed.
  `python3 scripts/verify/learn-scorecard-sql.py` repeats the isolated SQL fixture,
  including missing-role and preview-session rejection with no extra history rows.
  These draft migrations are still local and have not been applied to production.
- Preservation/transcript-status increment: 23 focused tests passed, covering
  pagination and foreign/duplicate rows, missing IDs hidden by rising totals,
  changed storage pointers/objects, failed reads, bounded WAV header inspection
  and transcript-status response validation. Application and preview TypeScript
  checks passed. Both builds passed; the preview retains existing bundle warnings.
  The rebuilt synthetic preview displayed all four transcript status counts with
  no browser errors. This browser check makes no live user-RLS claim.

## Subject-scoped performance storage increment

The existing measurement model now has a local additive migration and trusted
adapter append RPC for exact subject/period/policy revisions, evidence, coverage
and correction history. Performance metric definitions cannot be linked to
company objectives, and the objective worker/scanner explicitly read tenant scope.
Adapter writes remain inferred; no real measurements or scores have been created.
Owner/admin RLS and a count-checked reader are implemented. The reader is now
connected to cards with a separate append-only human review ledger. Source
adapters, numerical correction workflows and saved assessment runs remain required.
Prospective publication is now implemented locally as described below.
See [the storage contract and rollout order](../operations/LEARN-PERFORMANCE-MEASUREMENTS.md).

Validation: 17 reader/scorer tests, the full objective-evaluation verification
suite and application TypeScript check passed. Isolated SQL checks use the real
objectives/hardening migrations plus synthetic dependencies. They cover replay,
corrections, evidence/tenant ownership, objective isolation, role reads and retained
legacy behavior. No live database or deployment was changed.

## Performance review and card integration increment

Owners/admins can select a completed period, inspect observations and source
excerpts, and confirm or dispute a current observation with a reason. Reviews
retain actor/revision/history, reject stale or corrected observations, and never
refresh the underlying source timestamp or coverage. Cards show draft simulations
only under draft rules; disputes and insufficient evidence withhold the result.
All implementation and browser review remain local/synthetic.

Twenty-one focused tests and the expanded SQL suite passed. Application/preview
TypeScript checks and both builds passed, including 47 existing prebuild checks.
Browser checks covered unconfirmed →
confirmed 80/100 draft → disputed/unassessed, with both reviews retained and the
same source timestamp. No real measurement, review or pay change was made.

## Voicemail discovery and renewed preservation check

A read-only comparison at **18:11:35 UTC** on 9 October (completed 18:11:59)
found 18,441 emails, 4,324 calls, 2,882 recordings/transcripts and 22,777
interactions. All IDs from the 16:09 baseline remained present across the eleven
inventoried tables; recording pointers and previously inventoried storage-object
size/update metadata were unchanged. All 2,882 recording pointers matched storage
objects larger than 44 bytes. Transcripts: 2,876 completed and six failed.
Voicemail and canonical job rows remained zero. This checks preservation since
the baseline, not complete provider coverage, playable audio or backup recovery.

A bounded read-only Sipcentric voicemail discovery helper and CLI now inspect the
documented endpoint catalogue and optionally the structure of explicitly linked
voicemail resources. They never infer message coverage from a successful endpoint
list. Ten synthetic transport tests and strict/application TypeScript checks pass.
Existing local verification credentials were reused for the preservation check;
provider credentials were not present in the checked local environment files, so
no live voicemail discovery ran. No voicemail ingestion or deployment is claimed.
See [the source contract, diagnostic and remaining capture work](../operations/LEARN-VOICEMAIL-DISCOVERY.md).

## Forward membership evidence for work attribution

An additive local migration now retains member identity/team/confirmation/effective
state through changes, including recovered roster leave/rejoin operations. It starts
coverage at actual observation time and has no automatic historical baseline. A
bounded owner/admin reader reconciles the immutable chain with current state; a
TypeScript resolver splits work ownership intervals at historical membership
boundaries and keeps unknown or ambiguous identities unresolved. No new measurement
or score is created, and the module still needs wiring into card/source-adapter flows.
See [membership evidence and its limits](../operations/LEARN-MEMBERSHIP-HISTORY.md).

## First connected work-source observation

The card can now collect recorded outgoing ownership handoffs from captured work
and as-observed membership history, retaining an immutable calculation receipt and
saving an inferred measurement through the existing append path. Same-person
user/member aliases do not create handoffs; missing history withholds the value.
Retries retain identity and concurrent collection cannot create two same-cell
observations. Existing human review and draft scoring consume the result. This is
local/synthetic verification, not a deployed source or a real employee rating.
See [calculation scope, tests and remaining work](../operations/LEARN-WORK-HANDOFF-MEASUREMENTS.md).

## Retained scorecard publication

Owners/admins can now publish an unchanged saved revision with a reason and review
attestation. Publications retain exact definitions and server-assigned effective
dates; saving a later draft leaves published rules in force. The dated reader rejects
periods spanning a rule change and cannot apply newly published criteria to earlier
periods. Cards offer separate draft simulation and published-rule review modes.
Missing, inferred or disputed evidence still withholds scores. No pay changes occur.

The offline database clone passed revision retention, exact retry, stale draft,
period boundary, tenant/role/View-As authority and source-preservation checks. Pure
publication/scoring tests, TypeScript, production and preview builds passed. Browser
checks covered dirty-draft publication blocking, publication receipt, rejection of
retrospective application and an eligible historical publication without evidence.
This remains local and undeployed. See [publication details and limits](../operations/LEARN-SCORECARD-PUBLICATION.md).

## Connected elapsed ownership observation

Cards now collect `work.owned_item_minutes` from captured work intervals and
as-observed membership, with an immutable segment-level receipt and inferred
measurement. Concurrent items add separately; all states are included. This is
elapsed ownership load, not working hours or productivity. Missing history or
unresolved membership withholds the aggregate. Settings suggest zero weight.
Database checks include exact clipping, membership endings without work changes,
known zero, failed-append rollback and two-session duplicate prevention. Browser
review verified the inferred observation and full receipt display. Nothing is
live or deployed. See [meaning and remaining requirements](../operations/LEARN-WORK-RESIDENCE-MEASUREMENTS.md).

## Next work and release gates

The existing TEST target is verified through reused Supabase/Vercel logins.
At 19:32 UTC on 9 October the restricted launch metadata views were installed with
an atomic checksum receipt, after a matching hosted rollback rehearsal. Existing
source-table definitions/grants/policies and the original bootstrap ledger entry
were preserved. At 19:33, `learn-launch-status` deployed to TEST with gateway JWT
verification and metadata-view mode. Real signed-in synthetic acceptance passed
at 19:38; owner/admin access, tenant isolation, redaction, denial and revocation
were verified through Auth/PostgREST/Edge. All synthetic users and fixture records
were removed and absence verified. Production remains untouched. See
[verified inventory, evidence and dependency work](../operations/LEARN-TEST-READINESS.md).

At the foundation milestone, TEST had 59 RLS-enabled public base tables. The 33-table card/work foundation,
recovered from nine retained migration sources, installed at 20:06 UTC. Its actual
schema matched the isolated expected schema, with existing source definitions and
launch privileges preserved. Real JWT acceptance caught denied tenant-helper
execution; a narrow, rehearsed follow-up grant fixed the two helpers without
changing their bodies or source table access. The isolated projection now models
those original denied permissions correctly.

At 20:12 UTC, five synthetic signed-in users across two companies passed linked
customer/staff/job/work reads, company isolation (including OpenFolk), denied
client writes and cross-company service references, a valid service update, and
the existing launch redaction/revocation checks. Every marked fixture was removed
and its absence verified. Thirty-seven focused tests and the isolated SQL exercise
pass. See [foundation release and acceptance](../operations/LEARN-TEST-FOUNDATIONS.md).

Raw interaction reads and one of ten inspected LEARN RPC dependencies remain
unavailable. The scorecard draft reader/save, publication/period reader and membership
reader are installed in TEST, now joined by performance review in release 006.
Release 007 adds work-history and collection; release 009 below adds Slack setup/storage.
Allkin's last verified Vercel inventory has only the production project,
so TEST frontend deployment is still outstanding. No real customer data, production
state, provider traffic or stored audio was changed by these TEST releases.

Release 004 installed rules/publication and forward membership capture at 20:27 UTC.
A read-only recheck resolved an expected-schema qualification mismatch without another
install. Real JWT stale-editor testing then found manual SQLSTATE 40001 caused request
timeouts. Follow-up 005 changes only the two scorecard writers' business conflicts to
HTTP 409; isolated SQL and hosted rollback rehearsal passed, and installation at
20:37 UTC preserved all other catalog definitions/privileges. Signed-in acceptance
passed at 20:38 UTC for 50/100-point settings, publication boundaries/idempotency,
tenant/role/preview restrictions and immutable forward membership evidence. Synthetic
logins were removed; marked test companies and their evidence remain intentionally.
Other unreleased business-conflict RPCs must receive equivalent handling before release.
See [rules release and acceptance](../operations/LEARN-TEST-RULES.md). Full LEARN V1
remains incomplete; no actual employee score or reward was established.

At 20:49 UTC, TEST release 006 added sixteen objective/measurement/review tables
and nine functions. Earlier tables/helpers/privileges and all source communications
were preserved; TEST has 78 public tables and seven receipts. Measurements and
reviews retain originals/corrections, reject truncation and return HTTP 409 for
business conflicts. Service writers cannot bypass the validated staff-fact adapter.
Team periods now require retained observed membership; later transfers preserve
valid earlier periods, and effective dates alone cannot fabricate coverage.
Signed-in acceptance passed at 20:50 UTC through the actual card reader, including
correction chains, separate human review, concurrency, tenant/role/preview denial
and retained source timestamps. Marked synthetic records and author identities
remain; test Auth logins were banned and roles revoked. Thirty-one focused tests,
isolated SQL including concurrent reviewers, both TypeScript checks and the preview
build passed. See [measurement release evidence](../operations/LEARN-TEST-MEASUREMENTS.md).

At 21:01 UTC, TEST release 007 installed forward work capture and handoff/residence
collectors, bringing the environment to 79 tables and eight receipts. Existing
legacy history stays intact and unbaselined. New source changes retain immutable
snapshots; calculations retain evidence and cannot be duplicated by concurrent
requests. The performance writer gains only the receipt evidence type, preserving
its newer group-history and conflict behavior. Signed-in acceptance passed through
the real timeline/card readers for alias-safe handoffs, independent elapsed-time
sums, review, incomplete identity, tenant/role/View-As checks and retained source/proof
records. Twenty-five focused tests, isolated SQL/concurrency, main/preview type checks
and preview build passed. Synthetic evidence/actor identities remain, with Auth users
banned and roles revoked. Governed actions were not yet released at that milestone;
release 008 below supersedes that limitation.
See [capture release evidence](../operations/LEARN-TEST-WORK-CAPTURE.md).

Work-transition now resolves confirmed, effective cover and self/team/company
permissions against the actual item, and rechecks authority in the save transaction.
Confirmed viewer-role staff can act within the same item scope. Synthetic database
checks cover revoke-before-save, team target boundaries, cover weekdays/timezone and
retained owner attribution. Release 008 installed these capabilities in TEST and
passed actual staff-session checks. Full action browser flows and collection
visibility beyond owner/admin remain required. See
[work authority](../operations/LEARN-WORK-AUTHORITY.md).

The earlier Directory → Roster workflow is recovered locally: people/lifecycle,
shared responsibilities, weekday cover and scoped authority, including operator
routes and audited RPCs. Added review controls, complete-read checks, tenant/team
validation, safe rejoin dates and serialized responsibility replacement. Synthetic
database and Edge tests pass. Historical membership coverage and team/cover collection
visibility still need connecting; mutation authority is implemented locally as described above.
See [roster recovery and release limits](../operations/LEARN-ROSTER-RECOVERY.md).

Work transitions now preserve actual before/after ownership and status snapshots
in the existing history ledger, using one locked transaction and the revision the
user's card displayed. A further local migration captures background writes too,
with a coherent, bounded owner/admin reader. Cards now show elapsed ownership
intervals, handoffs, source IDs and explicit missing time. Synthetic failure,
concurrency, gap and limit checks pass; an actual SQL response is accepted by the
TypeScript reader. Old snapshots remain unknown and no live baseline has run.
Team/cover collection visibility and a scoring adapter with historical membership,
eligible population, calendars and exclusions remain required. See
[work history and release order](../operations/LEARN-WORK-HISTORY.md).

The governed Commusoft customer/site/job importer and later multi-phone/exact-site
fixes have now been recovered from the older local build. Pure tests, mocked Edge
rejection tests and historical plus supplemental SQL assertions pass. Explicit
ledger/helper privileges and protection against damaged previews falling back to
legacy import were added. This is local recovery, not a live connection or import.
See [provenance, verification limits and remaining historical modules](../operations/LEARN-COMMUSOFT-RECOVERY.md).

1. Keep comparing the private source/storage baseline; investigate failed audio,
   verify backup retention and restore, and reconcile against Birchills/Sipcentric
   provider inventory before attempting bounded recovery. Do not assume upstream
   recordings remain available indefinitely.
2. Verify deployed TEST and production schemas/migration history before each next
   additive release. The draft RPC is installed in TEST; production stays separate.
   Do not blindly apply all pending migrations or touch the separate Emma launch.
3. Trace real authorised email/phone examples end to end into customer/team evidence
   using ordinary user permissions; service-role inventory does not test user RLS.
4. Complete Slack ingestion and voicemail capture with source reconciliation and
   idempotent replay. Existing notification/directory integrations are not ingestion.
5. Connect Commusoft jobs/visits/assignments and confirm the actual vehicle-data
   provider and field definitions. The canonical jobs and voicemail tables were empty
   at the recorded observation; no performance figures should be inferred from that.
6. Wire verified source adapters into the new subject/period-scoped append RPC
   and verify the now-connected measurement/review card flow with real user RLS. Database scope isolation and the
   updated objective worker are implemented locally; deployment and real source
   acceptance remain pending. The pure scoring contract is already implemented.
7. Extend the review ledger with numerical correction workflows and retained
   assessment runs under the now-versioned publication contract. Complete
   membership as of the scoring period, approved business calendars,
   exclusions and job-mix treatment. Agree criteria before rating actual people.
8. Add manager-reviewed reward simulations against agreed rules after the evidence
   and scorecard stages pass acceptance. No automatic payroll change is implemented.

The overall LEARN V1 goal remains active and incomplete.

## Governed actions and actual browser milestone — 21:23–21:51 UTC

Release 008 installed governed action authority, validation and serialized authority
changes in TEST, bringing the catalog to 80 public tables and nine receipts. The
JWT-protected work-transition endpoint deployed at 21:24. Actual signed-in checks
passed for self/team/company scope, assignment, temporary cover, revocation,
preview denial and concurrent revisions. Canonical history/card reads counted a
handoff once. Synthetic evidence remains, with memberships/grants/cover ended and
logins banned. See [action release evidence](../operations/LEARN-TEST-ACTIONS.md).

The actual application then passed browser sign-in, 50-point rule save/reload,
same-day UTC evidence collection, source-proof reading, confirmation (5/50 draft),
dispute (score withheld), retained review history and revoked-session checks.
Browser testing fixed date-only assessment inputs and a roughly 70ms server-clock
lead that had made valid source status appear unavailable. No expiry extension or
provider operation was introduced. Main/preview builds and type checks passed.
See [actual browser acceptance and remaining scope](../operations/LEARN-TEST-BROWSER.md).

## Slack storage/setup milestone — 22:05–22:08 UTC

Release 009 passed hosted rollback rehearsal, installed with exact catalog and
source preservation, and passed actual signed-in synthetic acceptance. TEST now
has 87 public tables and ten receipts. Owner approval, idempotent retry, HTTP 409,
service-only atomic source/version/interaction publication, stale-cursor denial
and tenant isolation are verified. Evidence remains, with synthetic jobs cancelled,
connections disabled and logins/approval access revoked. This does not connect a
Slack workspace: broker/worker deployment, real credentials/permission, threads,
continuous ingestion and large historical imports remain. See
[Slack release evidence and limits](../operations/LEARN-TEST-SLACK.md).


## Slack durable execution and credential binding — locally verified

Added a Slack-only worker on the existing queue, unexpired claim checks before
credential use and source publication, durable per-page receipts, atomic delayed
continuation and retained finite retries/dead letters. Controlled database races
prove a replaced worker cannot complete and concurrent claimers skip locked jobs.
An injected continuation failure rolls job completion back without losing the page.
The existing generic claim function reserves Slack while preserving other types.

The new credential resolver reuses an existing Vault secret only when its reference,
tenant-qualified name, connection revision, approval and owned job agree. Actual
Vault encryption tests use synthetic values in a disposable offline PostgreSQL
instance. An infrastructure-only Edge entrypoint is prepared; no schedule or live
provider connection was created. TEST remains at release 009, 87 tables and ten
receipts. Release packaging, hosted rehearsal, deployment and signed-in/Edge
acceptance remain pending. See [worker behavior and verification limits](../operations/LEARN-SLACK-INGESTION.md).


## Slack durable worker released to TEST — 22:28–22:39 UTC

Release 010 passed isolated failure/rollback and hosted rollback rehearsal, then
installed the exact worker/credential functions with prior source catalogs,
table privileges and email completion unchanged. TEST remains at 87 public tables
and now has eleven receipts. The restricted worker endpoint is active at runtime
version 3. Actual owner/viewer/foreign-tenant sessions and service requests verified
browser denial, missing-credential refusal, lease conflicts, exact page replay,
crash-after-publication recovery and one atomic delayed successor.

Hosted acceptance exposed a mismatch between the gateway bearer and runtime service
credential. The trigger is now explicitly configured using the existing TEST service
credential in a dedicated header; no Slack credential was created. This configuration
refreshed all TEST runtime versions by one with identical existing source hashes.
The catalog guard verifies that exact refresh. The replacement deployment returned
an uncertain CLI result; eleven downloaded runtime sources matched exactly and
actual HTTP acceptance passed, resolving it without blind redeployment.

All synthetic source evidence and terminal job outcomes remain. The delayed job is
cancelled, connections disabled, and fixture logins/approval authority revoked.
Production communications were untouched. No live Slack page or schedule was run.
Live permission/source acceptance, threads, continuous/multi-window history,
workspace pacing and recovery controls remain. See
[the release evidence and current ingestion limits](../operations/LEARN-SLACK-INGESTION.md).

## Retained Slack thread capture — local implementation

Added an observed-thread approval, independent thread checkpoint and replies
transport to the scoped Slack worker. It shares the existing retained source and
version writer, reuses the existing Vault binding, and preserves channel progress.
Synthetic checks cover wrong-parent rejection, company/source/connection identity,
crash-after-page recovery, stale-worker refusal, atomic delayed continuation,
provider retry delays and qualified window completion. The 63 focused Node tests
pass; SQL verification runs both draft migrations in disposable offline PostgreSQL.

This has not been deployed. TEST remains release 010/runtime v3. The existing
release-010 deploy path refuses the newer source until it has a matching schema
release. Thread release packaging, hosted acceptance, operator discovery/import
controls, live permission checks, continuous coverage and workspace pacing remain.
No existing live inputs or credentials were replaced. See
[thread behavior and remaining ingestion work](../operations/LEARN-SLACK-INGESTION.md#observed-thread-windows--implementation-and-initial-local-verification).

## Slack thread release verified in TEST — 10 October

Release 011 is installed with 88 public tables and twelve receipts. Hosted rollback
rehearsal and installation preserved existing source catalogs and table privileges.
The thread-capable worker is active at runtime v4 with unchanged JWT verification
and existing secrets. All twelve downloaded runtime sources match the reviewed
bundle; unrelated endpoints remain unchanged.

Real TEST owner/viewer/foreign-company sessions and Edge requests passed history
and thread acceptance, including retained reply publication, replay, independent
checkpoints, expired-worker denial and recovery with one delayed continuation.
Synthetic evidence remains; fixture logins and approval roles are revoked,
connections disabled and all active fixture jobs stopped. The focused suite passes
72 tests. No live Slack request, production change or schedule was made.

Next ingestion work remains operator thread discovery/import controls, actual
Slack access, continuous/multi-window backfill, workspace pacing and recovery UI.
This completes the thread release milestone, not full Slack ingestion or LEARN V1.
See [current TEST verification](../operations/LEARN-SLACK-INGESTION.md#current-test-state--thread-release-011-10-october).

## Slack thread operator controls — local, 10 October

Added retained-channel browsing, observed-thread paging, latest import progress,
and multi-thread approval through the existing thread approval contract. Same-ID
retries preserve partially confirmed batches while the review remains open. Channel
history and thread replies have separate views. Disabled connections keep evidence
visible, and unavailable reads do not appear as empty or complete coverage.

The two draft read RPCs passed isolated company/queue-permission/pagination and
preservation checks. Eleven client tests, application/preview typechecks, the preview
build and synthetic browser scenarios passed. No hosted schema, real source import,
provider request or production change occurred. TEST remains release 011/runtime
v4; reader release and actual signed-in UI acceptance are next.

## Slack operator readers released and browser-checked — 10 October

Release 012 now provides the company-scoped channel/thread readers in hosted TEST.
Its exact rollback rehearsal, installation and schema readback passed: 88 tables,
thirteen receipts, existing definitions/privileges and worker runtime v4 preserved.
The isolated database release checks and eighteen focused Node tests passed.

Real TEST owner/viewer/foreign sessions verified the retained thread/checkpoint,
latest queue state, company isolation, raw queue denial and disabled-channel reads.
The actual locally served app against TEST displayed retained evidence and cancelled
progress with approval controls disabled for a temporary viewer. Empty observed
coverage stayed distinct from a failure or a claim of full channel coverage.
The temporary browser login was retired, and all acceptance evidence remains with
no active fixture jobs/connections. No real Slack fetch or production change occurred.

Actual owner browser submission remains unverified; owner approval/replay passed
hosted RPC checks and multi-thread/uncertain-response UI behaviour passed the earlier
synthetic preview. Live Slack access, continuous capture, pacing/recovery and the
rest of LEARN V1 are still outstanding. See the
[release 012 evidence and limits](../operations/LEARN-SLACK-INGESTION.md#current-test-state--operator-reader-release-012-10-october).

## Slack workspace pacing — local, 10 October

Implemented shared admission and recorded rate-limit cooldown across channels,
threads and connections referring to the same Slack workspace. Waiting jobs retain
retry attempts; other workspaces can proceed. Crash recovery for an already
published page bypasses provider pacing, while expired unpublished work waits for
the reservation to clear. Settlement and gate release are atomic and idempotent.

The isolated SQL release chain passed rollback, permission/preservation checks,
shared cooldown, saved-page recovery and controlled concurrent admission tests.
No hosted release or provider operation occurred; TEST remains release 012/runtime
v4. Exact release packaging and hosted concurrency acceptance remain before this
can support ongoing ingestion. See
[implementation and verification limits](../operations/LEARN-SLACK-INGESTION.md#shared-workspace-pacing--local-implementation-10-october).

## Shared Slack pacing released and verified in TEST — 10 October

Release 013 is installed: 89 public tables, fourteen receipts, existing source
catalogs and endpoint hashes preserved, Slack worker still runtime v4. Its exact
bundle passed isolated rollback/concurrency checks and refuses installation while
Slack work is active. Fourteen focused release/worker tests and hosted rehearsal,
installation and schema readback passed.

Actual concurrent RPCs kept jobs sharing a workspace serialized while another
workspace progressed, without consuming waiting jobs' attempts. Retained root
publication and owner thread approval passed; thread cooldown delayed channels
across companies. The existing worker respected the gate and safely refused a
missing credential. Exact replay and stale-claim HTTP 409 checks passed.
Synthetic records remain; all fixture logins/approval roles were revoked and
active jobs, connections and reservations are zero. Timing advancement was limited
to synthetic fixtures; no live provider acceptance is claimed.

No production change, real provider fetch, credential change or schedule was made.
Continuous/multi-window ingestion, provider access and recovery controls remain
before complete Slack capture, alongside the other LEARN V1 requirements. See
[release 013 evidence and limitations](../operations/LEARN-SLACK-INGESTION.md#current-test-state--workspace-pacing-release-013-10-october).

## Reviewed Slack channel recovery — local, 10 October

Added a company-scoped progress reader and owner/admin recovery for an incomplete
channel window. Continue retains its saved cursor; restart replays the same bounded
window. Both retain the old approval/checkpoint, renew the reviewed page budget and
leave source/version deduplication intact. The reader labels current-approval page
counts explicitly and excludes private cursors and credential references.

The isolated SQL chain passed rollback, permissions, continuation/restart, exact
retry, source preservation and controlled races: authority revocation is respected,
connection changes invalidate review and competing approvals queue once. Twelve
client tests and the focused strict typecheck passed. The client adapter retains
caller-supplied request IDs for uncertain retries; no recovery UI or durable browser
outbox is present yet.

TEST remains release 013/runtime v4. Hosted release packaging/acceptance and recovery
UI are next; no real provider fetch, production change or schedule occurred. See
[local recovery evidence and limits](../operations/LEARN-SLACK-INGESTION.md#reviewed-channel-recovery--local-implementation-10-october).

## Slack channel recovery released and verified in TEST — 10 October

Release 014 adds the reviewed recovery and safe progress contracts: 89 public
tables, fifteen receipts, existing table/function definitions and privileges
preserved, worker still runtime v4. Exact isolated and hosted rollback checks,
installation/readback and thirteen focused client/release tests passed.

Real signed-in TEST users verified safe viewer reads and denied approval, company
isolation, renewed consent, preserved cursors/checkpoints, continuation deduplication,
reviewed restart and one queued job from competing reviews. The existing worker
handled a recovery job and refused a nonexistent credential before contacting Slack.
Completed recovery was refused without creating an approval. An initial test's HTTP
status assumption was corrected after inspection; a fresh full run passed.

All prior TEST communications retained their counts and row fingerprints. Both
synthetic fixture runs retain their evidence with logins/approval roles revoked and
zero active jobs, connections or reservations. No production data, real provider
fetch, credential or schedule changed. Recovery UI, durable pending approvals,
thread recovery and continuous/multi-window capture remain, alongside the broader
LEARN V1 scope. See
[release 014 evidence and limits](../operations/LEARN-SLACK-INGESTION.md#current-test-state--channel-recovery-release-014-10-october).

## Channel recovery screen and durable local review — 10 October

Added retained-channel progress and owner/admin continue/restart controls. The
review shows its exact bounded window, current-approval page budget and preservation
behavior. Recovery saves its request before sending and restores it after reopening
or reload; refresh keeps it, exact retry resolves it, and browser locks prevent
another tab replacing unresolved work. Missing storage/lock support blocks submission.

Twenty-four focused tests, both application/preview typechecks and the preview build
passed. Synthetic browser checks verified lost-response recovery across reload,
restart, rejected-review reset, viewer restrictions, completed windows and failed
reads. No hosted schema, production data, provider or credential changed. TEST remains
release 014. Actual signed-in TEST browser acceptance and frontend deployment remain;
the durable review is browser-local and currently covers channel recovery only.
See [screen evidence and remaining limits](../operations/LEARN-SLACK-INGESTION.md#channel-recovery-screen-and-saved-approvals--local-10-october).


## Channel recovery accepted through the actual TEST browser — 10 October

Normal sign-in and the actual application successfully approved continuation and
restart against release 014. Stored records matched both reviewed budgets, reasons,
actor and original windows; predecessor checkpoints and source records remained.
Reloading retained queued progress without creating another approval. The fixture
was retired with its evidence intact, zero active jobs/connections/approvers, and
successful browser sign-out. The test tab and owned local server were closed.

This resolves the signed-in browser gap above. No production change, real provider
capture or frontend deployment occurred. Durable requests remain browser-local and
limited to channel recovery. See [acceptance and limitations](../operations/LEARN-SLACK-INGESTION.md#channel-recovery-screen--signed-in-test-acceptance-10-october).


## Initial Slack approvals now survive reload — local, 10 October

Channel approvals and partial thread batches now retain exact pending requests
across reload/reopening. Refreshing thread progress no longer discards them.
Receipts are saved before the next batch item; retry skips confirmed items, and
clearing an explicit rejection preserves other pending work and existing evidence.
Storage is scoped by backend, actor, company and import type; authority/lifetime
checks and browser locks protect submission.

Thirty-three focused tests, application/preview typechecks and preview build passed.
Synthetic browser acceptance verified lost-response reload/retry, partial batches,
per-item rejection and viewer restrictions. No hosted state or production source
changed. Signed-in hosted acceptance of these forms remains; browser-local storage
does not provide cross-device recovery. See [evidence and remaining scope](../operations/LEARN-SLACK-INGESTION.md#durable-initial-channel-and-thread-approvals--local-10-october).

## Phone preservation and company account binding — local, 10 October

A renewed production read-only comparison found every baseline ID and recording
pointer retained, with no missing/changed inventoried storage objects. Current
counts: 18,456 emails, 4,324 calls and 2,882 recording/transcript rows. Six transcripts
remain failed; jobs and voicemail rows are still zero. This proves preservation
within the inventory's scope, not complete capture, playable audio or backup recovery.

Phone sync, connection tests and downloads now use registered company accounts
instead of accepting arbitrary accounts or discovering the first shared provider
customer. Existing stored audio can return without live provider credentials.
The actual read-only resolver matched Drummonds' active registry; 25 sampled URL
shapes passed the new guard. Twenty local tests and strict handler typechecking
passed. No provider request, hosted deployment or production mutation occurred.
Read-time binding still needs concurrent-publication fencing and hosted acceptance.
See [implementation, preservation evidence and release limits](../operations/LEARN-PHONE-ACCOUNT-BINDING.md).


## Company-bound phone handlers accepted in TEST — 10 October

The four phone endpoints are deployed as runtime v1 with JWT verification. Signed-in
acceptance verified company/account isolation, owner/admin/ops handling, disabled
connector behavior, retained recording references and immediate role revocation.
All pre-existing TEST communications kept their counts and full-row fingerprints.
Both synthetic fixture runs retain their evidence with six logins banned/passwords
rotated, viewer-only profiles and zero active connectors/accounts or running syncs.

Acceptance exposed missing server permissions in TEST. Release 015 grants only
SELECT/INSERT/UPDATE on three phone tables to the server role after a successful
rollback rehearsal; no ordinary-user, DELETE or TRUNCATE grants were added. TEST
now has 89 public tables and sixteen receipts. Exact endpoint metadata, permission
matrix and all earlier catalog definitions are checked. The initial failed checks
and subsequent inspection/repair remain documented rather than overwritten.

No real provider credentials, production mutations, audio uploads, paid processing
or schedules were involved. The cached reference test is not playable-audio proof.
Live capture, voicemail, source reconciliation, concurrent publication fencing and
production deployment remain. See [TEST evidence and limits](../operations/LEARN-PHONE-ACCOUNT-BINDING.md#test-deployment-and-signed-in-acceptance--10-october).


## Restricted card communication reader — local, 10 October

Customer/job/member timelines now request bounded communication excerpts through
an owner/admin RPC instead of querying TEST's closed raw interaction table. A
restricted role and RLS bind the read to the actual company; the client validates
returned identities, links, fields and bounds. Raw metadata and processing fields
are excluded, long excerpts are visibly shortened, and access failures remain gaps.
No source record or provider connection changes, and no performance figure is made.

Twelve client/card tests, both TypeScript checks and the preview build passed.
Disposable PostgreSQL checks verified real role/RLS behavior, migration rollback,
same-session revocation, tenant isolation, raw-table denial and unchanged source
fingerprints. The actual SQL response passed the application reader. This is local
only: TEST remains release 015. A pinned TEST release, hosted rollback and signed-in
card acceptance are next; real-source and production acceptance remain. See
[reader contract and release gates](../operations/LEARN-CARD-COMMUNICATIONS.md).


## Card communication excerpts accepted in TEST — 10 October

Releases 016/017 install the restricted reader with 89 tables and eighteen receipts.
The hosted deployer could not grant `auth` schema usage; inspection preserved the
acknowledged initial release, and a rehearsed function-only correction now resolves
the caller profile through its existing RLS policy. Auth-schema access stays closed.
Exact prior definitions, endpoints and ordinary-client column grants remain pinned.

Fresh actual Auth/PostgREST acceptance used the application customer/job/member
readers in two synthetic companies. Email, phone and Slack excerpts linked to the
right work/card records; raw table, wrong-company and unauthorised role access were
denied. Same-session demotion produced a visible card gap. Existing TEST sources
kept their counts and full-row fingerprints. All six fixture logins were retired;
evidence remains, with zero active members. Five release/context and twelve card
reader tests passed, alongside isolated migration/rollback/context checks.

This resolves the hosted reader gap above. Source links were seeded, so provider
capture/projection, real-source user acceptance, actual browser rendering and
production deployment remain. No score or pay action was created. See
[release evidence and limitations](../operations/LEARN-CARD-COMMUNICATIONS.md#test-release-and-actual-signed-in-acceptance--10-october).

## Numerical card corrections — local, 10 October

Owners/admins can correct or withhold a current measurement with a recorded reason.
The original value, evidence, counts and reviews remain intact; the replacement
needs separate confirmation. Original source timing survives repeated corrections,
so editing a number cannot refresh stale evidence. No payroll action is introduced.

The isolated database suite passed atomic failure, concurrent correction, authority,
retry, review revision and preservation checks. Thirty-eight client/scoring tests,
both TypeScript checks and the preview build passed. The actual browser component
retained 80 → 90 → withheld synthetic history and required independent review before
a draft score appeared. This is local implementation only; TEST stays release 017.
Pinned hosted rehearsal, actual Auth/PostgREST acceptance and production release are
still required. See [contract, evidence and limits](../operations/LEARN-PERFORMANCE-MEASUREMENTS.md#numerical-corrections--local-implementation-10-october).

## Numerical corrections accepted in TEST — 10 October

Release 018 installs the correction ledger and RPC, bringing TEST to 90 tables and
19 receipts. Local PostgreSQL 17 checks and the hosted rollback proved atomic DDL
and preserved prior objects; installation matched the pinned catalog and endpoints.
Actual signed-in application clients verified numerical correction, separate review,
retry/conflicts, competing requests, withholding, original timing, tenant/role
isolation and past observed-team attribution after a later transfer.

An initial test caller omitted the scorer's team context; the scorer rejected it.
That stopped run remains documented and retired. The corrected harness passed with
a fresh fixture. All eight synthetic users across both runs were banned and demoted,
and memberships ended; six measurements, three reviews and four corrections remain
as evidence. Source and earlier performance rows were preserved. Production and
frontend deployment are unchanged. This is synthetic TEST acceptance, not a real
employee score or proof of complete provider capture. See
[release evidence and limitations](../operations/LEARN-PERFORMANCE-MEASUREMENTS.md#numerical-corrections-accepted-in-test--10-october).

## Original-source evidence panels — local, 10 October

Performance interaction evidence now uses the existing restricted communication
RPC. A new bounded reader provides original email excerpts and call/recording
metadata under actual owner/admin company scope, resolving the design mismatch
between performance drill-down and TEST's closed raw tables. Raw bodies, provider
payloads, phone numbers and recording storage pointers stay outside the reader.
No source rows, ingestion state, measurements or connections are changed.

Eleven focused tests, isolated PostgreSQL 17 authority/rollback/preservation checks,
SQL responses through the actual client, both typechecks/builds and 47 prebuild
checks passed. The actual card component rendered all four synthetic evidence kinds
with readable labels, UTC dates and explicit units. This is local-only; TEST stays
release 018. Pinned hosted rehearsal and real signed-in acceptance are next. See
[reader contract, evidence and release limits](../operations/LEARN-CARD-SOURCES.md).


## Original-source readers accepted in TEST — 10 October

Release 019 is installed and verified: 90 public tables, 20 receipts. Its bounded
email/call/recording reader passed isolated atomic rollback, exact hosted rehearsal,
installation and actual signed-in application acceptance for two synthetic companies.
Raw source grants stayed closed; tenant/role boundaries, Unicode clipping, zero
call duration and immediate role revocation passed. Nine release-runner tests passed.

All pre-existing source and performance records retained their counts/fingerprints
across rehearsal, installation and acceptance. Synthetic evidence remains; all three
fixture users were banned, rotated and demoted, with memberships ended and final
zero-active readback. Production and frontend deployment are unchanged. Recording
metadata is not playable audio; real provider capture, Slack/voicemail completion,
retained assessments and real-source acceptance remain open. See
[release evidence and limits](../operations/LEARN-CARD-SOURCES.md#accepted-in-test--10-october-2026).


## Saved assessment history — local, 10 October

Published-rule cards now have a local save/reopen flow backed by a proposed immutable
assessment ledger. The server captures canonical rules, measurements, reviews and
corrections; the browser cannot submit arbitrary scores. Stored inputs use a named
V1 engine and retained calculation time, so later evidence changes do not rewrite
history. Drafts cannot be saved; incomplete assessments remain unassessed. Exact
request retries and concurrent retries produce one record.

Thirty-five client/regression tests, isolated SQL authority/immutability/concurrency
checks, actual SQL snapshots through the application reader, both typechecks/builds
and 47 prebuild tests passed. Browser checks recovered lost responses and reopened
an earlier unassessed record after a later confirmed 80/100 save. No live input,
provider, production or TEST state changed. TEST stays release 019. Hosted rehearsal
and actual signed-in acceptance remain next; durable pending saves and pagination
beyond the latest 20 records remain open. See
[saved assessment contract and evidence](../operations/LEARN-PERFORMANCE-MEASUREMENTS.md#saved-assessments--local-implementation-10-october).


## Saved assessments accepted in TEST — 10 October

Release 020 is installed: 91 public tables and 21 receipts. Exact PostgreSQL 17
release rollback, hosted rollback/install and 11 release-runner tests passed.
Actual signed-in application clients retained empty/unreviewed, confirmed and
corrected outcomes under prospective published rules. Earlier 25/50 assessments
stayed identical after a corrected 33.33/50 assessment, later team transfer and later
100-point rules publication. Concurrent retry created one record, and authority,
stale-input, immutability and company-isolation checks passed.

Five synthetic assessments remain as evidence. All four users were banned, rotated
and demoted; memberships/previews ended. Existing source/performance rows retained
identical fingerprints. Production and frontend deployment are unchanged. See
[full evidence and limits](../operations/LEARN-PERFORMANCE-MEASUREMENTS.md#saved-assessments-accepted-in-test--10-october).

## Voicemail email discovery and unavailable source reads — 10 October

A bounded read-only diagnostic now searches existing imported email subjects for
possible voicemail notifications and checks candidate attachment metadata. It
preserves private source references separately, reports only safe indicators, and
never promotes hints or pointers to verified voicemail/playable audio. Twelve
focused diagnostic/preservation checks pass. No hosted deployment or data change
was made; TEST remains release 020.

The live audit could not establish candidate counts. Email count probes returned
HTTP 500/SQLSTATE 57014; a management aggregate also failed with HTTP 544. A later
read-only activity check found no active blockers. Fresh preservation reads for the
larger sources and recording storage are unverified, not missing; small registries
and the existing zero voicemail/job counts were verified. The earlier successful
18,456 email / 4,324 call / 2,882 recording comparison remains the latest complete
source inventory. Source-read availability needs investigation before another live
voicemail audit or a claim of fresh preservation. See
[diagnostic contract, evidence and limits](../operations/LEARN-VOICEMAIL-DISCOVERY.md#existing-email-notification-discovery--10-october).

## Bounded preservation scans without global counts — 10 October

The source reader now omits redundant exact counts from page reads and supports
an explicit double-keyset mode. Two fully exhausted scans must agree on every ID,
recording pointer and transcript state. Short server pages cannot masquerade as
completion; global request/response budgets and safe failure metadata keep partial
results unverified. Eighteen focused checks pass, including same-count replacement,
short-page caps, drift and budget exhaustion. Earlier baseline manifests still work.

Live availability is not resolved: a catalog probe and a 100-row ID-only email page
without a count timed out. A full new scan was not started, and no production
setting/session/data changed. The prior complete preservation inventory remains
current evidence; fresh large-source verification is open. TEST remains release 020.
See [reader contract and evidence](../operations/LEARN-SOURCE-PRESERVATION.md).

## Interrupted Slack thread recovery — local, 10 October

Thread recovery now creates a new retained approval for continue or restart of the
same observed window. It preserves old approvals/cursors/messages, renews a bounded
page budget, rejects active/completed/superseded work, and uses existing worker
publication and pacing. Company owners/admins approve outside preview; viewer
progress excludes private cursor/credential fields. Exact request retries and
competing reviews cannot create duplicate recovery jobs.

The isolated PostgreSQL chain passed rollback, metadata preservation, worker
continuation/deduplication, authority/revision races, restart and queue rollback.
Thirty-nine Slack client tests, actual SQL responses through the application adapter,
and strict/application typechecks passed. No hosted or provider operation occurred;
TEST stays release 020. The recovery UI and durable browser requests are now locally
verified: lost responses survive reload and unavailable progress reads; exact retry,
restart, rejected-review clearing, viewer access and completed-window restrictions
passed synthetic browser acceptance. All 46 Slack tests, both typechecks and both
builds passed. Hosted release/acceptance remains next. See
[implementation and evidence](../operations/LEARN-SLACK-THREAD-RECOVERY.md).

## Slack thread recovery TEST release — 10 October

Release 021 is installed in TEST after an unchanged hosted rollback rehearsal and
isolated DDL/receipt-failure checks. It adds three functions and two indexes; all
preceding catalog definitions remain verified. The local TEST UI/fixture tools now
require 021. Installation starts no import and changes no stored communications,
provider credentials, worker runtime (still v4), schedules or production state.
Actual signed-in recovery RPC/browser acceptance and live capture remain incomplete.
See [release evidence](../operations/evidence/learn-slack-thread-recovery-test-release-2026-10-10.json).

## Slack thread recovery signed-in acceptance — 10 October

TEST 021 now has actual Auth/RPC acceptance for recovery, competing review conflicts,
exact retry, viewer/company boundaries, retained predecessors, continuation/restart,
reply deduplication and completion refusal. Existing worker v4 refused the nonexistent
fixture credential before Slack access. Pre-existing communications and approval
ledger fingerprints were unchanged.

The real signed-in app also passed continuation, refreshed-thread-list and reload
checks. Temporary users/connections/jobs were retired with evidence retained; the
owned browser/server were closed. Workspace home remained unavailable for the
synthetic company, so this proves the LEARN thread flow only. Real provider capture,
continuous ingestion, voicemail, Commusoft and broader V1 acceptance remain open.
See [API/browser evidence](../operations/evidence/learn-slack-thread-recovery-test-acceptance-2026-10-10.json).

## Existing Commusoft sources located — 10 October

The retained DH Works v4 package contains 1,613 customers, 962 sites and 4,000 jobs;
its output hashes, row counts and manifest seal match. The historical validator was
recovered with its later cross-customer site check and tested against this branch's
importer. It correctly refuses one contradictory exact site link among 228; no
source files were changed and no import was started. Twenty-two focused tests pass.

An 8,889-row derived diary export provides a concrete source for further visit
evidence work. It needs provenance, timestamp and engineer-identity reconciliation.
Prepared job engineer/completion-date fields are empty, so no individual completion
measure can be inferred. See [source findings and remaining work](../operations/LEARN-COMMUSOFT-RECOVERY.md).

Production reads remain unverified: REST identity failed, while management reported
an active project but returned HTTP 544 for a bounded database identity query.
No new source scan ran and no missing data is inferred. Independent local input
recovery continued; the overall goal remains active.

## Commusoft ownership guard and source trace — 10 October

The contradictory package link was traced to one row in the sealed diary export;
the other four sealed supporting exports contain no row for that job. The source
conflict remains unresolved. Preparation now requires site customer ownership,
rejects duplicate ownership masters and classifies a mismatch for review instead
of reconstructing the wrong link. All 27 focused tests pass, and the actual retained
source trace confirms that refusal without rewriting any of the 4,000 package jobs.
No import, deployment, production read or source mutation occurred in this increment.
See [trace, compatibility requirements and historical environment distinction](../operations/LEARN-COMMUSOFT-RECOVERY.md#ownership-contradiction-traced-and-preparation-guarded--10-october).

## Governed import foundation installed in TEST — 10 October

Release 022 is installed after an acknowledged hosted rollback rehearsal and exact
post-install schema/configuration checks. TEST now has 95 tables and 23 receipts.
The existing customer/site/job importer has its missing contact endpoint and
tenant-key dependencies, four additive tables, 25 private server functions and
three prepared import profiles. Existing source tables and earlier release checks
are preserved; the TEST UI tools now require this verified release.

An isolated current-TEST projection passed deployment, rollback, failed receipt,
retained canonical row, historical import and exact-site assertions. Three release
tool tests and two preceding thread-release tests pass. Auth/Edge/UI import
acceptance remains open; marketing eligibility tests were explicitly excluded
because that subsystem was not enabled. No original file import, provider action,
Edge deployment or production change ran. The real package's disputed ownership
link remains unresolved. See [release evidence and next gate](../operations/LEARN-COMMUSOFT-RECOVERY.md#hosted-verification-and-installation).

## Governed import endpoint and signed-in TEST acceptance — 10 October

Release 023 adds atomic active-company/actor/View As protection to the existing
row helper; TEST now has 95 tables and 24 receipts. The new governed-only import
endpoint reuses the existing engine and requires explicit customer/site/job
profiles, bounded requests and sealed preview/checksum contracts. Failed reads,
matchers or outcome writes cannot report success. All other endpoints and earlier
schema definitions remain verified.

Actual signed-in TEST acceptance passed for customer → exact site → job, preview
without canonical changes, replay, checksum, company/role/View As restrictions and
foreign run access. Three synthetic imports and their rows are retained; temporary
users were banned, rotated and demoted. Pre-existing source fingerprints matched.
Thirty-four focused local tests, strict Edge typechecking and isolated SQL authority,
concurrency and rollback checks pass. No real package, provider, frontend or
production deployment ran. Hosted conflict/retry, scale and browser review remain
open, as does the disputed Commusoft site ownership.
See [implementation and evidence](../operations/LEARN-COMMUSOFT-RECOVERY.md#governed-endpoint-and-atomic-import-authority--10-october).

## Import conflicts, retry and review screen — 10 October

Hosted Auth/HTTP checks now prove held dependency retry, exact-site ownership
conflict refusal, correction through a new sealed file, retained original outcomes
and duplicate identity linking. Existing TEST source fingerprints matched; fixture
users were retired with nine import records retained.

The LEARN file review dialog is implemented with explicit profile/file selection,
saved mappings/results, exact-file approval and reload after uncertain responses.
Seven client tests, application typecheck/build and synthetic browser interaction
checks pass. Hosted tests and synthetic UI tests are separate evidence; integrated
signed-in browser acceptance, scale, pagination and conflict resolution remain open.
No real source package, provider or production/frontend deployment changed.
See [implementation and evidence](../operations/LEARN-COMMUSOFT-RECOVERY.md#hosted-conflict-recovery-and-file-review-screen--10-october).

## Actual browser import acceptance and missing card projection — 10 October

The real signed-in app/TEST endpoint passed preview, interrupted-preview recovery,
original-file reattachment, mapping review and apply. Final database inspection
confirmed one completed synthetic customer import and unchanged pre-existing source
fingerprints. Fixture access is retired and owned browser/server resources closed.
The post-apply full page reopen was interrupted and remains unverified.

The imported person has no customer card: the import engine creates canonical
identities, while LEARN lists the existing customer-card projection. Connecting
these without invented activity or scoring is now a verified integration requirement.
Hosted large-file tests and the real package ownership conflict also remain open.
See [browser evidence and next requirement](../operations/LEARN-COMMUSOFT-RECOVERY.md#actual-signed-in-browser-import-and-customer-card-gap--10-october).

## Imported customer → existing card projection prepared — 10 October

A local migration now creates/reuses the existing customer card when a governed
customer identity is linked. Existing card IDs, archived state and protected fields
remain untouched; new cards carry no invented activity or numeric score. Bounded
private repair supports earlier imported identities. Partial unique indexes reject
duplicate history and prevent concurrent card creation.

The exact twelve-table local projection passed service-role, RLS, rollback,
preservation, pagination, historical import and concurrency checks. TEST was read
only for aggregate preflight and service grants; the candidate is not installed.
Hosted rehearsal/release, synthetic repair, card visibility and legacy writer race
acceptance remain next. See [candidate and evidence](../operations/LEARN-COMMUSOFT-RECOVERY.md#customer-card-projection-candidate--10-october).

## Imported customer cards installed and signed-in reads verified — 10 October

TEST release 024 now projects approved imported customer identities into the
existing card store. Hosted rollback and installation preserved all 18 monitored
source/card tables. Explicit repair added the missing card for the earlier
synthetic browser import without changing its retained evidence or any existing
card. A new real-Auth/Edge run confirmed two imported customers are visible through
LEARN's actual card loader to company owner/viewer and hidden from another company.
Temporary accounts were retired; all synthetic evidence was retained.

The exact catalog now checks enabled trigger state and valid unique indexes as
well as function definitions, grants and all prior releases. TEST has 95 tables
and 25 receipts. Visual post-import card rendering, legacy writer race acceptance,
large-file behavior, conflict resolution and the real package ownership issue
remain open. Production/frontend deployment and provider traffic are unchanged.
See [installed release evidence](../operations/LEARN-COMMUSOFT-RECOVERY.md#customer-card-projection-installed-and-read-in-test--10-october).

## Browser customer-card acceptance passed — 10 October

Both repaired and newly imported synthetic customers are now verified visually in
the real TEST-backed LEARN card list/detail. Fresh preview/mapping review/approval
and apply survived a browser interruption, with one durable customer/card and a
successful page reopen. The performance panel kept the unconfigured scope
unassessed. Fixture access is retired and all evidence retained. Import-volume
acceptance is next; the real Commusoft ownership conflict remains unresolved.
See [browser evidence](../operations/evidence/learn-import-cards-browser-2026-10-10.json).

## Advertised import limit failed; bounded batch candidate prepared — 10 October

Actual TEST import of 1,200 synthetic customers completed with matching canonical,
card and evidence counts. The 5,000-row preview failed HTTP 546 after 132 seconds
and created no import/canonical rows. All pre-existing source/card fingerprints
matched and temporary accounts are retired. This is an unresolved release gap,
not a passing maximum-volume acceptance.

A locally tested 100-row database-batch candidate reuses existing match/apply rules
and authority checks. Customer/site/job paths, replay, failure isolation and rollback
pass in the isolated projection. It is not yet integrated into Edge or installed.
Next: integrate bounded calls, verify error/recovery behavior, pin and rehearse TEST
release, deploy the reviewed endpoint, then repeat maximum-volume acceptance.
See [volume findings and candidate](../operations/LEARN-COMMUSOFT-RECOVERY.md#import-volume-failure-and-bounded-batch-candidate--10-october).

## Bounded import release accepted at 5,000 customers — 10 October

TEST release 025 and importer endpoint v2 are installed and verified. The unchanged
real-Auth dependency/conflict/card suite passes, and a new 5,000-customer trial now
finishes: 4.469-second preview, 18.090-second apply, 0.614-second idempotent replay.
All 5,000 canonical customers, cards, links, outcomes and provenance rows are retained;
pre-existing source/card fingerprints match. Temporary accounts are retired.

The first, second and final card pages passed authenticated reads. The outcome API
still exposes only its explicitly truncated 1,000-row window; full ledger pagination
is next. Large site/job/mixed-failure acceptance, interrupted hosted batch recovery,
real-source ownership reconciliation and production/frontend release remain open.
No original source files, providers or production deployment changed. See
[batch release evidence](../operations/evidence/learn-import-batches-test-release-2026-10-10.json).

## Complete import outcome navigation accepted — 10 October

TEST importer endpoint v3 now exposes bounded cursor pages for the whole row ledger.
The real client read all 5,000 outcomes from a fresh import in 50 pages, with exact
row sequence and no duplicates or gaps. The synthetic browser verified next/back,
final-page boundary and recovery after a failed page read. Existing source/card
fingerprints match and both acceptance runs retired temporary credentials.

Application/Edge typechecks and builds pass. Frontend changes remain local. Next:
interrupted hosted batch recovery, large site/job/mixed-failure acceptance and the
real package's unresolved ownership conflict. Broader connectors, scoring adapters
and release requirements remain active. See
[pagination evidence](../operations/evidence/learn-import-pagination-2026-10-10.json).

## Monday priority and checkpoint backing — 10 October

Chris requests the Drummonds Commusoft API connection as a major Monday, 12 October
deliverable. Commusoft is an input adapter, not the ServiceOS data model: other
clients can connect their own customer/job systems. Priorities are verified
read-only ingestion, useful linked cards, existing communication evidence, and
OpenFolk module/submodule switches, health diagnostics and recovery. Calm client
status must remain accurate. Advanced scores need verified measurements.

Partial 1,200→5,000 customer import recovery now passes with identical fingerprints
for the earlier records and evidence. Large site/job mixed-file acceptance was
interrupted before its large phase and remains pending; its fixture was retired.
No current claim is made that the Commusoft API is connected or that Monday live
acceptance is complete.

The reconstructed working checkout had no Git remote. Its existing 74 local
commits are being connected to the verified ServiceOS repository using the separate
`codex/learn-v1-test` checkpoint branch. Branch-specific Vercel Git deployment is
disabled there; source backup is not frontend publication or database backup.

## Commusoft API source boundary — local, 10 October

Official API schemas now inform a read-only private-app reader for properties,
property contacts and jobs, plus a provider-neutral source-record adapter. Twenty
synthetic tests and strict standalone typechecks pass: bounded bodies/deadlines,
authority revocation, safe errors, cursor integrity, rate-limit reset handling,
source retention and separate customer/site/contact/job identities are covered.
Unknown relationships remain held or unresolved candidates rather than guessed
canonical links. No real API read, deployment or source write occurred.

Drummonds API access remains unconfirmed. Credential/worker authority binding,
shared quota, durable source/checkpoint storage, canonical reconciliation and live
acceptance remain required. See [API contract and remaining work](../operations/LEARN-COMMUSOFT-API.md).

The following local increment binds a page to durable tenant/job/account/approval/
connection metadata and the existing feature-flag store. Explicit LEARN and
Commusoft opt-ins, active client/connector, current job lease and unchanged
connection/cursor are required. Twenty-eight transport, source and binding tests
plus strict typechecking pass. Tests include revocation during reads and permit
deferral failures. The credential/quota database port is still required, so this
handler remains unregistered and cannot start a production sync. No flag, provider
credential, TEST schema or source data was changed.

## Commusoft credential and quota database boundary — local, 10 October

The atomic credential/permit RPCs and server bridge are now implemented locally.
Acquisition locks and rechecks current authority, resolves only the exact
tenant-qualified Vault key and reserves a shared credential quota. One permit per
job attempt and a five-second send window prevent duplicate acquisition and delayed
request bursts. Rate-limit deferrals extend the shared gate even after a late
response outlives its original job/connection authority.

Thirty-four synthetic TypeScript tests and strict checks pass. Disposable Postgres
verification passed scope/grant/Vault-name denials, duplicate refusal, shared-key
pacing across tenants, monotonic deferral, competing workers and migration rollback.
The container was removed. No hosted schema, actual Vault credential, provider,
flag or production source was changed. Durable source publication/checkpoints and
worker settlement remain the next integration work before TEST release.

## Commusoft atomic source pages and recovery — local, 10 October

Provider-neutral source pages, retained content versions and per-page observations
now commit atomically with the account cursor and job receipt. Publication checks
the exact permit and current authority; retries acknowledge an identical committed
page, reject changed content and cannot acquire another provider page for that job.
A source-free receipt reader supports recovery by a new queue attempt even when
processing was subsequently disabled. The TypeScript persistence bridge validates
the returned receipt and does not automatically retry uncertain writes.

Forty synthetic tests and strict TypeScript checks pass. Isolated SQL checks passed
late-failure rollback, source retention/deduplication, cursor continuation, changed
scope/refused publication, new-attempt recovery, mutation guards, concurrent exact
replay and migration rollback. Verification containers were confirmed removed.
No real data, hosted schema, credentials or provider configuration changed. Durable
worker orchestration, canonical projection and hosted acceptance remain required.

## Commusoft dedicated worker and transactional continuation — local, 10 October

The worker now checks retained receipts before reading, runs one permitted source
page, and probes committed state before failure settlement. Dedicated SQL claiming
excludes Commusoft from the generic worker. Completion and successor enqueue are
atomic, replayable and derived from stored scope/current authority. Continuations
respect shared cooldowns; module disablement stops further pages while acknowledging
already committed work. Job keys bind the exact account and approval identity.

Fifty Commusoft and three shared HTTP-guard tests pass, as do strict module checks
and Edge entrypoint syntax validation. Isolated database tests passed successor
rollback, replay, changed-job-approval refusal, recovery beyond the retry budget,
disabled continuation, cooldown/backoff, ownership and concurrent claims. Worker
migration rollback restores all modified prior functions. Containers were removed.
The dedicated JWT/key-protected endpoint is local only; no key, schedule, hosted
schema, deployment or live provider operation was created. Canonical projection,
operator setup/recovery and TEST/live acceptance remain required.

## Reviewed Commusoft customers reuse existing cards — local, 10 October

Retained customer properties can now be explicitly reviewed into existing people/
companies or created as the reviewed type, with the existing customer card reused
or created atomically. A private provider-neutral identity ledger retains the exact
connection/source version, actor and decision. No automatic name/email merge or
legacy CSV namespace match occurs. Existing customers/cards are unchanged; new
cards have no invented performance, ownership or activity. Latest-observation
checks and connection locks prevent stale approval during source publication.

Isolated SQL verification passed actual source-page-to-card creation, exact replay,
concurrent replay, cross-connection identity separation, company/person card
separation, actor/module/connection denials, stale source refusal and late-failure
rollback. The verification container was removed. This is a local private RPC;
customer review UI/endpoint, candidate discovery/bulk classification, contact/site/
job projection, source updates/corrections and hosted/live acceptance remain open.
No real records, source credentials, hosted schema or production release changed.

## Commusoft customer review UI — local, 10 October

The LEARN portal now opens a customer review dialog with retained source pages,
person/company classification, paged possible-match search, explicit existing/new
customer choice and reviewed confirmation. Authenticated RPCs derive the actor
from the session, protect raw records and retain current company/module authority.
Confirmed saves refresh the cards. An uncertain acknowledgement disables further
decisions until a reread; no write is automatically retried.

Six client tests, application typechecking, production/isolated preview builds and
the existing 47 prebuild checks passed. Isolated SQL acceptance passed actual role
privileges, paged/latest source reads, candidate search, caller-bound confirmation
and replay, and facade rollback. Synthetic browser acceptance passed existing-card
linking, lost-response recovery and viewer restrictions. The temporary preview and
browser tab were closed. Hosted Auth/PostgREST acceptance, real connection setup,
bulk/secondary-identifier reconciliation and contact/site/job projection remain.

## Commusoft sites/jobs resolve reviewed ownership — local, 10 October

A signed-in action now projects retained work addresses and jobs into the existing
canonical tables using the reviewed source identity ledger. Jobs resolve either a
direct customer or a site's parent customer. Missing/unreviewed dependencies and
changed ownership leave durable held reasons; no canonical ownership is guessed or
overwritten. New source namespaces keep equal job numbers in separate connections
distinct. Existing CSV identities require explicit reconciliation. Source lifecycle
dates/statuses are bounded and typed; closed jobs do not imply completed work.

The full isolated SQL chain passed source-to-site/job projection, both customer
types, replay/concurrency, malformed references and dates, changed source/canonical
ownership, separate connection identity, unchanged existing jobs, retained held
history and late-failure rollback. Verification containers were removed. Work
review/batch UI, contacts, source updates/corrections and hosted/live acceptance
remain outstanding. No provider traffic, production data or deployment changed.

## Commusoft work batches and browser recovery — local, 10 October

The LEARN portal now includes paged site/job review, explicit selection and review
reason, and per-record linked/held results. The server accepts at most 50 records
per batch and commits row projections with an immutable receipt. An exact retry
returns that receipt. Cancellation and application serialize to one retained
outcome, including when a delayed original request arrives after cancellation.
Current company/actor authority is required; module disablement still permits
reading or cancelling the caller's saved request.

The browser saves each request before submission, scoped to backend, company and
actor, with cross-tab locking. Lost responses retain the request across reload;
checking a receipt never silently reapplies it. New approvals remain disabled until
the saved request is resolved. Raw provider payloads are not placed in browser
recovery storage. Existing CSV identities still require explicit reconciliation;
this initial batch UI holds them rather than selecting an existing target.

Thirteen customer/work client tests, application typechecking, the production
build (47 prebuild tests) and isolated preview build passed. Disposable Postgres
checks passed reviewed source-to-canonical projection, pagination, mixed outcomes,
actor/scope denial, exact replay, apply/cancel concurrency, disabled-module recovery,
late-failure rollback and migration rollback. Synthetic browser verification passed
lost acknowledgement, actual page reload, recovered linked/held results and viewer
restrictions. The preview and temporary browser tab were closed.

This is local implementation, not a hosted release or real Commusoft sync. Hosted
Auth/PostgREST acceptance, real API access, operator connection setup, contacts,
existing-target reconciliation and governed source updates remain open. See
[batch verification evidence](../operations/evidence/learn-commusoft-work-batches-local-2026-10-10.json).

## Commusoft schema installed and confirmed in hosted TEST — 10 October

Release 026 now installs the retained input/identity/review schema in the named
TEST project, bringing it to 104 tables and 27 deployment receipts. The missing
module-switch table was included using the repository's existing feature-flag
model. A fresh read confirms zero flags, Commusoft connections, source-sync jobs
and retained pages. No worker endpoint, credential, schedule or real sync was
created. Production remains unchanged.

The exact package passed a local PG17 rehearsal using the observed TEST table,
helper and grant contracts, including non-superuser installation, rollback, injected
receipt failure and preservation of prior records. Hosted rollback and installation
both preserved fingerprints across 16 existing communication, canonical and
connector/queue tables.

The first installed read-back required inspection because the release verifier
restored the shared queue definition in only one of its two metadata sections.
The installed new tables/functions/grants already matched the expected package.
The verifier now checks both reported copies and restores both when validating the
prior release. Fresh read-only confirmation proves the complete installed schema
and prior catalog preservation; no installation request was repeated.

Next: real signed-in Auth/PostgREST acceptance using synthetic retained inputs,
then dedicated worker deployment/verification and operator setup. Drummonds API
access, contacts, existing-target reconciliation, source updates and broader LEARN
release acceptance remain open.

## Commusoft signed-in customer/site/job acceptance — 10 October

Real Auth and PostgREST acceptance now passes against hosted TEST release 026.
The application adapters listed retained customer sources, found an existing email
match, reused that person/card without changing any fields, and created an
explicitly reviewed company/card. A job with an unreviewed site was held; after
site approval, a mixed job batch linked two records and held the unresolved third.
The actual card loader returned two customer cards and two job records.

The run simulated a lost acknowledgement after an actual successful batch RPC.
The client retained its request and recovered the stored receipt with a read,
without resubmitting. Exact replay, module-disabled result reads/cancellation,
late apply after cancellation, expected-actor mismatch, viewer/foreign-company
write denial, raw-history denial and immediate owner-demotion checks passed.
Owner and viewer card reads agreed; the other company could not read those cards.

Pre-existing TEST record fingerprints matched. All three synthetic logins were
banned and their passwords rotated; roles were demoted and the synthetic module
switches/connection disabled. A separate fresh read confirmed that retirement and
zero fixture worker jobs. Synthetic source/history and canonical results remain
retained. Evidence: [signed-in acceptance](../operations/evidence/learn-commusoft-test-acceptance-2026-10-10.json).

This establishes the hosted review/card path, not provider capture: synthetic raw
pages were inserted as test fixtures, without a Commusoft credential or API read.
Dedicated worker deployment and runtime acceptance, real Drummonds access, operator
connection setup, contacts, existing-target reconciliation and source updates remain.

## Commusoft worker deployed and verified in TEST — 10 October

The dedicated JWT-protected worker is active in TEST. Its trigger header reuses
the existing TEST service credential; no Commusoft API key, schedule or production
change was made. Binding the environment variable refreshed prior endpoint runtime
versions by exactly one, with all source hashes and other metadata preserved. The
new verifier pins both that refresh and the added worker without relaxing earlier
schema or endpoint contracts.

Eight actual HTTP checks passed: missing JWT (with and without a trigger), missing
trigger under anonymous/service JWTs, wrong trigger, wrong method, caller-supplied
scope, and authorised empty-queue execution. Existing TEST records stayed identical.

A synthetic queued run then resolved real stored scope but refused a verified
nonexistent Vault credential. The deployed worker recovered its deliberately
expired claim and retained a terminal authority failure at attempt two. A second
job was refused after module disablement. Neither created a permit, source page or
successor. All prior source/queue fingerprints matched; the fixture account,
connector and switches are disabled, its connection revoked and its jobs terminal.

Evidence: [deployed worker acceptance](../operations/evidence/learn-commusoft-test-worker-2026-10-10.json).
This closes the initial deployed-runtime and authority/failure checks. Successful
page ingestion/recovery, real Drummonds API access, operator setup and the remaining
LEARN V1 requirements are still open. Production and the live frontend are unchanged.

## OpenFolk input approval controls — local, 10 October

The operator server layer now supports explicit LEARN/Commusoft switches and
bounded collection approvals through the existing platform authority model.
Tenant ownership alone grants no operator access. Each request retains its actor,
definition, receipt, reason and prior state. Retry/check/cancel share one durable
outcome; a cancellation fences a delayed apply. Switch changes require the observed
previous values, and starting an import requires current connection revision,
credential binding and enabled modules.

Approval, worker account/cursor and queued job commit together. Active/incomplete
imports are held for recovery; replacing a completed traversal retains its prior
approval/checkpoint. The bounded operator reader exposes control state without raw
source data or credentials. The application adapter validates actual SQL responses
and uses accurate queued/interrupted/expired/review states.

Isolated PostgreSQL authority, replay/concurrency, preservation and rollback checks,
five client tests and application typechecking pass. No hosted schema, flags, jobs,
credentials or provider traffic changed. The TEST project lacks the existing
platform-authority prerequisites, so those must be inspected and packaged before
hosted release. The operator UI, connection setup/verification, recovery controls
and real-source acceptance remain to be completed.

## OpenFolk input controls wired into Modules — local, 10 October

The operator Modules view now exposes LEARN/Commusoft switches, connection metadata,
bounded import approvals and retained progress. Saved requests are scoped to the
backend/operator/company and coordinated across tabs. An uncertain reply blocks new
changes until an explicit receipt check, same-request retry or server cancellation
resolves it. Requests survive reload, and storage/context failures never silently
discard unresolved work. The UI distinguishes an approval queued for work from
completed capture and preserves acknowledged results if a status refresh fails.

Eleven adapter/outbox tests, application typechecking and builds pass. Synthetic
browser acceptance passed lost-save response, actual reload, receipt recovery and
the unavailable-service screen. The preview has network access disabled; its
simulated receipts are not hosted TEST or real provider evidence. The new screen
still needs the operator prerequisites/RPCs released and signed-in verification
against TEST. Credential setup, incomplete-import recovery and broader module
controls remain open. No production or hosted source data changed.
