# Retained Slack source on LEARN cards

Verified on TEST and LIVE on 14 October 2026. This source reader completes the evidence drill-down for
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
Signed-in acceptance then verified the synthetic TEST successful path, denial of
an older unattested TEST source, and two actual LIVE customer messages including
text beyond the old excerpt. The LIVE operator opened the same source and its
actor/reason/revision audit was independently read back.

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

## Released state and operational limits

LIVE Git `c45c95a6188555d470f7c22146128be23471b531` / deployment
`dpl_DwKyTb8sUSWhcqgXQuJm1Uej5hDS` is verified on all four existing aliases and
the production target. Rollback frontend: Git
`d33cfe56b0804fc3c69c12030474661d4ca9f344` / `dpl_o6r8arDgsx9D1nJjwiuouasa3LBR`.

TEST Git `8f99829de7de78fcc3d47b9e75884ad0dced02fe` / deployment
`dpl_GxKWS5zVMVEuogKuMXs8HTGNqkoz` is verified on both existing stable aliases.
Rollback frontend: Git `97d78f697e5597ac9c243859e9dc7c0bad277afb` /
`dpl_264tnwefoJ9A5ULFzgj1z56ePiQC`. Protection is unchanged in both environments.

The synthetic TEST browser fixture is retained in the clearly labelled
`slack-source-reader-browser-20261014` tenant. It has one fake message, an inert
credential-free disabled connector and no new user, grant or schedule. Its capture
receipt is explicitly synthetic QA evidence, never real provider acceptance.

Normal reload in the existing TEST session retained an older document; a fresh
stable-domain URL with a release query loaded the exact build. This remains a
separate stale-document recovery issue, not a completed browser-cache fix.

[Sanitised release acceptance](evidence/learn-slack-card-source-live-2026-10-14.json).
