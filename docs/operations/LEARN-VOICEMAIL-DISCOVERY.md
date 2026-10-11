# Birchills voicemail: discovery before capture

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
