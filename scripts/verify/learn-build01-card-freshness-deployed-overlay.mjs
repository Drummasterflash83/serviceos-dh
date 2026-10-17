/** Apply the reviewed card freshness change to the exact current worker source. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";

export const BASELINE_SHA256 = "deadc8c0b8f2c9783b90b17f3210374a5066f1df7932ad964a4a9ae11b937d7d";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function uniqueSlice(source, begin, end) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0 || source.indexOf(begin, start + begin.length) >= 0 ||
      source.indexOf(end, finish + end.length) >= 0)
    throw Error("Card selection anchor changed");
  return { start, finish, body: source.slice(start, finish) };
}

export function patchDeployedCardFreshness(deployed) {
  if (sha256(deployed) !== BASELINE_SHA256)
    throw Error("Exact deployed card handler baseline changed");
  const local = readFileSync(new URL(
    "../../supabase/functions/_shared/worker_handlers/customer_card_sync.ts", import.meta.url), "utf8");
  const localJs = ts.transpileModule(local, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText;
  const begin = "  const sweepSince =";
  const end = "    // ── Batch-load identity rows + graph relationship counts ────────────────";
  const current = uniqueSlice(deployed, begin, end);
  const replacement = uniqueSlice(localJs, begin, end).body;
  let patched = deployed.slice(0, current.start) + replacement + deployed.slice(current.finish);
  const oldContinuation = "    const moreToSweep = isSweep && (cardRows?.length ?? 0) >= limit;\n";
  if (patched.split(oldContinuation).length !== 2)
    throw Error("Old sweep continuation changed");
  patched = patched.replace(oldContinuation, "");
  const oldCount = "swept: cardRows?.length ?? 0";
  if (patched.split(oldCount).length !== 2)
    throw Error("Old sweep count changed");
  patched = patched.replace(oldCount, "swept: cards.length");
  if (patched === deployed || !patched.includes(".is(\"context->>projection\", null)"))
    throw Error("Card freshness change was not applied");
  return patched;
}
