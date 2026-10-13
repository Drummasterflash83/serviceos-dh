# Voicemail provider history and ongoing capture

Updated 13 October 2026. **Candidate discovery optimisation is installed in production;
route expansion and additional recording imports remain under preparation.**
Chris has authorised all voicemail intake. Historical publication and ongoing
capture still require verified source binding and preserved mailbox visibility.

## Proven starting point

- The retained-email candidate set contained 78 notifications: 71 published
  voicemail/source pairs, three withheld because the provider did not sign
  `Content-Type`, and four originals unavailable in Gmail. This is a distinct
  scope from provider-wide notification discovery below.
- All five historical routes are paused and have fixed end dates. They cannot
  capture future messages simply by being enabled again.
- Office playback and representative personal-mailbox playback are verified in
  the signed-in live app. The Liz recording played to its end at 4.68 seconds,
  readyState 4, with no media error. Private evidence:
  `.verification-results/voicemail-personal-playback-20261013.json`.
- The existing `serviceos-worker` schedule is active every minute. The deployed
  worker already invokes voicemail discovery and processes bound import jobs.
  No separate new schedule or credential destination is needed.

## Provider notification discovery

The initial read-only pass checked the 30 existing `active_dwd` Workspace accounts
against the existing service-account identity and actual Gmail profile. It listed
messages using the fixed Birchills sender, notification-subject and attachment
query, including Spam/Trash, then checked exact sender/subject/recipient metadata.
No raw message, transcript or audio was requested or published.

The initial limit was 100 unique message IDs per account. It found 316 exact
metadata candidates, including 246 absent from the retained-email candidate set.
Anna, Office, Tony and Scheduling reached that limit. The continuation preserves
those first 100 metadata results and uses 100-ID pages, capped at 1,000 unique IDs
per account. The first page is checked against the saved ID set to recover the
cursor; subsequent cursors and pending-page IDs are saved privately. Any remaining
cursor is reported as truncation, not completed history.

The completed bounded continuation found **1,372 exact metadata candidates**, of
which **1,298 are additional to the retained set**. The 74 retained available
candidates include the 71 published messages and three signature rejections;
the four missing originals are not added back by this provider listing.
Office reached 1,000 listed IDs (988 exact candidates) and still has older history.
Scheduling reached 1,000 listed IDs with no exact-recipient candidates and still
has older copies. Anna exhausted at 100; Tony exhausted at 268. Six accounts still
require the profile/delegation review described below. The continuation made 1,997
additional metadata/profile/list requests, zero raw/audio reads and zero writes.

| Recipient / extension | Exact metadata candidates | Additional to retained | Earliest observed |
| --- | ---: | ---: | --- |
| Office / 103 | 861 | 815 | 15 December 2023 |
| Office / 601 | 127 | 118 | 18 December 2023 |
| Tony / 105 | 268 | 260 | 7 August 2024 |
| Anna / 102 | 100 | 98 | 27 September 2024 |
| Liz / 102 | 12 | 3 | 13 July 2026 |
| Heidi / 108 | 2 | 2 | 23 July 2026 |
| Larne / 107 | 1 | 1 | 16 September 2026 |
| Rudi / 106 | 1 | 1 | 20 July 2026 |

Older dates may involve previous provider signing domains or templates. Metadata
alone cannot authorise a different signer; classify those originals separately
and retain the existing signed-header requirement. Sanitised discovery evidence:
`docs/operations/evidence/learn-voicemail-provider-discovery-2026-10-13.json`.

An exhausted query establishes coverage of that query in that mailbox at the time
of reading. It does not prove all voicemails ever left, deleted notifications,
alternate provider templates, or independently authenticated audio. Every newly
discovered candidate still needs signed-original and audio verification.

Private inventories:

- `.verification-results/voicemail-provider-history-discovery-20261013.json`
- `.verification-results/voicemail-provider-history-expanded-20261013.json`
- `.verification-results/voicemail-metadata-gap-review-20261013.json`

## Recipient and ownership gaps

