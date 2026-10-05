// Communication operational-relevance — real Drummonds read-only analysis (WS2).
//
// Runs the SAME read-only projection the `comm.relevance` edge action runs, against REAL prod via
// the verify harness. Reuses the existing eligibility ledger (no new classifier of record, no
// mutation). Output is aggregate counts only — no message subjects/bodies/addresses.
//
// Run: node scripts/comm-relevance-proof.ts   (needs .env.verify)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { gatherCommunicationRelevance } from "../supabase/functions/_shared/controlplane/comm_relevance.ts";

function loadEnv(p: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}
const env = loadEnv(new URL("../.env.verify", import.meta.url).pathname);
const ref = (env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (env.VERIFY_ALLOW_PROJECT_REF && ref !== env.VERIFY_ALLOW_PROJECT_REF) {
  console.error("REFUSING: project ref not in allowlist");
  process.exit(2);
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const TENANT = env.VERIFY_TENANT ?? "00000000-0000-0000-0000-000000000001";
const NOW = new Date().toISOString();

async function main() {
  console.log(`project ${ref} · tenant ${TENANT.slice(0, 8)}… · ${NOW}\n`);
  const r = await gatherCommunicationRelevance(db, TENANT, NOW);
  console.log("total communications (classified interactions):", r.totalCommunications);
  console.log("\nby class:");
  for (const [k, n] of Object.entries(r.byClass).sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  console.log("\nby operational relevance:");
  for (const [k, n] of Object.entries(r.byRelevance).sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${k}`);
  console.log("\nestimated exclusion (conservative floor):");
  console.log("  noise interactions:", r.exclusion.noiseInteractions);
  console.log("  intelligence objects excluded:", r.exclusion.intelligenceObjectsExcluded);
  console.log(
    "  recommendations excluded:",
    r.exclusion.recommendationsExcluded,
    "(open:",
    r.exclusion.recommendationsOpenExcluded + ")",
  );
  console.log("\ncaveat:", r.caveat);
  console.log("\n✅ Read-only relevance report from real prod (existing ledger; no mutation).");
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
