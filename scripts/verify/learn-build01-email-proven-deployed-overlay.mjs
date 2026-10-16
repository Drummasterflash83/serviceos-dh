/** Pin and patch only the two current serving Email scheduler modules. */
import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const before = {
  "email-workspace-scheduled-sync/index.ts": "267bf439f1e35e7332053137e1bebe7520beae33c7f9a14454f0dc6b38da32d6",
  "_shared/workspace_scheduler_selection.ts": "9eba790fcfc27a3c1de469427b73cb97fe78bd39fc6dd7ba62806949234b5b51",
};
function replaceOnce(source, oldText, newText) {
  const first = source.indexOf(oldText);
  if (first < 0 || source.indexOf(oldText, first + oldText.length) >= 0)
    throw Error("Serving Email scheduler anchor changed");
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

export function patchProvenSchedulerModule(path, source) {
  if (sha256(source) !== before[path])
    throw Error(`Serving Email scheduler source changed: ${path}`);
  if (path === "_shared/workspace_scheduler_selection.ts") {
    return replaceOnce(source,
      `/** A blocked recent checkpoint stays held until its existing recovery protocol succeeds. */ export function isWorkspaceRecentCaptureHeld(account, checkpoints) {
  return checkpoints.some((checkpoint)=>checkpoint.tenant_id === account.tenant_id && checkpoint.email_account_id === account.id && checkpoint.state === "blocked");
}`,
      `/** Scheduling is only possible after a recent exact read-only profile proof.
 * The database claim repeats the stronger paired-audit and authority checks. */
export function isCurrentWorkspaceProfileProof(checkpoint, proof, nowMs) {
  const createdMs = Date.parse(proof?.created_at ?? "");
  return checkpoint.state === "blocked" && checkpoint.block_code === "admin_delegation_missing" &&
    proof?.status === "success" && proof.detail?.code === "provider_verified" &&
    proof.detail.checkpoint_generation === checkpoint.generation &&
    ((typeof proof.detail.checkpoint_revision === "number" &&
      Number.isSafeInteger(proof.detail.checkpoint_revision)) ||
      (typeof proof.detail.checkpoint_revision === "string" &&
      /^\\d+$/.test(proof.detail.checkpoint_revision))) &&
    String(proof.detail.checkpoint_revision) === String(checkpoint.revision) &&
    proof.detail.mailbox_content_read === false &&
    typeof proof.detail.request_audit_id === "string" &&
    Number.isFinite(createdMs) && createdMs >= nowMs - 3600000 && createdMs <= nowMs + 5000;
}
export function isWorkspaceRecentCaptureHeld(account, checkpoints, profileProof = null, nowMs = Date.now()) {
  return checkpoints.some((checkpoint)=>checkpoint.tenant_id === account.tenant_id &&
    checkpoint.email_account_id === account.id && checkpoint.state === "blocked" &&
    !isCurrentWorkspaceProfileProof(checkpoint, profileProof, nowMs));
}`);
  }
  if (path !== "email-workspace-scheduled-sync/index.ts")
    throw Error("Unexpected Email scheduler module");
  source = replaceOnce(source,
    `.select("tenant_id,email_account_id,state,block_code")`,
    `.select("tenant_id,email_account_id,generation,revision,state,block_code")`);
  return replaceOnce(source,
    `      if (isWorkspaceRecentCaptureHeld(acc, checkpoints)) {
        heldByTenant.set(tid, (heldByTenant.get(tid) ?? 0) + 1);
        continue;
      }`,
    `      const held = checkpoints.find((checkpoint)=>checkpoint.tenant_id === tid &&
        checkpoint.email_account_id === acc.id);
      let profileProof = null;
      if (held?.block_code === "admin_delegation_missing") {
        const { data, error } = await supabase.from("audit_logs")
          .select("status,created_at,detail")
          .eq("tenant_id", tid).eq("resource_type", "email_account")
          .eq("resource_id", acc.id)
          .eq("action", "learn.email.mailbox_source_probe_result")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }).limit(1).maybeSingle();
        if (error) counts.unconfirmed++;
        else profileProof = data;
      }
      if (isWorkspaceRecentCaptureHeld(acc, checkpoints, profileProof)) {
        heldByTenant.set(tid, (heldByTenant.get(tid) ?? 0) + 1);
        continue;
      }`);
}
