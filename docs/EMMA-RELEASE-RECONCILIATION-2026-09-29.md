# Vapi release reconciliation — 29 September 2026

Release `a256764d-0c49-4b62-93b7-0332b76f07c0` was initially marked uncertain.
Read-only comparison against its immutable snapshots established that the exact
approved model instructions were present and that the only other difference was
Vapi's generated top-level `latestVersion` label. This field is documented in the
Vapi Assistant response / installed SDK as the version-history label.

The actual provider update timestamp is `2026-09-29T12:51:31.686Z`.

## Correction

- Exclude only the generated top-level `latestVersion` label, alongside existing
  identity/timestamps, from behavioural configuration comparisons.
- Recompute comparisons from immutable snapshots for older receipts, including
  rollback comparisons. Preserve the original audit hashes and snapshots.
- Return safe field-name diagnostics for genuinely mismatched configurations;
  never expose provider credentials or configuration values in diagnostic errors.
- Retain conflict detection, exact-change approval, and no blind retry.

The live endpoint was deployed, then the authenticated **Check Vapi result** action
confirmed the existing release as `applied`; the task moved to `verifying` and the
browser shows **Published · Results Need Checking**. No additional Vapi PATCH was
sent during this investigation. This confirms configuration delivery, not caller
behaviour or audio quality; a fresh recorded scenario still needs verification.

Validation: 11 release tests passed, including generated-version regression,
real-field conflict detection, lost response, rollback, and diagnostic secrecy;
Deno endpoint typecheck passed. Production receipt and operator UI checked.

Reference: https://docs.vapi.ai/api-reference/assistants/get