| Observed recipient / extension | Existing access | Preparation required |
| --- | --- | --- |
| Office / 601 and 103 | Existing Chris/Heidi managers only | Historical gaps and a separately bounded forward route; verify current provider notification destination. |
| Liz / 102 | Existing Chris/Heidi managers only | Keep historical Anna deliveries separate; verify current destination before a forward route. |
| Anna / 102 | Existing Chris/Heidi managers only | Historical evidence only; do not infer present ownership or switch future notifications to Anna. |
| Tony / 105 | Existing Chris/Heidi managers only | Complete available history and verify current destination. |
| Heidi / 108 | Existing Heidi owner plus existing managers | New history route must preserve the configured owner exactly. |
| Larne / 107 and Rudi / 106 | Existing managers only; no configured owner | New history routes may retain that access; names alone must not assign staff ownership. |

Scheduling has notification copies whose sampled To header names
Office, not Scheduling. The Mary sample likewise names Office; a Larne sample
names another recipient. These copies are excluded by the exact-recipient rule.
Do not expand recipient allowlists or infer an alias from message possession.
Prefer the original recipient mailbox; otherwise establish explicit provider alias
or forwarding authority before proposing a different binding model.

Finance and Invoicing return Gmail profiles different from the requested account,
and those profiles do not match another existing active account. Dave, Jordan,
TonyStockton and Wilson fail delegation. Keep these six account cases separate
from empty mailboxes; investigate current directory/provider status without
deleting history or guessing that an account is obsolete.

## Avoiding delayed ongoing capture

At 11:13 UTC, production held 22,189 Gmail rows. The present discovery function
walks the entire tenant Gmail table in UUID order for each route, examining 100
rows per page. The minute tick handles up to two routes, five pages each. With
four continuously eligible routes this can take about 89 minutes per full pass,
followed by a 15-minute rescan delay. That is a capacity estimate from the code,
not a promised latency or measured service level.

Prepare a narrowly scoped discovery change before enabling ongoing capture:

1. Apply tenant, Gmail provider, Birchills sender, exact extension, account binding
   and route date bounds in the SQL query **before** the 100-row page limit.
   Keep unbound candidate diagnostics separate; missing `provider_account_id`
   must never become an assumed match. Add an index matched to this query and
   check its plan on the restored full schema.
2. Preserve deterministic paging, immutable source IDs, batch receipts and replay
   behaviour. Retain settled and failed jobs so discovery cannot create an
   unbounded retry loop. Repeated generations must still find late-arriving rows
   and account-binding repairs without changing original source content.
3. Use a short bounded rescan interval for the much smaller eligible candidate
   set, retaining fair route selection and the existing per-tick work limits.
   Measure arrival-to-job and arrival-to-published latency with a real notification
   before describing capture as current.
4. A later ingestion-triggered enqueue can reduce latency further, but must use
   the same route admission, exact account binding and idempotency contract. It
   must not make ordinary email ingestion depend on successful audio import.

The modern email ingestion SQL records `provider_account_id`. Of 3,321 Gmail rows
created in the preceding 24 hours, 3,299 had a valid account binding. The remaining
22 require separate classification; retained email existence alone is not trusted
voicemail routing evidence. Read-only operational snapshot:
`.verification-results/voicemail-ongoing-readiness-20261013.json`.

## Controlled route expansion

Before execution, prepare exact immutable routes and per-source manifests from
the completed provider inventory. Each route must identify tenant, configured
voicemail mailbox, existing Gmail account/profile, signed recipient, date window,
signing authority, existing owner/managers and verification evidence. Rehearse
admission, pause, replay, tenant isolation and ownership on the full restored
schema. Publish only originals passing every current signature/MIME/audio check.

Historical extensions must not overlap another enabled route for the same
mailbox/account/date. Preserve previously published source and voicemail identity;
do not rebind an existing source to a replacement route. Import history to a fixed
handoff cutoff, reconcile outcomes, then create a distinct forward route from that
cutoff after verifying the current provider destination. Preserve the old routes
and their evidence. Do not silently mark rejected or unavailable history complete.

For the initial forward run, record the before state, enable only verified routes,
observe a real new voicemail through Gmail capture, discovery, private storage and
signed-in playback, then verify duplicate handling and the pause control. Existing
Email/Phone module gates must both remain authoritative. Report historical count,
latest verified intake and whether automatic capture is enabled separately.

Independent backup coverage of the original-message and voicemail-audio buckets
remains a separate prerequisite for declaring full operational recovery complete.

## Prepared additional historical scope

