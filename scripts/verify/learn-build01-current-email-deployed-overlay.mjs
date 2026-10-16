/** Minimal patch against the two exact deployed function modules. Other downloaded files stay byte-for-byte unchanged. */
import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const WORKER_BASELINE = "ada66c710d49df7fa26e241b919342127ff5effb1661b6ffeb20090252c2baca";
const SCHEDULER_BASELINE = "795b2b64252eb5aabd70fe66a581c9df1df4a27a9389206bd6853b68a075df34";

function replaceOnce(source, before, after) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0)
    throw Error("Deployed Email source anchor changed");
  return source.slice(0, index) + after + source.slice(index + before.length);
}

export function patchDeployedWorker(source) {
  if (sha256(source) !== WORKER_BASELINE) throw Error("Deployed Email worker baseline changed");
  let result = replaceOnce(source,
    '  const source = payload.source === "phone" || payload.source === "email" ? payload.source : "all";\n',
    `  const source = payload.source === "phone" || payload.source === "email" ? payload.source : "all";
  if (payload.lane !== undefined && !(source === "email" && payload.lane === "current")) return {
    success: false,
    error: { code: "projection_lane_invalid", message: "Choose the current Email lane only with Email input.", retryable: false }
  };
  const currentEmail = source === "email" && payload.lane === "current";
`);
  result = replaceOnce(result,
    '  const limit = Math.max(1, Math.min(200, typeof payload.limit === "number" && Number.isFinite(payload.limit) ? Math.trunc(payload.limit) : 20));',
    '  const limit = Math.max(1, Math.min(currentEmail ? 100 : 200, typeof payload.limit === "number" && Number.isFinite(payload.limit) ? Math.trunc(payload.limit) : 20));');
  result = replaceOnce(result,
    `    const { data: rows, error } = await admin.rpc("learn_projection_pending", {
      p_tenant: tenantId,
      p_source: source,
      p_limit: limit
    });`,
    `    const { data: rows, error } = await admin.rpc(
      currentEmail ? "learn_projection_pending_current_email" : "learn_projection_pending",
      currentEmail ? { p_tenant: tenantId, p_limit: limit }
        : { p_tenant: tenantId, p_source: source, p_limit: limit }
    );`);
  result = replaceOnce(result,
    `    const review = await admin.rpc("learn_projection_review_count", {
      p_tenant: tenantId,
      p_source: source
    });
    if (review.error || !Number.isSafeInteger(review.data) || review.data < 0) throw Error("review_inventory");
    counts.review_required = review.data;`,
    `    // The older Email lane retains the tenant-wide review count. Its holds
    // must not mark this bounded current-message lane as failed.
    if (!currentEmail) {
      const review = await admin.rpc("learn_projection_review_count", {
        p_tenant: tenantId,
        p_source: source
      });
      if (review.error || !Number.isSafeInteger(review.data) || review.data < 0) throw Error("review_inventory");
      counts.review_required = review.data;
    }`);
  result = replaceOnce(result,
    '      jobKey: `interactions.sync:${tenantId}:${source}`,',
    '      jobKey: `interactions.sync:${tenantId}:${source}${currentEmail ? ":current" : ""}`,');
  result = replaceOnce(result,
    `      payload: {
        source,
        limit
      },`,
    `      payload: {
        source,
        limit,
        ...(currentEmail ? { lane: "current" } : {})
      },`);
  result = replaceOnce(result,
    '      priority: 50\n    } : undefined;',
    '      priority: currentEmail ? 40 : 50\n    } : undefined;');
  return result;
}

export function patchDeployedScheduler(source) {
  if (sha256(source) !== SCHEDULER_BASELINE) throw Error("Deployed Email scheduler baseline changed");
  return replaceOnce(source, '  return [\n', `  return [
    {
      tenantId,
      jobType: "interactions.sync",
      jobKey: \`interactions.sync:\${tenantId}:email:current\`,
      connectorId: "openfolk-core",
      moduleId: "core.interactions",
      priority: 40,
      payload: { source: "email", lane: "current", limit: 50 }
    },
`);
}
