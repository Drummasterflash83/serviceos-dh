# Reviewed Commusoft job refresh — backend installed, frontend acceptance pending

This package adds reviewed job-source refresh and durable cancellation. It retains
initial identity links and all provider history. It updates only source-owned job
fields after current identity, ownership, source revision and local-edit checks.
Installation writes no source or canonical records and starts no provider work.

The target is production `tgbnakbxwcqjeimygroz`. Set `serviceos.release_target` and
`serviceos.release_sha256` to the exact values in manifest.json using the existing
approved database deployment route. The apply wrapper checks all ten prerequisite
function definitions, owners and ACLs and refuses existing refresh objects. Do not
remove a guard or retry an uncertain installation; inspect the catalog first.

Installed in production on 13 October at 22:14 UTC. Exact definitions, access and
all sixteen scoped table digests were verified; no canonical refresh has occurred.
See `docs/operations/evidence/learn-business-job-refresh-production-2026-10-13.json`.

## Acceptance still required

- Recovery rehearsals pass. The aligned TEST backend is installed and preserved.
  Verify the same refresh source through its matching signed-in TEST controls.
- Isolated frontends are prepared from their existing deployment bases. TEST has
  six reviewed files; the protected LIVE candidate additionally carries the HTML
  no-store rules in vercel.json. Exact paths, revisions and patch hashes are in
  frontend-manifest.json. Do not deploy the shared branch wholesale.
- The backend preservation and definition checks passed in production. Complete
  the real source-to-card journey on the protected candidate through logged
  operator controls before frontend promotion. Verify current authority, scope,
  before/after fields and retained source/link history. No actual production job
  has been refreshed by this package. Candidate runtime cache headers remain
  unverified; build/configuration evidence is not a response-header observation.

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
