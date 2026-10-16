/** Exact two-constant reduction of the deployed customer-card sweep batch. */
import { createHash } from "node:crypto";
export const BASELINE_SHA256 = "815dcb58fee7ddac2583a22695f587e85548ef6dac3e0a81a9f7d01777416bc3";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function once(value, before, after) {
  const at = value.indexOf(before);
  if (at < 0 || value.indexOf(before, at + before.length) >= 0)
    throw Error("Deployed card batch anchor changed");
  return value.slice(0, at) + after + value.slice(at + before.length);
}
export function patchDeployedCardTen(source) {
  if (sha256(source) !== BASELINE_SHA256)
    throw Error("Deployed card handler baseline changed");
  let patched = once(source, "const DEFAULT_LIMIT = 40;", "const DEFAULT_LIMIT = 10;");
  patched = once(patched, "const MAX_LIMIT = 500;", "const MAX_LIMIT = 10;");
  if (sha256(patched) === BASELINE_SHA256) throw Error("Card batch did not change");
  return patched;
}
