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


## Additional-original verification — 13 October, 11:51 UTC

The 1,298 additional originals were read exactly once each, with exact provider
profile/message/receipt binding and the unchanged deployed parser/signature/audio
rules. No raw email or audio was persisted or uploaded. All were available during
this read; the four previously missing retained originals remain a separate case.

- **68 passed:** 51 with a provider transcript and 17 using the observed legacy
  no-transcript format. No duplicate content fingerprints were found in this set.
- **113 current-signer messages remain withheld:** their DKIM result passes, but
  `Content-Type` is omitted from the signed headers required by the current policy.
- **1,117 prior-signer messages remain withheld:** they use
  `birchills-net.20230601.gappssmtp.com`, outside the current signer policy, and also
  omit signed `Content-Type`. The first failing policy does not establish whether
  every other cryptographic condition would pass.

The exact accepted-only plan is
`.verification-results/voicemail-expanded-eligible-import-plan-20261013.json`,
SHA-256 `e7f8a4a6128306fdb869bfbc3f7e1a2f81214ac91d529d2fa27b755805df515c`.
It contains 68 source bindings and nine proposed duplicate replays across nine
selected routes: four existing routes and five new historical routes. The frozen
access bindings contain actual owner/manager IDs, not inferred staff ownership.
Heidi retains her existing owner access; the other mailboxes retain managers-only
visibility. The new routes with zero eligible originals are excluded.

| Mailbox | Additional eligible recordings |
| --- | ---: |
| Office 103 | 45 |
| Office 601 | 6 |
| Tony 105 | 10 |
| Liz 102 | 3 |
| Heidi 108 | 2 |
| Larne 107 | 1 |
| Rudi 106 | 1 |

Before bounded imports, the prepared route operation takes the same dispatcher
advisory lock used by the worker, followed by the tenant capture lock, route lock
and job-admission lock. It refuses unreconciled queued/retrying/running voicemail
work, then holds discovery on only the selected routes for a bounded deadline.
The final pause happens before restoring each previous dispatch deadline. This
prevents the faster minute worker from expanding a manual batch into unrelated
retained notifications in the same route windows. No source history is deleted;
new paused scan rows remain for audit. Full execution still awaits parent review.

Sanitised preflight evidence:
`docs/operations/evidence/learn-voicemail-expanded-preflight-2026-10-13.json`.

## Authenticated-body compatibility investigation

A separate authorised diagnostic read exactly four representative originals:
the newest and oldest missing-Content-Type example from each observed signer.
It made six Gmail requests and two bounded public DNS queries. It changed no
production verifier and imported nothing.

Both **current-signer** examples cryptographically authenticate the complete body
with RSA-SHA256/2048-bit keys, signed identity headers, bounded signed dates and no
`l=` partial-body limit. Their bodies contain two root parts: a text alternative
and an MP3 attachment. The MIME part headers, attachment type/disposition/encoding
and boundary delimiters are inside that authenticated body. A diagnostic prototype
ignored unsigned outer MIME type/encoding, derived the root boundary from the body
and reconstructed only the signed identity headers plus that derived MIME root.
Both examples passed the existing template parser, exact recipient/extension
binding and audio decode/duration check. These remain **diagnostic successes,
not production import eligibility**.

Both **prior-signer** examples remained DKIM `neutral` even with diagnostic DNS
access to that exact older domain. Their structural similarity is not proof of
authenticity. Do not treat the MIME compatibility path as resolving old-key
verification or automatically allow that signer.

A possible production compatibility path should therefore:

1. Preserve the existing fully signed-header path unchanged.
2. Permit a separate current-signer path only after full-body cryptographic,
   identity-header uniqueness, signed-recipient, receipt-time and key checks pass.
3. Derive a strictly bounded two-part MIME root solely from authenticated body
   delimiters. Unsigned outer MIME fields must never choose interpretation; the
   proposed implementation rejects inconsistent content type and any outer transfer
   encoding/disposition. Reject ambiguous boundaries, unexpected
   preamble/epilogue, additional root parts and unsupported structures.
4. Keep existing attachment, parser, duration, mailbox, private visibility and
   source-fingerprint checks. Add adversarial signed fixtures proving unsigned
   header changes cannot change extracted identity/audio; reject body tampering,
   partial signatures, MIME ambiguity and missing identity signatures.