The private exact-source plan is
`.verification-results/voicemail-expanded-history-plan-20261013.json`. It excludes
all mismatched-recipient copies and the six unverified accounts. It contains
1,298 unique account/message bindings, preserving original receipt timestamps and
existing mailbox owners/managers. No historical content is published by this plan.

- Eight proposed non-overlapping historical routes cover 1,211 candidates before
  the existing route boundaries, or the first verified historical window for
  Heidi, Larne and Rudi. Heidi retains her configured owner access; all other
  boxes retain the current managers-only access.
- Four existing routes cover the remaining 87 new candidates within their
  already verified windows: Liz 2, Office 103 74, Office 601 6, Tony 5. Reuse
  those immutable routes rather than rebinding sources to replacements.
- Preflight each exact original in memory, at most 1 MiB each, with exact Gmail
  profile, recipient, timestamp, mailbox, signer, required signed headers and
  audio decode checks. Do not store rejected raw messages or widen signer or
  recipient bindings automatically. The three earlier unsigned-header sources
  and four unavailable originals remain separately withheld.
- Import only the preflight-accepted manifest after parent review, with exact
  runtime/source hashes, current permissions and preserved published identities.
  Use per-route duplicate checks and pause every route in the final step.
- This is a bounded discovered-history scope, not all-history completion.
  Office still has a retained listing cursor; Scheduling's copies remain
  excluded. Forward capture requires separate verified current destinations.

## Candidate discovery release prepared

Migration: `supabase/migrations/20261101900000_learn_voicemail_candidate_discovery.sql`.
It adds a partial tenant/extension/UUID index and replaces only the discovery
page query/rescan interval. Sender, extension, account and route-date hints are
applied before the 100-row limit. Missing account/time and unavailable/draft
candidates retain their existing review or exclusion outcomes. Existing source,
route, owner, private-storage and cryptographic validation are unchanged.

The current worker runtime already accepts the unchanged receipt contract; no
runtime deployment is required. The existing two-route/five-page scheduling limit
and fair last-dispatch order remain unchanged. Full candidate generations repeat
after one minute, so old-dated backfills and corrected bindings behind the UUID
cursor are revisited. A partly completed old scan keeps its cursor and finishes,
then the next generation revisits the entire candidate set. Page counts are work
observations, never proof of provider coverage.

Full-schema verification used the isolated retained production backup and actual
worker discovery adapter. The database planner selected the candidate index
without disabling sequential scans. Across 20,000 ordinary fixture emails plus
552 candidate notifications, tick one examined 501 candidates across two routes;
tick two examined the remaining 51 across the unfinished and third route. The
receipt replay added no jobs, all three routes progressed, and source hashes
were unchanged. Separate assertions exercised 100-row pagination, missing
bindings, drafts, unavailable originals, invalid IDs/timestamps, finite cutoff
boundaries, late old-dated inserts, binding/label repair, receipt failure rollback,
paused capture, client-role denial and retained dead-letter jobs.

Private preparation: `.verification-results/production-voicemail-candidate-discovery-20261013/`.
The release pins the project, source hash, current function definition and exact
paused route bindings. It changes no credential, schedule, account, grant or
source record. The rollback restores the captured old function and drops only
the new index, with installed-function and paused-route checks. Parent review is
required before executing these prepared production files.


Final offline receipt:
`.verification-results/voicemail-candidate-discovery-rehearsal-20261013-v4/report.json`.
The exact production release wrapper and rollback both passed, along with the
original full-schema voicemail publication, retained-owner and private-access
journey. The prepared `apply.mjs` requires the exact plan SHA in
`SERVICEOS_APPROVED_VOICEMAIL_DISCOVERY`, journals before mutation, refuses an
existing uncertain outcome and verifies function/permissions, route bindings,
owner/manager hashes, policies, schedules and non-decreasing retained counts.
No apply command has been run by this preparation task.

## Production installation — 13 October, 12:37 BST

The parent reviewed and applied the exact prepared SQL release. Installed function/index readback passed, with original routes, owners, managers, policies, schedules and function privileges unchanged. All five routes remain paused and the 71 voicemail/source pairs remain intact. There was no runtime deployment or provider request. The full-schema worker acceptance above verifies candidate selection; live scheduled acceptance awaits verified route activation. This installation does not claim that the additional metadata candidates have been imported.
