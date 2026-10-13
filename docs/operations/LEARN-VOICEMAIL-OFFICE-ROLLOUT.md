# Shared-office voicemail: prepared production acceptance

Updated 13 October 2026. **Approved; one production message imported and browser playback verified. Route paused. Historical acceptance remains incomplete.**

## Proposed scope

- Drummonds production `tgbnakbxwcqjeimygroz`, tenant
  `00000000-0000-0000-0000-000000000001` only.
- Existing Birchills shared-office mailbox **601**, receiving notifications at
  **office@drummondheating.co.uk**, through its existing active Google Workspace
  account. No new provider credential or mailbox setting.
- Import matching historical notifications received **19 July through 8 October
  2026 inclusive (UTC)**. Ten candidates are currently retained, each with an
  attachment hint. Additional matching notifications arriving from an email
  history import during this bounded historical run are within this same scope;
  ten is the observed count, not an enforced provider-volume cap.
- Store the signature-verified original email in the existing private production
  `learn-voicemail-sources` bucket and decoded/verified MP3 bytes in the existing
  private `receptionist-voicemails` bucket. Original messages are bounded to 1 MiB
  each; audio is extracted from those messages. Retain caller details, the provider
  transcript and source/byte-integrity receipts. No paid AI processing.
- Access stays with the mailbox's **existing two managers, Heidi and Chris**.
  No staff ownership is inferred, no tenant-wide publication or new grant is made.
  The source email is server-only; audio links require existing private mailbox
  permission and expire. No Slack DMs are involved.
- Use the deployed importer and existing queue/discovery controls. Verify replay
  deduplication, source/audio byte readback and signed-in private playback. Stop on
  an unconfirmed publication; reconcile saved receipts before retrying.
- **Pause this route after the acceptance run**, retaining messages and evidence.
  No ongoing voicemail schedule is activated by the final paused state. Existing
  email/phone capture remains unchanged.

## Current evidence

At 09:12 UTC, production had zero voicemail routes and zero imported voicemails.
Both target buckets were private; the Office email account was `active_dwd` and
Email/Phone capture gates were open. Existing mailbox-manager identities matched
Heidi and Chris. A prior real notification for mailbox 601, received 8 October,
passed signature validation and full local audio decoding (57,285 bytes,
28.512 seconds). This proves a viable sample, not the other nine candidates.
Each notification must pass the deployed checks independently.

The exact [route operation](../../scripts/operations/learn-voicemail-office-route.sql)
was rehearsed against an offline restored production schema with the 13 required
release packages. Route admission, pausing and transaction rollback passed;
no provider requests or hosted changes occurred. The disposable database had no
network, host mounts, published ports or active workers and was removed.
SQL SHA-256: `2d56a282fa5d9f84ce2a239aa30bbfd457421e49435f40c6c187ebed0cb02d16`.

## Execution and recovery

The caller sets the fixed project/run and `serviceos.voicemail_action` to `enable`
inside a transaction. The operation rechecks the existing mailbox, account,
manager set, private buckets, capture gates and absence of another Drummonds
route. It creates only the fixed route `ce601013-aaaa-4000-8000-000000000001`.
Its historical scope and binding evidence are immutable. The same operation with
`pause` switches only that route off; imported evidence is not deleted.

Before enabling, save current route, mailbox, manager and source preservation
metadata in an ignored private execution journal. Recheck afterward. Original
emails, existing phone recordings and access grants must remain unchanged by
this run; normal ongoing capture can add records concurrently.

The existing database backup covers database records, not these two file buckets.
Independent backup coverage for these new voicemail files remains a separate
launch requirement; this run must not claim that recovery gate is complete.
No AWS copy or infrastructure change is included in this proposal.

## Approval and current result

Chris approved the shared-office historical import in this chat. He also explicitly
approved a read-only production runtime credential fingerprint check after automatic
approval review rejected that diagnostic. The check found that the existing Edge
service credential differs from the legacy `service_role` key; the correct existing
credential was used without rotating, copying to a new destination or saving it.

At approximately 10:57 BST:

- Eleven retained candidate references were checked against the authenticated Office
  Gmail profile. Nine exact IDs/timestamps/recipients matched; two returned 404.
- The 8 October notification imported through the deployed handler. Original and
  decoded audio bytes passed storage readback; one source and one voicemail were saved.
- Replaying that same source preserved both identities and counts. Chris’s signed-in
  live inbox showed the source transcript and loaded its private recording. Browser
  audio reached readyState 4, duration 28.36 seconds, currentTime 14.50, no media error.
- Eight older notifications were rejected as `notification_signature_unverified`
  before publication. A separate in-memory probe found the expected 2048-bit signer,
  complete body and required signed headers, but signature time validity failed.
  Historical verification time is being investigated; no signature check was bypassed.
- The route is paused and the existing manager-set fingerprint is unchanged. No
  access grants, phone routing, AI processing or source email edits occurred.
- Private execution journals and the playback screenshot are retained under ignored
  `.verification-results/`; customer contents and credentials are not checked into Git.

## Original decision basis

The launch goal explicitly requires approval before copying recordings to a new
destination. Earlier approvals covered phone TEST and independent recording
backup; this proposal concerns the private **production voicemail buckets**.
Approval is for the historical import and existing private recipients above,
not new accounts, permissions, phone routing or an unbounded ongoing capture.
