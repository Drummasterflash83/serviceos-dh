/** Three exact changes to the deployed worker's Email-only continuation. */
import { createHash } from "node:crypto";
export const BASELINE_SHA256 = "b72538ebcb9980fdc39735ca65e7c6b9bc92f619a621bf43ec2fb883be55ecc4";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function replaceOnce(value, before, after) {
  const first = value.indexOf(before);
  if (first < 0 || value.indexOf(before, first + before.length) >= 0)
    throw Error("Deployed Email receipt patch anchor changed");
  return value.slice(0, first) + after + value.slice(first + before.length);
}
export function patchDeployedEmailReceiptWorker(source) {
  if (sha256(source) !== BASELINE_SHA256)
    throw Error("Deployed Email worker source baseline changed");
  let result = replaceOnce(source,
    'const limit = !currentEmail && source === "email" ? Math.min(requestedLimit, 10) : requestedLimit;',
    'const limit = !currentEmail && source === "email" ? Math.min(requestedLimit, 50) : requestedLimit;');
  result = replaceOnce(result,
    'rows.length === limit && counts.interactions_upserted + counts.reviews_recorded > 0 && counts.interactions_upserted + counts.reviews_recorded + counts.skipped === rows.length;',
    'rows.length === limit && (counts.interactions_upserted + counts.reviews_recorded > 0 || !currentEmail && source === "email" && counts.skipped > 0) && counts.interactions_upserted + counts.reviews_recorded + counts.skipped === rows.length;');
  result = replaceOnce(result,
    'payload: {\n        source,\n        limit,\n        ...currentEmail ? {',
    'payload: {\n        source,\n        limit: !currentEmail && source === "email" ? 50 : limit,\n        ...currentEmail ? {');
  if (sha256(result) === BASELINE_SHA256) throw Error("Email worker patch did not change source");
  return result;
}
