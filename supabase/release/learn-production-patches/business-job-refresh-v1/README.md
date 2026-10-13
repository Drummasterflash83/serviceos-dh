# Reviewed Commusoft job refresh — rehearsed, not deployed

This package adds reviewed job-source refresh and durable cancellation. It retains
initial identity links and all provider history. It updates only source-owned job
fields after current identity, ownership, source revision and local-edit checks.
Installation writes no source or canonical records and starts no provider work.

The target is production `tgbnakbxwcqjeimygroz`. Set `serviceos.release_target` and
`serviceos.release_sha256` to the exact values in manifest.json using the existing
approved database deployment route. The apply wrapper checks all ten prerequisite
function definitions, owners and ACLs and refuses existing refresh objects. Do not
remove a guard or retry an uncertain installation; inspect the catalog first.

## Acceptance still required

- Recovery rehearsals pass. The aligned TEST backend is installed and preserved.
  Verify the same refresh source through its matching signed-in TEST controls.
- Prepare the frontend from each existing deployment base, using only the six files
  in frontend-manifest.json. Do not deploy the shared branch wholesale.
- Take fresh production preservation and definition snapshots, install the matching
  backend/frontend, then verify the real source-to-card journey through logged
  operator controls. Verify current authority, scope, before/after fields and retained
  source/link history. No actual production job has been refreshed by this package.

## Recovery

Before any committed refresh or cancellation exists, rollback-empty-only.sql can
restore the exact six prior definitions and remove the unused new objects. It checks
all nine installed refresh definitions/ACLs before doing so. Never remove retained
history to make this rollback pass.

After any receipt exists, use pause-retain-history.sql. It checks the same exact
installed definitions/ACLs, then prevents new apply operations. Existing committed
results, result checks and cancellation remain available with their normal authority
checks. It preserves effective source readers, canonical records and both ledgers.
The older frontend may be restored separately; do not restore an older reader that
ignores accepted refresh revisions. Neither operation rewinds real job history.

The package does not complete automatic customer/site/contact reconciliation or the
wider LEARN acceptance goal. See docs/operations/LEARN-BUSINESS-SOURCE-REFRESH.md.
