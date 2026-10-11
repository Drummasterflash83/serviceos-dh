# OpenFolk operator health inventories

The health queue previously omitted `team_member_id` from its identity read, so
verified staff could still be flagged as having no email identity. It also treated
any ownership assignment as a phone link, including email endpoints and rejected
or proposed assignments. Unchecked, capped reads could undercount the summary or
turn failed queries into empty results.

The summary, data-quality queue and workspace's identity/endpoint/ownership arrays
now use six checked tenant inventories. The reader shares the roster's stable-ID
pagination, exact counts before/after, empty terminal page, tenant/ID validation
and per-table limits (20,000 rows, 8 MiB, 100 requests). A missing, failed, changing
or truncated read fails the request; it cannot report a healthy empty inventory.
The workspace reuses one collected health inventory for its counts and issues.

Current means effective at one fixed observation time. Future and expired links
are excluded. Former/future staff do not receive current setup warnings. Counts
and coverage require confirmed ownership; proposed/conflicted assignments remain
visible as review items. Phone coverage requires a confirmed assignment to an
active phone endpoint. Email identities retain their member ID and match an active
mail endpoint by provider and address/provider reference. A Slack or Commusoft
login email is not proof of a mail account. Manual email reviews follow the existing
provider fallback contract. Suspended mailboxes and inactive owners remain issues.
Provider capability notices describe only providers present in phone evidence,
using the adapter registry rather than an unconditional generic warning.

## Verification

- Seven focused health tests and ten roster/authorization/store tests pass.
  They exercise selected-column projection, current dates, provider identity
  matching, failed reads in every source, changing counts, foreign/truncated
  pages and a 2,503-record population under a 137-row server cap.
- The isolated PostgREST v14.5 transport check reads all six 2,503-row inventories
  through the installed PostgrestClient: 132 requests, 12 exact-count HEADs and
  six empty terminal pages. It finds the deliberately unverified identity,
  conflicted ownership and suspended mailbox beyond the first server page.
  All synthetic source fingerprints remain unchanged. No hosted schema/auth
  acceptance is inferred from this synthetic table-shape test.
- The shared roster reader's existing boundary/budget checks still pass; 23
  navigation checks pass. Application TypeScript and direct health/roster
  TypeScript checks pass. No frontend source or request contract changed.
- Six deployment-guard checks pass. The previous roster installer retains its
  historical source pin and refuses newer source without any external action.
- The older full-stack control-plane integration scripts could not run because
  their local-stack URL/key environment is absent. They exited before database
  access; this is not counted as successful integration verification.

Reproduce with `node --test scripts/learn-operator-health.test.mjs
scripts/learn-roster-recovery.test.mjs` and
`python3 scripts/verify/learn-operator-health-http.py`. The Docker verifier uses
cached images, no host mounts or published ports and no external network.

## Release and limits

The reviewed 19-file runtime source hash is
`16b5a46ae6e2277ef2b28bea10fd25fad722bb7f8cd360838f898e0533bdedac`.
The new TEST replacement runner requires operator v2, the existing runtime
catalog and release-051 schema, and journals all 101 preservation fingerprints
before submitting once. The operator endpoint is ACTIVE at v3, installed at
03:04 UTC on 11 October from Git `9dd72d4994f82e2365e90f797321507e654c25cf`.
All 101 monitored datasets, schema and other endpoints were preserved. Fourteen
hosted checks of workspace/data-quality access boundaries passed at 03:05 UTC.
The existing protected frontend remains at Git `27113d0`; no frontend source or
request contract changed. Positive signed-in hosted acceptance is still pending.
See [local evidence](evidence/learn-operator-health-local-2026-10-11.json) and
[TEST evidence](evidence/learn-operator-health-test-2026-10-11.json).

These are current reads, not a transactionally frozen or historical snapshot;
same-count concurrent edits remain possible. The subsequent [identity inventory increment](LEARN-IDENTITY-INVENTORY.md) checks
email/phone suggestion inventories and provider scope. The
[ownership increment](LEARN-OWNERSHIP-EVIDENCE.md) checks historical ownership and
flags overlapping accountable rows in health results. Connection evidence,
history, phone readiness and cross-client listing retain separate coverage limits. The source inventories do not prove actual
mail/call delivery or complete provider capture. Positive signed-in hosted
acceptance remains required. No new grants, provider calls or production release
are part of this increment.
