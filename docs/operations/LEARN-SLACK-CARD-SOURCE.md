# Retained Slack source on LEARN cards

Prepared 14 October 2026. This source reader completes the evidence drill-down for
already retained public-channel messages. It does not establish complete Slack
coverage or current outstanding work, and it makes no request to Slack.

## Customer and operator journey

A Slack communication on a customer timeline offers **Read retained Slack message**.
It shows the retained text, actual message date, channel/author references and
expandable provenance. Historical requests may already be resolved. Slack author
references do not imply customer identity or assigned ownership. Text is rendered
literally, bounded to 40,000 Unicode characters with an explicit shortening label.

OpenFolk uses the same view from a selected client's communication and logs the
operator's existing reason, actor, source ID and revision. Audit failure prevents
returning the message. Own-client reads use the existing tenant owner/admin boundary.
No people are granted new authority. Private/shared channels and DMs remain excluded.

The reader requires immutable capture-time public-channel evidence for the exact
retained revision, matching provider payload and a still-authorised workspace
connection. It fences source changes and connection revocation during the read.
Withheld, unsupported, foreign, unproven and unauthorised sources fail closed.
Disabling capture alone retains access to already authorised history. The view
clears on close, backgrounding, scope changes and expiry; refresh rechecks access.

## Verification and release

Four client tests cover response binding, stale/extra fields, operator audit, Unicode
and literal markup. TypeScript and the Vercel-target build pass. The isolated native
rehearsal preserves all 1,591,601 archived rows, 389 tables and seven sequences.
Its synthetic permissions/visibility/audit fixture rolls back completely. The same
fixture passes on the actual hosted TEST schema without persisting synthetic data.
These checks do not substitute for the pending signed-in browser acceptance.

Install the additive SQL in TEST before LIVE, guarded by the observed classifier and
authority-helper definitions, source identities and existing access. Verify the new
reader owner, ACL and exact definition after each installation. Release only the
five frontend files on each environment's current Git parent, preserving the TEST-only
job-refresh UI. Use stable aliases and retain deployment protection.

Rollback: restore the previous environment's frontend before optionally running
`supabase/release/learn-slack-card-source/rollback.sql`. The guarded reversal removes
only this reader; it never deletes retained Slack sources, versions or visibility
proofs. No production reversal has been executed.

[Exact manifest](../../supabase/release/learn-slack-card-source/manifest.json).
