# Birchills voicemail: discovery before capture

## Private playback deployed — TEST, 12 October 01:01 BST

`receptionist-voicemail-recording` v1 is deployed with JWT verification. The handler
also calls Auth `getUser`, then selects the requested company/message using that
user's client and existing RLS. It accepts only the two UUIDs, reads at most 4,096
body bytes and never accepts an audio path or URL from the browser. A message must
match the requested scope and its canonical private storage path. Missing, denied
and inconsistent message reads do not reach privileged operations.

The server must save `playback_link_requested` for the actual actor before signing
the object in `receptionist-voicemails` for 60 seconds. It validates the signed
destination against the configured Supabase origin and exact object. Audit or
signing failure returns no link. Responses from the handler use `Cache-Control:
no-store`. A granted URL is a short-lived capability; the endpoint does not revoke
an already issued URL when later mailbox permissions change.

Pinned bundle `869e36a205cd3e4a8a6e9c3ae44978d9e5e63a162bced52d21649ae8f8f54fa2`
contains two modules; both match downloaded deployed code. Twenty-five local
regressions and strict types pass; the eight actual-handler tests also pass against
downloaded code. Six hosted HTTP probes verify absent/anonymous/forged/service
denial and method/CORS behaviour, with all 140 datasets preserved. No human account,
mailbox permission, source file or provider call was created. The TEST frontend's
existing inbox already invokes the endpoint; no frontend deployment was needed.

This closes the missing-endpoint gap, not positive playback acceptance. Still
required: an authorised signed-in owner/manager opens a retained recording, the
audit entry matches their actual user, audio loads/plays, a different unentitled
user is denied, and real provider/ownership/backup acceptance is completed.
[Evidence](evidence/learn-voicemail-playback-test-2026-10-12.json).

## Historical inbox visibility — TEST 077, 12 October

The original message policy snapshots the owner, but the mailbox summary starts
from current mailbox assignments. Actual SQL reproduced an old owner seeing one
message through RLS and zero mailboxes after reassignment. The additive
`learn_voicemail_mailboxes(tenant, after)` reader fixes discovery using the union
of caller-visible mailbox IDs and caller-visible message mailbox IDs. It is
SECURITY INVOKER with a fixed search path and authenticated execution only.
Message, mailbox and Storage RLS are unchanged. It returns 20 rows with an opaque
UUID continuation; the next page starts strictly after that ID.

When current mailbox configuration is not visible, only the existing message
group ID, its caller-visible saved count and a generic historical label are shown.
Current names, extensions, notification addresses and sync settings stay hidden.
No connection warning is inferred for historical-only groups. Current owners and
explicit managers retain their existing views; revocation follows existing RLS.
The UI now uses this paginated reader in both LEARN and Receptionist.

The full TEST schema rehearsal and installation passed real-role old/new owner,
ordinary owner denial, manager/revocation, foreign tenant and 20+3 pagination
checks. Temporary banned/passwordless identities and every fixture rolled back
inside the release transaction; no session or persistent access was created.
All **140 datasets** were preserved. Runtime worker/importer versions are unchanged.
Rollback can restore the preceding frontend while retaining the unused reader;
do not remove messages or change ownership to make an older UI display them.
Subsequent preservation checks should use the inbox-inclusive catalog.

These checks verify the existing recorded ownership rules, not that Drummonds'
historical route assignments are correct. Real route authority, signed-in playback
and provider completeness remain open. [Evidence](evidence/learn-voicemail-inbox-history-2026-10-12.json).

## Private inbox entry from LEARN — 12 October, local acceptance

`LearnVoicemails` opens the existing `VoicemailInbox` from LEARN. It uses the same
signed-in SECURITY INVOKER mailbox summary, message RLS and audited playback
endpoint as Receptionist. No schema, mailbox grant or storage permission changes
are involved. Private messages are not inserted into shared customer cards or
performance observations. Operator aggregate visibility does not provide inbox access.

The reader now verifies response shape, unique identities, company/mailbox binding,
timestamps, counts and exact page size. Null/error responses do not become an empty
inbox; a changed population can leave an empty later page with a Newer action.
Account/company changes remount the inbox and discard selection, details and audio
state. Private queries have zero unused-cache retention. Source failures still allow
retained messages to be displayed when their own read succeeds. Saved-message counts
do not attest complete provider history.

Local browser verification uses controlled synthetic RPC/query responses, including
a delayed old-account read. It proves frontend behaviour, not hosted permissions or
successful audio playback. Real mailbox access, historical ownership/reassignment,
private context linkage and signed-in acceptance still need verification.
[Local evidence](evidence/learn-voicemail-inbox-local-2026-10-12.json).


## Recurring dispatch and operator status — 12 October, 00:29 BST

TEST release 076 adds `voicemail_schedule_tick()` to the existing platform-worker
invocation path. It is called before queue claiming for all-jobs or voicemail-only
runs; a deliberately narrow run for another connector skips it. No new cron or
secret is introduced, and no TEST schedule has been activated. Current real routes
remain disabled. A transaction processes at most two eligible routes and five
100-row pages per route. Routes are ordered by last attempt; failed routes back off
for five minutes so another route can progress. Email and Phone gates still apply.
Per-route page changes roll back together on failure, and the whole tick rolls back
if its final receipt cannot be saved. Empty configurations create no write heartbeat.

One immutable receipt per UTC minute makes concurrent/lost-response invocation
replayable. Old receipts retain their observation time and never claim fresh provider
health. Worker errors or malformed responses surface as unconfirmed; one failure does
not stop unrelated queued work. The invocation promise is registered with the existing
Edge background-lifetime mechanism before awaiting it.

`learn_operator_voicemail_status(tenant, after)` uses the existing effective-dated
OpenFolk view/admin grant and rejects View-As. It paginates 20 routes per page and
returns only extension/configuration and aggregates: observed candidates, source-review
reasons, excluded drafts, job states, pass progress, worker attempts and backoff.
Caller numbers, email addresses, source IDs/paths, transcripts, credentials and audio
are omitted. The helper is not callable by ordinary clients. Local actual SQL confirms
that an operator with view authority but no mailbox ownership/manager relationship
still sees zero private voicemail messages. This status privilege creates no human
grant and does not bypass private voicemail RLS.

The new OpenFolk LEARN component distinguishes paused/unobserved/overdue/scanning/pass
finished states. It does not turn an unavailable status into zero or imply that a
finished retained pass proves provider history. It gives concrete steps for missing
bindings, unavailable originals and overlapping/reassigned routes. Counts cover
notifications found by discovery, rather than every earlier/manual import. It is
built and checked in a local browser using synthetic RPC responses; hosted frontend
still needs deployment and signed-in verification.