5. Re-preflight affected exact originals with the reviewed implementation before
   any release/import. Investigate older signer verification separately.

Sanitised structural evidence:
`docs/operations/evidence/learn-voicemail-authenticated-body-diagnostic-2026-10-13.json`.


## Accepted-only batch execution prepared

The route operation and concurrency hold passed a full-schema offline rehearsal:
`.verification-results/expanded-voicemail-selected-routes-rehearsal-20261013-v3/report.json`.
The restored snapshot predates the approved Heidi Workspace recovery; only the
selected fixture account statuses were aligned to the fresh preflight's verified
current states. The rehearsal proved all selected route admissions, shared
worker-lock exclusion, zero scheduled jobs while held, exact prior scan-control
restoration, unchanged manager permissions, final pause and repeat activation
without duplicate routes.

Prepared runner: `.verification-results/run-expanded-voicemail-history-20261013.mjs`.
It requires the exact reviewed plan hash in `SERVICEOS_APPROVED_VOICEMAIL_EXPANSION`,
pins the published importer and parser/signature source hashes, preserves the
current 71 messages/sources, and permits at most 68 imports plus nine duplicate
replays. Each request is journalled before dispatch. Uncertain outcomes are not
replayed automatically. It stops before the 30-minute selected-route discovery
hold expires and always attempts pause/control restoration. Source raw-byte
hashes are compared with preflight evidence after import; duplicate replays must
preserve the exact message/source identities and counts. No scheduled voicemail
jobs may be added by the bounded run. This runner has been prepared and syntax
checked, **not executed**.

## Authenticated-body implementation prepared; not deployed

The narrow implementation is now prepared in `voicemail/signed-source.js` and
`voicemail/authenticated-multipart.js`. The original fully signed Content-Type
path is unchanged. The fallback requires the current provider signer to pass
RSA-SHA256/2048-bit verification over the complete body, with all unique identity
headers signed, no partial-body limit and the existing receipt chronology checks.
It reconstructs MIME from the body-derived root boundary and signed identity
headers only. The unsigned outer Content-Type must agree exactly with that derived
structure; duplicate or extra interpretation parameters, root transfer encoding
and root disposition are rejected. Two complete root parts are required: a text
alternative and a base64 audio attachment. Delimiter collisions, additional parts,
nonempty epilogues and truncation fail closed.

Validation passed: 15 signature/template tests, nine provider-bridge/audio tests,
the worker TypeScript check, and the actual offline Supabase user-worker with
network disabled. The Edge rehearsal decoded synthetic audio, rejected tampering
and invalid audio, preserved internal authentication and recovered a simulated
lost queue acknowledgement without another provider read on replay. These checks
used no customer data or credentials. The current signer policy and older neutral
signature rejection are unchanged.

This is **prepared and offline verified**, not production acceptance. After review,
the next bounded check is an in-memory preflight of the 113 current-signer originals
from the expanded scan plus the three earlier retained unsigned-Content-Type
originals. The 1,117 older-signer rejects are excluded from that proposed check.
No compatibility release or further import has been performed by this preparation.

Sanitised implementation evidence:
`docs/operations/evidence/learn-voicemail-authenticated-body-tests-2026-10-13.json`.

## Compatibility source preflight completed — no release/import

The reviewed bounded read-only pass finished at **12:15:03 UTC on 13 October**.
It read all **116** selected originals exactly once: 113 expanded current-signer
rejects plus the three retained unsigned-Content-Type sources. **109 passed** the
reviewed signature/MIME/template/recipient/audio checks: 100 transcribed and nine
without provider transcripts. This includes all three retained originals.

Seven sources remained rejected by the existing `notification_reference_invalid`
guard. Their fixed-marker diagnostics show a single system reference, no automated
transcription marker and neither recognised legacy footer. This is insufficient
to infer the precise template; they remain excluded pending original-source
diagnosis. The 1,117 older-signer rejects were not read or made eligible.

The pass used 116 original reads, 119 Gmail requests and one current-provider DNS
query. It changed no runtime, routes or data; raw messages/audio were not persisted.
Private evidence records original hashes and per-source classification. All 109
eligible sources use `authenticated_body_boundary`; there are no duplicate content
fingerprint groups within that set. Existing mailbox permissions remain required
for any subsequent separately reviewed import.

