# Build 01 public Slack Events preparation

This package is **not active capture**. The ledger and default-off receiver are
installed in TEST only. LIVE has neither. No Slack app event subscription or
signing secret has been installed by this release. Individual and group DMs stay
excluded; the scope is the exact approved 160 public channel/reply roster.

The receiver needs these private deployment settings before it can serve an
event: `LEARN_SLACK_EVENTS_ACTIVE`, `LEARN_SLACK_EVENTS_TENANT_ID`,
`LEARN_SLACK_EVENTS_TEAM_ID`, `LEARN_SLACK_EVENTS_APP_ID`,
`LEARN_SLACK_EVENTS_SIGNING_SECRET`, `LEARN_SLACK_EVENTS_MIN_TS`,
`LEARN_SLACK_EVENTS_EXPECTED_CHANNELS`, and
`LEARN_SLACK_EVENTS_ROSTER_SHA256`. The roster digest is SHA-256 of the approved
channel IDs sorted lexicographically and joined by single newlines, with no
trailing newline. The saved 13 October 2026 09:30 UTC cutoff belongs in
`MIN_TS`; do not derive an earlier one. No setting value belongs in Git.

`LEARN_SLACK_EVENTS_ACTIVE` defaults to false. The Edge function checks a fresh
enabled roster before signature validation, verifies the raw-body Slack HMAC,
and acknowledges a message or correction hint only after the service-only SQL
recorder confirms a durable insert or exact duplicate. The SQL transaction
rechecks current approval, capture, connection revision, credential kind and
source scope. It stores no message text or attachments. Correction hints need a
fresh public-visibility check and a documented edit/delete policy before they
can reconcile retained evidence; no such processor is active yet.

Before any activation: implement and rehearse the bounded hint processor;
verify signed synthetic root, reply, duplicate, revocation, edit and delete
delivery in TEST; compare the exact roster and connection to approval; review
Slack's event subscription change; then observe real post-cutoff approved
source-to-card capture. Keep existing polling as reconciliation until its
capacity and loss recovery are verified. A deployed receiver or an empty ledger
does not prove capture.

Rollback the TEST preparation only when the hint table is empty: delete the
`learn-slack-events` TEST Edge function, verify its absence, then apply
[`rollback.sql`](rollback.sql). The SQL aborts if any hint exists. Preserve any
pending hint and reconcile it before considering a rollback. This procedure
does not change the existing Slack history, recurring subscriptions or source
credentials.

[Sanitised evidence](../../../docs/operations/evidence/learn-build01-slack-event-preparation-2026-10-16.json)
