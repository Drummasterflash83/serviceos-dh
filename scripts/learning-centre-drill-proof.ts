// Learning Centre drill-down — real Drummonds read-only proof.
//
// Runs the SAME read-only `gatherQueueRecords` the `learning.drill` edge action runs, against
// REAL prod via the verify harness. Proves the drill returns EXISTING canonical records (no new
// intelligence). Customer-sensitive text (subjects / excerpts / customer names) is MASKED here —
// only shapes, presence flags, counts and durations are printed. No writes; project-ref allowlisted.
//
// Run: node scripts/learning-centre-drill-proof.ts   (needs .env.verify)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { gatherQueueRecords } from "../supabase/functions/_shared/controlplane/learning_centre.ts";

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
const mask = (s: string | null) => (s ? `«${s.length} chars»` : "—");
const dur = (ms: number | null) => (ms == null ? "—" : `${Math.floor(Math.abs(ms) / 86_400_000)}d`);

async function main() {
  console.log(`project ${ref} · tenant ${TENANT.slice(0, 8)}… · ${NOW}\n`);
  for (const q of ["overdue_actions", "intel_no_owner", "recs_awaiting_review", "comms_no_intel"]) {
    const r = await gatherQueueRecords(db, TENANT, q, NOW, 5);
    console.log(`═══ ${q} ═══`);
    console.log(
      `  drillable=${r.drillable} returned=${r.returned} truncated=${r.truncated} · trace ${r.trace.table}[${r.trace.filter}]${r.note ? " · note: " + r.note : ""}`,
    );
    for (const rec of r.records) {
      console.log(
        `  • ${rec.objectType ?? "—"} subject=${mask(rec.subject)} overdue=${rec.isOverdue ? dur(rec.overdueMs) : "no"} owner=${rec.owner.state} customer=${rec.customer ? "present" : "—"} source=${rec.source?.type ?? "—"} conf=${rec.confidence ?? "—"} excerpt=${mask(rec.evidenceExcerpt)} link=${rec.source?.interactionId ? "yes" : "—"}`,
      );
    }
    console.log("");
  }
  console.log(
    "✅ Drill records fetched dynamically from real prod (read-only; sensitive text masked).",
  );
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
