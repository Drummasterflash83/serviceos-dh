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

### Bounded recording recovery — separate from voicemail activation

On 2 October, five existing failed ordinary-call recordings were converted from
their verified GSM WAV source to private PCM16 mono/8 kHz derivatives. Original
objects were retained; source and derivative SHA-256 hashes, exact tenant scope,
and compare-and-swap reference updates were audited before the existing pipeline
was retried once per recording. No new processor or recipient was introduced.

All five retries returned success. A separate database read confirmed
`stage = complete`, a completed transcript, stored audio and an analysis record
for each ID:

- `6674a6d9-3f4f-4da1-9642-20d55280da83`
- `1c31d8b8-8914-4fa3-8adc-876c717de426`
- `d2d8ac9f-9314-4fc7-990e-1a8552220035`
- `3b39a52c-10f0-425b-85ae-9e3412d827a1`
- `6d9035bf-b658-4117-90d1-dcb29d14049b`

The near-empty 125-byte source was not retried. This demonstrates a successful
bounded recovery, not that GSM encoding was the only cause of all failures;
completed comparator recordings also used that codec. It does **not** provide
Birchills voicemail-message ingestion, mailbox receipt or email-delivery proof.

Internal maintenance logs were additionally restricted with migration
`20261028150000_phone_operations_audit_private`: the existing Chris-only active
OpenFolk administrator gate is required, including its client-preview denial.
All 16 then-existing audit records were preserved. Rollback-only live SQL tests
proved Chris and the service role retained access while Heidi/client-manager,
missing-identity and anonymous reads returned no records. Customer progress
remains in the separate customer-facing feedback records, not raw provider
configuration or internal test transcripts.

### Original Alan greeting recovery — 2 October

The existing 29 September rollback notes identify the original files in
`/Users/chrisdrummond/Documents/DH Works/voicemail-audio/`. Silent transcription
of exactly these two SHA-256-pinned files through the already-approved OpenFolk
review key found an important filename/content mismatch:

- `Alan_unavailable.mp3` (238,584 bytes,
  `39af89039edced814102a72639774cc73547fce57aaf6965952eb1459f453040`)
  correctly says: “Hi, you've reached Alan's voicemail at Drummonds. He's away
  from his desk just now, so please leave your name, your number, and a short
  message after the tone. Alan will get back to you as soon as he can. Thanks!”
- `Alan_busy.mp3` (235,658 bytes,
  `7ce6294868f86cf3b108125c90600d3896e76ad437251bd76d410e1c07578315`)
  says **Tony**, not Alan. Do not restore it based on its filename.

The correct unavailable original was subsequently edited locally to remove only
the away-from-desk clause and its joining “so”, leaving a neutral greeting suitable
for busy or unavailable use in the same original voice. No speech was generated.
The word-timed cut is 2.90–5.35 seconds with a 10 ms crossfade between quiet
segments (−59.3/−60.3 dBFS); the splice's maximum adjacent-sample jump is 11/32768,
the source-rate edited audio has no clipped samples and peaks at −3.02 dBFS.
The final 8 kHz mono PCM16 WAV is 11.411 seconds / 186,672 bytes:

- `/private/tmp/Alan_neutral.wav`
- SHA-256: `66a96d4edaec54fb32ead4b6f6700cf804c7e4c9164a1f98c2a1c99da3d7ad68`
- Manifest: `/private/tmp/Alan_neutral_manifest.json`

Independent transcription of that exact final WAV, without a content/name prompt,
confirmed: “Hi, you've reached Alan's voicemail at Drummonds. Please leave your
name, your number, and a short message after the tone. Alan will get back to you
as soon as he can. Thanks!” This is an automated wording/signal check, not a claim
of subjective listening or an end-to-end phone acceptance test.

Verification did not change Birchills. The one-off
`receptionist-greeting-verify` helper accepts only those two originals and the
exact pinned neutral derivative, requires
a signed service request plus the existing Chris-only actor gate, reserves one
private audit ID per file before transcription, never retries uncertainty, and
expires on 3 October UTC. The original unavailable file alone additionally has
one fixed word-timing reservation using the same processor's documented
`whisper-1` timestamp option. No caller recordings, new processor, arbitrary source
URL or new credential were used. Both successful results are retained in the
private audit; unauthenticated access was verified to return HTTP 401. Restoration
to the two Alan104 greeting slots is a separate provider write; preparation does
not itself claim that the provider has been updated.

After both Alan104 slots were saved through Birchills, a separate GET-only
read-back of provider endpoint 9356's `busy` and `unavail` greeting resources
returned HTTP 200 and **bit-identical PCM audio** to the approved neutral file.
Birchills removed WAV padding: both returned 182,620-byte files with full SHA-256
`ed2f6d4fd41e0441d98706796fd7c3181dd6b422093c53fdfc091875a6e026c1`.
Their 182,576-byte PCM payloads both match
`fb10bc360eedd7dc9647c83f79f8cd1e91055dd2779d6caa9508149cbd9cdae6`.
The fixed private remediation audit
`03a1c104-7ba1-4869-a83d-16c9075a6432` records
`alan_greetings_restored_verified`, both match flags, audio/transcript hashes and
the original failed-call context. Rob109 was not accessed or changed by this
verification. The prior physical failure remains historical evidence; the
correct current label is **provider greeting restored; fresh call retest pending**.

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
