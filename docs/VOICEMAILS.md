# Voicemails — implementation and activation

Status: UI and private storage/access foundation implemented. **Not a live Birchills voicemail connector.**

2 October launch check: the schema, private bucket and protected playback function
are deployed. A read-only database check confirmed 12 DH mailbox bindings, zero
imported messages and `awaiting_connection` on every mailbox. Explicit manager
grants are present for **chris@openfolk.ai** and **heidi@drummondheating.co.uk** only
(12 mailboxes each). The bucket remains private with a 25 MB limit.

Only Heidi's mailbox 108 currently has an owner user ID. The other personal owners
still require binding to their verified ServiceOS identity before they can access
their own messages; a Birchills app invitation is not a ServiceOS identity grant.
No owners were inferred or access expanded during this check. No historical
messages have been imported.

Provider inventory confirmed mailbox 603 (Emergency Call-Outs), extension 109
(Rob - Commercial) and ring group 306 (Office Overflow). Inventory access does
not establish a voicemail-message/audio feed. The UI now shows **Awaiting sync**
instead of an apparent empty inbox for unsynced mailboxes, and explains the
missing provider connection before a mailbox is opened.

The DH receptionist menu adds Voicemails immediately after About your receptionist. OpenFolk has the same view. Mailbox owners and individually authorised managers only; an OpenFolk operator role alone does not unlock recordings. The migration grants nobody access.

## Verified provider capability and remaining gap

The official Sipcentric API specification documents endpoint names/extensions, voicemail-enabled settings and notification email addresses. It links an endpoint voicemail subresource but does not document a message listing, audio download, or per-message email delivery API:
https://github.com/sipcentric/pbx-api-docs/blob/master/api/v1.md

The current Hosted PBX documentation confirms the same distinction:
https://developer.simwood.com/docs/direct/api/v1/

On 2 October, the existing server-side credential successfully read the DH
endpoint inventory for provider customer 3950. The documented voicemail
subresources for mailbox 601 (endpoint 9304) and 603 (endpoint 180997) both
returned **HTTP 405**, with no message resource links. Endpoint discovery did
not advertise a voicemail-message collection. This is not evidence that the
mailboxes are empty, and does not justify guessing message URLs or polling the
signed-in browser session.

The existing adapter ingests ordinary phone calls and call recordings, not voicemail messages. Do not treat those as equivalent. The inspected Birchills Communicator currently shows call history and SMS, not a voicemail inbox. A verified message source is required before this feature can be called live.

## Exact provider handoff needed

Ask Birchills for a supported mechanism for **customer 3950** covering:

1. A mailbox-scoped message list with stable message IDs, received times, caller
   details, duration, pagination and retention/deletion behaviour.
2. An authenticated retrieval method for the actual deposited message audio,
   distinct from greetings and ordinary call recordings.
3. A webhook or incremental cursor for new/changed messages, including replay,
   signing/authentication, retries and event IDs.
4. Per-message notification evidence where available: intended recipient,
   accepted/sent versus delivered/failed, event time and reference ID.
5. Mailbox 603 delivery to **both Rob and Tony**, without changing personal
   mailboxes 109/105. If the provider supports only one notification address,
   use an approved managed distribution address whose membership is verified;
   do not put a comma-separated list into a single-address field.

A supported voicemail-to-email feed is an alternative, not an already-active
connector. Before building it, obtain an actual authorised sample, verified
sender/authentication metadata, attachment format, mailbox identity and stable
message identifier; configure a dedicated restricted recipient and retention.
Forwarding all staff email or merely trusting a claimed From/subject is not
acceptable. Import receipt is not proof that both engineers received their copy.

## Data and privacy

- Mailbox bindings must be verified against the right provider customer and real signed-in user IDs; never select the first provider account or infer access from an email string supplied by the browser.
- `receptionist_mailbox_managers` contains explicit, mailbox-specific authorisations for client or OpenFolk users. Writes are service-role-only. Confirm intended managers before creating any grants.
- Snapshot the message owner at receipt. Reassigning extension 104 must not expose Alan’s historical recordings to Rob.
- Metadata, transcripts and counts all use message-level RLS. Counts describe messages saved in OpenFolk, not an asserted complete provider inbox.
- Only server ingestion can write messages. A verified importer must upsert by mailbox/provider message ID. No public ingest endpoint has been added.
- Audio lives in a private bucket at `tenant/mailbox/message` (UUIDs). Service ingestion validates MIME/size; the bucket limit is 25 MB. No browser storage grants or arbitrary URL proxy.
- Playback rechecks user identity and message RLS, logs the access request, then returns a 60-second signed URL. Revocation prevents new links; an already issued link can remain valid for up to 60 seconds. Playback is not proof that a human listened to the whole message.
- Email `sent`, `delivered`, `pending` and `failed` require a source evidence reference and timestamp. Enabled notification settings alone remain `unknown` per message. Never mark delivered merely because a send was accepted.
- Store provider transcripts only where available and authorised. No new transcription processor is enabled.

## Activation checklist

1. Verify Birchills message-list, private audio retrieval and email-event capabilities (API or supported provider export/webhook). Do not scrape browser sessions into a backend job.
2. Build and test the provider importer against that observed contract, with explicit account binding, pagination, deduplication, retry and deleted-message handling. Set `current` only after a successful complete sync; keep last successful timestamp on failure.
3. Apply migration, deploy `receptionist-voicemail-recording`, confirm bucket remains private and test ACLs on staging.
4. Map verified owners and approved managers; agree retention with the customer before copying historical recordings. No bulk historical import by default.
5. Leave a controlled voicemail. Prove message/count/audio, email evidence and access denial as an unrelated user and another tenant. Verify mobile and desktop before marking the connector live. The private UI may be released earlier only with an explicit awaiting-connection state.

## Local checks

`node --test src/lib/voicemails.test.ts src/lib/client-workspace-nav.test.ts`

`npx tsc --noEmit` and `npm run build`

The standalone SQL bootstrap is ONLY for a disposable local Postgres database, never production. Run `scripts/voicemail-test-bootstrap.sql`, then the new migration, then `supabase/tests/voicemail_access.test.sql` with ON_ERROR_STOP enabled. The tests exercise real Postgres RLS, not just a JavaScript permissions model.
