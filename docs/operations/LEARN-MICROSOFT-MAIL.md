# Microsoft 365 mail input

## Current status — TEST worker recovery-to-card verified; connector not enabled

TEST **079** adds `learn_operator_microsoft_status` behind existing OpenFolk view
authority. At **02:41 UTC on 12 October**, installation and HTTP denial checks
preserved all 148 datasets. Full-schema positive SQL-role checks verified scoped
counts, pagination, revocation and sanitization; all banned/passwordless actors and
temporary grants rolled back. The frontend status reader and operator panel pass
three new tests, full TypeScript and the frontend build but are **not deployed or
signed-in verified**. Progress counts describe retained observations, not unique
emails or current mailbox coverage. Raw tokens, message content and provider
continuations remain private. Guidance identifies reconnect, provider delay,
checkpoint review and capture-pause cases without offering unimplemented resets.
[Operator diagnostics evidence](evidence/learn-microsoft-status-2026-10-12.json).

Worker **v20** was deployed at **02:25 UTC on 12 October**. All 148 datasets and
other endpoints were preserved; downloaded-source checks matched 110 runtime
modules and 177 emitted imports. Twenty control-flow tests passed against both
local and downloaded code, alongside strict TypeScript. At **02:27 UTC**, five
hosted calls verified auth denial, recovery of one retained synthetic email while
capture/account/binding were disabled, and its delivery to one card by the deployed
identity worker. Fresh paused work remained unclaimed with zero attempts; a repeat
invocation claimed nothing. The fixture is archived, with no credentials or human
access and all remaining jobs cancelled; all 148 external datasets were unchanged.

This proves deployed recovery and downstream delivery, not a fresh Graph fetch or
real-mailbox capture. Consent/identity provisioning, coverage and recovery controls,
and real-provider/signed-in acceptance remain required. The controller continues
to advertise `adapterImplemented: false`.
[Deployed worker evidence](evidence/learn-microsoft-worker-test-2026-10-12.json).

### TEST schema and RPC checkpoint

TEST release **078** installed at **02:17 UTC on 12 October** following an exact
package rehearsal. Its eight private Microsoft tables were initially empty and
all 140 existing dataset counts/hashes were preserved. At **02:20 UTC**, the actual
local handler/credential port/reader completed a synthetic email-to-card journey
over the real hosted RPC boundary in 16 requests. Refresh rotation, durable source
and canonical records, identity/card publication, replay without duplicate fetch
or card, and unsigned/anonymous/wrong-application denials all passed. The 148
preservation datasets outside the fixture were unchanged.

The retained synthetic evidence belongs to an archived fixture company; capture
is paused, its binding/account revoked, token deleted and remaining jobs cancelled.
No human access or real provider request was created. At this checkpoint the
deployed worker was still v19; v20 deployment and recovery acceptance are recorded
above. Consent/identity provisioning, controller coverage and real-mailbox
acceptance remain open.
[TEST 078 evidence](evidence/learn-microsoft-test-078-2026-10-12.json).

For rollback, keep the installed source pages, receipts and other retained
Microsoft evidence. Pause affected capture and cancel only unstarted synthetic
test jobs where applicable; do not drop the new tables to roll back application
code. Existing worker v19 can remain in place while Microsoft has no active
accounts or scheduled jobs. Any later worker downgrade needs a fresh compatibility
check, because this package changes the shared claim function to respect Microsoft
capture pauses while permitting saved-page recovery.

### Earlier verification checkpoints

On 12 October, the server-side credential port and refresh RPCs were added and
verified against isolated PostgreSQL with synthetic credentials. The complete
Microsoft suite now has **68 passing tests**, plus actual SQL/reader/settlement checks
and strict worker/Microsoft TypeScript checks. This extends the earlier hosted
projection rehearsal below. At **02:11 UTC on 12 October**, all nine Microsoft
migrations and five probes passed together against the complete hosted TEST 077
schema, then rolled back. All **140 existing dataset counts and hashes** and the
original catalog were restored. Credential rotation and stale-write protection,
role/claim denial, retry delays, pause without consuming a retry, and retained-page
completion after pause/revocation passed alongside canonical projection, recurring
discovery and same-card refresh. No Microsoft tokens, fixtures or schema remain
installed; there were no real provider requests or production changes.
[Hosted worker evidence](evidence/learn-microsoft-worker-hosted-2026-10-12.json).

