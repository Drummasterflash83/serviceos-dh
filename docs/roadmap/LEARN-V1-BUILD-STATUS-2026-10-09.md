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
- Preservation/transcript-status increment: 23 focused tests passed, covering
  pagination and foreign/duplicate rows, missing IDs hidden by rising totals,
  changed storage pointers/objects, failed reads, bounded WAV header inspection
  and transcript-status response validation. Application and preview TypeScript
  checks passed. Both builds passed; the preview retains existing bundle warnings.
  The rebuilt synthetic preview displayed all four transcript status counts with
  no browser errors. This browser check makes no live user-RLS claim.

## Next work and release gates

1. Keep comparing the private source/storage baseline; investigate failed audio,
   verify backup retention and restore, and reconcile against Birchills/Sipcentric
   provider inventory before attempting bounded recovery. Do not assume upstream
   recordings remain available indefinitely.
2. Verify deployed TEST and production schemas/migration history before applying
   the additive draft RPC. TEST project identity remains separate from production.
   Do not blindly apply all pending migrations or touch the separate Emma launch.
3. Trace real authorised email/phone examples end to end into customer/team evidence
   using ordinary user permissions; service-role inventory does not test user RLS.
4. Complete Slack ingestion and voicemail capture with source reconciliation and
   idempotent replay. Existing notification/directory integrations are not ingestion.
5. Connect Commusoft jobs/visits/assignments and confirm the actual vehicle-data
   provider and field definitions. The canonical jobs and voicemail tables were empty
   at the recorded observation; no performance figures should be inferred from that.
6. Persist subject/period-scoped scoring measurements through the existing
   measurements/objectives model. Ensure individual metrics cannot be selected as
   company-wide measurements by the existing objective worker. The pure scoring
   contract is implemented; the production measurement adapter is not yet wired.
7. Add evidence correction/review and policy publication with retained versions,
   effective dates, membership as of the scoring period, approved business calendars,
   exclusions and job-mix treatment. Agree criteria before rating actual people.
8. Add manager-reviewed reward simulations against agreed rules after the evidence
   and scorecard stages pass acceptance. No automatic payroll change is implemented.

The overall LEARN V1 goal remains active and incomplete.
