# Scoped customer-card reader release

Installed and verified LIVE 14 October 2026. This changes one read-only function;
there are no source-row writes, user grants, credential or schedule changes.

The manifest pins the source, exact old/new function hash, owner and ACL, apply,
inverse rollback and 22 source/identity tables guarded inside the transaction.
The package requires `serviceos.release_target` set to the manifest target and
`serviceos.release_sha256` set to its source SHA, using the existing `postgres`
deployer. Do not rerun an installed package: prior-definition checks reject it.

Both scripts temporarily use the deployer's existing administrative role ability
inside the transaction and restore its exact original memberships before commit.
Failure before restoration, late failure, wrong target/digest and prerequisite
drift were rehearsed with rollback. The deployment changes no persistent access.

The scripts compare before/after data fingerprints in one repeatable-read snapshot,
along with role memberships, table access, RLS policies and schedules. This proves
this transaction did not change those records; it does not stop or describe legitimate
concurrent capture in other transactions. The inverse rollback restores only this
function after checking the exact installed version and dependent function hashes.
It does not remove retained data or rewind capture. Reconcile newer changes before
using it; do not weaken a drift guard.

The LIVE HTTP client timed out after 75 seconds. No write was retried. Subsequent
catalog reads showed the exact new function committed, its owner/ACL correct,
dependencies unchanged, and membership restored. Because assertions precede the
single commit, successful installation requires the preservation guards to pass.
The returned per-table fingerprint receipt was unavailable. Do not infer failure
from a transport timeout or repeat the mutation; reconcile actual catalog state.

Two signed-in customer-card refreshes passed. See the LIVE evidence and authoritative
completion checklist for the remaining LEARN V1 work.
