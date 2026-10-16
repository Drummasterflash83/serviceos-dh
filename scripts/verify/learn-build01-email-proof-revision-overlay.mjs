/** Correct only the serving scheduler's PostgREST numeric audit revision. */
import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
const prior = "01a5d731441cf5d403ea450919745578262d2bd77528794091cc1c12497e35a4";
export function patchProfileRevision(source) {
  if (sha256(source) !== prior) throw Error("Serving profile selector changed");
  const old = "proof.detail.checkpoint_revision === String(checkpoint.revision)";
  const replacement = `((typeof proof.detail.checkpoint_revision === "number" &&
    Number.isSafeInteger(proof.detail.checkpoint_revision)) ||
    (typeof proof.detail.checkpoint_revision === "string" &&
    /^\\d+$/.test(proof.detail.checkpoint_revision))) &&
    String(proof.detail.checkpoint_revision) === String(checkpoint.revision)`;
  const first = source.indexOf(old);
  if (first < 0 || source.indexOf(old, first + old.length) >= 0)
    throw Error("Serving revision comparison changed");
  return source.slice(0, first) + replacement + source.slice(first + old.length);
}