At that checkpoint, persistent TEST installation and hosted RPC/worker acceptance remained open.
Consent/identity provisioning, controller coverage and real-mailbox acceptance
remain required; a successful synthetic rollback does not establish live capture.

`microsoft_capture_handler.ts` is now registered for `email.microsoft_discovery`
and `email.microsoft_sync`. Its completion, failure, retry and pause handling
passed isolated actual-SQL acceptance; 20 actual generic-worker control-flow tests
also pass. This is a source-code registration, **not a hosted worker deployment**.
No real credentials, consent, accounts or schedules were created or enabled.

On 11 October 2026, the first Microsoft Graph mail delta reader was implemented in
`supabase/functions/_shared/microsoft_mail_page.ts`. Folder discovery and resumable traversal are now implemented in
`microsoft_mail_folders.ts`, using the extracted shared
`microsoft_graph_transport.ts`. The combined 58 reader/discovery/engine/job tests and strict
TypeScript checks pass. The additive source-journal migration now also passes
isolated PostgreSQL checks using page/checkpoint fixtures generated by these actual
readers, including observed two-session lock contention, rollback and lease expiry.
The page engine now drives the actual journal RPCs in that isolated database,
including lost-reply recovery by a replacement worker without provider access.
The six Microsoft migrations plus the existing platform-event foundation passed a
full-schema hosted TEST rollback rehearsal at 14:59 UTC on 11 October; none remains
installed. Complete retained messages produced common email/thread/interaction
records and durable downstream events in the same settlement transaction. All 113
existing datasets and the original catalog were restored. No real Microsoft
credentials, accounts, provider requests or production changes were involved.
[Projection evidence](evidence/learn-microsoft-projection-2026-10-11.json).
The controller's `microsoft_365` entry remains `adapterImplemented: false`.
This is groundwork for the full reusable input adapter; live mail capture is not enabled.

## Implemented behavior

The reader fetches one Graph v1.0 page for an explicitly scoped company, email
account, Microsoft directory mailbox object ID and actual folder ID. A successful
result says `persistence: not_attempted` and `attachmentsCaptured: false`. Its folder
round completion flag describes the provider response only; it cannot establish
stored evidence, mailbox coverage, freshness or connector health.