- Release 076 SHA-256: `3d071818ed83407c496ac6b6e25a784a6e976bf63986928d5309a3fcd5bbe355`.
- Installed catalog: `e98a51ad59594757305433a7257c5e6f`; dispatch metadata: `8a2c3ed38f0b91da2c374183a693710f`.
- Runtime bundle: `712fc8b2743967e2532feae706c917de8c2ca2de953e8a6e2fc3c1889cdd79b0`.
- TEST platform-worker **v19** and learn-voicemail-import **v2** are ACTIVE; draft
  rejection is deployed in both paths. Readback verifies 102/19 emitted modules and
  160/23 imports respectively. Type-only omitted modules have no emitted importers;
  syntax normalization is a review aid, not formal proof.
- All 139 prior datasets survive schema installation; all **140** survive runtime
  deployment and ten idle/auth/RPC checks. The retired synthetic fixture is retained.
- Local command: `python3 scripts/verify/learn-voicemail-intake-local.py --dispatch`.
  It includes discovery-to-publication, dispatch bounds/recovery, actual authority,
  private-message denial and 24-route pagination. Local fixture receipt resets
  simulate later ticks; they do not prove real clock-driven delivery.
- [Sanitized evidence](evidence/learn-voicemail-dispatch-2026-10-12.json).

Next: deploy the matching frontend from Git; obtain signed-in operator/owner acceptance;
verify positive hosted scheduled import and actual cron operation within authorised
provider scope; finish real route authority and independent source/audio recovery.
For runtime rollback, restore the reviewed preceding bundle while preserving schema,
receipts, candidates and jobs. Do not drop populated evidence tables. Use the new
140-dataset baseline for subsequent releases; older first-install tools must not run
again. Production remains unchanged.



## Retained-email discovery installed in TEST — 12 October, 00:08 BST

Release 075 adds service-only scan state, candidate tracking, immutable per-request
page receipts and aggregate status. Installation and rollback rehearsal each preserve
all 136 prior datasets, including the retired synthetic source/audio/message from
release 074. The three new tables are empty; the next full preservation baseline
must include **139 datasets**. No runtime endpoint, route, schedule, human access,
credential or production state changed.

`voicemail_discover_page(tenant, route, request)` requires an enabled, verified
Birchills route, its active Workspace primary account, and both Email/Phone capture
gates. It scans at most 100 retained Gmail rows per call. Known sender/subject hints
select potential notifications only; the existing raw-provider, DKIM, recipient,
mailbox, audio and private publication checks still decide admission. Missing legacy
account bindings, unknown receipt times, unavailable originals and ambiguous routes
remain review cases. Drafts are excluded. A source already assigned to a different
route cannot be silently reassigned. Terminal jobs are retained rather than repeatedly
recreated by discovery.

Each page atomically saves candidates, queue jobs, progress and a replayable receipt.
Completed passes become eligible to restart after 15 minutes, so subsequent calls
can find late inserts and corrected labels/account bindings. **This interval is a
scan-state rule, not an installed schedule.** Multi-page passes are not snapshots
of Gmail; `coverage_complete` is always false. Discovery currently recognizes the
observed “New message in mailbox NNN from …” Birchills template. Other templates and
provider history coverage remain unproven. `voicemail_discovery_status` is an internal
aggregate for the controller; the controller UI is not wired to it yet. Candidate
counts represent retained observations, with pass timestamps and separate job states.

Local acceptance runs actual PostgreSQL migrations and the complete discovered-source
journey through the queue, Workspace bridge, real signature verification and MP3 decode,
then private publication. Gmail/DNS/Storage transports are controlled fixtures, not real
provider or hosted Storage acceptance. Lost publication replies recover through the
queue receipt without another provider read. The raw bridge now rejects Gmail drafts
and malformed label responses; this runtime change has not been redeployed.

- Release SHA-256: `cfd833f9f962322a73d3d0ec516bc5e58d7d4e75d649b9c505a59f8d7c8ed868`.
- Installed discovery-inclusive catalog: `911f61a99c28149bd78305496009a69c`.
- Discovery metadata fingerprint: `ddaa5f4f12a0cc0794d9c3bd79a9ea18`.
- Verification: `python3 scripts/verify/learn-voicemail-intake-local.py --discovery`;
  27 Node regressions and strict worker types also pass.
- [Sanitized evidence](evidence/learn-voicemail-discovery-2026-10-12.json).

Next: bounded recurring dispatch with recoverable request identities, OpenFolk status
and recovery wiring, positive hosted discovery, real mailbox authority/provider
acceptance, private signed-in playback and independent source/audio recovery. The
schema can remain unused on rollback; preserve candidate/receipt history once it has
been populated. Do not drop discovery tables or replay old release tools against the
new baseline. The previous runtime remains deployed and production remains unchanged.





## Hosted synthetic import completed — 11 October, 22:52 UTC

A complete generated source passed the shared production queue adapter, signed MIME
verification, actual MP3 decode, immutable upload/readback and atomic SQL publication
against hosted TEST. Code ran locally using the existing TEST service credential
in memory; provider reads and DNS were controlled synthetic inputs. This is positive
hosted SQL/Storage acceptance, **not positive dispatch through platform-worker's
real Workspace bridge**, real-provider acceptance or signed-in playback.

The isolated fixture `ce740001-aaaa-4000-8000-000000000001` contains one private
mailbox and one generated 28-second voicemail. There is no owner, manager grant,
profile or login for it. The route's required verifier reference uses the already
banned synthetic playback actor; its evidence text explicitly identifies runner
verification, not human or real-provider verification. No Auth row or entitlement
was created or modified. The setup/claim transaction first rehearsed and rolled
back with all 136 datasets unchanged, then ran once under an exclusive journal.

One source load led to exactly two immutable uploads/readbacks. The runner discarded
the successful publication reply; the queue recovered its saved success receipt.
It then replayed after retirement with no additional source load or write. A foreign
tenant claim never reached the loader. Final records contain one succeeded job,
one private message, one binding and one settlement. `coverage_complete` remains
false and email-delivery state remains unknown.

- Published message: `39ae5f5e-d38c-4fc1-b1d5-2314cce9404e`.
- Audio: 56,304 bytes; SHA-256 `782a76362731d87a5d1608107758a25e86e36afa28e6dba183b8ce45d06694e1`.
- Original synthetic email: 76,391 bytes; SHA-256 `89eff41c8b2c380f07e3238065ab7830feff704b07e27a8f4e45699c1b52afc9`.
- Both final service readbacks match. Anonymous downloads and public URLs are denied.
- The existing unentitled synthetic subject sees zero messages under SQL's authenticated
  role and fails `can_manage_voicemail`; no session or token was minted for this check.
- Exact row/path exclusions preserve all 136 prior datasets. Auth, role, profile,
  membership and mailbox-manager records have no preservation exclusions.

The tenant is now archived, the route disabled and its credential-free email-account
metadata disabled. Evidence and files are retained. Setup, claim and import must
not be rerun: the verifier's exclusive journals and preflight reject existing fixture
records. Use `--inspect --existing-cli-login` for read-only inspection. Existing
empty-configuration release probes will correctly reject this newer nonempty TEST
state; future releases must include this retained fixture in their baseline.

