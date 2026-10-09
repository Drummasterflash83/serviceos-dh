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