Sanitised source evidence:
`docs/operations/evidence/learn-voicemail-authenticated-body-preflight-2026-10-13.json`.

## Compatibility rollout package prepared

The reviewed 109 eligible originals now have an exact private import plan with six
route bindings: three existing routes and three additional immutable historical
routes. Six identity-preserving duplicate replays bring the maximum importer calls
to **115**. The plan preserves the current **139 messages/sources and ten paused
routes**. No owners or manager grants change; seven template-invalid originals and
all 1,117 older-signer originals remain excluded.

The operation holds selected-route discovery under the dispatcher and capture
locks, refuses unreconciled jobs, journals the prior scan controls and pauses before
restoring them. Full-schema offline rehearsal passed worker concurrency fencing,
zero scheduled imports while held, all route admissions, exact scan restoration,
unchanged message/source/owner/manager hashes and repeat activation without duplicate
routes. The guarded runner pins reviewed source hashes and requires a verified
compatibility runtime publication before any import.

Two runtime artifacts are prepared against current production: importer **v5** and
platform-worker **v61**. Only the signature verifier and new authenticated multipart
helper change. Exact retained rollback artifacts match the current published
hashes. Both prepared artifacts booted and rejected unauthenticated requests in a
network-disabled container. The deployment runner checks all existing runtime and
secret fingerprints, paused intake/no pending jobs, schedules and exact voicemail
content/access hashes before and after release. **Neither deployment nor import
has been executed.**

Private review artifacts:
- `.verification-results/production-voicemail-authenticated-body-20261013/preparation.json`
- `.verification-results/production-voicemail-authenticated-body-20261013/deploy.mjs`
- `.verification-results/voicemail-authenticated-body-eligible-import-plan-20261013.json`
- `.verification-results/authenticated-body-voicemail-selected-routes-20261013.sql`
- `.verification-results/run-authenticated-body-voicemail-history-20261013.mjs`

Sanitised preparation evidence:
`docs/operations/evidence/learn-voicemail-authenticated-body-rollout-preparation-2026-10-13.json`.

## Remaining history and ongoing route review

After the 248-pair checkpoint, the seven remaining current-signer failures were
diagnosed as a third exact no-transcript footer: “To access your mailbox, simply
dial 0 from any connected handset.” The parser previously recognised the same
zero-dial wording with “the mailbox”, plus the separate *95 wording. The proposed
change accepts only this additional fixed template. All **seven originals now
pass** read-only signature, identity, route and audio preflight. Eighteen
signature/MIME/display tests and the worker TypeScript check passed. **This parser
change is prepared, not deployed; those seven have not been imported.**

