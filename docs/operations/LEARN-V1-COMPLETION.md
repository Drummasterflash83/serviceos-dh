# LEARN V1 delivery and acceptance checklist

This is the authoritative remaining-work checklist for Chris's 11 October 2026
goal: complete and launch Drummonds' LEARN V1 through OpenFolk. Detailed component
documents retain implementation history; their older status statements do not
override a later release observation. No requirement is silently deferred.

## Current evidence and priority

**12 October, 00:54 BST — historical private-message discovery installed in TEST (077).**
An actual SQL regression showed that previous owners could read their retained
messages under RLS but could not find them through the current-mailbox summary.
The new SECURITY INVOKER reader paginates already-visible mailbox/message groups.
Historical-only groups contain no current notification address, extension, name or
sync settings. The new owner still sees only their messages; an ordinary company
owner has no mailbox bypass. Manager grant/revocation and foreign-tenant denial
passed in the actual TEST schema. Both rehearsal and installation preserved all
140 datasets; all banned/passwordless probe fixtures rolled back, with no sessions
or persistent access created. Local UI checks cover 20+3 mailbox pagination and
historical message detail; 18 regressions, full TypeScript and build pass. Matching
frontend deployment and actual signed-in playback remain separate gates.
[Evidence](evidence/learn-voicemail-inbox-history-2026-10-12.json).

**12 October, 00:47 BST — private inbox entry deployed to protected TEST.**
Deployment `dpl_3axjgqPF1VNeXaRWzGANk7cvMzja` is READY from
`de4bcd98dba0c70d87069ff9b554130d79b7f7b3`; the stable TEST alias points to it.
Both hostnames' homepage, login and LEARN routes require Vercel authentication.
The backend and private mailbox permissions did not change. This supersedes only
the frontend deployment status below, not its outstanding provider/playback and
signed-in acceptance limits. [Deployment evidence](evidence/learn-voicemail-inbox-test-2026-10-12.json).

**12 October, 00:46 BST — LEARN private voicemail entry and reader verified locally.**
LEARN now opens the existing owner/manager inbox directly, without copying private
messages into shared customer cards or scoring. The reader rejects unavailable
summaries, unknown counts, truncated pages and company/mailbox mismatches. Account
or company changes discard selection/details/playback state; unused private query
data is removed from the query cache. The actual dialog was exercised locally with
synthetic responses: paging, details, recording failure, mailbox failure, missing
count and a delayed response after account switching all behaved as expected, with
no browser console errors. Fifteen tests, full-project TypeScript and build passed.
This is frontend/local evidence only; hosted signed-in playback, provider capture,
historical mailbox ownership and private customer-context linkage remain open.
[Evidence](evidence/learn-voicemail-inbox-local-2026-10-12.json).

**11 October, 23:39 UTC (12 October, 00:39 BST) — matching voicemail controller frontend deployed to protected TEST.**
Vercel deployment `dpl_HguNFttZTsfCoj6ZzHtpCqf9knNM` is READY from Git commit
`89c44585824c2effc06a485be608f7cc13db7fbd`. The stable TEST alias points to this
deployment. Homepage, login and LEARN paths on both hostnames redirect to Vercel
authentication. Full-project TypeScript exits successfully. This closes the
frontend-deployment gap in the earlier entry below; it does **not** prove signed-in
acceptance or real scheduled voicemail capture. No production change was made.
[Frontend deployment evidence](evidence/learn-voicemail-frontend-test-2026-10-12.json).

**11 October, 23:29 UTC (12 October, 00:29 BST) — bounded voicemail dispatch and operator status backend verified in TEST.**
Release 076 installed after full-schema rollback rehearsal, preserving all 139 prior
datasets. Worker v19 and importer v2 then deployed with all 140 datasets and other
endpoints preserved; both installed sources match the pinned bundle. Ten hosted
HTTP/RPC checks pass, including idle no-write discovery and denied unauthorised access.
The dispatcher advances at most two routes/five pages each per UTC minute and uses
saved receipts, route backoff and existing capture gates. **No TEST cron or real
routes were activated.** Draft rejection is now in both hosted import paths.

OpenFolk's voicemail status component is built and browser-checked **locally with
synthetic responses**, showing notifications, source review, drafts, import states,
worker scan timestamps and recovery guidance. Actual offline SQL verifies the existing
OpenFolk view grant, expired/View-As denials, pagination and zero private-message
access for an operator without ownership/manager rights. Fourteen regressions,
strict worker/UI types and the frontend build pass. **Matching frontend deployment,
positive hosted scheduled imports and signed-in acceptance are still outstanding.**
[Evidence](evidence/learn-voicemail-dispatch-2026-10-12.json).


**11 October, 23:08 UTC (12 October, 00:08 BST) — retained voicemail discovery installed in TEST.**
Release 075 passed a full-schema rollback rehearsal, then installed empty private
scan/candidate/receipt tables and internal RPCs with all 136 prior datasets preserved.
Local PostgreSQL checks cover bounded enumeration, lost replies, legacy-binding
review, draft exclusion, late inserts, corrected metadata, route ambiguity and
atomic enqueue/progress. A discovered synthetic email also completes the existing
queue → Workspace bridge → actual signature/MP3 decode → private publication journey,
including lost publication acknowledgement and provider-free replay. Twenty-seven
Node regressions and strict worker types pass. **No hosted discovery dispatch,
schedule or real capture was activated.** The new draft rejection is local runtime
code; hosted worker remains v18. Next: scheduling/controller integration, positive
hosted discovery, verified real routes, signed-in acceptance and recovery. Retained
scan completion never claims provider coverage. [Evidence](evidence/learn-voicemail-discovery-2026-10-12.json).


**22:52 UTC — synthetic voicemail queue import verified against hosted TEST.**
The production queue adapter/coordinator and real signature/MP3 decoder ran locally
against hosted TEST SQL and private Storage. One generated voicemail published with
one settlement receipt and two exact-hash files. Deliberately losing the publication
reply recovered success; replay after retirement loaded no source again. A foreign
tenant claim was rejected before loading, and anonymous/public/unentitled SQL-role
access was denied. All 136 prior datasets were preserved using exact test-row/object
exclusions. No login or owner/manager access was created; the fixture tenant is
archived, its route off and email-account metadata disabled. **This does not prove
real Gmail/Birchills capture, deployed-worker positive dispatch or signed-in playback.**
Enumeration/coverage, real route authority, credentials and backup acceptance remain.
[Evidence](evidence/learn-voicemail-queue-import-2026-10-11.json).

**22:45 UTC — voicemail queue installed in hosted TEST; boundaries verified.**
Release 074 passed rollback rehearsal and installed with all 134 prior datasets
preserved. Platform worker v18 deployed with 136 datasets and other endpoints
preserved; downloaded source matches 101 emitted modules/159 imports. Six HTTP/RPC
checks pass through the existing exact internal-header path: unauthorized callers
are denied, the empty voicemail worker claims zero jobs, empty recovery changes
nothing and a missing claim is rejected. A bearer-only request returned 403 and is
recorded separately; auth rules were not changed. No jobs, routes, users, credentials
or provider capture were added. **Positive hosted voicemail import remains unproven**;
next is a synthetic SQL/Storage queue journey before real-route activation. [Evidence](evidence/learn-voicemail-queue-hosted-2026-10-11.json).

**22:35 UTC — durable voicemail queue prepared and verified locally.** The existing
platform worker now has a one-message voicemail path with frozen source binding,
lease checks and atomic voicemail publication/job settlement. Thirteen actual
PostgreSQL/coordinator scenarios pass, including lost replies, simultaneous delivery,
partial uploads, changed payloads, pause/resume and dead workers. Five reclaim
regressions, 28 existing regressions, strict worker types and queued/direct offline
Edge checks pass. Queue recovery never presents an old receipt as fresh coverage.
This change is **not installed in TEST or production**; TEST remains at 073 and
platform worker v17. Full-schema/hosted release acceptance, enumeration/coverage,
verified routes and real-user acceptance remain. [Evidence](evidence/learn-voicemail-queue-local-2026-10-11.json).

**22:20 UTC — voicemail foundation/runtime/storage verified in hosted TEST.**
Release 073 installed empty private tables after rollback rehearsal, preserving 127
existing datasets. The internal endpoint v1 deployed with 134 datasets and all other
endpoints preserved. Hosted checks deny unauthenticated/anonymous intake, malformed
internal calls and unknown routes; source readback matches 19 emitted modules and
23 imports. Two synthetic files (generated MP3 plus signed email) round-trip through
private hosted Storage with exact hashes and anonymous/public denial. They are retained
as marked TEST evidence, with no tenant/mailbox/route/voicemail row. No provider request,
credential upload, user access grant, schedule or production change occurred. Integrated
publication, real mailbox ownership/provider acceptance, queue/discovery/coverage,
backup and signed-in journeys remain required. [Evidence](evidence/learn-voicemail-hosted-test-2026-10-11.json)
and [release/rollback scope](LEARN-VOICEMAIL-DISCOVERY.md).

**22:09 UTC — voicemail provider bridge and internal endpoint prepared, local only.**
The importer now reuses the existing Workspace credential checks, verifies Gmail
profile identity and loads one bounded original message after route/capture admission.
The internal HTTP handler rejects user/forged tokens before any credential or provider
work. Its safe result states distinguish missing delegation, denied access, unavailable
source and unconfirmed publication. Twenty-eight regressions, strict worker types and
an actual offline Edge worker check pass; the latter uses controlled Gmail/storage
transports and a synthetic signed recording. No hosted deployment, queue registration,
schedule, real route, credential or production change occurred. TEST foundation/intake
installation, actual hosted Storage, durable queue/discovery/coverage and real-owner
acceptance remain outstanding. [Evidence](evidence/learn-voicemail-workspace-bridge-2026-10-11.json)
and [integration scope](LEARN-VOICEMAIL-DISCOVERY.md).

**22:01 UTC — voicemail runtime integration, local evidence only.** Shared server
code now handles signed source verification, MIME extraction, MP3 decoding and
private import coordination in both Node and Supabase Edge Runtime. An actual
offline Edge user worker passed a generated 28-second recording through the full
coordinator with controlled storage transport, including real WebAssembly decode,
tamper rejection and hash readbacks under a 2-second hard CPU limit. Explicit
Buffer imports fix the deployment incompatibility the check found. Seven Node
regressions and actual PostgreSQL intake/failure tests still pass. No hosted or
production change was made. Authenticated worker/provider wiring, hosted Storage,
route ownership, coverage, backup and signed-in acceptance remain required.
[Evidence](evidence/learn-voicemail-edge-runtime-2026-10-11.json) and
[scope/next step](LEARN-VOICEMAIL-DISCOVERY.md).

Latest scoped production observation: **11 October 2026, 14:33 UTC**.
[Read-only capture inventory](evidence/learn-current-capture-2026-10-11.json)
shows **18,548 emails, 4,328 calls, 2,882 recording rows, 3,165 cards and zero
canonical jobs**. Compared with the morning counts, email inventory grew by 37
and card inventory by five. This is not an identity-preservation comparison.
Among the newest 200 email runs, Workspace capture includes 138 successful and
14 failed runs, with latest success at 14:33 UTC and latest failure at 14:31 UTC;
other run types account for the remaining observations. The newest 200 Phone runs
are successful call/recording/scheduler receipts through 14:30 UTC. These bounded
samples do not prove provider coverage or resolve the known mailbox failures.
The observation issued no provider requests and made no production writes.

Earlier combined production/TEST audit: **11 October 2026, 06:07 UTC**.
[Sanitized baseline](evidence/learn-launch-baseline-2026-10-11.json), reproduced with
`node scripts/verify/learn-launch-baseline.mjs --read-only-production-and-test`.
This reads aggregate source counts and configuration/catalog metadata, never
message bodies, audio, provider credentials or source paths. It changes nothing.

- Production retained inventory: 18,511 emails, 4,328 calls, 2,882 recording rows,
  3,160 customer cards, zero canonical jobs. Counts alone are not preservation or
  provider coverage; retain the separate source-ID comparison before releases.