The initial request selects message content, participants, source timestamps,
headers and identity fields without a date or change-type filter. Every request
asks for immutable message IDs. Follow-up requests preserve Microsoft's complete
opaque URL, after checking the global Graph host, mailbox, folder, resource and
continuation kind. Redirects are rejected. IDs remain case-sensitive; encoded
slashes stay inside one identifier. Slash, OData parenthesized and qualified delta
function forms are accepted. These choices follow Microsoft's
[message delta contract](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
and [immutable ID guidance](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
National-cloud Graph hosts and mailbox UPN aliases are not supported by this reader.

Partial updates retain only the supplied fields. Missing fields do not become
null; explicit nulls remain explicit. The original provider object, duplicate
observations and seven-digit timestamp fractions are retained. A removal is a
folder-membership event, never permission to delete retained email evidence. Delta
ordering is not a reliable chronology. An empty page with a next link stays
incomplete, and an unchanged terminal delta link is allowed. See Microsoft's
[delta overview](https://learn.microsoft.com/en-us/graph/delta-query-overview) and
[mail change tracking](https://learn.microsoft.com/en-us/graph/delta-query-messages).

Each fetch has a 30-second timeout, a 16 MiB response limit and a 1,000-event ceiling;
page size preference is constrained to 1–100. Malformed, oversized or mis-scoped
pages fail as a whole. Errors distinguish authentication, denied access, missing
folder, expired delta, throttling and provider failure. Retry-After is returned to
the future scheduler; this reader does not retry, reset a cursor or silently
truncate content. Error messages exclude provider bodies, tokens and URLs.
Returned raw bodies and continuation URLs are private runtime data, not log data.
HTML bodies must not be rendered as trusted application HTML.

## Canonical projection — local and hosted rollback verified

`20261101280000_learn_microsoft_message_projection.sql` publishes only complete,
non-draft observations from immutable saved source pages. Message and conversation
identities include the Microsoft directory and mailbox, preventing collisions
between mailboxes. The newest provider modification timestamp wins across folders,
including its seventh fractional digit. Sparse or conflicting observations stay
held; folder-removal observations never delete retained messages. Hydration and
operator visibility for held observations remain unfinished.

The settlement wrapper first validates the live queue claim, then atomically
publishes email messages, threads, interactions, pending platform events and an
immutable projection receipt before completing the queue job. A failure rolls
back canonical writes and settlement, leaving the original source page available
for retry without another provider fetch. Exact retries recover their receipt.
An event proves a durable hand-off, not successful enrichment or customer-card
creation. Attachment presence is retained, but file capture remains false and
mailbox coverage remains unverified.

The real TEST schema lacks `interactions.source_version` and `platform_events`.
The first two rollback rehearsals exposed these dependencies; preservation was
verified after both failures. Projection now keeps its content hash in scoped
interaction metadata and uses the existing authoritative event-bus foundation as
an explicit prerequisite. The successful third rehearsal applied that foundation
and all six Microsoft migrations inside one rolled-back transaction. It did not
install a runtime release or activate any schedule. Any future release must
inspect its target schema and package the missing prerequisites explicitly.

The isolated actual-engine harness adds seven grouped checks for atomic
publication, lost replies, duplicate/sparse/draft/removal handling, version
ordering, mailbox isolation, downstream failure/retry and permissions. It used
eight synthetic fetches and zero real provider requests. The 58 focused Microsoft
reader/folder/engine/job tests also pass. The hosted full-schema probe independently
checks canonical records, durable event, stable retry, source retention and access
denials. Real-mailbox capture, downstream card delivery, token lifecycle and
worker/controller integration remain open.

## Folder discovery behavior

`beginMicrosoftFolderDiscovery` starts at the mailbox root.
`stepMicrosoftFolderDiscovery` reads exactly one page and returns that original
page together with a new private server checkpoint. It never mutates the input
checkpoint. The caller can serialize the checkpoint after each successful step;
the tests resume this way through root pagination and nested hidden folders.
The database journal now implements atomic page/checkpoint commits and worker
lease checks, verified in isolation. The page engine connects this walker to those RPCs. Live credential ports, worker
registration and schedules remain pending. Queue settlement and same-stream continuation are locally verified below.
These checkpoints must come from trusted server storage, not a client request;
their shape checks do not authenticate their provenance.

The reader asks for hidden folders on every initial collection request. It visits
all discovered folders, even when `childFolderCount` is zero. Search folders are
identified as virtual views rather than independent capture targets; their
children are still traversed. Each folder's ID is scheduled once. Overlapping
observations remain in the returned raw page; the checkpoint retains the first
metadata observation rather than inventing an ordering between conflicting names
or counts. A changed parent/type or hierarchy cycle fails the pass. No existing
stored folder or mail is deleted on disappearance or failure.

List continuations stay on the same mailbox and parent collection. Numeric
pagination must retain `includeHiddenFolders=true`; opaque skip tokens are passed
unchanged and may carry original options. An explicit false hidden flag, a newly
introduced filter/search, a foreign resource, or an ambiguous cursor is rejected.
Repeated exact request URLs across multiple pages are detected. The pass stops
with an explicit error at 10,000 folders or 10,000 pages, without advancing the
caller's checkpoint or presenting a truncated inventory as complete.

`traversalExhausted` means the queue from this traversal has been visited, including
its pagination. It is not a consistent point-in-time mailbox snapshot, persistence
proof, imported-message coverage or connector readiness. Mailboxes can change while
being scanned; future schedules must repeat discovery and reconcile changes.
Folder counts are provider observations and are not summed into mail import totals.
All returned pages, names and cursor URLs remain private runtime data.

## Source journal — isolated database verification only

`20261101180000_learn_microsoft_source_journal.sql` adds private mailbox bindings,
capture streams and append-only source pages. It does not modify existing mail,
create credentials, enable a binding, schedule a job, or populate shared cards.
All three tables have RLS and no direct grants to anon, authenticated or service
roles. Only the service role can call the open/commit entrypoints; internal helpers
are not callable by application roles. A mailbox binding starts disabled. Verified
credential provisioning and binding management are separate unfinished work.

Bindings fix the company, account, Microsoft tenant and mailbox identity. Replacing
an identity requires a new binding; disabling an old binding retains its evidence.
Streams separate folder discovery from each folder's message cursor. The journal
requires an active Microsoft email account, eligible binding, permitted Email
capture, matching queue job and current worker claim/lease. It uses the existing
capture-switch lock and locks the account/binding while committing.

`learn_microsoft_journal_open` returns the stored stream checkpoint and revision,
creating an initial stream only if absent. It never resets an existing stream.
`learn_microsoft_journal_commit` requires the exact prior checkpoint and revision,
stores the entire validated-reader page and next checkpoint in one transaction,
and checks the lease again before returning. Revisions are returned as decimal
strings. A request UUID permanently identifies one exact job/page/transition.
A retry recovers its original metadata receipt, including after pause or lease
expiry; that read-only recovery does not authorize additional capture. A changed
request or stale revision cannot advance the stream.

The stored page retains raw provider objects, repeated observations, sparse changes
and removal events. There is no materialization, message deletion, body replacement
or health promotion in this migration. Private source pages and continuation URLs
must never become general-purpose logs or client-readable tables. The journal
checks scope, page contract and basic cursor transitions; the resource readers
remain responsible for full Graph validation. A receipt proves atomic storage,
not provider authenticity or imported-mail coverage.

`python3 scripts/verify/learn-microsoft-journal.py` uses a disposable network-isolated
PostgreSQL 15 container with synthetic account/job dependencies and the actual
capture-switch predicate. Its fixtures come from the real TypeScript readers.
It verifies migration rollback, application-role denial, exact recovery, stale and
cross-company rejection, pause/revocation/lease checks, rollback after a source-page
insert, lease expiry during commit, two competing jobs with observed database lock
contention, concurrent exact retries and immutable raw evidence. Full deployed-schema,
PostgREST/Auth and hosted provider acceptance are not covered by this harness.

## Page engine and per-job recovery — local integration verified

`microsoft_capture_engine.ts` binds the current worker claim to the authoritative
queue payload through `learn_microsoft_journal_job`. It validates the company,
mailbox, stream checkpoint and receipt response before relying on them. It opens
the saved stream, calls the folder/message reader and submits the original page
with its next checkpoint. Only a matching commit receipt permits a
`source_page_stored` result. Unknown replies remain unconfirmed; database/provider
content and credentials do not enter its errors or result metadata.

The companion `20261101181000_learn_microsoft_job_receipts.sql` migration enforces
one source page per job and exposes its saved receipt to the current lease holder.
On retry, the engine recovers that result before stream admission or token access.
This allows recovery after a lost reply, including when the binding has since
been disabled, without authorizing further capture. Applying the unique index
requires no existing multi-page-per-job history; it fails rather than deleting
such evidence. Neither local migration has been deployed.

Message checkpoints now retain request URLs for the active delta round and reject
repeated cursors across separate queue jobs. A terminal delta clears that round's
history while preserving the continuation for a later round. Stored observations
include duplicate changes and removals, so the count is explicitly not a distinct
email count. Every engine outcome keeps `mailboxCoverage: unverified`.

The isolated integration uses the actual engine, Graph readers and PostgreSQL RPCs.
Only Graph/token acquisition is synthetic. It deliberately drops a committed reply,
reclaims the job with a replacement worker, disables the binding and confirms
recovery without a second token/provider request. It also exercises denied new
work on a disabled binding, nested-folder continuation, already-exhausted discovery,
message delta rounds, raw-body retention and multi-job cursor-cycle rejection.
Both migrations' rollback checks pass. Ten engine unit tests additionally reject
malformed/foreign responses, unsafe revisions and mismatched commit receipts, and
verify input mutation isolation and error redaction. The other 38 transport and
folder tests remain passing.

This page engine does not itself settle queue rows or enqueue successors. The job
wrapper below provides that boundary; the 12 October credential and failure paths
now connect it to `WORKER_HANDLERS`. Hosted release and real consent remain open.
The locally verified folder-to-message dispatch below completes the initial fan-out.
The supplied token port must revalidate account/binding/credential authority
immediately before token acquisition. The implemented port is verified with synthetic
credentials, not an authorized real Microsoft mailbox.

## Atomic queue completion — locally verified, not deployed

`microsoft_capture_job.ts` wraps the page engine with the service-only
`learn_microsoft_job_settle` RPC from migration
`20261101182000_learn_microsoft_queue_completion.sql`. A completed-job receipt
recovers before token or provider access. New completion requires retained source
evidence (or previously exhausted discovery), marks the parent succeeded and
creates its same-stream continuation in one transaction. Terminal pages create no
immediate successor. Every result keeps mailbox coverage unverified.

Eight wrapper unit tests verify receipt identity/counts, bounded dispatch summaries, malformed or uncertain
settlement responses, recovery ordering and denial after failed source storage.
The actual wrapper and SQL pass isolated PostgreSQL integration: two concurrent
settlements with observed lock contention return the same receipt and exactly one
child; lost replies recover; successor insertion failure and lease expiry roll
back completion while retaining source evidence. Role/scope checks, immutable
receipts, no-page denial and paused-binding recovery also pass. Retained work can
finish after a binding is disabled, but new source capture remains denied.

The initial settlement migration advances only the current stream. The additive
folder-dispatch migration below now connects retained discovery pages to their
message jobs. The fixture uses synthetic dependencies and Graph responses;
full-schema, hosted and real-mailbox acceptance are still required.

## Discovery-to-message dispatch — local integration verified, 11 October

`20261101192000_learn_microsoft_folder_dispatch.sql` connects each retained
folder-discovery page to bounded message jobs inside the same lease-bound
settlement transaction. A private immutable dispatch ledger records one decision
per folder in a discovery stream. Physical folders, including hidden folders,
receive message jobs. Search folders retain an explicit exclusion with no message
job; their physical descendants remain eligible when discovery reaches them.

Repeated observations share the first dispatch, even after its message job has
completed. A matching active job is reused; an occupied key with different
company/account/binding/payload identity is refused. New jobs use the existing
message engine and its saved stream cursor. No stream is reset and no source is
deleted. Each settlement handles only its retained page (at most 1,000
observations), rather than creating jobs for an entire mailbox in one transaction.

The receipt exposes bounded counts for physical/search folders, newly queued jobs,
reused active jobs and prior dispatches. It does not expose names, contents or
provider cursors. Counts represent dispatch decisions, not imported emails or
mailbox coverage. Older completion receipts without dispatch metadata remain
readable without implying that message jobs were created.

Actual TypeScript readers, engine, wrapper and four SQL migrations pass the
network-isolated PostgreSQL integration. A discovered folder queues a message job
which retains the synthetic source email. Checks include nested/hidden/search
folders, duplicate observations after message completion, active-job reuse,
conflicting identity rejection, rollback after partial dispatch inserts, lease
expiry, observed concurrent settlement, lost replies and paused no-token behavior.
The eight wrapper unit tests also validate bounded/sanitized dispatch receipts;
56 combined reader/engine/wrapper tests and strict worker TypeScript pass.

The migration preserves the existing settlement function's owner and execute
grants, denies all application roles direct dispatch-table/helper access, and
rehearses rollback. It takes short-timeout queue/completion locks during upgrade.
An installation with already-completed discovery jobs is explicitly refused:
those retained pages need a separately reviewed backfill, never silent omission or
changed historical receipts. No Microsoft migrations are hosted yet.

Completion of retained evidence can queue work after pause, but the new jobs
cannot obtain tokens or capture new pages while the binding is disabled. The
integration verifies this distinction. Full target-schema, hosted, real-provider,
recurring-discovery and canonical-card publication acceptance remain open.
[Local evidence](evidence/learn-microsoft-folder-dispatch-local-2026-10-11.json).

## Recurring message rounds — local and full-schema TEST rehearsal, 11 October

`20261101260000_learn_microsoft_incremental_queue.sql` extends atomic settlement:
a completed message round now creates one future queue job, due five minutes later,
for the same mailbox/folder stream. A nonterminal page continues after one second.
The next run uses the exact retained delta/next URL through the existing capture
engine; no cursor is reconstructed or reset. Microsoft's [message delta guide](https://learn.microsoft.com/en-us/graph/delta-query-messages)
describes using the saved delta link for subsequent rounds. The interval here is a
ServiceOS default, not a Microsoft requirement or an assertion of mailbox freshness.

Completion, successor insertion and the immutable receipt remain one transaction.
Receipts add `continuationKind` and `nextCheckAt`, using the queued job's actual due
time. The client validates those fields together with the source and successor.
Old receipts remain readable unchanged; replay never retroactively schedules them.
Existing completed imports will need an explicit initial restart when this connector
is enabled. Failed enqueue or expired lease cannot claim completed scheduling.

The queue's actual claim function excludes jobs before their due time. At execution,
the journal still checks company and Email switches, account eligibility, binding
and current lease before token acquisition. Paused or revoked inputs do not make
new provider requests. Completion may retain a future queued job during pause;
this is not permission to capture. Worker-level deferral and operator resumption
must be connected before activation. Credentials/provider failures do not generate
an uncontrolled retry loop in this function; queue failure/recovery remains a
worker responsibility. A folder discovery pass still does not repeat automatically.

Verification:

- **58 focused tests** and strict worker TypeScript pass. The isolated PostgreSQL
  pipeline executes real reader → journal → queue settlement → due-time claim →
  later delta round. Only Graph/token ports and dependency tables are synthetic.
- A later round retains a new message and a folder removal while preserving the
  original source page. Multiple pages use the correct opaque URLs; terminal
  completion schedules the next round. Stored removals do not delete prior mail.
- Lost completion replies recover the same schedule without another provider
  request. Actual queue claims cannot take a future job. Pause, disabled account,
  revoked account and disabled binding all stop before token acquisition. Successor
  insertion failure rolls back completion while preserving the source page.
- The combined five migrations passed the **full hosted TEST schema** inside a
  rolled-back transaction at 13:31 UTC. Actual discovery dispatches a message job;
  its source page yields a future incremental job. Receipt replay, pause rejection,
  tenant boundaries, service-only RPC access and denied direct journal reads pass.
- All **113 existing datasets**, the original schema and previous access were
  restored. Synthetic tenant/account/queue rows disappeared with rollback. No Auth
  account/session, platform grant, credential, provider request or production write
  was created. This proves database compatibility, not real-mailbox acceptance.

[Local and hosted evidence](evidence/learn-microsoft-incremental-2026-10-11.json).
The one-shot rehearsal journal is private; do not replay it after an uncertain result.
This connector still reports `adapterImplemented: false`. Token lifecycle, worker
registration, recurring folder discovery, expired-delta recovery, canonical email/
card publishing, operator controls and authorised real-provider acceptance remain
required before activation. No Microsoft mailbox is currently identified for Drummonds.

## Current source-to-card compatibility — 11 October, 18:36 UTC

The six existing Microsoft journal, dispatch, incremental and projection migrations
now pass a combined rollback rehearsal against TEST release **066**, using its
actual installed identity/card publisher and durable processing settlement.
A synthetic Graph-format message produced one enriched card. A later message
version refreshed that same card, retained the person relationship and preserved
both original source pages. Both ready events were consumed. Two fenced identity
publications, two immutable identity receipts and two successful processing-job
settlements were confirmed; exact publication replay returned the original receipt.

All **121 existing datasets** and the original schema fingerprint were preserved.
The candidate Microsoft tables, functions, fixture mailbox and jobs disappeared
with rollback. No Auth user, session, operator grant, credential, provider request
or production change was created. All 58 reader/engine/job regression checks pass.

This closes synthetic compatibility between Microsoft projection and the current
card path. It does not install or activate the connector, prove a real mailbox,
exercise token lifecycle or demonstrate unattended worker registration. The
remaining items below still apply; `adapterImplemented` remains false.

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-microsoft-card-rehearse.mjs --rehearse --existing-cli-login
```

The rehearsal has a one-shot private journal. Inspect its exact outcome before any
retry; do not overwrite or reuse a submitted journal. The previous 060 rehearsal
retains its original pins and has not been silently rebased.
[Combined evidence](evidence/learn-microsoft-card-rehearsal-2026-10-11.json).

## Repeat folder discovery — verified locally and in rollback TEST rehearsal

On 11 October at 18:46 UTC, the recurring-discovery migration passed the current
TEST 066 full-schema rehearsal. A terminal folder scan now atomically records an
immutable round transition, resets traversal with a higher revision, and queues
the next scan for 15 minutes later. Original terminal pages and completion
receipts remain unchanged. Newly observed physical folders start a message job;
previously dispatched folders keep their original job/stream identity. No folders
or messages are deleted merely because they are absent from a later scan.

The actual page/job engines in isolated PostgreSQL verify future-job gating,
pause and revocation before token access, exact lost-response recovery, and a
late settlement failure that rolls back the reset, round record and successor
while preserving the source page. Existing completed receipts do not acquire a
new schedule on migration; an explicitly admitted job can restart an old exhausted
stream. The old terminal page supplies that transition's evidence without
inventing a new provider page. All 59 adapter tests and strict TypeScript pass.

The hosted rehearsal ran two discovery rounds, dispatched one newly added folder
exactly once, retained the prior dispatch, and reran the source-to-card journey
against the installed identity publisher. All **121 datasets** and the original
catalog matched after rollback. No Microsoft schema, account, user, grant,
credential or schedule was retained; zero provider requests and production writes.
This is synthetic compatibility, not real-mailbox or unattended-worker acceptance.

```sh
LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy \
  node scripts/verify/learn-microsoft-discovery-rehearse.mjs --rehearse --existing-cli-login
```

This command uses its own one-shot journal; never overwrite a submitted run.
[Evidence](evidence/learn-microsoft-discovery-2026-10-11.json).

## Credential execution path — local only, 12 October

`microsoft_capture_ports.ts` obtains credentials only through
`learn_microsoft_credential_read` and `learn_microsoft_credential_refresh` in
`20261101470000_learn_microsoft_credentials.sql`. Both RPCs require service-role
execution, the current job owner/attempt/lease, the exact company/account/mailbox
binding, active account, enabled binding and current capture permission. Human
roles cannot invoke them. They reuse `email_oauth_tokens`, whose browser reads are
denied by RLS; no new direct table grants are added.

An existing Microsoft token row is insufficient by itself. Its `raw_payload`
must contain a trusted `learnMicrosoft` association with contract
`microsoft-delegated-credential/1`, Microsoft tenant ID, mailbox ID, immutable
binding ID and app client ID. **The future consent callback must authenticate the
initiating company/user and validate the provider identity before writing this
association.** This migration does not supply that callback or treat UUID shape
as proof of identity. It creates no real association or credential.

`MICROSOFT_MAIL_CLIENT_ID` and `MICROSOFT_MAIL_CLIENT_SECRET` are server-only
configuration names; neither has been provisioned here. `microsoft_oauth.ts`
refreshes against the bound Microsoft directory's official token endpoint,
requests only Graph `Mail.Read`, rejects redirects and bounds response size/time.
Tokens remain opaque. Refresh-token replacement and omitted scope handling follow
Microsoft's [authorization-code and refresh contract](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
Endpoint bodies and credentials never become operator errors or queue results.

Refreshed tokens are saved only if the stored token ID, version and old refresh
token still match. The RPC checks current capture authority again and preserves
the original identity association. A newer refresh/reconnection wins; the port
re-reads and validates the committed token before using it. An uncertain save
reply stops that capture attempt without blindly resubmitting the refresh.

The isolated database exercises actual SQL, credential port, reader and queue
settlement together, including paused/revoked access, cross-company/client/mailbox
denial, stale writes and revocation during refresh. This is synthetic provider
acceptance with minimal database dependencies. Real consent, hosted schema/HTTP
acceptance and controller credential health are open. Worker failure settlement
is now implemented as described below.
[Local evidence](evidence/learn-microsoft-credentials-local-2026-10-12.json).

## Worker retry, pause and recovery — local only, 12 October

`20261101480000_learn_microsoft_worker_failures.sql` adds private immutable stop
receipts and `learn_microsoft_job_stop`. Only the exact current worker, attempt,
live lease and Microsoft job definition may change an unsettled queue row.
Responses and persisted errors contain bounded codes, never provider bodies.
An exact already-saved stop can be read back as historical evidence; a late worker
cannot replace a completed outcome or act for a newer claim.

Temporary failures use the existing attempt budget and backoff, respecting longer
provider `Retry-After` delays. Unsupported delays exceeding the queue's one-year
bound are held for review instead of silently shortened. Permanent failures and
exhausted retries stop for review while preserving all checkpoints and source data.
Expired deltas are **not** automatically reset; operator resynchronization remains
to be implemented. Pausing after claim returns the attempt and queues a later check.
The additive claim filter prevents fresh paused work from consuming an attempt,
while retained pages can still be claimed for completion.

A saved source page always takes precedence over a proposed failure or pause.
An uncertain page acknowledgement leaves that row available for its original
completion/recovery path. An uncertain stop acknowledgement is reported as
unconfirmed. The generic worker consumes the confirmed durable outcome without
calling its generic completion/failure updater a second time. Historical receipts
do not create new health observations, and Microsoft completion does not claim
mailbox-wide coverage or fresh whole-Email health.

Actual isolated SQL/handler/credential/reader acceptance covers provider retry then
canonical email publication, lost stop replies, pause without provider calls,
same-worker resume, permanent errors, exhausted retries, source-page recovery while
paused/revoked, stale claims, rollback and receipt access boundaries. The VM tests
execute the generic worker's real control flow with synthetic handler/queue ports;
they do not establish an Edge deployment or real network execution.
[Worker evidence](evidence/learn-microsoft-worker-local-2026-10-12.json).

## Remaining work to deliver the connector

1. Resolve each authorized company/account to its Microsoft tenant and mailbox;
   integrate consent, provision the locally and hosted-RPC verified token association/refresh path,
   complete revocation and read-only mail content
   permissions. Transport UUID validation is not authorization. Revalidate the
   company/module/account permission and capture switch at execution time.
2. Deploy and verify the implemented operator progress panel against TEST 079,
   then complete coverage reconciliation and message-capture eligibility. Prove nested/hidden/search
   behavior on an authorized real mailbox. Discovery and explicit exclusions must
   be visible to OpenFolk. The local traversal does not prove real mailbox coverage.
   Its traversal follows Microsoft's
   [root folder listing](https://learn.microsoft.com/en-us/graph/api/user-list-mailfolders?view=graph-rest-1.0)
   and [child folder listing](https://learn.microsoft.com/en-us/graph/api/mailfolder-list-childfolders?view=graph-rest-1.0).
3. Complete fresh-provider execution and scheduled capture acceptance on the
   installed TEST 078/worker v20. Full-schema credential/failure rehearsal, hosted
   RPC refresh/storage/card publication, deployed saved-page recovery and pause
   exclusion are verified. Complete expired-delta and deleted-folder recovery
   without discarding old source evidence. Repeat discovery is installed but has
   not run against an authorized real mailbox.
4. Add hydration and operator handling for sparse/conflicting events currently
   held from canonical publication. Complete message projection, timestamp-based
   version ordering, retained removals and original bodies already pass synthetic
   SQL/RPC acceptance; prove them on real inputs. Define attachment, inline content and unsupported-folder
   handling; `hasAttachments` alone cannot prove attachment capture.
5. Complete historical/incremental scheduling acceptance and safe operator
   recovery actions. Read-only progress/diagnostics are installed in TEST 079;
   fresh-work pause exclusion is verified on worker v20. Stop future work on disable or
   revocation. Keep customer-facing progress calm and truthful about missing/stale
   inputs, while providing diagnostic detail in OpenFolk.
6. Extend verified isolated storage/retry/concurrency and hosted TEST access/recovery
   behavior to an authorized real mailbox and signed-in user journey. Only then mark adapter capability as
   implemented and evaluate enabling capture. Production remains a separate release.

## Reproduce local checks

```sh
python3 scripts/verify/learn-microsoft-journal.py
node --test supabase/functions/_shared/microsoft_mail_page.test.ts \
  supabase/functions/_shared/microsoft_mail_folders.test.ts \
  supabase/functions/_shared/microsoft_capture_engine.test.ts \
  supabase/functions/_shared/microsoft_capture_job.test.ts \
  supabase/functions/_shared/microsoft_credentials.test.ts
node scripts/verify/learn-worker-typecheck.mjs
node --experimental-vm-modules --test scripts/verify/learn-capture-queue-handler.test.mjs
```

Tests exercise the exported reader with synthetic provider responses, including
exact outgoing requests, continuation traversal, source preservation, invalid
scopes and foreign destinations, malformed pages, byte limits, error classification,
retry timing, in-flight scope mutation and completion timestamps. Folder tests also
cover serialized resumption, nested and hidden discovery, virtual folders, overlapping
pages, hierarchy conflicts, longer cursor loops, explicit limits and handing a
discovered folder to the mail reader. They are not
real-provider acceptance, database preservation or authenticated controller tests.
