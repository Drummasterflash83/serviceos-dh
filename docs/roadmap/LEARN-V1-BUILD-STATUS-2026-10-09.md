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
worker now has a credential-owning transport implementation, but still requires
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