[Sanitized evidence](evidence/learn-voicemail-queue-import-2026-10-11.json).
Remaining: enumeration/reconciliation and scheduling, real authority/credential
acceptance, deployed provider-to-queue flow, provider-transcript quality, signed-in
private playback, access-preserving LEARN/card integration and independent backups.
Private content must not be projected into shared tenant-wide cards merely because
it belongs to the same customer or company.

## Queue schema and worker installed in TEST — boundaries verified, 22:45 UTC

Release 074 is installed in TEST `saatxzwxvdvqevbnskxy`, after a rollback rehearsal
against the installed schema. Both checks preserve all 134 existing datasets,
including private source/audio storage metadata, Auth records, roles and memberships.
The two added queue tables remain empty. The runtime deployment preserves 136
datasets and all other endpoints. Platform worker advanced once, from v17 to v18;
no route, job, user, access grant to a person, credential or schedule was added.
Production is unchanged.

- Release package SHA-256: `ca067f8fa8d11ef266713ec105a9064461a99258e14b0321d79e6ee542d08c15`.
- Installed queue-inclusive schema: `ae32949d7a76097a899e92d36654293e`.
- Queue metadata fingerprint: `01e9b2e9a3d765960c22d956a7403fdf`.
- Worker source bundle: `0c100e374d41c38d82000bacfa66281734455c441a033debf00f1e58c75d23c0`.
- Worker deployed artifact: `f8357c2c3f9219ecddb50399164712fa4dcbda82d29cd8a501e0c1fa8929dbae`.

The worker source readback matches 101 emitted modules and 159 relative imports.
Three omitted modules contain only erased types. Comparison normalizes syntax
presentation and is a review aid, not formal proof. Six hosted boundary checks
pass: missing/anonymous worker auth are denied; the exact existing internal-header
request runs an empty voicemail-only claim with all counts zero; service-role
recovery returns zero; missing-claim binding returns PT409; anonymous queue recovery
returns 42501/401. All 136 dataset fingerprints match before/after.

The first bearer-only worker request returned 403. Its complete report was retained,
including unchanged data, before a separately journaled check added the already
supported `x-serviceos-internal-key` header using the same authorized TEST server
credential. That path succeeded. Authentication was not loosened and no secret was
stored or printed. These checks do not establish why bearer-only authentication was
rejected. Use the verified internal-header path for this TEST worker acceptance.

[Sanitized release/deployment/readback/HTTP evidence](evidence/learn-voicemail-queue-hosted-2026-10-11.json).
The pinned release scripts use exclusive private journals and inspect uncertain
outcomes rather than resubmitting them. Completed runs must not be repeated blindly.
The existing source fingerprint readers that include the release ledger now see
074; older pinned release tools should reject this newer state.

**Not yet verified:** a successful hosted queue import or live provider journey.
Next, exercise the real hosted queue RPCs and private Storage with a generated
recording in an isolated fixture without creating login access. Real route/owner
verification, credential authorization, enumeration/coverage, backup and signed-in
playback remain required. Keep real routes and scheduling inactive. Rollback keeps
all records/buckets; disable/defer voicemail jobs before reverting to a worker that
lacks the dedicated queue path. Do not drop queue evidence or reset source data.

## Durable voicemail queue — local only, 22:35 UTC

Migration `20261101430000_learn_voicemail_queue.sql` and the platform-worker path
are prepared, **not installed in hosted TEST or production**. No job, route, user,
credential or schedule has been added. Installed TEST remains release 073, import
endpoint v1 and platform worker v17.

The job type is `phone.voicemail_import`, on the existing `platform_jobs` queue.
The service freezes its exact route/account/Gmail-message/receipt-time payload in a
private binding. Every route, prepare and publish call is fenced by tenant, worker,
monotonic claim attempt and current lease. The original intake owner/privacy rules
remain authoritative. Publication and queue success commit together. Exact saved
receipts resolve uncertain replies without another provider read and are explicitly
historical; they do not prove current storage integrity or complete history.

Pause detection checks both Email and Phone controls plus route enablement.
A paused attempt waits five minutes without consuming the failure budget. Claim
attempts still increase, so an old worker cannot regain authority after a pause.
Transient failures use bounded backoff; permanent denials need review. Dead-worker
recovery handles at most 100 rows per invocation and uses the failure budget.
Generic queue reclaim explicitly excludes this job type, even if the dedicated
recovery RPC fails. No generic completion/failure writer handles voicemail results.
Unknown publication remains unconfirmed until a saved settlement can be read.
Only allowlisted machine codes and neutral messages enter public queue diagnostics.

Local verification uses the actual queue/intake migrations in a disposable,
network-disabled PostgreSQL container. Thirteen coordinator scenarios cover tenant,
role and worker denial; lost success/failure replies; partial storage retry;
pause before capture and after upload; lease expiry/reclaim; changed bindings;
publication rollback on queue-settlement failure; retry exhaustion; false handler
success; permanent denial; and simultaneous delivery of a single claim. Parser,
decoder and Storage are controlled adapters in that database test. Separately,
the actual offline Edge Runtime verifies a generated signed 28-second MP3 through
the queued Workspace/coordinator path, loses its publication reply and recovers
its receipt. A replay makes no provider request. The direct endpoint still passes.
SQL/SDK/provider transports are controlled in the Edge check. Five reclaim tests,
28 existing regressions and strict worker types pass.

Reproduce locally:

- `python3 scripts/verify/learn-voicemail-intake-local.py --queue`
- `python3 scripts/verify/learn-voicemail-edge-runtime.py --queue`
- `python3 scripts/verify/learn-voicemail-edge-runtime.py`
- `node --test scripts/verify/learn-voicemail-queue-recovery.test.mjs`
- `node_modules/.bin/tsc -p scripts/verify/voicemail-auth/worker-tsconfig.json`

[Sanitized evidence and exact source hashes](evidence/learn-voicemail-queue-local-2026-10-11.json).
The first fixture exposed a mismatched synthetic receipt time and the first
immutable-trigger check exposed a shared-record field lookup; both were corrected
and rerun. The Edge check found that a type-only worker-contract dependency tried
to resolve a remote SDK in the offline runtime. The queue now uses the existing
structural database boundary, and the final offline run passes without network.

Before hosted use: rehearse against the full installed schema with preservation
checks; install the queue migration before deploying the new platform worker;
verify the complete worker bundle and authenticated hosted queue/storage flow.
Keep real routes and scheduling inactive until historical ownership, provider
access and acceptance are established. Enumeration, durable coverage, private
file backup and signed-in playback are still unfinished. Reverting a worker after
queue activation must first stop/defer voicemail jobs; an older worker lacks the
dedicated reclaim/settlement path. Retain private bindings, receipts and source
files during rollback. Do not drop tables or reset data.