- All 30 production email accounts are Gmail: 29 Workspace DWD accounts, one
  revoked OAuth account. Two Workspace connections are active; recent Workspace
  capture runs report both success and failure. Account auth_state `unknown` is
  not itself a DWD credential failure. Last success is not complete coverage.
- Workspace inventory contains 30 active users, 12 pending users and one pending
  suspended mailbox, all marked sync enabled. Reconcile eligibility per mailbox;
  do not silently count pending/suspended users as captured.
- The revoked OAuth account remains eligible for the old scheduler by status.
  Production has 4,485 dead-letter OAuth jobs and a queued OAuth job. Their
  aggregate presence does not establish every failure's cause. Local scheduler
  now skips auth states outside `ok`/`unknown` and records skipped counts in the
  scheduler heartbeat. Three actual-handler regression tests pass; not deployed.
- Recording storage metadata totals **601,004,261 bytes** across 2,888 objects;
  all objects have known metadata sizes. Objects created in the last 30 days
  total 312,897,776 bytes; backfills may be included, so this is not a growth forecast.
- At the 06:07 audit, TEST ledger ended with correction recovery release 053. Gmail
  endpoints v4, platform worker v5, Slack worker v8, Commusoft workers v4 and Phone
  sync workers v6 are ACTIVE. Deployment status is not positive capture acceptance.
  Microsoft journal tables are absent in TEST; that connector remains local only.

**Next delivery order:** verify Drummonds' Google capture/authority and scheduling;
finish the bounded Commusoft import and customer/job publication after required
access approval; prove a signed-in customer/card journey; then close Phone,
voicemail, Slack, scoring and operational acceptance. Microsoft stays in scope
as a reusable connector; no Microsoft mailbox has been identified for Drummonds.

### Voicemail route discovered — real read-only checks, 11 October, 21:06 UTC

**Coordinator update, 21:47 UTC:** local code now connects verified raw extraction
to decode, intake, immutable uploads, byte-hash readback and publication. Twelve
orchestration cases passed against actual offline PostgreSQL with controlled
storage faults; the portable decoder separately decoded the real signed sample
to 28.512 seconds without native tools or files. Hosted Storage/runtime acceptance,
verified routes, installation, scheduling/coverage, backup coverage and signed-in
acceptance remain. [Coordinator evidence](evidence/learn-voicemail-import-coordinator-2026-10-11.json).

**Private intake update, 21:40 UTC:** the new service-only preparation/publication
contract passed actual offline PostgreSQL privacy, retry, concurrency, pause,
conflict and atomic-failure tests. The hosted TEST rehearsal needed the existing
private-voicemail foundation, absent in TEST 072; both migrations then rehearsed
and rolled back with all 124 existing datasets and schema preserved. No users or
routes were seeded. The worker's upload/readback integration, route verification,
installation, scheduling, coverage and signed-in acceptance are still unfinished.
[Private-intake evidence](evidence/learn-voicemail-private-intake-2026-10-11.json).

**Signed extraction update, 21:29 UTC:** the locally verified original message
now supplies the parser's text and audio directly. Its signed recipient matches
the Gmail account, and the extracted audio hash matches the earlier complete
decode. Six local verification/extraction tests pass. Private-mailbox binding,
historical ownership, durable ingestion and deployed acceptance remain required;
no production records changed. [Signed extraction evidence](evidence/learn-voicemail-signed-extraction-2026-10-11.json).

**Signature update, 21:23 UTC:** one original Gmail notification's complete-body
signature verified locally against the observed provider signing domain. Changed
subject/body and duplicate From checks were rejected. Two reads of the same
message were used after fixing a local verifier integration error; raw content
was not persisted. This establishes a cryptographic route, not a deployed sender
verifier or an authorised mailbox/owner binding. Extracting and importing the
verified raw content still needs implementation.
[Signature evidence](evidence/learn-voicemail-dkim-2026-10-11.json).

**Local implementation update, 21:18 UTC:** the notification parser and bounded
MP3 metadata selector passed six local checks, strict types and all three real
Gmail metadata samples against retained source text. The stored mailbox bindings
have explicit managers but no current owner, and do not establish historical
ownership or the notification recipient. No importer was deployed or activated.
[Parser evidence](evidence/learn-voicemail-email-parser-2026-10-11.json).

A broader audit found 77 retained Birchills-domain “New message” notification
candidates with voicemail body and attachment hints. The previous voicemail-only
subject search missed that format. Three direct Gmail metadata reads verified
consistent mailbox/transcription/system-reference structure and MP3 attachment
references. One 57,285-byte attachment fully decoded locally to 28.512 seconds of
mono audio; temporary files were removed. No production data or access changed.

This provides an observed email route for implementation. Sender authentication,
mailbox/owner binding, idempotent private import, coverage, scheduling and signed-in
acceptance remain required. The production audit still found zero imported
voicemails; neither these samples nor their authentication-header hints prove a
live connector. [Evidence and next implementation step](LEARN-VOICEMAIL-DISCOVERY.md).

### Operator email availability — TEST 072, 11 October, 20:55 UTC

The operator health reader now returns company-wide retained-email counts:
available and unavailable at the last recorded observation, unverified
availability, unverified mailbox binding, and earlier source versions. Older or
malformed observations stay unverified. The account page limit does not truncate
these totals. Source contents and provider identifiers remain private; existing
platform authority and function permissions are unchanged.

The installed TEST function and aggregate were verified against retained synthetic
history; all 124 pre-existing datasets were preserved. Eleven client checks,
actual isolated SQL authority/tenant/pagination checks, TypeScript and the frontend
build passed. The protected frontend is deployed from Git `59077dafbe1419853d971baa92aa73ec0078e549`,
READY at 20:57 UTC. Anonymous and service-role HTTP requests correctly receive
401/403 access denials. Positive operator HTTP and signed-in acceptance remain pending. No actual provider requests or production changes occurred.
[Retention status evidence](evidence/learn-email-retention-health-2026-10-11.json).

### Gmail ongoing state changes — TEST 071, 11 October, 20:50 UTC

The TEST capture worker handles Gmail label additions/removals and provider
absence, as well as new messages. New continuation v4 generations reconcile the
current mailbox and then refetch touched messages; in-flight v2/v3 tokens retain
their original query. Prior source versions are archived privately before updates.
Confirmed 404/410 observations retain the captured content and source identity;
newer history wins, unknown storage acknowledgement leaves the old cursor, and
cross-mailbox source collisions stop for review.

**Verified:** 21 reader/store checks; 73 actual-engine/SQL checks; strict local
worker types; full hosted TEST-schema rollback rehearsal including a draft-to-sent
change through source publication to a customer card. All 121 preservation datasets,
schema and existing authority were restored. No actual provider calls occurred.
**Now installed in TEST:** release **071**, worker **v17**, card refresh v2 and
Workspace discovery v3. The compatible worker was installed before schema v4
activation. All 92 emitted runtime modules matched reviewed source and all 21
reader/store tests passed against the downloaded runtime. Installation preserved
all 123 pre-existing datasets; the new private source archive brings the inventory
to 124. No existing provider connection was activated.

A bounded hosted HTTP check passed all 12 storage/protocol calls: unsigned and
foreign-context denial, retained draft source history, repeated absence
idempotency, restoration by newer sent content, stale-absence rejection, durable
cursor and atomic job completion. All 124 pre-existing datasets and the schema
were preserved. Its synthetic tenant is archived, account disabled and jobs
retired; no Auth users, grants or provider calls were created.

**Still open:** real Gmail/Edge capture acceptance, signed-in customer review,
signed-in availability presentation and unavailable legacy-message reconciliation.
The archive is included in release preservation and database recovery procedures;
actual database restore remains blocked on recovery credentials.
[Deployment and acceptance evidence](evidence/learn-email-mailbox-changes-2026-10-11.json).

### Credential discovery and phone portal — 11 October

After Chris unlocked 1Password, the existing Birchills portal login and Supabase
dashboard login were located in the Allkin account. No database credential was
identified in the inspected Supabase item; a `postgres` search returned no matches.
This is a focused search, not proof that no database password exists anywhere.

The Birchills portal's existing signed-in Drummonds session exposes three shared
mailbox definitions and the call-recording report. No credentials were copied,
provider settings changed or audio downloaded. Portal access does not establish
API authentication, mailbox ownership for staff access, voicemail message/audio
API support or complete capture coverage. Those checks remain required.

### Current protected TEST frontend — 11 October, 20:57 UTC

