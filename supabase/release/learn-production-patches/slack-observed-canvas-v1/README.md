# Slack observed canvas source retention

This release retains the exact observed `tabbed_canvas_updated` subtype as `source_needs_review`. Its semantics are not established by official Slack documentation; it must not become a conversation, task or performance observation. Genuine observed reply threads continue through the existing authorised importer. Unknown or hidden event shapes remain rejected.

Apply the guarded `apply.sql` transaction with `serviceos.release_target` and `serviceos.release_sha256` set to the manifest values. It checks all nine reviewed function definitions and their existing ownership/access, changes only the classifier and coverage count, then checks the resulting definitions. Do not also replay the numbered migration. No role grant, credential, schedule or campaign change is part of installation.

Publish the two matching immutable runtime artifacts after SQL readback. Their source closure differs from the current LIVE platform-worker v70 / learn-slack-worker v9 only in `_shared/slack/slack_message_kind.ts`. Do not deploy the current shared checkout wholesale: it also contains separate QuickBooks TEST work.

The existing logged exact-page recovery control can then resume the held public-channel page under its existing campaign, dates, checkpoint and request budget. Do not restart an already queued recovery.

`rollback.sql` restores the previous two function bodies only before a canvas source has been retained and when no Slack lease is running. After retention, keep the additive SQL and revert runtime only; never delete sources to force rollback.

Validation: 106 Slack runtime tests; full native database restore and 15 source/replay/thread journeys; exact production transaction apply/rollback/apply; wrong-target, wrong-digest, definition-drift and late-failure guards; refusal to roll back after retention; all 1,591,580 archived rows and seven sequences preserved. Both exact worker artifacts booted without network and rejected missing authentication. Production acceptance is recorded separately after deployment.