## Hosted TEST foundation, endpoint and private storage — verified, 22:20 UTC

TEST **073** is installed in `saatxzwxvdvqevbnskxy`: the existing private voicemail
foundation plus the new private intake schema. The pinned release package is
`supabase/release/learn-test/073_voicemail_private_intake.sql`, SHA256
`bd7e8bd175d21827b40bcc2eb511c7118f48ef0f3fe85bbf6fdc3209ce069cba`.
The exact package first passed a rollback rehearsal, then installed with **127
existing datasets preserved**, unchanged existing audio bucket, and no new roles,
role memberships, Auth users, mailbox grants, mailboxes or routes. All seven new
tables remained empty. Client/anonymous intake and private-source reads are denied;
service calls with an unknown route are denied. The installed voicemail-inclusive
catalog fingerprint is **f22d6c92600ca36b82360239594d4286**. The legacy 072 reader's
fingerprint also changes because its release ledger now includes 073; do not
reuse older pinned deployment prerequisites without a fresh review.

`learn-voicemail-import` **version 1** is deployed in TEST, with source bundle SHA256
`379a6b2a4d371638f474efbf657e4777f79f74b599e0d07df1bd98a6288bd7c6`.
Gateway JWT verification is disabled because the handler requires an exact existing
server key; ordinary user JWT claims never grant intake access. No secrets were
uploaded, no queue handler was registered and no schedule was activated. Other
endpoints and all **134 datasets**, now including the seven empty voicemail tables,
were preserved during deployment and boundary acceptance.

Actual hosted HTTP checks confirmed: no auth **403**, anon key **403**, malformed
internal request **400**, and authenticated nonexistent route **503 / route
unconfirmed**, before credential/provider loading. This is refusal evidence, not a
successful provider import. Downloaded source matches all **19 emitted modules**
and **23 runtime imports**. Five type-only modules were correctly omitted by the
compiler. An initial readback-verifier false positive counted imports inside those
absent type-only modules; inspection of the same downloaded artifact corrected the
comparison without redeployment. No deployed source difference was found.

Actual hosted Storage received exactly two generated synthetic objects, uploaded
with overwrite disabled: a **56,304-byte MP3 tone** and its **76,391-byte signed
notification email**. Service readbacks matched exact sizes/SHA256; anonymous reads
returned **404** and public URLs **400** for both private buckets. They remain under
synthetic prefix **ce730001-aaaa-4000-8000-000000000001** for acceptance evidence.
There is no corresponding tenant, mailbox, route or voicemail row; do not treat
these files as customer data or evidence of publication. Preservation checks excluded
only these two planned object paths and confirmed all other 134 datasets unchanged.
No real recording or provider credential was copied and no provider request occurred.

[Combined hosted evidence](evidence/learn-voicemail-hosted-test-2026-10-11.json).
Reproducible tooling: `learn-voicemail-release.mjs`,
`learn-voicemail-runtime-deploy.mjs`, `learn-voicemail-runtime-http.mjs`,
`learn-voicemail-runtime-readback.mjs` and `learn-voicemail-storage-http.mjs` in
`scripts/verify`. Completed mutation journals must not be rerun. Unknown submissions
require inventory inspection, not resubmission. Storage fixtures must not be overwritten.

**Still required:** a successful integrated hosted import/publication with verified
route ownership, exact hosted provider/DNS/credential acceptance, durable queue
admission and settlement, enumeration/coverage and ongoing scheduling, larger-source
handling, backup of source/audio buckets and signed-in mailbox/card/playback journeys.
The current endpoint is a one-message internal operation, not completed ingestion.
Capture remains off because no routes exist. Production is unchanged.

**Rollback:** while TEST acceptance is incomplete, leave routes absent/disabled and
stop invoking the isolated endpoint; retain the private tables/buckets and evidence.
Do not drop storage/source tables or reset TEST. Subsequent fixes use new pinned
releases. Production already has its own voicemail foundation and must not receive
this TEST prerequisite package wholesale; production promotion remains separate.

## Workspace source bridge and internal entry point — local only, 22:09 UTC

Prepared `supabase/functions/learn-voicemail-import/index.ts` connects the shared
importer to existing Workspace credential checks and bounded Gmail original-message
reads. It handles **one message per internal call**. It is not deployed, registered
with the queue or scheduled. No service key, provider secret, user, grant or route
was created or changed.

The HTTP handler requires an exact existing service-role or internal key, with the
tenant in `x-internal-tenant-id`; user JWT role claims are not authority. Its 2 KiB
body accepts only route/account/message IDs and the expected Gmail receipt time.
It returns only a publication receipt, processed count and `coverageComplete:false`.
Unconfirmed publication never becomes a success or an assertion that nothing changed.

Before credentials or provider traffic, SQL route admission checks the tenant,
verified historical mailbox route and both Email/Phone controls. The bridge reuses
`createEmailCapturePorts` for account, Workspace connection, directory identity and
service-account binding. The only change to that existing component is a narrower
credential-scope type: it no longer requires unrelated queue-attempt fields.
Gmail's profile must match the primary mailbox; routes and controls are checked
again before a single `format=raw` read. The response is bounded at 1.5 MB JSON /
1 MiB decoded original, requires canonical base64url and the same ID/receipt time,
and uses fixed Google URLs, refused redirects and 15-second request timeouts.
The importer then verifies signature/audio and performs immutable upload/readback.
The bridge clears its original-message byte buffer on exit. Aliases remain held
for a separately verified binding; this is not a claim of complete mailbox coverage.

The restricted public DKIM resolver is now shared with diagnostics: three cached
selector lookups maximum, only the exact pinned signing domain, 5-second DNS
attempts. Nested selector/domain tricks and other domains are refused. Errors
retain allowlisted credential/provider codes without response bodies or secrets.

**Verification:** 28 Node regressions pass, including the existing 14 credential
checks, seven signature/decode checks and seven new provider/HTTP/bounds checks.
Strict worker types pass using the installed SDK and a Deno declaration shim.
The actual offline Edge user worker again passes under a 2-second CPU limit,
including HTTP authentication before work, a synthetic token handoff, two controlled
Gmail reads, real signature/decode, two immutable uploads and two hash readbacks.
The runtime test uses simulated database/provider/storage transports and public
synthetic signing material; it makes no external requests. The actual endpoint
SDK/hosted network path has not been exercised. Test containers are removed.

[Evidence](evidence/learn-voicemail-workspace-bridge-2026-10-11.json).
Next: prepare/install the TEST foundation and private intake schema with preservation
checks, verify actual hosted Storage and endpoint packaging, then add durable queue
admission/settlement, discovery and coverage. Real routes/owner binding, provider
credential destination approval, backup coverage and signed-in acceptance remain
required before activation. Production is unchanged.

