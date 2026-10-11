# Birchills voicemail: discovery before capture

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