The observed older selector
`20230601._domainkey.birchills-net.20230601.gappssmtp.com` returns a TXT record with
an explicitly empty `p=` value. Both representative older originals report
`neutral / invalid public key`. This is a revoked key, not merely a missing
allowlist entry: [RFC 6376 §6.1.2](https://www.rfc-editor.org/rfc/rfc6376.html#section-6.1.2)
requires a revoked key to fail verification. No signer/resolver policy was widened.
A copied Authentication-Results header or an archived public key alone must not
be used to bypass this result. To recover these older sources, obtain independently
authenticated provider history (for example an authenticated provider export that
binds each recording hash to its account, mailbox and original message/reference),
then design a separate provenance path. The 1,117 old-signer records remain
withheld; two diagnostics do not establish every original's selector.

The transcript display change is separate: only a complete known provider footer
at the end is hidden, with “Show full provider text” available. Stored transcripts,
source fingerprints and raw originals remain unchanged. Similar spoken phrases,
partial footers and extra text are preserved. This UI change still needs the
parent's release/build and browser verification.

Seven forward bindings are concretely prepared in
`.verification-results/voicemail-forward-route-plan-20261013.json`: Office103,
Office601, Liz102, Tony105, Rudi106, Larne107 and Heidi108. Each begins at its
existing historical route's exclusive end, avoiding a date gap or overlap. They
keep the same exact Gmail account/recipient and explicit owner/managers; Anna102
remains historical only. All seven selected account rows are active Workspace
accounts with capture selected and no directory conflict. Email and Phone capture
gates are open. No routes have been activated.

The production mailbox records still have null provider notification destinations,
null email-enabled state and no provider-sync timestamp for all 12 mailboxes.
Historical signed sources establish the past destinations, but do not prove the
phone provider's current configuration. Before ongoing acceptance, verify that
configuration or a fresh exact-recipient signed notification for each selected
mailbox, rehearse the exact forward bindings, enable under a bounded monitored
first-run plan, and measure Gmail-arrival → job → private playback. Preserve the
13 historical routes and existing 248 messages/sources. A first recording does not
prove ongoing latency or complete provider history; Office/Scheduling discovery
also remains capped and six Workspace account identity cases remain unresolved.

Sanitised investigation evidence:
`docs/operations/evidence/learn-voicemail-remaining-history-review-2026-10-13.json`.

## Current provider destinations verified; forward capture still paused

At **12:47:06 UTC**, eight read-only Birchills API requests verified the exact
Drummonds account and the seven already-bound endpoint IDs, extensions and types.
Their **current notification email addresses match all seven proposed forward
recipients**, including Liz102. This closes the current-destination evidence gap
without relying on null local fields or historical delivery. Existing credentials
were read in memory; no provider settings, credentials or application data changed.
The current API responses did not supply `voicemailEnabled` or publish a voicemail
subresource link. Do not equate those missing fields with disabled voicemail or
claim message-list/recording coverage. The documented endpoint email fields are
notification destinations, per the [provider reference](https://github.com/sipcentric/pbx-api-docs/blob/master/api/v1.md).

The forward plan now records this exact provider evidence. It still requires an
exact route rehearsal and bounded monitored activation, followed by fresh signed
notification → Gmail ingestion → discovery/job → private publication acceptance.
All historical routes remain paused. Mailbox switch state is unverified until
separate provider evidence or actual delivery establishes it.

The seven-source third-footer import plan also passed its full-schema rehearsal:
**seven originals plus two duplicate replays**, using only two existing historical
routes (four Office103, three Office601), preserving 248 message/source pairs and
13 routes. Dispatcher fencing, exact source admissions, prior scan-control
restoration, owner/manager/source preservation and final pause all passed. No
new historical routes, access grants or provider configuration changes are needed
for that batch. Its parser runtime release and import remain separate parent-owned
steps; no runtime was prepared against the superseded platform-worker v62.

Private seven-source plan:
`.verification-results/voicemail-third-footer-eligible-import-plan-20261013.json`.
Private exact route operation:
`.verification-results/third-footer-voicemail-selected-routes-20261013.sql`.
Sanitised provider and rehearsal evidence:
`docs/operations/evidence/learn-voicemail-forward-provider-verification-2026-10-13.json`.

## Exact ongoing-route rehearsal completed; activation pending

The seven current-recipient routes passed the full-schema offline rehearsal. Four
actual minute scheduler ticks fairly visited all seven routes (2 + 2 + 2 + 1
jobs). A late-arriving notification below the prior cursor was found on the next
generation, while replaying identical metadata added no duplicate job. Fixed
start boundaries, dispatcher fencing, held-route suppression, queued-import
rejection after pause, and exact prior dispatch-control restoration all passed.
Existing messages, sources, mailbox owners, manager permissions and cron commands
were preserved. The isolated container had no network and was removed afterwards.

The prepared activation uses seven new forward routes, no former Anna route, and
no access or provider-setting changes. Each fixed start equals that same
recipient's historical exclusive end. A 30-minute initial hold permits checks
before releasing the existing scheduler; rollback pauses routes before restoring
dispatch controls. Provider binding evidence is valid until 14:47:06 UTC on
13 October; refresh it before activation if that deadline has passed.

A fresh read found zero installed forward routes and no retained voicemail hints
within these seven intervals. Therefore activation alone cannot prove new-message
acceptance. Monitor a genuine signed notification through Gmail ingestion,
discovery, import and private playback, recording each timestamp. Do not mark an
empty scheduler tick as successful end-to-end capture. The seven historical
footer sources should be completed before activation and a fresh preservation
baseline recorded. All production routes remain paused at this preparation point.

Sanitised rehearsal evidence:
`docs/operations/evidence/learn-voicemail-forward-activation-rehearsal-2026-10-13.json`.
Private activation plan, exact operations and metadata monitor:
`.verification-results/voicemail-forward-activation-plan-20261013.json`,
`.verification-results/forward-voicemail-selected-routes-20261013.sql`, and
`.verification-results/forward-voicemail-monitor-20261013.sql`.

The third-footer runtime is now prepared against the published importer v6 and
platform-worker v63. Its sole runtime source change is the exact additional
no-transcript footer in `birchills_voicemail_email.ts`. Both compiled artifacts
booted without network access and rejected missing authentication. The five
published Slack proof files are byte-for-byte preserved, and matching rollback
artifacts are retained. Preparation read back 248 voicemail pairs, no enabled
voicemail routes and no active voicemail jobs; it performed no production writes.
The guarded seven-source runner requires the matching new importer/platform
hashes and finishes with two identity-preserving replays, 255 pairs and all 13
routes paused. Deployment and import remain parent-owned review steps.

Sanitised preparation evidence:
`docs/operations/evidence/learn-voicemail-third-footer-runtime-preparation-2026-10-13.json`.

## Monitored activation paused safely after unrelated runtime changes

The first ongoing monitor stopped at **13:48:38 UTC** when its exact runtime
baseline changed. A read-only production comparison at 13:52:17 identified only
`receptionist-calls` v10 → v11 and `receptionist-practice` v13 → v14. The voicemail
importer v7 and platform-worker v64 were unchanged. All seven forward routes were
paused, with all 255 existing messages/sources preserved; all 20 routes are now
paused. This is a deliberate runtime-drift stop, not evidence of a voicemail
import or provider failure. The original journal remains intact.

A separate guarded resumption is prepared for the same seven existing forward
routes. It creates no route and imports no historical source. Four offline
scenarios passed, including resumed scan-generation progress and automatic pause
after template/runtime failure. It retains prior scan history and restores only
selected dispatch control deadlines on rollback. The monitor still requires
current exact runtime evidence: coordinate with the pending Slack runtime release
and refresh/review that baseline before activation. The provider destination
receipt expires at 14:47:06 UTC and must be refreshed if activation is later.
No resumption has executed at this checkpoint; genuine new-message publication
and private playback acceptance remain outstanding.

Sanitised diagnosis/preparation:
`docs/operations/evidence/learn-voicemail-forward-runtime-pause-2026-10-13.json`.

At **13:55:40 UTC**, a fresh read confirmed the completed Slack release changed
only Slack worker v4 → v5 and platform-worker v64 → v65 from the prior diagnosis,
exactly matching its verified deployment receipt. Resumption preparation v2 now
pins that baseline, keeps importer v7 and Emma runtimes unchanged, and retains
the earlier plan and journal. All four offline resumption checks passed again.
This is preparation only; no route activation was performed by this review.
Evidence: `docs/operations/evidence/learn-voicemail-forward-resumption-v2-2026-10-13.json`.

## Resumption v3 guards the voicemail runtime dependencies

The v2 attempt stopped before journal creation or writes when the independent
Emma work changed `receptionist-calls` v11 → v13 and `receptionist-practice`
v14 → v15. A 13:59:21 UTC read confirmed these were the only changes; all
voicemail dependencies remained unchanged.

The prepared v3 guard now compares ten actual dependencies: platform-worker
(discovery, queue, signed import and embedded email engine), the direct voicemail
import endpoint, the three email schedulers, the three direct Gmail capture
adapters, Workspace mailbox discovery explicitly invoked by the queue, and
private voicemail playback. Their runtime identities, hashes, versions, auth
flags, entrypoints, import maps and active status must remain exact. Relevant
drift still prevents activation or pauses an active run. Other runtime updates
are recorded separately in the private journal instead of being mistaken for a
voicemail fault. All credential fingerprints, access, route and cron guards
remain unchanged.

Three policy tests passed, exercising each dependency against six change types.
Five full-runner offline scenarios passed, including relevant-runtime pause and
40 healthy polls with an unrelated Emma update recorded without stopping capture.
Original journals and earlier plans remain retained. This checkpoint prepared
v3 only; no activation was performed by this subtask.
Evidence: `docs/operations/evidence/learn-voicemail-forward-resumption-v3-2026-10-13.json`.
