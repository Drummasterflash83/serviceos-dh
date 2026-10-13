# Voicemail: production historical intake

Updated 13 October 2026, 12:04 BST. **71 production voicemails and 71 original-source records verified from 78 retained candidates. Three withheld for signature-header verification; four originals unavailable. All historical routes paused. Full provider-history and ongoing-intake coverage remain incomplete.**

## Historical repair and continuation

The signature-time failure was resolved against RFC6376§3.5 and mailauth7.3.0:
archived verification now uses the authenticated Gmail receipt with bounded
signing-clock skew and signed Date/expiry checks. Generic current-time verification
remains unchanged. All cryptographic, body, signed-header, recipient and route
requirements remain enforced. Seventeen tests passed and a rejected real source
passed read-only extraction. Matching production importer v2 and platform-worker
v58 were published and verified; authentication, environment and schedules stayed
unchanged. Exact old artifacts are retained for rollback.

The shared-office continuation published all nine available, verified originals.
A second exact legacy footer for personal mailboxes was subsequently added and
verified against synthetic signed messages and every remaining available original.
Production importer v5 contains the repair; cryptographic and routing guards remain
unchanged. The latest historical continuation is complete below.

## Latest verified production result — 12:04 BST

- **71 published:** mailbox 601 (Office) 9; mailbox 102 (Liz) 9;
  mailbox 103 (Office recipient) 45; mailbox 105 (Tony) 8.
- The final continuation imported **60 of 60 eligible sources**. Three duplicate
  replays preserved source/voicemail identities and counts. The previous eleven
  messages and sources remain unchanged.
- All five historical routes are paused; the two-source historical Anna route
  was never resumed. No pending jobs remained for the continuation routes.
- Existing mailbox owners, manager permissions, private buckets and the Office
  route were preserved. No new user access, phone routing, AI processing or
  ongoing voicemail capture was introduced.
- **Seven retained exceptions:** three originals omit `Content-Type` from the
  provider signature and remain withheld; four exact Gmail source IDs return 404.
  None was deleted or counted as successfully imported.
- The deployed importer verified original signatures, recipient/route/date
  binding, full audio decoding and stored-byte readback. Signed-in live browser playback is verified for Office and a representative
  Liz recording (4.68 seconds, played to the end, readyState 4, no media error).

[Sanitised acceptance evidence](evidence/learn-voicemail-history-2026-10-13.json).
Private execution journal:
`.verification-results/additional-voicemail-history-continuation-20261013.json`.
This reconciles the retained candidate set only. Complete provider-mailbox history,
ongoing capture and independent backup of both voicemail file buckets remain
separate delivery requirements.

## Approved initial scope

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

## Initial approval and first-message result

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

## Additional historical mailboxes — 13 October, 11:34 BST

Chris subsequently authorised all voicemail intake. Authenticated recipient-profile
and message-metadata checks found 74 available originals among 78 retained
notifications. Four original IDs returned Gmail 404; their retained email records
were preserved. This is coverage of retained candidates, not the whole provider
mailbox history.

The shared Office history now contains nine published sources/voicemails. Historical
signature verification and the exact legacy notification footer were repaired and
tested without relaxing recipient, signature, reference or audio checks. The three
legacy notifications correctly retain a null provider transcript.

The additional [historical route operation](../../scripts/operations/learn-voicemail-additional-history-routes.sql)
was rehearsed against the restored full schema. Creation, idempotency, date bounds,
tenant isolation, pause and rollback passed with unchanged managers and owners.
It covers 65 available originals: nine addressed to Liz for mailbox 102, two
historically addressed to Anna for 102, 46 addressed to Office for 103, and eight
addressed to Tony for 105. Existing managers-only visibility is retained; recipient
addresses do not imply historical ownership.

- Production imported the first two Liz sources successfully. The third returned
  `voicemail_import_unconfirmed`; the runner stopped and paused all four routes.
- Current totals are eleven voicemail records and eleven source records: nine
  Office and two Liz. Sixty-three additional candidates remain; the four planned
  replay checks have not run.
- Before/after checks preserved the original Office route, all prior voicemail
  sources/messages, mailbox owners, manager grants and both private buckets.
- The failed source needs a read-only diagnosis before another import attempt.
  No production processing failure is counted as completed coverage.

Exact candidate IDs and execution evidence remain in ignored private journals:
`.verification-results/voicemail-additional-history-import-plan-20261013.json` and
`.verification-results/additional-voicemail-history-execution-20261013.json`.
No source email/audio or credentials are in this document or Git.

### Read-only continuation preflight — 11:41 BST

The first Liz failure was an observed personal-mailbox footer variation: it says
“To access your mailbox, dial *95 from your handset.” The parser now accepts that
exact alternative to the shared-office footer; recipient, signature, reference,
attachment and audio checks remain intact. Sixteen synthetic parser/signature
tests passed. At that checkpoint this follow-up parser change awaited deployment;
production importer v5 now includes it.

All 63 remaining originals were then checked in memory through their authenticated
recipient accounts. Sixty passed signed-source extraction, exact mailbox/date
binding and full audio decoding: seven Liz, 45 Office-recipient mailbox 103, and
eight Tony. No original emails or audio were saved by this preflight.

The other three (two historic Anna-recipient 102 notifications and the oldest
Office-recipient 103 notification) have valid expected-domain signatures but omit
`Content-Type` from the signed headers. The existing guard therefore correctly
rejects unauthenticated MIME interpretation. They remain withheld for review;
signature requirements have not been weakened. At that checkpoint all historical routes were paused and the 60-source continuation
and duplicate checks awaited deployment. The latest verified result above supersedes
that execution status.

Private evidence: `.verification-results/additional-voicemail-history-preflight-20261013.json`
and `.verification-results/additional-voicemail-signature-review-20261013.json`.

## Wider provider history and ongoing capture

The 78 retained candidates above are not the whole provider history. A separate
bounded, metadata-only Gmail discovery found additional notifications outside the
retained email set. See the [provider-history and ongoing-capture plan](LEARN-VOICEMAIL-ONGOING-PLAN.md)
for listing limits, source-binding gaps and the proposed candidate-directed scan.
That assessment has not enabled routes or published additional audio.
