# Voicemails — implementation and activation

Status: UI and private storage/access foundation implemented. **Not a live Birchills voicemail connector.**

The DH receptionist menu adds Voicemails immediately after About your receptionist. OpenFolk has the same view. Mailbox owners and individually authorised managers only; an OpenFolk operator role alone does not unlock recordings. The migration grants nobody access.

## Verified provider capability and remaining gap

The official Sipcentric API specification documents endpoint names/extensions, voicemail-enabled settings and notification email addresses. It links an endpoint voicemail subresource but does not document a message listing, audio download, or per-message email delivery API:
https://github.com/sipcentric/pbx-api-docs/blob/master/api/v1.md

The existing adapter ingests ordinary phone calls and call recordings, not voicemail messages. Do not treat those as equivalent. The inspected Birchills Communicator currently shows call history and SMS, not a voicemail inbox. A verified message source is required before this feature can be called live.

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
5. Leave a controlled voicemail. Prove message/count/audio, email evidence and access denial as an unrelated user and another tenant. Verify mobile and desktop, then release via normal Git deployment.

## Local checks

`node --test src/lib/voicemails.test.ts src/lib/client-workspace-nav.test.ts`

`npx tsc --noEmit` and `npm run build`

The standalone SQL bootstrap is ONLY for a disposable local Postgres database, never production. Run `scripts/voicemail-test-bootstrap.sql`, then the new migration, then `supabase/tests/voicemail_access.test.sql` with ON_ERROR_STOP enabled. The tests exercise real Postgres RLS, not just a JavaScript permissions model.
