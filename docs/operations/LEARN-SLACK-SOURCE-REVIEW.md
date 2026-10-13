# Exact Slack subtype source-review preparation

Prepared for review, 13 October 2026. No production retry, deployment, new authority or provider requests.

The logged recovery of one real page reported `type=message`, no hidden field and `subtype=welcome_party`. This confirms the observed subtype, not its meaning. The current official [message event reference](https://docs.slack.dev/reference/events/message/) and [official Node SDK message definitions](https://github.com/slackapi/node-slack-sdk/blob/main/packages/types/src/events/message.ts) do not document this subtype. No official semantic confirmation was found. Do not describe it as proven channel activity or a harmless welcome event.

The exact subtype becomes `source_needs_review`: retain its original provider payload and source/version identity, but withhold interaction, job linkage and performance interpretation. No other unknown subtype is admitted. Hidden, deleted/changed-envelope, redacted, malformed and wrong-type records retain the existing rejection rules. A newly unsupported record still aborts its entire page transaction.

If this held source actually contains valid reply evidence, existing campaign discovery follows that evidence under the original scope and request ledger. Its replies are classified independently. A held parent is neither invented conversation nor reason to discard genuine replies. Current customer-context and source-replay eligibility already require conversation, so held sources do not gain those privileges.

The existing authorised campaign reader reports `sourceNeedsReviewCount`. The existing operator screen says these saved records are not yet interpreted as conversations or used for scoring. Older closed campaign snapshots without the field remain unknown rather than invented zero. Captured-window completion remains about capture, not semantic interpretation.

SQL replaces only four existing function bodies: classifier, durable source writer, campaign observed-thread discovery and campaign reader. No tables, grants, ownership, connection scope, schedules, jobs, campaign allowance, cursors or retained source rows are changed by installation. Runtime requires the matching exact classifier before any logged retry. SQL first is safe: the old worker remains more restrictive. Rollback after a held source is captured must retain the additive classifier so retained history does not become unreadable; stop further retry admission or restore the prior runtime rather than deleting source evidence.

Verification: 44 Node tests, TypeScript and diff checks passed. The exact guarded envelope passed a full-schema isolated restore as non-superuser postgres, preserving 1,591,580 archived rows across 401 tables and 7 sequences. Wrong target, wrong digest, function drift and late-failure rollback checks passed. Retained held sources correctly prevent classifier rollback. The actual campaign journey captured the held parent's genuine reply and completed all 21 observed threads under the unchanged 297-request ledger. Existing recovery, source replay, customer-context, visibility and reader isolation tests passed.

Immutable matching workers were compiled against published Slack v6/platform v66, preserving the voicemail v7 parser and all other source files. Only `_shared/slack/slack_message_kind.ts` differs in the runtime closure. Both exact artifacts passed isolated boot and missing-auth denial. Current production definitions, owner/ACL, schedules and access fingerprints were read for preparation only.

The reproducible guarded SQL and rollback are in `supabase/release/learn-production-patches/slack-source-review-v1/`. Private executors and immutable artifacts are in `.verification-results/production-slack-source-review-20261013/`. Apply SQL first, verify, then publish the matching runtime and existing operator notice. Recover a failed page only through its existing logged recovery control. No retry, provider acceptance, deployment or production change has been performed by this preparation.

A separate live diagnostic identified hidden `tombstone`. That is intentionally **not** admitted by this bundle. It requires its own source-deletion semantics and stale-content suppression review.

## Production schema/runtime — 2026-10-13T15:06:16.292Z

Guarded SQL applied and read back; Slack worker v7 and platform-worker v67
published and verified, preserving unrelated runtime, source counts, access,
credentials, voicemail controls and schedules. Only the exact visible
`welcome_party` source-review case is admitted. The three observed held pages
still need logged retries and provider acceptance. The fourth hidden `tombstone`
remains held pending withheld-content and stale-replay handling. The frontend
source-review notice is built locally but not yet released.

Evidence: [live release](evidence/learn-slack-source-review-live-2026-10-13.json).