The stable entry is [serviceos-learn-test-allkin.vercel.app](https://serviceos-learn-test-allkin.vercel.app).
It resolves to READY deployment `dpl_CrDen3D6UrzuykQgSnKZdg7ayxBg`, built from
Git SHA `59077dafbe1419853d971baa92aa73ec0078e549`. The immutable preview is
`serviceos-learn-test-lz3vdjsah-allkin.vercel.app`. Both are Vercel protected; their
home, login and LEARN routes redirect to Vercel authentication. The preview-only
backend remains TEST `saatxzwxvdvqevbnskxy`, paired with release 072/worker v17/card
refresh v2. The frontend includes the draft advice and bounded-evidence explanation.

TEST Auth uses the stable exact `/login?reset=1` recovery target, preserving the
previous exact recovery URLs and every other setting. This does not reactivate
Chris's disabled TEST account or send a reset email. The prepared ongoing owner
access request and browser acceptance remain pending. No production change occurred.
[Latest frontend evidence](evidence/learn-email-retention-health-2026-10-11.json);
[earlier Auth configuration evidence](evidence/learn-card-frontend-test-2026-10-11.json).

### Remaining launch work — 11 October, 20:17 UTC

| Requirement | Evidence now | What still closes the gate |
|---|---|---|
| Google and Commusoft input coverage | TEST runtime and retained-source pipelines verified; existing real capture/import history retained | Approve the prepared Google credential destination and bounded Commusoft continuation; finish real historical/incremental coverage and reconciliation |
| Phone, voicemail and Slack | Phone source pipeline/playback tested; real recording inventory backed up; Slack adapter exists | Recover authorised provider credentials, verify real Phone processing, implement the observed voicemail email route with verified sender/owner binding, connect authorised Slack workspace/channels |
| Customer cards and scoring | Hosted synthetic source-to-card refresh and isolation pass; configurable scoring and review are implemented | Signed-in Drummonds review, reliable staff/job evidence, calendar/criteria approval and legacy derived-data reconciliation |
| OpenFolk controller | Scoped controls, diagnostics and recovery tested locally/TEST | Approve ongoing TEST owner access; verify real signed-in operation and customer branding |
| Recovery and recurring operation | Recorded audio inventory and independent restore verified | Real database restore with record links, confirmed scheduled runs and durable operational ownership |
| Release | Git backups and staged TEST backend and matching protected frontend deployed | All above acceptance, development dependency review, concrete production approval, deployment and live monitoring |

The frontend release checks passed (`npm install`, `npx tsc --noEmit`, `npm run build`).
Compatible transitive dependency updates reduce the production-dependency audit
from five findings to zero. The full audit drops from 15 to nine findings, all in
development tooling. This is not a complete security assessment; the remaining
build-tool chain still needs review. The pinned Lovable configuration stays at
2.6.4 and its packages remain installed. TypeScript/build passed again after updates.
[Dependency evidence](evidence/learn-dependency-patch-audit-2026-10-11.json).

The existing stable TEST alias `serviceos-learn-test-allkin.vercel.app` was verified
to point to the READY TEST deployment and preserve Vercel protection on home/login/
LEARN routes. TEST recovery now points to its exact `/login?reset=1` path; previous
exact recovery URLs remain allowed. All other Auth settings are unchanged. No
account, grant, password or email was created or changed. Browser/sign-in acceptance
and the existing owner-access decision remain pending.

### Existing draft influence and card refresh — TEST 070, 11 October, 20:11 UTC

The read-only production impact audit at **19:57 UTC** found 55 enriched draft
interactions, 54 linked to people, four directly linked recommendations and 95
match suggestions. Person/company associations reach 178 cards; this is a broad
review scope, **not 178 proven incorrect cards**. None had an exact draft-summary
or latest-timestamp match, none had locked fields, and their priority inputs were
legacy/unversioned. The three production measurements had no exact draft UUID
references; that does not prove absence of historical influence. No saved assessment
table was present in this audit's production metadata. Source bodies, identities,
card text and score values were not returned. Initial aggregate scans timed out;
the completed bounded audit uses direct recommendation/suggestion links.
[Aggregate evidence](evidence/learn-email-draft-impact-2026-10-11.json).

The separate card-refresh handler still read all canonical interactions, so it
could reintroduce retained drafts into card activity, response timings and timelines
after TEST 069's publication fix. TEST 070 now uses one tenant/card-bound
SQL input read, filters drafts before the recent windows, excludes directly linked
draft recommendations without deleting them, and reports full eligible counts.
Recent response timing remains a bounded communication estimate, not a staff score.
An unlocked stale latest-activity value can become null; locked/manual fields and
context remain. Compare-and-set writes reject concurrent card edits or missing rows.

The actual SQL/handler/calculator/saved-card journey passes with 110 drafts, 105 valid
interactions and 51 valid recommendations. Twelve handler/snapshot tests, strict
worker types and the local frontend build pass. The full hosted TEST rollback
rehearsal preserved all 121 datasets and removed its synthetic fixtures. The exact
package was then installed, followed by `platform-worker` v16 and `customer-card-sync`
v2. Downloaded source matched reviewed runtime (92 and 6 modules respectively), and
nine actual-handler tests passed against each download. Unsigned calls returned
403/401. No other endpoint or source changed during deployment.

The positive hosted **service-to-service** check then passed: tenant mismatch 403,
cross-tenant card lookup empty, and one synthetic card refreshed over HTTP with
110 drafts excluded and 105 valid interactions retained. Job completion and saved
projection evidence were checked. All 123 pre-existing datasets (adding explicit
recommendation and match-suggestion tracking) were preserved. Two successful-run
synthetic tenants were archived, with no users, grants, provider calls or live jobs.
An earlier harness attempt omitted the existing internal header; its fixtures were
also archived. A second attempt rolled back on a synthetic-slug collision; the final
run used unique slugs and the digest-verified existing key, with no credential changes.
This is not signed-in acceptance. Frontend explanatory copy is deployed in the
20:19 TEST release below; browser acceptance remains pending. Legacy
priorities, indirect recommendations and reviewed identity suggestions still need
explicit reconciliation rather than blanket deletion.
[Verified evidence and release sequence](evidence/learn-card-draft-projection-2026-10-11.json).

### Drafts retained without being treated as replies — TEST 069, 11 October, 19:51 UTC

A read-only production metadata check found **55 Gmail draft messages, all with
canonical interactions**. This is not evidence of 55 incorrect staff scores; it
identifies source records that must not be treated as sent replies. Production
remains unchanged. Google's documented send flow replaces a draft with a new sent
message ID, so both source records may legitimately be retained.

TEST 069 preserves draft bodies/labels, gives new drafts no sent timestamp or
outbound direction, and excludes drafts from customer communication publication,
identity/card delivery, restricted card excerpts and new activity counts. Existing
source/canonical records and receipts are retained. Direct publication and operator
attribution cannot bypass the source classification; known retained drafts do not
count as actionable processing failures. Source revisions include the classification
so a later correction is reassessed instead of remaining behind a stale hold.

The actual parser/handler/durable-queue/card journey passes locally, including
reply-loss recovery, legacy draft rejection, restricted reader access, unchanged
source bodies and correction recovery. Fourteen Gmail-reader and fifteen review-client
regressions pass, alongside 65 actual email-engine/durable SQL checks. The page
store accepts unknown direction only for a labelled draft with no sent timestamp.
The full TEST schema rehearsal rolled back with all 121 datasets
and original permissions restored. The exact package was then installed with
all 121 datasets preserved. Worker v15 was deployed and downloaded: all 92 runtime
modules matched reviewed source, 145 emitted imports were checked, and the three
pruned dependencies have no emitted runtime importers. All 14 reader tests passed
against the download; unsigned POST returned 403. No capture, provider calls,
credentials, users or production changes occurred. Frontend explanatory copy is
deployed to protected TEST at 20:19, with signed-in acceptance pending. Production card
summary/aggregate reconciliation remains a required release gate; current label
changes, Spam eligibility and real-provider acceptance are still unfinished.
[Evidence](evidence/learn-email-draft-eligibility-2026-10-11.json).

### Mailbox-wide Gmail capture — installed in TEST, 11 October, 19:24 UTC

The recent Gmail reader previously filtered both reconciliation and incremental
history by Inbox/Sent. That could omit automatically archived/filed communications.
Continuation v3 now uses one unfiltered mailbox traversal, explicitly includes
Spam/Trash during listing, and retains their source labels. New protocol accounts
and completed v2 generations must first reconcile; an old label-limited cursor
cannot establish mailbox-wide coverage. In-flight v2 pages and their receipts are
not rewritten. Historical backfill retains its original pagination scope; the new
recent reconciliation fills its gaps. Incremental capture covers message additions;
this is not a deletion/label-state mirror or recovery of already purged provider data.

All 64 actual-engine/durable-SQL checks and 13 page-reader checks passed locally,
plus the strict installed-SDK TypeScript check. The exact 068 package passed a
full-schema TEST rollback rehearsal, preserving all 121 existing datasets. The
existing migration administrator needed transaction-only inheritance of the
protocol-owner role to replace its function; that temporary membership was removed
before assertions, with original role memberships, function owners and ACLs verified
identical. No application access was created. Package SHA-256:
`ccb31394a7e482321c5a3c72dc78604692c57f5d5371617301881c763b1f4c10`.

TEST release **068** is installed with **worker v14**, preserving all 121 datasets.
Downloaded runtime comparison matched all 92 runtime modules; three pruned modules
have no emitted runtime importers. The downloaded Gmail reader passes the same 13
checks, and an unsigned worker POST returns 403 without processing a job. Original
memberships, function owners and ACLs match after installation. Real-provider
Google acceptance remains blocked by the pending credential-destination approval.
No production change or claim of complete real mailbox coverage is made.
[Evidence](evidence/learn-email-mailbox-coverage-test-2026-10-11.json).

Source retention and score eligibility are separate acceptance requirements:
draft/spam messages must not silently become staff performance evidence. Current
label/deletion mirroring and representative score acceptance remain unfinished.

### Matching TEST frontend deployed — 11 October, 18:26 UTC

The protected TEST frontend is now READY from GitHub `1af32a4` at
[the updated preview](https://serviceos-learn-test-g7nlyfdcg-allkin.vercel.app).
It brings the recent recovery, freshness, operator review and manual queue UI
changes onto the same hosted candidate as backend release 066 / worker v12.
Previous sections describing these changes as local/Git only are historical.
Exact project, source commit, TEST backend binding and Vercel route protection
were verified; no production change was made.

The default TEST password-recovery URL points to this new frontend's reset form,
with the previous exact URL retained in the allowlist. All other Auth settings
matched after the update. No account was reactivated and no email was sent.
New-origin browser permission and the existing TEST owner-access approval remain
pending. Positive signed-in acceptance, real-provider coverage and unattended
operation are still required. [Evidence](evidence/learn-processing-frontend-test-2026-10-11.json).

### Production Phone metadata rechecked — 11 October, 18:32 UTC

All 2,882 retained recording URIs pass the actual exact-account URL guard against
Drummonds' sole active registered account; all have storage pointers. The two
registry/recording metadata fingerprints match. This expands the previous 25-row
compatibility sample to the full observed inventory, without downloading audio
or contacting the provider. Production has 4,328 calls and 2,876 completed / six
failed transcripts. The latest 200 Phone sync runs report success through 18:30 UTC;
coverage and the six failures still need real-provider/processing acceptance.

Both required Phone credential names are present in production and absent in TEST.
The password manager is locked; an unlock request is pending so existing values
can be located without extracting production runtime secrets. No credentials,
sources or settings changed. [Evidence](evidence/learn-phone-retained-readiness-2026-10-11.json).

### Microsoft source-to-card rehearsal — 11 October, 18:36 UTC

The six Microsoft capture/projection migrations passed a rolled-back rehearsal
against the current TEST release 066. Its real card publisher and durable queue
settlement created one card from a synthetic Microsoft message, then refreshed
the same card from a later version without changing its person identity. Original
source pages, exact replay and event consumption were verified. All 121 existing
datasets and the original schema matched after rollback; no Microsoft objects,
fixtures, users, grants, credentials or provider requests were retained. All 58
adapter checks pass.

This proves synthetic source-to-card compatibility, not a connected Microsoft
mailbox. Token/account setup, persistent release, worker registration, recurring
folder discovery, expired-delta recovery and real-provider acceptance remain open.
[Evidence](evidence/learn-microsoft-card-rehearsal-2026-10-11.json).

### Microsoft repeat discovery — 11 October, 18:46 UTC

Repeat folder discovery now records each finished scan and queues another after
15 minutes, preserving original source pages and dispatch identities. A later
scan finds an added folder without creating duplicate message jobs for known
folders. Disabled or revoked inputs stop before token access. Local actual-engine
checks prove exact replay and atomic rollback of a failed reset/settlement; all
59 adapter checks and strict TypeScript pass.

A full-schema TEST rehearsal ran two scans plus the existing source-to-card
journey, then rolled everything back. All 121 datasets and the original catalog
matched. No users, grants, credentials, schedules, provider requests or production
changes were made. This supersedes recurring discovery as a missing implementation
in the earlier 18:36 entry. Microsoft still needs credentials/account setup,
worker/operator integration, expired-delta/deleted-folder recovery, persistent
release and real-provider acceptance; no Drummonds Microsoft mailbox is identified.
[Evidence](evidence/learn-microsoft-discovery-2026-10-11.json).

### Existing Workspace key located — 11 October, 15:21 UTC

A scoped local-file check found `ServiceOS Workspace Connector.json` in the
owner's Downloads folder. Its service-account email and client ID exactly match
one active production Drummonds Workspace connection. The existing signer then
obtained one `gmail.readonly` delegated token for that connection's configured
impersonation subject; one Gmail profile request confirmed the same mailbox.
No messages, directory records or credential values were output. Production was
read-only and no new Google key or permission was created. This resolves the
credential-location blocker, not full mailbox or capture acceptance.

TEST preflight found zero active Workspace connections, zero DWD accounts and
none of the three `GOOGLE_WORKSPACE_*` secrets. A concrete proposal to copy the
existing key to those secrets is prepared, with an original 113-dataset baseline
and secret digests. **Not applied:** automatic approval review rejected that
upload because the general credential-reuse goal did not specifically authorize
sending this private key to TEST Supabase. Chris has been asked for that exact
destination approval. Do not retry through another transport or extract a
production runtime secret. The key has not been stored in 1Password by this run.
After approval, verify the existing secret values by digest, preserve all other
secrets and data, and keep mailbox/schedule activation separate from provisioning.
[Credential verification evidence](evidence/learn-workspace-existing-key-2026-10-11.json).

At 15:28 UTC, bounded follow-up checks confirmed that the four previously failing
mailbox subjects still return `delegation_grant_invalid`; the same key already
succeeded for the configured admin mailbox. Google Directory `users.get` returned
HTTP 404 for all four addresses using the existing Directory read-only grant.
Stored mailbox rows still say `user`, `active`, `sync_enabled=true`. This supports
stale/unresolved directory identity; it does not establish deletion, renaming or
the exact cause. No settings were changed and no message content was read.

### Workspace alias capture identity — 11 October, 19:05 UTC

The real alias profile findings exposed a second acceptance gap: Gmail returns
the primary address for a valid alias, while the V1 capture engine required that
profile to equal the configured alias string. TEST release **067**, worker **v13**
and directory discovery **v3** now support an explicit directory-verified primary
identity for an existing alias. The original account ID, email address, source
namespace and retained messages stay unchanged. Missing, foreign-domain, disputed
or changed bindings fail before token access; an unrelated Gmail profile remains
rejected. OAuth and primary-account exact matching remain in place.

Directory refresh binds an unverified row only to the actual returned primary.
A database guard preserves its first owner and latches a conflict if later or
concurrent refreshes disagree. Ordinary refreshes cannot clear that hold or move
the binding across tenants/connections/addresses. This is not an identity merge;
operator recovery for a changed owner still needs an explicit reviewed workflow.

Both the standalone migration and exact package passed full-schema rollback
rehearsals before installation. All **121 datasets** retained their original
fields; new columns remain null/false for existing rows, with no inferred binding.
The actual engine/SQL suite passed 58 checks, including alias-profile capture and
wrong-profile refusal. All 23 port/directory checks passed locally and against
downloaded deployed modules. Runtime comparison matched 92 worker modules and
four directory modules; three omitted files have no emitted runtime imports.
Strict endpoint/worker types and HTTP 403/401 boundary checks pass.

No credential, user, grant, capture schedule or production change was made. The
existing protected frontend is unchanged. Positive hosted directory refresh,
real alias-to-card capture and signed-in acceptance still await their existing
access/credential approvals. [Evidence](evidence/learn-workspace-profile-identity-test-2026-10-11.json).

### Real Workspace directory and aliases — 11 October, 18:49–18:54 UTC

The existing local credential completed a bounded, read-only scan of its matched
Drummonds domain using the actual directory reader. Google returned 29 current
primary users, none suspended. The 35 stored mailbox rows comprise 29 present
primaries, two returned aliases and four absent addresses. All four recently
failing `invalid_grant` accounts fall in that absent group. This establishes
current directory absence, not deletion or a reason to erase historical data.
The domain's DWD account rows comprise 23 present primaries, two aliases and four
absent addresses. Two follow-up Gmail profile reads verified the aliases resolve
to their directory owners; neither owner has a separate DWD account. No email
content, settings, keys or permissions changed. Configuration hashes matched.
[Directory evidence](evidence/learn-workspace-directory-audit-2026-10-11.json),
[alias profile evidence](evidence/learn-workspace-alias-profiles-2026-10-11.json).

This exposed an actual discovery bug: ignoring aliases would mark those two
working inputs removed on refresh. TEST `google-workspace-discover-mailboxes` v2
now validates returned alias ownership, retains already-registered aliases,
preserves operator enable/disable decisions, and propagates suspension. It does
not register every alias as a new mailbox, merge source identities or alter email
accounts. Conflicting alias ownership or malformed pages fail before reconciliation.

Ten local checks and eight checks against downloaded deployed code pass; all four
runtime modules match. Strict endpoint/worker types and unsigned HTTP 401 pass.
All 121 TEST datasets, the schema and other endpoints are preserved. No positive
hosted scan or real mailbox capture was run; TEST credential/access approvals and
production reconciliation/promotion remain pending. Before enabling primary rows,
review their alias history so one mailbox is not captured or scored twice.
[TEST release evidence](evidence/learn-workspace-directory-alias-test-2026-10-11.json).

### Directory reconciliation safeguards — 11 October, 15:38 UTC

Source inspection found that the directory reader returned partial results at its
page limit, while discovery ignored inventory-read and removal-update errors.
The correction is installed as TEST `google-workspace-discover-mailboxes` v1,
ACTIVE with JWT verification. An unfinished, malformed or repeated-page traversal
now fails before mailbox reconciliation. Existing-inventory, upsert, removal,
connection-verification and success-receipt failures cannot return clean success.
Tenant/connection scope and operator mailbox choices are retained. Existing
mailboxes are marked absent only after terminal traversal; no history is deleted.

- Six local directory test groups passed, including the actual endpoint against
  incomplete scans and database failures; the same six passed against downloaded
  deployed code. Two existing token checks and seven deployment checks also passed.
  Strict backend TypeScript passed; all four downloaded runtime modules matched
  the reviewed emitted syntax trees.
- TEST rejected the unsigned HTTP request with 401. All **113 retained datasets**
  and the full schema matched before/after deployment and the HTTP check. Other
  endpoints were unchanged. No provider request, key, grant, schedule or production
  write occurred. The accepted frontend preview remains unchanged.
- **Still unverified:** a positive authenticated hosted scan, real directory
  reconciliation and mailbox-to-card acceptance. The credential-copy and TEST
  owner-access approvals remain pending. No failing production account was disabled.
- Writes are sequential, not one database transaction: confirmed upserts may
  remain if a later reconciliation write fails, with failure reported. Discovery
  is scoped to the saved domain; it does not prove all-domain Google coverage.
  Previously removed/disabled choices are not automatically re-enabled.

Google's [directory list contract](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list)
defines pagination and domain scope. [TEST evidence](evidence/learn-workspace-directory-test-2026-10-11.json)
distinguishes local fixtures, deployed readback and HTTP denial from real acceptance.
The four-account [diagnostic evidence](evidence/learn-workspace-current-failure-check-2026-10-11.json)
remains read-only; it is not authority to infer deletion or alter capture settings.


### Hosted TEST sign-in — 11 October, 15:02 UTC

The accepted preview opens and its login route renders without recorded browser
console errors. Positive signed-in acceptance remains pending. Chris reported
that the emailed reset link led to an unavailable localhost address. A read-only
TEST configuration check confirmed `site_url=http://localhost:3000` and an empty
redirect allowlist. Both now point exactly to the approved preview's existing
`/login?reset=1` page; read-back verified every other Auth setting unchanged.
No password, account, grant, provider, schedule or production change was made.
The earlier temporary operator login remains banned and has no effective grant.
Ongoing owner/operator access has been prepared and awaits Chris's choice.
Do not reuse or reactivate a retired acceptance account implicitly.
[Configuration evidence](evidence/learn-test-password-reset-redirect-2026-10-11.json).

This TEST default intentionally opens the password form for dashboard-generated
recovery links as well as app-generated links. It is pinned to the accepted
preview; moving the preview requires reviewing this destination and its exact
allowlist. A successful configuration read-back does not prove email delivery or
password-change completion. Chris completes password entry and stores it in
1Password. Supabase documents the fallback/allowlist behaviour in its
[redirect guidance](https://supabase.com/docs/guides/auth/redirect-urls).

### Recovery form correction — 11 October, local verification

The login form previously ignored `requestPasswordReset` errors and always
claimed a link was on its way. It now reports an unconfirmed request, permits
retry, keeps successful responses independent of whether an account exists, and
recovers from thrown transport failures without exposing provider details. Form
submission waits for initial authentication to finish. A confirmed password
update clears both password fields and continues to the requested workspace
using the recovery session, rather than racing a best-effort sign-out with the
automatic login redirect. No permissions or account grants are changed by this flow.

Six actual-component regression cases and four existing error-copy cases pass.
Application TypeScript and the production build pass, including 47 prebuild checks.
The actual component was exercised locally in the browser for reset rejection,
retry, update rejection and confirmed-update navigation, with synthetic auth and
navigation and no observed console errors. This does **not** prove real email
transport, token exchange, password change or hosted access. The accepted TEST
preview is unchanged pending the account setup; this fix is local/Git only.
No real password was entered, email sent or account enabled. Supabase's
[recovery contract](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
remains the provider reference. [Verification evidence](evidence/learn-login-recovery-local-2026-10-11.json).


### Email diagnosis — 11 October, 06:17 UTC

[Read-only failure diagnosis](evidence/learn-email-failure-diagnosis-2026-10-11.json)
samples the latest 100 failed/retrying Workspace jobs: 99 `delegation_failed`,
one `db_error`. The latest 200 failed Workspace capture runs all retained
`invalid_grant`, across four accounts. These are bounded samples, not all-time
failure counts or proof that the other accounts have full coverage.

The downloaded deployed worker and token helper confirm that the old code reduces
token failures to a generic code and does not retain Google's error description.
The exact cause therefore cannot be recovered from these logs alone. Google's
[service-account troubleshooting](https://developers.google.com/identity/protocols/oauth2/service-account#error-codes)
lists multiple `invalid_grant` causes, including subject, signature and assertion
timing. Local classification now uses `delegation_grant_invalid` instead of
asserting `subject_invalid`; it requires review and does not trigger endless queue
retry. Five focused handler/token tests pass, including provider-detail redaction.
The helper is now installed in hosted TEST worker v6 (see the release below),
but is not deployed to production. The V1 worker preserves six safe
Workspace diagnostic codes through protocol failure, checkpoint and queue settlement.
The operator reader/UI exposes only an allowlisted code, attempt ID and timestamp.
See the local and hosted acceptance below; signed-in operator acceptance
and real-mailbox diagnosis remain outstanding. Earlier production logs cannot establish the exact grant cause.

Production has the three Workspace credential secret names; TEST has none. No
credential values were returned. The checked older checkout env files and current
process environment contain no copy. Chris has been asked for the secure location
of the existing service-account key so real TEST capture can proceed. Do not
export credentials from a running production function or invent a new key.

An earlier extended authority aggregate observed one matching eligible mailbox
for each of 29 DWD accounts, and 25 accounts with successful capture in the previous
24 hours (47 reported processing observations). A repeat aggregate timed out and
produced no replacement evidence. These observations guide investigation, not
current credential validity or launch acceptance. The bounded diagnosis above
succeeded after that failure; no worker was invoked and no source record changed.

### Durable email diagnostics — local acceptance, 11 October

- The token adapter keeps only six known permanent Workspace diagnostic codes;
  unknown provider errors retain a generic category. Provider descriptions, keys
  and message content are never passed into these diagnostic fields.
- Additive migrations `20261101190000_learn_email_safe_failures.sql` and
  `20261101191000_learn_email_failure_health.sql` preserve those codes through
  the existing transition, blocked checkpoint, failed run and lease-bound job
  receipt, then expose current mailbox diagnostics to the existing operator role.
- **23 focused tests and 57 isolated protocol tests passed.** The latter exercised
  all six codes for both recent and historical capture, no provider reads after
  token refusal, unchanged retained-message fingerprints and idempotent settlement.
  The operator SQL suite passed rollback, unchanged function owner/ACL and source
  rows, tenant isolation, unknown-error redaction and later-success clearing.
  Every actual SQL health page passed the application parser.
- The actual operator component displayed the grant diagnostic and cautious recovery
  guidance in the isolated synthetic browser. Application/worker TypeScript and
  application/preview builds passed; existing bundling warnings remain.
- The health view continues to report recent mailbox capture; historical failures
  retain diagnostics in their run/checkpoint/job but do not appear as recent mailbox
  health. Missing platform configuration caught before token acquisition can still
  have the generic eligibility code. This does not prove any live failure is fixed.
- **Release dependency:** rehearse/install both migrations against the current TEST
  catalog, then release the diagnostic-aware worker and frontend together. Older
  clients reject the new checkpoint codes. After any new diagnostic is persisted,
  do not roll back to an older worker or narrow the SQL allowlist; pause capture
  and retain compatible readers while repairing forward. The local acceptance itself made no hosted changes. The subsequent TEST
  database/worker release is recorded below; no new role/credential grant was made.

[Structured evidence](evidence/learn-email-diagnostic-local-2026-10-11.json) and
[synthetic operator screenshot](evidence/learn-email-diagnostic-local-2026-10-11.jpg).

### Email diagnostics — hosted TEST release 054, 11 October

- Rollback rehearsal succeeded at 06:51 UTC; installation at 06:52 UTC changed
  only the three intended function definitions and retained existing authority.
  All 101 monitored datasets matched before and after. TEST ledger now has 55
  entries, ending with release 054.
- `platform-worker` v6 became ACTIVE at 06:54 UTC, using the pinned 96-file
  dependency bundle. Other endpoints, schema and all 101 datasets were preserved.
- HTTP acceptance at 06:55 UTC rejected missing/incorrect worker credentials
  (403) and accepted an authorised execution filtered to no capture jobs (200,
  zero claimed/failed). Sources remained unchanged. Ten release/deployment tests pass.
- Matching frontend `a621415c451c31336a8b19cde8a7a0e7284b3110` is READY in
  protected Vercel TEST at 07:00 UTC. TEST backend binding, three protected HTTP
  routes, same-origin client/operator sign-in redirects and zero observed browser
  console errors were verified. It also includes the retained source timeline viewer.
- Positive signed-in operator and customer acceptance remain open. These checks
  made no provider requests, created no access grants and do not establish
  successful mailbox capture or resolution of production failures.
- Production remains unchanged. Preserve compatible readers if new diagnostic
  codes are stored; pause and repair forward instead of reverting to older readers.

[Release evidence](evidence/learn-email-diagnostic-test-2026-10-11.json) and
[HTTP evidence](evidence/learn-email-diagnostic-http-2026-10-11.json).

### Scheduler outcomes — local correction, 11 October, 14:03 UTC

The OAuth and Workspace schedulers could report a successful no-op when queue
submission or capture admission was unconfirmed. The backfill heartbeat also
copied its global queued count into every configured company's receipt. The
legacy health reader selected only a timestamp, so even a fresh failed receipt
could appear healthy.

The local candidate now records per-company confirmed new jobs, confirmed
duplicates, paused attempts and unconfirmed outcomes separately. A failed or
unknown enqueue marks that company's heartbeat failed and returns HTTP 503;
heartbeat-write failure also returns an uncertain result while attempting other
companies' receipts. Connection/account/discovery reads no longer silently become
empty successful inventories, and raw database error prose is withheld. The
existing OAuth auth-state guard, five-mailbox backfill bound, explicit-running
backfill requirement and discovery throttle remain. No historical import is
started automatically.

The client evaluates outcome as well as freshness: **Needs attention**, **Includes
paused inputs**, **On schedule**, **Overdue**, **Not observed** and **Unverified**
are distinct. Scheduling evidence is not described as completed capture.
Twenty-four focused checks pass, including actual scheduler-handler receipts fed
to the client verdict, two-company isolation, failed reads/enqueues, pause,
duplicate uncertainty, discovery and heartbeat failure. Strict Edge and application
TypeScript checks and the production build (47 prebuild checks) pass.

**Not deployed.** The 14:01 read-only TEST inventory confirms all three email
scheduler endpoints and their trigger-secret names are absent. The 14:03 TEST
permission check also denies authenticated SELECT of the legacy reader's status/
metadata columns. A bounded, tenant-scoped reader is required for hosted acceptance;
do not solve this by broadly exposing scheduler/source tables. Secure trigger
provisioning, reviewed runtime installation, signed-in acceptance and explicit
schedule activation remain. The fresh combined production/TEST aggregate audit
failed and produced no replacement baseline; it does not prove a source loss or
service failure. No production, provider, credential, schedule or access change
occurred. [Evidence](evidence/learn-email-scheduler-outcomes-local-2026-10-11.json).

### Email schedulers — hosted TEST runtime, 11 October, 15:07 UTC

The corrected OAuth, Workspace recent-capture and Workspace backfill schedulers
are now installed as version 1 in TEST. The six-file dependency bundle is pinned
and the deployment preserved the existing endpoints, schema and all 113 tracked
datasets. Twenty-one actual-handler checks passed before deployment. Six hosted
HTTP checks verified method rejection and missing-configuration refusal, again
preserving the full baseline. A fresh preflight confirmed all three trigger
secret names absent; no secret, schedule, account or grant was created.

This closes the runtime-installation gap from the 14:03 local correction. It does
not establish authenticated scheduling, recurring execution, real Google capture
or source-to-card acceptance. Trigger credentials, explicit schedule activation,
existing Workspace service-account access and signed-in acceptance remain required.
The live production schedulers are unchanged.
[Deployment and boundary evidence](evidence/learn-email-schedulers-test-2026-10-11.json).

### Card refresh preservation — hosted TEST, 11 October, 15:14 UTC

The shared card-refresh handler previously ignored identity, graph, interaction
and recommendation read errors. Failed reads could become empty facts and
replace a retained card with misleading health/activity values. It now preserves
cards on required read failure, reports a retryable safe failure, and allows
unaffected cards to refresh. A missing linked identity also preserves its card.
Synthetic sweep cursor failures are reported; successful skips are counted.
Locked fields and manual context remain intact. The manual HTTP wrapper previously
completed partial-failure jobs whenever counts were present; it now records those
jobs as failed, retains their counts and returns an error response.

Six actual-handler/wrapper tests and strict TypeScript passed. The fix is installed
in TEST `platform-worker` v8 and `customer-card-sync` v1 with existing worker auth
and JWT-protected customer entrypoint. The pinned 98-file bundle preserves all
other endpoints, schema and 113 tracked datasets. The downloaded handler/wrapper
passed the same six regression checks; anonymous HTTP requests returned 403/401
and preserved the full baseline. No positive hosted refresh was invoked. Real
provider-to-card and signed-in currentness acceptance remain open. Existing
bounded-window activity calculations and legacy job persistence helpers are not
made complete by this correction. Production remains unchanged.
[Card preservation evidence](evidence/learn-card-refresh-test-2026-10-11.json).

### Customer snapshot labels — local frontend acceptance, 11 October

The legacy Customers list/detail now show the saved summary's exact preparation
date beside its finding. Missing, malformed and future dates say freshness is
unverified. A later recorded activity timestamp explicitly warns that the saved
summary does not yet include it. A recent snapshot still does not imply provider
coverage. The old confidence-derived “Verified critical” label is now “Recorded
urgent signal”; “Normal / No open issues” is scoped to issues recorded in the saved
snapshot. Existing urgent findings remain visible.

Three date-boundary checks, application TypeScript and the complete application
build pass. The actual Customers component rendered synthetic older and undated
snapshots in a local browser; list/detail notices and zero console errors/warnings
were verified. This is not deployed to hosted TEST yet: keep the approved TEST
login destination stable during owner access setup, then coordinate the next
frontend release and its reset URL. The newer LEARN detail already distinguishes
read time from provider coverage. No production or source data changed.
[Local UI evidence](evidence/learn-customer-snapshot-ui-2026-10-11.json).

## Working and verified in production

- [x] Retained source inventory and recording object-size metadata observed at the
  time above. This does not claim the new V1 workflows are production verified.
- [x] Earlier source-ID/pointer comparison and database-backup listings retained
  in [source preservation](LEARN-SOURCE-PRESERVATION.md) and
  [recovery coverage](LEARN-DATA-RECOVERY.md). Refresh these for the actual release.
- [ ] Entire V1 live service accepted: **not established**. Production deployment,
  signed-in journeys, provider coverage and recovery gates remain below.

## Verified in TEST or locally only

- [x] Real Commusoft TEST capture retained 2,418 properties and 10,000 jobs in the
  approved, retired run. Property traversal exhausted; job traversal did not.
  Contacts did not start. These are source records, not canonical publication.
  [Evidence and limitations](LEARN-COMMUSOFT-API.md).
- [x] TEST controller/module controls, card readers, scorecard configuration,
  measurement review/correction and work history have dated release evidence in
  [TEST readiness](LEARN-TEST-READINESS.md). Positive acceptance is component-specific;
  anonymous denials do not prove the signed-in owner/operator journey.
- [x] Local Microsoft readers, durable pages, retry recovery, atomic queue completion
  and discovery-to-message dispatch pass unit and isolated database checks. A
  discovered folder drives retained message capture with synthetic Graph responses;
  hidden/search/nested folders, deduplication, pause and rollback are verified. No real Microsoft
  provider calls or hosted installation. [Remaining work](LEARN-MICROSOFT-MAIL.md).
- [x] Local OAuth scheduling guard now prevents known revoked/expired/missing-auth
  accounts receiving new jobs; heartbeat write failure returns an uncertain result.
  Run `node --test scripts/email-scheduled-sync.test.mjs`. Hosted installation and
  acceptance remain required; existing queue/source rows are unchanged.

- [x] Local customer/job timeline now reuses the restricted source reader already
  used by scorecards. Browser checks verified email/call failure-to-retry recovery
  and explicit unsupported-source messaging using synthetic data. Eighteen reader
  tests, both TypeScript checks and builds passed. The matching frontend is now
  deployed to TEST with release 054 above; signed-in source acceptance is pending.
  [Evidence and limits](LEARN-CARD-SOURCES.md#customer-timeline-integration--11-october-2026-local-only).
- [x] Local customer/job findings now resolve typed team owner and waiting-on names.
  Unavailable or ambiguous identities show a clear unresolved assignment and a gap;
  they never display an internal UUID as the owner label. All 150 references on a
  full findings page are supported within a bounded lookup. Nineteen card/communication
  checks, both TypeScript checks and both builds passed. Synthetic browser verification
  shows “Office” for the customer finding. The matching Git commit `6be7c9b` is now
  READY in protected Vercel TEST (08:31 UTC); backend binding, protected HTTP routes
  and client/operator sign-in redirects pass, with no observed browser console errors.
  Positive signed-in hosted and production acceptance remain pending.
  [Local evidence](evidence/learn-owner-labels-local-2026-10-11.json) and
  [TEST deployment evidence](evidence/learn-owner-labels-test-2026-10-11.json).

### Phone source-to-event handoff installed in TEST — 11 October, 16:21 UTC

TEST release **061** and `phone-process-pipeline` **v2** now use one scoped atomic
publisher for the canonical interaction, downstream event and immutable receipt.
The previously missing event/projection dependencies are installed. Direct raw
interaction INSERT remains denied; no broad service DML grant was added. Unknown
legacy provenance is held without deleting recordings, transcripts or insights.

The full-schema and exact-package rollback rehearsals passed. Installation
preserved all 113 pre-existing datasets; the two additive interaction columns
remain NULL on retained rows. The monitoring baseline now includes 115 datasets,
adding event and handoff receipts. Existing schema catalogs that are pinned to
060 are historical and must not be silently updated/reused to authorize a write.

A hosted, internal-service TEST request reused exact synthetic cached source data
and returned HTTP 200 only after four terminal runs, one ready interaction, one
pending event and one matching run/handoff receipt were verified in storage.
No provider dispatches, new users, grants, secrets, schedules or production writes.
The fixture is archived; all 115 non-fixture datasets and the schema matched.
71 actual-handler, six finaliser and three terminal-settlement cases pass, as do
eight downloaded pipeline-related checks and strict backend TypeScript. All seven
deployed modules match the tested closure in the syntax-tree comparison.

This milestone proves source-to-event publication. The next section adds hosted
synthetic card delivery; real-provider and signed-in acceptance remain open.
[Release and verification evidence](evidence/learn-phone-atomic-handoff-test-2026-10-11.json).

### Manual processing joins the durable queue — 11 October, 18:22 UTC

- TEST `platform-worker` **v12**, `interactions-sync` **v1** and `identity-resolve`
  **v1** are installed against unchanged release 066. The manual endpoints require
  the existing authenticated owner/admin/ops or internal tenant authority. They
  confirm a tenant-bound queued job and return HTTP 202; they never run an
  unclaimed handler or mark its work complete. Duplicate active requests reuse
  the confirmed job. Unsupported options and malformed batch limits are rejected.
- Hosted synthetic acceptance entered through both real manual HTTP endpoints:
  four original requests and four duplicate retries, followed by ten worker runs.
  Two customer cards were delivered and one updated after a retained source change;
  identity/card links, all 121 non-fixture datasets and schema were preserved.
  Unsigned calls received 401 and foreign-tenant requests 403. No user, grant,
  credential, capture schedule, provider request or production write was added.
- The timeline now explains request acceptance, retry, cancellation and failure
  without calling the full backlog complete when only one batch has finished.
  The actual component passed local browser checks, including clearing an earlier
  queued notice after a failed request, with zero observed console errors. This
  frontend change is **local/Git only**; the hosted preview has not changed.
- The nine earlier worker type errors are corrected. The full worker and both
  manual endpoints pass `node scripts/verify/learn-worker-typecheck.mjs` using the
  installed SDK declarations and a minimal Deno shim. This is not a native Deno
  type check. Application TypeScript/build, 39 existing Marketing tests, 29 policy
  assertions and eight new admission/client checks pass. All 41 queue/admission
  checks also pass against downloaded TEST modules. Source comparison found 92
  matching worker runtime modules and all five modules of each manual endpoint.
- Remaining acceptance: matching frontend deployment, signed-in manual requests,
  automatic worker dispatch/identity scheduling, real-provider coverage and
  production approval. The hosted probe deliberately invokes the worker and each
  manual endpoint; it does **not** prove unattended processing. Other generic
  queue types remain outside this durable settlement change.

[Manual processing evidence](evidence/learn-processing-request-test-2026-10-11.json).

### Durable retained-input queue verified — 11 October, 18:11 UTC

- TEST release **066** and **platform-worker v11** now fence queued
  `interactions.sync` and `identity.resolve` publication to the exact tenant,
  worker, attempt and unexpired claim. Publication and its immutable receipt
  commit together; a stale worker cannot publish new results.
- Finishing a batch and scheduling its continuation now commit together. A lost
  acknowledgement is inspected using the original request, without repeating the
  mutation. Unconfirmed settlement cannot become a generic success or fresh
  healthy heartbeat. Persisted identity-review holds remain visible even when
  the next inventory batch is empty.
- Hosted synthetic Phone/Email acceptance completed **10 worker calls**, producing
  two cards, refreshing one after a source update, and leaving zero pending
  interaction events. Six fenced publications and ten durable job settlements
  were verified. Identity/card links and all **121 non-fixture datasets** were
  preserved; the synthetic tenant was archived with its evidence retained.
- Full-schema and exact-package rollback rehearsals passed, including claim,
  tenant, expired-lease, audit-failure, continuation-failure and retry checks.
  The offline real-handler journey recovered deliberately lost acknowledgements.
  All **33 focused tests** passed locally and against downloaded TEST modules;
  92 deployed runtime modules matched the tested source after syntax normalization.
- Strict checking of changed helper/identity modules passed. The wider worker
  dependency check still reports **nine pre-existing errors** in unchanged
  Marketing/Intelligence code, reproduced against the previous Git checkpoint.
  This historical failure is resolved by the subsequent manual-processing release above.
- No users, grants, credentials, capture schedules, real provider requests or
  production changes. This is queued synthetic TEST acceptance, not real-provider
  coverage or signed-in customer acceptance. Manual `interactions-sync` and
  `identity-resolve` endpoints remain undeployed pending lifecycle hardening;
  other generic queue types still need their own recovery review. The subsequent
  manual-processing release above replaces these manual endpoints with queue admission.

[Release evidence](evidence/learn-processing-queue-test-2026-10-11.json).

### Operator initial identity review installed — 11 October, 17:50 UTC

- TEST release **065** adds a paged held-interaction list, tenant-scoped contact
  search, exact source/contact/company comparison and audited operator decision.
  The existing OpenFolk admin grant is required; no accounts, grants or schedules
  were added. The unchanged automatic delivery API delegates to a private engine;
  only the governed review action can supply an explicit contact choice.
- Initial ambiguous/conflicting matches can be attributed to the chosen existing
  contact and their displayed company. Card enrichment, event consumption and
  immutable audit commit together. Previous canonical/contact/company snapshots
  and the operator's reason are retained privately. Global contact verification,
  raw sources, manual card locks and rejected suggestions are preserved.
- Source/contact/company changes invalidate the review. Revoked access, tenant-only
  membership, View-As and cross-client selections are denied. Offline PostgreSQL
  checks prove late-audit failure rolls back all publication, identical concurrent
  decisions share one receipt and competing contact choices cannot both publish.
  The existing automatic identity/card assertion suite also passes.
- Full TEST-schema and exact-package rehearsals passed and removed all fixtures.
  Installation preserved **118 existing datasets** and added an empty private audit
  table. Eight hosted anonymous/service endpoint denials preserved all **119
  datasets** and the schema. No new session, provider request or production change.
- The component is **local/Git only**: eight client tests, application TypeScript
  and build pass. The actual local browser exercised unavailable reads, tenant
  switching during a delayed comparison, the prior-rejection warning and a lost
  reply recovered through the original receipt with exactly one apply. No console
  errors were observed. This is synthetic UI acceptance, not signed-in hosted UAT.
- **Still open:** frontend deployment and positive signed-in hosted review; broader
  correction of previously delivered interactions/old cards and graph/history;
  duplicate-contact merging, company edits, invalid/internal-source investigation;
  real provider coverage and production acceptance. A new source revision can
  require a new identity review; this is not a global verified-person override.

[Operator procedure](LEARN-IDENTITY-REVIEW.md) ·
[Sanitized TEST evidence](evidence/learn-identity-review-test-2026-10-11.json).

### Operator projection review backend installed — 11 October, 17:30 UTC

- TEST release **064** adds an authenticated OpenFolk review list, exact source
  comparison and audited action for legacy/unowned or manually changed canonical
  communication records. Existing effective platform grants govern access; no
  user, grant, credential or schedule was added. Raw review history remains private.
- An administrator can explicitly apply the displayed retained source values.
  The previous full canonical record, actor, reason and exact receipt are retained
  in immutable audit history. Source messages/calls, identity links and unrelated
  metadata remain intact. Publication, event and audit commit together; card
  processing is reported **pending**, not complete.
- Changed comparisons, paused inputs, revoked grants, viewers, tenant-only users,
  actor impersonation and View-As are refused. Check/retry uses the same durable
  request; cancellation prevents delayed application. Failed audit insertion
  rolls back the publication. Unexpected canonical types, campaign relationships,
  invalid addresses and oversized comparisons require separate investigation.
- The matching OpenFolk module screen is **local/Git only**. Seven client tests,
  actual local browser checks, application TypeScript and production build passed.
  Browser checks covered failure/recovery, delayed cross-company comparison and
  a lost reply recovered with exactly one apply; zero console errors were observed.
  It labels projection holds separately from identity matching/provider reviews.
- Full TEST-schema and exact-package rollback rehearsals passed. Installation
  preserved all **117 existing datasets**; all **118 datasets** matched after six
  hosted anonymous/service access denials (401/403). No persistent synthetic
  account/grant/session, provider call or production change occurred. The current
  protected frontend URL was not replaced.
- **Outstanding:** matching frontend deployment and positive signed-in hosted
  review; broader identity correction (initial holds addressed by 065 above); operator workflows for the explicitly held
  exceptional cases; real-provider capture/coverage and unattended recovery.

[Sanitized TEST evidence](evidence/learn-projection-review-test-2026-10-11.json).

### Retained Phone/Email to cards installed in TEST — 11 October, 17:10 UTC

- TEST release **063** and **platform-worker v10** are installed. The repair and
  backfill path now publishes the canonical interaction, pending event and exact
  receipt together through scoped functions. No raw interaction write permission
  was added. Confirmed phone analysis remains owned by its provenance-checked
  publisher; basic calls preserve their actual provider rather than assuming Simwood.
- New and changed emails reach cards. In the hosted synthetic acceptance, Phone
  and Email created two cards; a later email update refreshed the existing card
  while preserving both identity/card links. All four queued jobs completed,
  three events were consumed, and no pending event or eligible source remained.
  This proves retained-source processing, **not real-provider capture or coverage**.
- Lost replies are inspected by the same immutable request instead of republished.
  Concurrent requests, stale source selection and event-failure rollback passed
  against offline PostgreSQL. Nine actual-handler cases, nine downloaded-handler
  cases and three local HTTP-wrapper cases passed; strict backend/application
  TypeScript and the production build passed.
- Full-schema and exact-package rollback rehearsals passed. All **116 existing
  datasets** matched at installation; all **117 non-fixture datasets**, including
  the new receipt table, matched around deployment and hosted verification. No
  user, grant, credential, provider call, schedule or production change occurred.
  Synthetic acceptance tenants are archived and their evidence is retained.
- The manual `interactions-sync` wrapper now handles partial failure honestly,
  rejects mismatched tenant/invalid input and avoids work after duplicate/failed
  job admission. That wrapper is **local/Git only**, not deployed. Its legacy
  best-effort start/settlement remains a separate hardening gate.
- Unowned legacy canonical rows and manually changed projected fields are held
  visibly for review; they are not overwritten. Release 064 above adds audited projection reconciliation; signed-in acceptance
  and identity review remain open. Outstanding holds make the batch report review required;
  successful clean full batches request bounded continuation (20 default, 50 max).
  Generic queue continuation remains best effort and needs final operational
  acceptance before unattended historical import is called complete. Email
  mailbox binding and source coverage remain explicitly unverified.

[Sanitized TEST evidence](evidence/learn-interaction-projection-test-2026-10-11.json).

### Atomic identity/card delivery installed in TEST — 11 October, 16:40 UTC

TEST release **062** and `platform-worker` **v9** replace the early enriched marker
and unchecked card writes with one exact-revision database transaction. Contact
resolution, provisional identities, card updates, recommendations, the enriched
marker, matched-event consumption and an immutable receipt commit together. Card
or event errors roll all of them back; a lost reply is inspected without repeating
the publication. A worker holding an older source revision cannot finish newer
content. Existing source rows, manual locks and human match decisions are retained.

The actual hosted chain passed using one synthetic cached call: pipeline v2
confirmed its transcript/analysis and ready event; worker v9 created one useful
card with the source summary and provisional customer, linked the interaction,
consumed exactly that event, saved its delivery receipt and finished its queue job.
The fixture is archived. No users/grants/credentials, real provider calls, storage
objects or production changes. All 116 non-fixture datasets and the schema matched.

Eight actual-handler checks, eight downloaded-handler checks, one manual-wrapper
partial-failure check, strict backend TypeScript, real PostgreSQL concurrency and
lost-response tests passed. Full-schema and exact-package rollback rehearsals
preserved 115 pre-existing datasets before adding the receipt table. The downloaded
worker has 92 matching runtime modules; three type dependencies were pruned by the
bundler. No differing runtime module remains after accounting for equivalent
logical grouping and the optional block around a for-of statement.

**Still open:** real-provider/data-coverage and signed-in acceptance; an authorised
signed-in review of initial `identity_review` cases (065 above) and broader attribution corrections; legacy
projection review acceptance (063/064 above); and recovery for other generic queue types (queued identity/projection addressed by 066 above). The manually
invoked `identity-resolve` wrapper now reports partial failures correctly locally,
and has since been replaced by the queued TEST manual endpoint described above.
The calculated customer-card priority is an operational queue aid with recorded
inputs and an explicit UTC daily window, not staff performance/pay scoring.
[Release and hosted journey evidence](evidence/learn-identity-card-test-2026-10-11.json).

## Implemented but not fully verified — acceptance gates

- [ ] **Google email:** reconcile every enabled mailbox against current connection
  and domain authority, distinguish OAuth from DWD, classify recent failures,
  verify bounded real historical/incremental capture through the installed V1
  engine into interactions/cards, and verify pause, credential expiry, resume,
  duplicate suppression and schedule/expired-lease recovery. Exercise matching UI.
  Existing Workspace key availability in TEST is a current dependency; the live
  four-account `invalid_grant` issue requires a bounded diagnostic with a safe
  cause category, not a guessed Google-admin change.
- [ ] **Commusoft:** resume remaining jobs and property-scoped contacts; reconcile
  missing customer/property references and unzoned timestamps; publish valid
  customer/contact/site/job relationships with held records visible for review.
  Verify incremental updates and a real source-to-card journey without provider writes.
- [ ] **Phone:** verify existing account binding, calls, recording download,
  transcription, playable audio, retry/recovery and recurring capture with the
  real Birchill account. Preserve existing IDs and distinguish capture from shadow
  processing configuration. [Phone work](LEARN-PHONE-ACCOUNT-BINDING.md).
  Retained call playback is implemented and its backend is now **installed in TEST**:
  owner/admin evidence cards list exact tenant/provider/call recordings and request
  audited 60-second links to private retained audio. Candidate checks included
  nine protocol/client/actual handler tests, isolated PostgreSQL assertions and
  actual-component browser playback of generated audio. Closing evidence stopped
  playback; switching company discarded a delayed old link; listing retry worked.
  Release 057 installed at 11:08 UTC after the exact package rollback rehearsal,
  preserving 112 data sets. Endpoint v1 is ACTIVE with JWT protection; runtime
  deployment and nine anonymous/service HTTP denials preserved 113 data sets.
  All three downloaded source files matched transpiled syntax and downloaded
  handler tests passed. No new users or grants were created. The protected TEST
  frontend is READY from Git commit `0a8d7eab2eeede40d368a9e5b66508ddd954abeb`
  at https://serviceos-learn-test-qu7dogqm4-allkin.vercel.app; the actual browser
  reached its same-origin login with no observed warnings/errors. Isolated
  signed-in acceptance run `73e083fe` subsequently received explicit user approval
  and **passed in hosted TEST**, using one generated eight-second recording.
  Card → call → recording → private audio worked in the actual browser; playback
  advanced and closing evidence removed the player. Exact bytes, foreign-tenant
  denial, same-session role revocation and all 113 original dataset comparisons
  passed. The temporary login is banned and company access removed.
  TEST needed a private synthetic WAV bucket; it currently has a 1 MiB limit and
  requires configuration review before real-audio acceptance. No new policies.
  [Completed run and retirement](LEARN-PHONE-PLAYBACK-ACCEPTANCE.md).
  [Signed-in acceptance evidence](evidence/learn-phone-playback-acceptance-2026-10-11.json).
  Real Drummonds retained audio and provider-to-card acceptance remain open.
  [Candidate checks](evidence/learn-phone-playback-candidate-2026-10-11.json).
  [Hosted backend evidence](evidence/learn-phone-playback-test-2026-10-11.json).
  TEST release 058 installed at 12:30 UTC adds the bounded saved transcript/analysis
  reader under existing owner/admin access. All 113 data sets are preserved.
  Current-source provenance, stale and unverified historical results remain distinct.
  Long transcripts paginate with a text hash so pages cannot mix edited versions.
  Actual local component checks cover pagination, warning labels, failure recovery
  and discarding delayed replies on company change; offline SQL and full hosted
  rollback assertions pass. The matching protected frontend is READY at 12:32 UTC from GitHub `508dc13`,
  at https://serviceos-learn-test-ea944wgld-allkin.vercel.app. TEST binding, route
  protection, actual browser sign-in redirect and zero browser errors pass. Three
  real RPC denials pass; positive signed-in hosted reader acceptance remains open. Legacy `/app` call detail/feed
  freshness remains separate work. [Saved-result evidence](evidence/learn-phone-saved-results-test-2026-10-11.json).
  Hosted TEST now has pipeline, transcription and analysis v1, download v4,
  pending processor v2 and platform worker v7, coordinated with schema release 055.
  The local candidate now confirms pipeline completion and gives downloads,
  transcription and analysis exclusive per-recording ownership. Forced processing
  retains prior audio, transcript, summary and attribution versions. New results
  carry exact source hashes; stale results no longer count as a completed pipeline.
  Prepared outputs can be reconciled without repeating provider requests. Unknown
  paid-request outcomes stay held for review, while confirmed rejections can retry.
  All 101 focused checks, isolated PostgreSQL assertions and strict TypeScript pass.
  The complete schema passed positive processing assertions in hosted TEST and was
  installed at 10:05 UTC, preserving 101 data sets. Runtime deployment preserved
  108 data sets including the new journals/configuration. At 10:10 UTC, the deployed
  HTTP chain completed all three stages using retained synthetic results in an
  archived company. Both cached receipts reconciled without provider dispatch;
  forced work remained paused. Authentication, tenant mismatch and method checks
  passed. No users or access grants were created. This proves retained-result reuse,
  not new audio capture, model processing or customer-card delivery.
  Operator history and saved-result recovery are now implemented locally. At
  10:31 UTC, their positive assertions passed against the full hosted TEST schema
  inside a rolled-back transaction; 111 datasets, including Auth identities and
  sessions, remained unchanged. No login, grant or candidate schema persisted.
  The actual local UI verified lost-response receipt recovery and disabled writes
  for a read-only operator. Six client tests and the offline SQL/concurrency suite
  pass. TEST release 056 is now installed (10:37 UTC), preserving all 111
  datasets and retaining no synthetic users/grants. Seven HTTP denials passed
  (10:38 UTC), preserving 112 datasets including the new empty audit journal.
  The matching protected frontend is READY from GitHub commit `48999ca`;
  protection, client/operator login redirects and zero observed browser errors pass.
  Signed-in hosted acceptance, download verification UI and unknown-outcome
  disposition remain open, along with customer-facing stale
  indicators, live-provider and recurring-capture acceptance.
  [Operator recovery evidence](evidence/learn-phone-operator-rehearsal-2026-10-11.json)
  and [TEST release](evidence/learn-phone-operator-test-2026-10-11.json).
  Chris authorised a dedicated TEST OpenAI key; the secure Platform picker is open
  and awaiting its selection. No TEST OpenAI secret has been provisioned yet.
  [Latest evidence](evidence/learn-phone-processing-test-release-2026-10-11.json).
- [ ] **Slack:** verify authorised workspace/channel scope, history plus replies,
  files/unsupported-content limits, incremental schedule, revocation/recovery and
  source-to-card visibility. Local synthetic history and deployed worker status
  alone are insufficient. [Slack work](LEARN-SLACK-INGESTION.md).
- [ ] **Cards and scoring:** signed-in Drummonds review of customers/jobs,
  communications, ownership, outstanding actions and next steps; configurable
  scale/criteria/weights/targets for individuals/teams; traceable evidence,
  calculation, period, coverage, corrections and human review. Missing evidence
  must not become a low score. Pay decisions remain human-reviewed.
- [ ] **Operator controller:** signed-in client creation/configuration, module and
  submodule switches, accurate health/coverage/last success, diagnostics and recovery.
  Prove pause stops new reads but retains sources. Verify customer-facing stale or
  missing-input messages and compare Drummonds branding with production.
- [ ] **Isolation:** positive authorised and negative foreign-tenant/user-role
  cases against the actual hosted schema and HTTP boundary, covering sources,
  recordings, cards, scoring, controls and administrative recovery.

## Missing or externally blocked — no silent exclusions

- [ ] **Commusoft continuation access:** original bounded real TEST grant is
  retired. The prepared continuation needs its own approval; earlier approvals
  must not be reused. Provider data-shape questions remain an explicit diagnostic
  task, not permission to assume timestamps or missing relationships.
  At 12:07 UTC on 11 October, the same prepared run passed fresh read-only schema,
  Auth, runtime, credential-binding, paused-capture and retained-checkpoint checks.
  All 78 original source fingerprints matched after isolating the two documented
  synthetic Phone fixtures; a preserved one-time baseline refresh now protects
  those additions too. Exact release-055 transcript additions are accepted by the
  Auth checker without removing the old guards. Twenty focused tests pass.
  No user, grant or provider request was created; the original approval remains
  pending. [Readiness evidence](evidence/learn-commusoft-continuation-refresh-2026-10-11.json).
  A second exact reconciliation at 12:38 UTC proved the original 78 hashes after
  the approved playback fixtures and release 058; previous journals and both
  original baselines remain retained. Twenty-one checks pass. Full read-only
  preflight now passes on 058 with no active grant or provider request, preserving
  the original account, 100-page checkpoint, duration and budget.
  [Latest readiness](evidence/learn-commusoft-continuation-playback-refresh-2026-10-11.json).
- [ ] **Voicemail:** the signed Birchills-email/audio route has real read-only
  evidence, and the importer/queue now has local plus hosted synthetic acceptance.
  Still required: verified historical mailbox access, authorised real source capture,
  enumeration and coverage, recurring scheduling, provider-transcript quality,
  signed-in private playback, authorised LEARN context/card integration and independent
  recovery of audio/original-message files. Do not publish private voicemail into
  tenant-wide cards without preserving its owner/manager access rules.
  [Discovery and acceptance evidence](LEARN-VOICEMAIL-DISCOVERY.md).
- [ ] **Microsoft:** authorised tenant/mailbox setup and token lifecycle;
  persistent hosted release; real canonical/card acceptance; worker/controller registration,
  recurring folder discovery activation, expiry recovery and real-mailbox acceptance.
  At 13:31 UTC, all five source-journal/dispatch/recurring-queue migrations passed
  a full-schema hosted TEST rollback rehearsal, preserving all 113 datasets and
  the original catalog. Local actual-engine/queue tests prove later delta rounds,
  due-time gating and pause/revocation before token access; 58 focused tests and
  strict TypeScript pass. Nothing is installed or enabled for Microsoft. No real
  Microsoft mailbox has been identified for Drummonds.
  [Evidence](evidence/learn-microsoft-incremental-2026-10-11.json).
  At 14:59 UTC, the canonical message projection also passed a full-schema TEST
  rollback rehearsal, including the missing shared event-bus foundation. Complete
  synthetic messages reached email/thread/interaction records and durable events;
  all 113 datasets and the original schema were restored. Seven isolated projection
  checks cover retries, version ordering, mailbox isolation and failure rollback.
  Sparse/conflicting observations stay held, attachments remain uncaptured, and a
  pending event does not prove customer-card delivery. No Microsoft installation
  or live activation occurred.
  [Projection evidence](evidence/learn-microsoft-projection-2026-10-11.json).
- [ ] **Performance inputs:** finish source-backed response-time, job progression,
  repeat-visit and driving adapters where sources exist. Establish staff identity,
  team membership, calendars and reviewable calculation rules using Drummonds data.
  Unsupported inputs stay visibly unavailable until connected and verified.
- [ ] **Backups:** confirm measured volume, estimated total cost, account owner,
  retention and recovery targets; use the now-approved AWS London setup and
  recording-copy scope under OpenFolk ownership; implement encrypted independent files plus database recovery.
  Verify bytes and isolated restore/playback, record duration and recovery point.
  [Recovery plan](LEARN-DATA-RECOVERY.md). The complete observed file inventory and one manifest-selected
  audio restore are verified; database restore and recurring operation remain open.
  At 13:51 UTC, a reusable offline logical-restore destination passed a separate
  synthetic PostgreSQL dump/restore: retained row/pointer fingerprints, tenant RLS,
  cross-tenant foreign keys, an imported active cron job prevented from running,
  failure redaction and complete disposable-target cleanup. This is preparation,
  not a real ServiceOS database recovery. Database credentials and real export,
  restored relationships/audio matching and platform/Vault recovery remain open.
  [Local restore evidence](evidence/learn-database-restore-isolation-2026-10-11.json).
  The costed proposal now includes 601 MB / 2,888 objects, verified London AWS
  rates, an illustrative US$1.89/month operating estimate and a US$5 budget alert
  (not a cap), plus scoped access, daily copies, 30-day governance protection and
  isolated restore acceptance. Chris approved setup/copy and changed account ownership to OpenFolk. The OpenFolk AWS account is now verified in Arc, with London selected. Owner
  MFA is now verified enabled in the in-app browser. Chris intends to move to the paid plan later; this
  is not an immediate setup blocker unless AWS reports a service restriction,
  but must happen before free access ends. The approved London foundation reached
  CREATE_COMPLETE at 07:55:12 UTC. S3 readback verifies private access, encryption,
  versioning, 30-day GOVERNANCE retention and protected writes. Both IAM policies
  are attached to separate approved Writer/Restore identities with matching
  permissions boundaries and console access disabled. Each has one active key
  stored separately in Mac Keychain, due for rotation by 9 January 2027. Both
  pass live STS and bucket protection checks. The $5 monthly alert still awaits
  owner email verification, so delivery is not yet active.
  [AWS evidence](evidence/learn-recording-backup-foundation-aws-2026-10-11.json).
  Local CloudFormation foundation and streamed copy/restore/inventory core now
  pass schema lint and eleven synthetic tests. The official AWS SDK destination
  and encrypted journal add eight signed-wire synthetic tests (19 combined).
  The recursive Supabase source adapter now joins the synthetic copy/manifest/
  restore test path (28 tests combined), and one real object passed metadata-only
  verification. The complete real metadata inventory now verifies all 2,888 objects
  and every recording-row file link; six unlinked objects remain included. Private
  manifests are saved locally. The bounded local copy command now uses private atomic
  disk checkpoints, separate attempt status, exclusive locking and exact Writer
  credential/principal selection. Thirty-nine local tests passed before activation;
  the first live recording copy verified 108,870 bytes. Bounded full-inventory
  copy pass has now verified all 2,888 files. Sequential whole-inventory finalization
  stopped at its 30-minute deadline at 10:29:51 UTC; no complete manifest was confirmed.
  The runner now verifies at most four objects concurrently, preserving both source
  checks, exact S3-version byte hashes, ordering and failure draining. All 44 backup
  tests pass. The revised run completed at 10:39:30 UTC: all 2,888 pinned object versions
  and 601,004,261 bytes verified, with both source comparisons and an immutable
  manifest. No audio was recopied. Coverage is the explicit observed inventory,
  not a simultaneous database/storage snapshot or subsequent new files.
  [Runner evidence](evidence/learn-recording-runner-local-2026-10-11.json).
  The separate Restore-only command now validates the immutable manifest and restores
  an exact object version without Supabase access, preserving record links and checking
  local audio decoding. Forty-three tests pass, including actual macOS decoding of
  synthetic WAV audio. [Restore evidence](evidence/learn-recording-restore-local-2026-10-11.json).
  The earlier receipt-only rehearsal is now supplemented by a successful real
  full-manifest Restore-key rehearsal: 108,870 bytes hashed, 66.96 seconds decoded,
  one recording reference retained, no source-provider calls, and temporary audio
  removed. Human listening and isolated database relationship recovery remain open.
  [Verified inventory and restore](evidence/learn-recording-inventory-restore-2026-10-11.json).
  [First real restore](evidence/learn-recording-initial-restore-live-2026-10-11.json).
  Restricted Writer/Restore IAM access was explicitly approved and its stack
  completed at 08:35:18 UTC. Whole-inventory verification and one manifest-selected decoded audio restore
  now pass; scheduled execution, operator monitoring and isolated database recovery remain open.
  A repeat-run command, local health report and monthly cleanup mode now pass 56
  backup checks. A real check at 11:42 UTC restored and decoded an 81-second
  recording through the separate Restore key, retained its record link and
  automatically removed temporary audio; separate inspection confirmed removal.
  The active daily follow-up includes the next monthly check due by 11 November;
  no scheduled execution has yet occurred.
  [Monthly check evidence](evidence/learn-recording-monthly-check-2026-10-11.json). Existing
  audio is reused; every retained version is byte-verified again before a new
  immutable inventory manifest. The first real repeat run started at 11:22 UTC
  and reached its 20,000-request ceiling during the final source comparison. All
  destination bytes passed, but no fresh manifest was claimed. The daily allowance
  now accounts for the inventory and both complete reference/metadata passes, with
  a fixed 100,000-request ceiling and the same object, byte and time limits. A new
  live repeat started at 11:38:53 UTC and succeeded at 11:53:07 UTC: all 2,888 files,
  601,004,261 bytes and 2,882 references passed, with zero missing file references
  and no audio recopied. A fresh immutable manifest was verified after 20,288 source
  requests. Local health reports observed inventory verified; the lock was removed.
  The daily 09:00 local follow-up and monthly due check are now ACTIVE and read back.
  No scheduled execution has occurred. This local runner still requires this Mac
  and Codex to be running; it is not an always-on production backup service.
  [Fresh daily verification](evidence/learn-recording-daily-verified-2026-10-11.json).
  [Daily operation runbook](LEARN-RECORDING-DAILY.md).
  [Live access evidence](evidence/learn-recording-access-live-2026-10-11.json).
  [Inventory and runner evidence](evidence/learn-recording-inventory-and-batch-2026-10-11.json).
  AWS foundation and scoped access are active. The full explicitly observed
  recording inventory and one manifest-selected restore are verified; later
  arrivals, scheduled coverage and database recovery still require acceptance.

## Commusoft jobs with unresolved times — 11 October, 13:21 UTC

The captured-data audit found 9,940 of the first 10,000 jobs had completion strings
without a timezone. Previously a valid unzoned timestamp held the entire job at
review. The new projection separates usable job identity/status from timing
eligibility: after customer/site ownership is reviewed, it can link that job while
leaving the uncertain canonical timestamp null. Original source text and the
`timezone_required` classification remain in provenance metadata. Invalid dates,
unknown statuses, stale/conflicting sources and unresolved ownership remain held.
Nothing assigns a timezone, marks the job verified, attributes staff or awards pay.

- Additive migration `20261101250000_learn_commusoft_partial_job_times.sql` changes
  only the existing review function; execution grants/owner are retained. Existing
  canonical rows and immutable source versions are not backfilled or overwritten.
  Exact replays keep the same job and timing limitations. Closure does not imply
  a completion timestamp. A later timezone resolution still needs explicit review.
- The job card shows timing limitations. The performance evidence reader requests
  only the timing part of metadata, checks it against stored dates, and shows
  unknown or conflicting provenance instead of a guessed instant. Missing time
  is not a poor-performance score. Saved review batch receipts retain the same
  warning; linking a job does not attest timing quality.
- **40 focused client tests pass**, along with TypeScript and production build.
  Isolated PostgreSQL checks cover actual source-page publication, customer/site/
  job/card linkage, DST ambiguity, explicit offsets, absent dates, malformed dates,
  orphan holds, retry and preserved old source/canonical rows. Actual SQL job
  output passes the application's card and performance-evidence presentation.
- Full hosted TEST schema rehearsal passed at 13:14 UTC, including positive owner
  projection, normal signed-in job SELECT access, foreign-tenant RLS, replay and
  same-session demotion. All temporary synthetic records and banned passwordless
  fixture identities rolled back; no login/session or platform grant was issued.
  All **113 existing datasets** and original function definitions/grants were
  restored. The first attempt exposed a missing permission on the probe's temporary
  helper; correction did not alter application permissions. No real records were
  published and no provider requests or production changes occurred.
- Actual LEARN card browser verification with a simulated backend shows the
  completion-time warning, with zero console errors. TEST release 059 installed at
  13:16 UTC with all 113 datasets unchanged. The matching Git-built frontend was
  observed READY at 13:20 UTC; all three checked HTTP routes remain protected.
  Browser inspection of its new origin awaits explicit permission after automatic
  approval review rejected opening it. Real Drummonds publication and signed-in
  hosted browser acceptance remain open.
- The unchanged prepared Commusoft continuation passed read-only preflight against
  release 059 at 13:17 UTC. All 78 protected datasets still match the original
  refreshed baseline. No further baseline refresh, account, grant or provider
  request occurred. Its separate access approval is still pending.

[Evidence](evidence/learn-commusoft-partial-times-test-2026-10-11.json).

## Retained call detail — 11 October, 12:55 UTC

The older `/app#communications` call detail could pair the newest recording
transcript with an insight and corrections from a different transcript. The
reader now selects the insight's exact transcript ID within the same tenant and
recording. Missing source IDs remain missing; an interaction summary is never
silently substituted. Saved corrections are selected deterministically for that
same source. This linkage does not establish that the text still matches the
current audio: the legacy screen explicitly labels analysis, participants and
corrections as unverified and potentially out of date. The LEARN recording viewer
remains the separate reader with retained provenance checks.

- Hosted TEST `phone-call-detail` v1 is ACTIVE with JWT verification, response
  contract `phone-call-detail/2` and `Cache-Control: no-store`. It requires a real
  signed-in owner/admin/ops profile and confirms the call belongs to that tenant
  before detail reads or review writes. No new account or grant was created.
- Database read errors fail visibly, including review lookup. Failed review
  clearing no longer reports success. Invalid actions and request bodies above
  4,096 bytes fail before call access. Review remains a call-level receipt, not
  approval of a transcript version, source freshness or later analysis.
- The client validates the versioned response and requested call. The screen
  starts with saved raw text, disables corrected text when absent, shows review
  failures and discards responses arriving after another call opens. No saved
  summary is described as proof that processing is running.
- **12 focused tests passed** (eight actual handler, four response-contract).
  The eight handler cases also pass against downloaded deployed code; its three
  emitted syntax trees match the reviewed TypeScript. TypeScript and production
  build passed, including 47 repository prebuild checks.
- Actual local browser/component/client checks passed for delayed call switching,
  missing analysis, disabled absent correction, saved correction selection,
  failed detail clearing and failed review feedback; zero console errors. The
  backend was simulated for these browser checks.
- Actual TEST HTTP checks returned 401/401/403 for absent session, anonymous key
  and service impersonation, without call content. All **113 retained datasets**
  matched both deployment and HTTP before/after comparisons. No production changes,
  provider calls, new users or grants occurred.
- Signed-in positive hosted acceptance of this older call screen and review flow
  **remains outstanding**. The completed playback run is separate evidence and
  must not be reused after retirement. The matching protected TEST frontend
  `serviceos-learn-test-fpzgfbxtu-allkin.vercel.app` is READY at 12:56 UTC from
  `a5f2329369b50194be4bcad59f29d31157d2717a`. Exact TEST backend binding and
  three Vercel-protected routes passed. The actual `/app#communications` entry
  redirects to same-origin sign-in, with zero observed browser errors.

[Sanitized evidence](evidence/learn-call-detail-test-2026-10-11.json).

## Scoped scheduler health — 11 October, 14:29 UTC

- TEST package **060** is installed. The authenticated reader returns ten bounded,
  tenant-scoped scheduling summaries without granting browser access to raw logs,
  job payloads or source metadata. Own-company reads follow existing membership;
  cross-company reads require an effective OpenFolk grant. View-As is rejected.
- Full TEST-schema rehearsal and packaged rollback passed before installation.
  Membership removal, foreign-tenant access, revoked grants, View-As and role
  impersonation checks passed. All **113 retained datasets** matched before and
  after installation and HTTP checks; no synthetic users, grants or sessions remain.
- Actual anonymous/service-role HTTP requests were denied (401/403). A positive
  signed-in hosted check is **still outstanding**; SQL-role checks are not a
  substitute for that acceptance.
- The actual OpenFolk capture controller now includes scheduling checks. Failed,
  paused, late and unobserved activity remain distinct; recorded queue activity
  does not claim completed capture. Legacy LEARN/Ops also use the scoped reader.
  Failed reads show unverified status, and delayed replies cannot cross companies.
- Actual local component/browser checks passed with a synthetic RPC: failure,
  recovery and delayed company switching, with zero console errors. Six focused
  reader/outcome tests, application TypeScript and the production build passed.
  The matching TEST frontend from `aff42842d82ae228de3513a63cad73c2a91ff9a7`
  is now READY, observed at 14:35 UTC, at
  `serviceos-learn-test-b5u66qgft-allkin.vercel.app`. Exact TEST project, Git SHA,
  backend binding and Vercel protection configuration were checked through the
  management API. Browser access to this updated origin has been requested;
  positive signed-in hosted acceptance remains unverified.
- Commusoft's prepared continuation preflight passed against the new TEST catalog
  at 14:21 UTC. Its original source baseline, request budget and approval requirement
  remain intact; no continuation account or provider request was created.
- Email scheduler installation/secure triggers, real input capture, hosted
  acceptance and production promotion remain separate unfinished gates. No key or
  password was created, reset or saved during this checkpoint.

[Sanitized evidence](evidence/learn-scheduler-health-test-2026-10-11.json).

## Release and completion gates

- [ ] Keep meaningful checkpoints on GitHub `codex/learn-v1-test`; verify exact
  remote SHA. Source backup excludes secrets, private manifests and customer files.
- [ ] Rehearse the complete additive migration/runtime/frontend combination on
  the actual TEST schema; preserve before/after source identity evidence.
- [ ] Pass the repository's release commands (`npm install`, `npx tsc --noEmit`,
  `npm run build`) and verify required routes, matching API project, sign-in,
  permissions and browser console. Use [deployment requirements](../DEPLOYMENT.md).
- [ ] Complete the [production release plan](LEARN-V1-PRODUCTION-RELEASE.md), including deployment sequence, rollback, credentials recovery, monitoring,
  incident handling, unresolved provider limits and operating ownership.
- [ ] Present concrete acceptance evidence and obtain Chris's production approval.
- [ ] Deploy through Vercel/Git and the separate reviewed Supabase release; verify
  the actual production domain/redirect chain, deployed versions, real signed-in
  journeys and initial capture/monitoring. Do not promote a TEST-configured frontend.
- [ ] Refresh preservation evidence and prove recovery after the final release.
- [ ] Audit every requirement in the goal against evidence. All outstanding
  requirements remain incomplete unless Chris explicitly agrees a scope change.

The goal remains active. A successful local test, catalog read, deployment or
provider page does not by itself establish readiness for launch.