Primary contracts checked:
[Gmail message get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
and [profile get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).

## Shared voicemail code verified in Edge Runtime — local only, 22:01 UTC

The signature/MIME verifier, audio decoder and private import coordinator now live
in `supabase/functions/_shared/voicemail/`. Node diagnostics use thin adapters to
these same implementations. `edge.js` pins mailauth 7.3.0, postal-mime 4.0.5 and
mpg123-decoder 1.0.3 through `npm:` imports. Explicit `node:buffer` imports fix the
real `Buffer is not defined` failure found in the Supabase worker.

An actual offline **Supabase Edge Runtime 1.74.3 user worker**, with 256 MiB memory
and a 2,000 ms hard CPU limit, passed signed extraction, body-tamper rejection,
invalid-audio rejection and positive MP3 decoding. A generated 28-second tone
produced 56,304 MP3 bytes and decoded to **225,216 frames at 8 kHz (28.152 seconds)**,
identically in Node and Edge. The extra duration is encoding padding, not a real
customer recording. The full coordinator completed two immutable uploads and two
hash readbacks through a controlled SDK-shaped transport. No customer files,
credentials, outbound network, hosted writes or capture activation were involved.

The refactored code also passed seven Node regressions and the existing actual
PostgreSQL intake suite, including twelve coordinator failure/retry scenarios.
The separate voicemail dependency audit reports zero known vulnerabilities.
The synthetic encoder is development-only and is not imported by the Edge adapter.
The test container and staged files were removed after verification.

**Still unproven:** hosted deployment/bundling, actual Supabase Storage transport,
restricted live DNS resolution, provider credential/loader wiring, verified
mailbox routes and historical ownership, scheduling/coverage, source/audio backup
coverage and signed-in acceptance. Neither the private intake migration nor a
voicemail capture endpoint has been installed or enabled by this checkpoint.
The next step is an authenticated, bounded worker integration and hosted TEST
acceptance with capture disabled until its route and credential approvals exist.

[Runtime evidence](evidence/learn-voicemail-edge-runtime-2026-10-11.json).
Reproduce with `python3 scripts/verify/learn-voicemail-edge-runtime.py` after
installing the pinned diagnostic dependencies. The harness mounts only selected
code, installed packages and generated synthetic fixtures; it never mounts the
repository or exports the host environment to the user worker.

## Import coordinator and portable decode — local verification, 21:47 UTC

`scripts/verify/voicemail-auth/private-import.mjs` now connects route admission,
bounded raw-source loading, signature/MIME extraction, actual audio decoding,
private intake preparation, uploads without overwrite, byte-hash readback and
atomic publication. It requires the provider's message ID and receipt time to
match the admitted source. Storage paths must match the SQL-reserved IDs. A
second admission check precedes upload; SQL rechecks capture before publication.
Unknown upload acknowledgements are resolved by readback, never by overwriting
the object. Unknown publication acknowledgements require the same idempotent
request to be retried. Source or decoder mutation and mismatched readbacks fail.

The default decoder is pinned `mpg123-decoder@1.0.3` WebAssembly. It processes
bounded chunks, rejects decode errors/empty output, enforces input/PCM/duration
limits, clears PCM chunks and frees the decoder. It uses no native executable or
temporary audio file. A real read-only sample passed signature, extraction and
this decoder: **228,096 PCM frames at 8 kHz, 28.512 seconds**, exactly matching
the prior native duration/frame check and the same audio hash. Its two returned
PCM channels describe the decoder output, not the original file's channel count;
the earlier native inspection identified the original as mono. No listening,
transcription, storage upload, database mutation or source-file persistence occurred.

The coordinator passed 12 cases against actual offline PostgreSQL intake RPCs,
using synthetic signed messages and a controlled in-memory storage adapter:
admission before provider reads, decode required, changed receipt refused,
invalid fixture rejected by the actual decoder, partial-upload retry, exact
replay, corrupt readback, lost upload/publication acknowledgements, pause during
upload, mutation and historical-owner preservation. Four synthetic messages were
published in the disposable database. Successful fixture publication used an
explicit decoder test double; the real portable decoder was independently proved
against the provider sample. These are not hosted Storage or signed-in proofs.

Seven signature/extraction/decoder tests pass; dependency audit reports zero
findings at this observation. No hosted migration or capture has been enabled.
Remaining: deployed runtime/SDK and credential wiring, actual Storage acceptance,
verified routes and ownership, scheduling/coverage, larger-message handling,
independent backup coverage and signed-in owner/manager acceptance.
[Coordinator and portable decode evidence](evidence/learn-voicemail-import-coordinator-2026-10-11.json).

## Durable intake contract — local and TEST rollback verification, 21:40 UTC

Migration `20261101420000_learn_voicemail_private_intake.sql` adds a private
two-stage intake. It creates no routes or users and defaults every route to
disabled. Route facts record a verified provider signer, existing Gmail account
and recipient, mailbox, receipt-time interval, evidence and historical owner or
explicit manager-only access. Those facts are immutable; only the enabled switch
can change. A new historical route is required for changed ownership. No owner
is inferred from the current extension assignment.

`voicemail_intake_prepare` admits only service-role work under an enabled route,
active matching Gmail account and both Email/Phone capture controls. It retains a
canonical candidate and hashes with a stable reserved message ID. Separate email
copies retain separate original-source receipts but share the voicemail identity.
Changed content, hashes, owner snapshot, source-email reuse across routes or a
different provider reference raises a conflict rather than replacing evidence.
Prepared records and their source receipts have no client/operator SELECT grant.

The server must upload the original message to `learn-voicemail-sources` and audio
to the existing private `receptionist-voicemails` bucket, without overwrite; read
back both objects and verify their actual digests and sizes. Only then may it call
`voicemail_intake_publish`. SQL verifies receipt/digest agreement, private buckets,
object paths/sizes/MIME metadata, route and capture controls, then inserts the
voicemail and publishes the journal atomically. **SQL metadata is not a substitute
for hashing the stored bytes.** The upload/readback coordinator was still missing
at this milestone; see the subsequent local coordinator evidence above. Original-message size is
currently capped at 1 MiB; larger messages need an explicit supported path rather
than silent skipping. The new source bucket must join recovery/backup acceptance.

Offline PostgreSQL verified actual DDL, permissions, concurrent preparation and
publication, exact and conflicting replay, distinct source copies, missing or
changed storage metadata, wrong digests, Email/Phone pause, forced publication
failure rollback, owner reassignment, manager revocation, tenant isolation and
private storage even with a broad unrelated storage-read policy. Existing owner
snapshots and explicit manager access remain the only message-read routes.

The first hosted TEST rehearsal exposed a missing prerequisite: TEST 072 does
not contain the private voicemail foundation already present in production.
Rehearsing that existing foundation together with the new intake succeeded.
The final revision was rolled back at 21:40 UTC; all **124** existing datasets,
the original schema and foundation metadata were preserved. No TEST migration,
routes, users, storage objects, provider calls or credential changes persisted.
Hosted positive ingestion and signed-in acceptance remain unverified.

Evidence: [private-intake checks](evidence/learn-voicemail-private-intake-2026-10-11.json).
Reproduce offline with `python3 scripts/verify/learn-voicemail-intake-local.py`.
The fixed-TEST rollback runner is `scripts/verify/learn-voicemail-intake-rehearse.mjs`;
its explicit `--include-private-foundation` mode requires the observed absent
foundation, and records each migration digest in a separate exclusive journal.

## Signed content extracted — 11 October 2026, 21:29 UTC

The same original raw notification is now verified and MIME-parsed in one local
path. Its signed To list matches the account used for the Gmail read. The parser
extracts the notification fields, transcript and one MP3 attachment directly
from those verified bytes, rather than from a separately retained text copy.
The 57,285-byte attachment's SHA256 exactly matches the earlier fully decoded
28.512-second recording. No new audio decode or transcription was required.

The extractor caps raw bytes, MIME nesting/parts/headers, rejects wrong recipient
mailboxes, unsigned/altered or partial-body-signed messages, and requires one
supported attachment. Six local tests (two verifier regressions and four signed
extraction journeys) pass; the isolated pinned dependencies have zero npm audit
findings at this observation. The real check made one raw-message read, one
public DNS-key lookup and no writes/uploads. Message and audio stayed in memory.

This establishes **verified original content → parsed candidate/audio**, locally.
It does not establish the provider-account / private-mailbox association,
historical staff ownership, durable storage, deployed runtime compatibility,
recurring capture, coverage or signed-in acceptance. The signed recipient is
not a staff-access grant. Those remain the next steps; no voicemail importer is
live. [Extraction evidence](evidence/learn-voicemail-signed-extraction-2026-10-11.json).

## Original-message signature verified — 11 October 2026, 21:23 UTC

One original Gmail notification was read in memory and verified locally with the
pinned mailauth 7.3.0 verifier in strict mode. Its RSA-SHA256 signature used a
2048-bit public key from the previously observed provider Google signing domain.
It covered the complete MIME body and unique From, To, Subject, Date, Message-ID,
MIME-Version and Content-Type fields. This is direct cryptographic evidence,
independent of the notification's Authentication-Results text.

The same check rejected locally altered copies: changed subject, changed body
with a forged `dkim=pass` header, and a second From field. Only one public DNS key
lookup was needed; other domains were refused. Raw message/audio bytes stayed in
memory, were not uploaded or written to disk, and no records or access changed.
The first diagnostic attempt failed on a library result-shape mismatch; a local
fix and synthetic check preceded the successful second read of the same message.
This milestone used two raw-message reads in total, not two unique messages.

Two offline regression tests pass and the isolated diagnostic dependencies have
zero npm audit findings at this observation. This dependency is separate from the
application; compatibility with the deployed Edge runtime remains unverified.
The provider-account/signer association must be explicitly configured before
automatic import. Mailbox-recipient/historical-owner binding, extraction of the
verified raw MIME content, durable private import and scheduled capture remain
unfinished. The earlier parser used retained text; signature verification does
not retroactively authenticate that separately stored copy.

Evidence: [original-message signature and tamper checks](evidence/learn-voicemail-dkim-2026-10-11.json).
Reproduction: [isolated diagnostic](../../scripts/verify/voicemail-auth/README.md).

## Local parser verified — 11 October 2026, 21:18 UTC

The new `birchills_voicemail_email.ts` parser handles the observed subject/body
format, matching extension/caller fields, the system reference and provider
transcript. It labels the result `candidate_requires_verification`; email receipt
time is explicitly not the time the caller left the message. A bounded MIME
selector requires one MP3 attachment and rejects ambiguous or unsupported files.
The content fingerprint includes the audio hash and excludes email receipt time
so duplicate recipient copies can be compared later within a verified tenant and
mailbox. Durable deduplication is still to be implemented.

Six local tests and strict TypeScript passed. Three fresh read-only Gmail metadata
responses passed the real parser/MIME selector using retained source text plus
the freshly retrieved subject, receipt time and attachment metadata. This check
did not refetch email bodies or download more audio. The diagnostic's explicit
`--validate-parser` option uses a separate exclusive journal to preserve the
earlier observations.

The read-only stored binding audit found one extension match per sample, no
current owner and two explicit managers for each matching mailbox. It did not
establish a notification-recipient match or historical ownership. Missing stored
notification settings must not be interpreted as disabled provider notifications.
Do not infer ownership from an extension or give an old message to a new owner.
Sender verification, durable private import and owner/manager acceptance remain
unfinished; no production data, provider settings or access changed.

Evidence: [parser and binding checks](evidence/learn-voicemail-email-parser-2026-10-11.json).

## Verified email route — 11 October 2026, 21:06 UTC

**The earlier subject-only zero result did not exclude existing voicemail
notifications.** A new read-only snapshot of 18,570 stored emails found 112
messages claiming a Birchills sender domain. Of these, **77** use “New message”
subjects, have a voicemail/mailbox body hint and an attachment hint. None matched
the previous voicemail/voice-mail/voice mail subject query. No audio attachment
metadata or pointers were already stored by the general email importer.

Three newest direct-recipient candidates were checked through the existing,
company-bound Google Workspace credential, using Gmail read-only access. All
three returned one MP3-named attachment, with MIME `application/octet-stream`,
and sizes 57,285, 82,629 and 38,997 bytes. The observed subject and body agree on
mailbox extension; the body contains an automated transcription and a distinct
UUID-shaped system reference. The Gmail metadata includes one `mx.google.com`
authentication-results header per sample, with SPF and DKIM pass hints; no DMARC
pass result was observed. **Those hints are not an implemented sender verifier.**
The DKIM identity uses the provider's Google signing domain, so do not assume a
DKIM signing-domain match to the visible From domain.

One 57,285-byte attachment was retrieved using the existing read-only connection
and fully decoded locally: **28.512 seconds, 8 kHz, mono**, compared with the
notification's 28-second duration. Temporary original and decoded audio were
removed. No playback, transcription service, storage upload, database write,
mailbox setting change, credential upload or access grant occurred.

This establishes an observed notification/attachment route and changes the next
implementation step. It does not prove all notifications are authentic, historical
coverage, intended staff ownership or a working importer. The production audit
still found **zero imported voicemail records**.

Build the email adapter against this actual format: establish the trusted Gmail
header boundary and allowed provider sender; bind the received mailbox and
provider extension to the existing private mailbox record; use a stable system
reference plus tenant/mailbox scope for replay; retain source evidence and audio
integrity; snapshot the verified owner and retain explicit manager access. Unknown
sender, ambiguous identity, template changes and mismatched duplicates must stay
in review, not become tenant-wide communication cards. No audio may become public.
Treat imported email text, including transcripts, as untrusted source data.

Then verify bounded historical capture and recurring capture, message counts,
private playback, retry/recovery, duplicate handling and revocation with signed-in
users before calling voicemail live. Historical scope/retention still needs to
follow the customer agreement; the sample is not authority for an unrestricted
bulk import or new recipients.

Evidence: [real email route and audio check](evidence/learn-voicemail-email-route-2026-10-11.json).
Read-only diagnostics: `scripts/verify/learn-voicemail-provider-email-audit.mjs`
and `scripts/verify/learn-voicemail-gmail-sample.mjs`. Samples containing source
content and attachment references remain in ignored private verification files.

Official references: [Gmail message reads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
[attachment reads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments/get),
and [Sipcentric authentication](https://developer.simwood.com/docs/direct/api/v1/#authentication).
The Direct API documents use of the existing portal login; a separate voicemail
message endpoint remains unverified and is no longer the only candidate route.

## Existing implementation and observed gap

The current private voicemail tables, mailbox-owner snapshots, explicit mailbox
manager grants, RLS and audited short-lived playback links remain intact. They
are not an ingestion worker. The last read-only live inventory (9 October 2026,
18:11:35 UTC cutoff) found zero `receptionist_voicemails` rows. It does not establish
whether provider mailboxes are empty or whether voicemail notification emails
exist in the separately stored email history.

The older `/Users/chrisdrummond/serviceos-dh` source contains voicemail routing
and call classifications; the inspected paths did not reveal a reusable voicemail
message ingester. Existing call recordings must not be relabelled as voicemails.

## Provider contract and diagnostic

[Simwood's published Direct API v1 documentation](https://developer.simwood.com/docs/direct/api/v1/)
describes the account endpoint collection, phone and additional-mailbox endpoint
types, and an endpoint's `links.voicemail`. It does not specify a voicemail
message listing or audio-download schema. Message access therefore remains
unverified; the diagnostic does not invent a `/messages` API or follow child links.

`supabase/functions/_shared/sipcentric-voicemail-discovery.ts` implements bounded,
read-only discovery, invoked by `scripts/verify/learn-voicemail-discovery.mjs`:

- Requires an explicit provider account and a matching environment allowlist;
  never discovers and chooses the first accessible customer.
- Uses existing `SIMWOOD_USERNAME` / `SIMWOOD_PASSWORD` credentials in memory.
  The checked older checkout `.env.local`, `supabase/functions/.env.local` and
  `.env.verify` files did not contain these credentials. Database verification
  credentials are not provider credentials. No new secret has been requested,
  created, exported from production or embedded in source.
- GETs only the documented account endpoint collection, endpoint details, and
  optionally a voicemail resource explicitly linked by that endpoint. All requests
  use the fixed HTTPS provider origin with redirects refused. Documented HTTP
  links are accepted only when they match the exact path, then upgraded to HTTPS.
- Requires stable counts, page numbering, duplicate-free endpoint IDs, full pages
  and matching continuation links. Errors, drift, malformed responses and budget
  exhaustion fail rather than return a partial catalogue labelled complete.
- Limits each response to 2 MiB, each request to 20 seconds, the catalogue to
  2,000 endpoints, and a run to 40 requests by default (configurable up to 100).
- Outputs candidate endpoint IDs/types/enabled state and, only when requested,
  allowlisted structural field names. Unknown field names are counted, not printed.
  No names, emails, PINs, transcripts, credential values, raw provider errors or
  message payloads are retained. Rate-limit delays are returned without retrying.
- Always reports `messageCoverage: unverified`. A complete endpoint catalogue is
  not a complete voicemail inventory or a transactionally consistent snapshot.

Run in an already-authorized server environment containing the existing provider
credentials. Set `SIMWOOD_CUSTOMER_ID` and `VERIFY_ALLOW_SIMWOOD_CUSTOMER_ID` to the
same verified account, then run:

```sh
node scripts/verify/learn-voicemail-discovery.mjs
```

Set `VERIFY_INSPECT_VOICEMAIL_RESOURCE=true` to inspect linked resource structure;
`VERIFY_SIMWOOD_REQUEST_BUDGET` optionally sets the finite request budget. These
settings do not enable message capture. Do not paste credentials into commands or
logs. There are no database writes, provider mutations, routing changes, mailbox
provisioning, new access grants, storage uploads or transcript requests.

## Validation and next steps

Ten synthetic transport tests cover empty and paginated inventories, incomplete
pages, drift, duplicate IDs, foreign-account links, redirects, authentication/rate
limits, malformed/oversized bodies, privacy, opt-in inspection and exhausted
budgets. Standalone strict TypeScript and application TypeScript checks pass.
The CLI's missing-allowlist guard was exercised without any provider request.
No live provider acceptance or deployed ingestion is claimed.

Next, run discovery in the existing credential-owning environment. Verify message
and audio access from actual linked resources or provider documentation. Then
implement additive idempotent capture with retained source evidence, owner/access
snapshots, bounded replay and recording integrity checks. Preserve provider
messages even when source retention or mailbox ownership later changes; do not
mark messages read or delete them. Private voicemail access must not silently
become tenant-wide LEARN access. End-to-end capture, transcription, reconciliation
and ongoing scheduling remain incomplete.

## Existing email notification discovery — 10 October

`scripts/verify/learn-voicemail-email-audit.mjs` checks whether the existing imported
email history contains possible voicemail notifications. It is a read-only diagnostic,
not an importer or a substitute for the provider contract above. Server-side subject
matching covers `voicemail`, `voice mail` and `voice-mail`. Other subject wording,
body-only references and messages never imported into ServiceOS are outside its scope.

The audit requires the existing explicit project/tenant allowlist and first verifies
the tenant identity. It reads candidate IDs, direction and the existing attachment
hint; it does not retrieve subjects, bodies, sender/recipient addresses or raw
provider payloads. Attachment metadata reads are limited to those candidate IDs.
Filename/MIME indicators, positive size and storage pointers are reported separately:
none authenticates Birchills, establishes mailbox ownership or proves playable audio.
A mention of voicemail in an ordinary email is also a possible match.

Reads use a fixed Supabase origin, refuse redirects and time out after 20 seconds.
Each JSON response is limited to 2 MiB; scans use ordered unique IDs, 250-row pages,
a maximum of 20,000 rows per scan and a global budget of 200 HTTP requests. Exact
counts are checked before/after, and failed, partial, duplicate, cross-company or
changed-count results cannot claim complete query coverage. Stable counts cannot
exclude all concurrent edits and do not create a consistent database snapshot.
The report says `complete_for_subject_query`, never complete voicemail coverage.

Public output contains counts and company-scoped message fingerprints. Optional
private output retains only the original candidate IDs with those fingerprints,
using an exclusive file with mode 0600. Keep that file in ignored verification output.
No source content, filename, storage path, credential or provider error prose enters
the report. There are no database writes, storage downloads, provider requests,
transcriptions, messages to others or access changes.

Run with the existing secure verification environment (do not paste credentials):

```sh
node scripts/verify/learn-voicemail-email-audit.mjs .verification-results/voicemail-email-private.json
node --test scripts/verify/learn-voicemail-email-audit.test.mjs scripts/verify/learn-preservation.test.mjs
```

Seven new tests cover pagination/batching, safe projections, empty matches, failed
and oversized responses, company/identity isolation, duplicates, count drift,
attachment uncertainty and the global request budget. The five existing preservation
tests also pass. Live discovery results are recorded separately below.

### Live attempt and query cancellations

The first identity read failed; a separate identity read succeeded at 03:00:38 UTC.
The subsequent audit (03:00:46–03:01:55) could not establish either the email count
or candidate count. Its status is **unverified**. Zero observed candidates in that
report is not evidence of zero matching emails. The initial run predates the added
safe HTTP/transport failure categories in the diagnostic; those categories are
covered by the local tests.

A separate email-count HEAD returned HTTP 500 at 03:03:55. A GET count returned
HTTP 500 with SQLSTATE `57014` at 03:04:38. Read-only database activity metadata
at 03:05:30 showed no blocked client sessions or locks on the inspected source
relations; that later observation does not establish the cause of the earlier
cancellations. One bounded aggregate query through the existing management
read-only endpoint also failed (HTTP 544). No server timeout, role, query, schedule
or session was changed or cancelled to work around the failures.

The concurrent preservation check (03:01:55–03:04:25) was also **unverified** for
email, calls, recordings, transcripts, interactions, customers and recording
storage. It did verify the existing zero jobs, eight members, zero captured
voicemails, 30 email accounts and three tenant connectors. Failed reads are not
missing rows. The earlier successful 00:40–00:41 inventory remains the last verified
comparison for the larger sources: 18,456 emails, 4,324 calls and 2,882 recordings.
This step made no production mutation and does not claim a fresh preservation proof.

Evidence: [candidate audit](evidence/learn-voicemail-email-audit-2026-10-10.json),
[partial preservation check](evidence/learn-preservation-voicemail-email-2026-10-10.json),
[read-only wait/lock metadata](evidence/learn-source-read-timeouts-2026-10-10.json),
and [verification and failed-read diagnostics](evidence/learn-voicemail-email-verification-2026-10-10.json).

Next, establish why these bounded source reads are cancelled and repeat the audit
when reads are available. If actual candidate notifications exist, inspect a
specifically scoped authorised sample to verify message identity, sender
authentication, mailbox identity and audio retrieval. Do not infer a usable
voicemail-to-email connector from a subject match or attachment flag.

A follow-up [preservation-reader improvement](LEARN-SOURCE-PRESERVATION.md) removes
redundant page counts and adds matching double scans. Its small count-free live pilot
also timed out, so this does not resolve the candidate-discovery or live-availability
gap above. No further full source scan was started after that pilot failed.

At 03:55–03:56 UTC, the intended live-input recheck again stopped at the REST
tenant identity read, before email or Slack metadata scans. Management project
metadata returned `ACTIVE_HEALTHY`, but one bounded read-only database identity
query returned HTTP 544. This does not identify a cause or prove lost records.
No further source scan or provider request was started. See
[availability evidence](evidence/learn-live-input-availability-2026-10-10.json).

## Successful live recheck — 10 October, 18:30 UTC

The tenant identity read and bounded subject audit responded successfully. At
18:30:20 UTC, 18,501 stored emails contained **zero** subjects matching voicemail,
voice mail or voice-mail. The six-request audit completed without read failures.
This rules out those subject candidates only; it does not prove the provider has
no voicemail or that other subject formats/body-only notifications are absent.
No message bodies, audio or provider resources were retrieved.

The following preservation inventory completed two matching keyset scans with
149 requests and no read errors. It found 18,501 emails, 4,328 calls, 2,882
recordings/transcripts, 22,841 interactions and 3,159 cards. All original baseline
IDs and recording pointers remained present, and all 2,882 pointers matched stored
objects. There are still zero captured voicemails and six failed transcripts.
This supersedes the earlier availability uncertainty for this observation, but
is not a backup, restore proof, full-row content audit or playable-audio check.

Evidence: [subject audit](evidence/learn-voicemail-email-audit-2026-10-10-recheck.json)
and [preservation comparison](evidence/learn-preservation-voicemail-email-2026-10-10-recheck.json).
The supported provider message/audio feed remains the required next step.

## Official documentation and SDK recheck — 11 October

The current [Simwood API overview](https://simwood.com/api/) explicitly keeps
Hosted PBX on the separate Direct API. The newer gateway's Bearer-token contract
therefore does not replace this connector's documented Basic-auth contract.
The [Direct v1 reference](https://developer.simwood.com/docs/direct/api/v1/)
still documents mailbox email notifications and endpoint voicemail links without
a message-list/audio schema. The [official Node client page](https://developer.simwood.com/docs/direct/clients/node/)
links to Sipcentric's SDK. At commit `99217b20dd2ca58bffc3bf7165538106cf0cc9d0`,
its complete file index has no voicemail-specific resource, and
[`endpointList.js`](https://github.com/sipcentric/node-pbx-client/blob/99217b20dd2ca58bffc3bf7165538106cf0cc9d0/lib/api/endpointList.js)
only declares an endpoint collection. These checks do not establish an alternative
supported message feed or prove that one does not exist. No provider request,
credential change or mailbox mutation was made. Supported message/audio discovery
remains required; ordinary call recordings must remain distinct from voicemail.


## Public contract recheck — 11 October 2026

The provider's [archived Sipcentric API reference](https://github.com/sipcentric/pbx-api-docs/blob/master/api/v1.md)
still documents per-extension voicemail enablement and a linked voicemail
resource. This reference alone does not establish a complete message-list,
pagination, retention or audio-download contract. The
[Nimvelo/Sipcentric Python client reference](https://github.com/Nimvelo/python-client)
lists endpoints and recordings but does not document voicemail message retrieval.
No new provider request was made and no guessed message endpoint was implemented.

A search result titled “Read Voicemail” on `pbx.readme.io` names a different
`dashmanager.com/ns-api` service; it is not evidence for Drummonds' Sipcentric
account and must not be used as this adapter's contract. Existing email discovery
remains a bounded diagnostic rather than proof of complete voicemail capture.


## Authenticated portal observation — 11 October 2026

Following Chris's 1Password unlock, an existing Birchills login was located. The
portal opened with an existing signed-in Drummonds session. Three shared mailbox
definitions and the call-recording report were visible. A mailbox detail view
exposed notification-email and greeting configuration, but this inspection did
not establish a voicemail-message listing or audio API contract. No settings were
changed, credentials copied, messages played or audio downloaded. The observations
are retained privately; customer identifiers and credential values are not in Git.

A Supabase dashboard login was also located, but the database password needed for
the real database restore was not identified. Portal login, API authentication and
database authentication remain separate verification gates.
