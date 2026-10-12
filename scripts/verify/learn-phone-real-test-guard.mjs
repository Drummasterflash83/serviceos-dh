/** Only an acknowledged rejection before sync-run creation can be recovered.
 * Unknown outcomes and any evidence of provider work require separate inspection. */
export function canRecoverPhoneAuth(plan, state, rows) {
  const receipt = plan.history?.[0];
  const expected = [
    "phone_calls",
    "phone_recordings",
    "phone_sync_runs",
    "learn_phone_capture_pages",
    "learn_phone_import_completions",
    "learn_phone_processing_attempts",
  ];
  return (
    plan.state === "capturing" &&
    plan.pending === null &&
    !plan.authRecovery &&
    plan.history?.length === 1 &&
    receipt.name === "simwood-sync-calls" &&
    receipt.status === 401 &&
    receipt.success === false &&
    receipt.code === "internal_auth_mismatch" &&
    receipt.run === null &&
    receipt.processed === null &&
    receipt.windowComplete === null &&
    state.active === true &&
    state.allowed === false &&
    ["calls", "recordings", "audio", "running", "ai", "transcripts"].every((k) => state[k] === 0) &&
    Array.isArray(rows) &&
    rows.length === expected.length &&
    expected.every((name) => rows.filter((r) => r.name === name && r.n === 0).length === 1)
  );
}
