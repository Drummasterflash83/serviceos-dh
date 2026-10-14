# Slack observed huddle marker retention

Retain the exact provider-observed `automatic_ai_huddle_notes_enabled` message as `source_needs_review`, with its original payload. The marker name does not establish the presence of meeting notes, AI content or staff activity. It must not become a conversation, customer finding or performance observation. Genuine observed replies continue through the existing importer. Hidden, malformed and other unknown message types remain rejected.

Apply `apply.sql` with `serviceos.release_target` and `serviceos.release_sha256` set to the manifest values. The transaction checks all nine reviewed function definitions, ownership and access, changes only the classifier and held-source count, and verifies the result. Do not also replay the numbered migration. Installation changes no source record, role grant, credential, schedule or campaign scope.

After SQL verification, publish the two matching immutable worker artifacts. Their source closure differs from the verified LIVE platform-worker v72 and learn-slack-worker v11 only in `_shared/slack/slack_message_kind.ts`. Those baseline versions have the identical artifact hashes and authentication settings retained from the preceding canvas release. Do not deploy unrelated parallel work from the shared checkout.

Resume the saved page only through the existing logged operator recovery control, retaining the campaign dates, checkpoint, request allowance and DMs exclusion. Reconcile the saved receipt and job before any repeat submission. A queued recovery is not evidence of captured history.

`rollback.sql` restores the two previous function definitions only before an exact marker has been retained and when no Slack worker lease is running. After retention, preserve additive SQL and roll back the exact runtime artifacts only. Never delete retained sources to force rollback.

Validation: 107 Slack runtime tests; 18 full-schema journeys; exact release/rollback/apply, four negative release guards and refusal to remove handling after retained evidence; all 1,591,580 archived COPY rows across 403 tables and seven sequences preserved. Two immutable runtime artifacts booted without network and rejected missing authentication. These are local acceptance results; production evidence is recorded separately.
