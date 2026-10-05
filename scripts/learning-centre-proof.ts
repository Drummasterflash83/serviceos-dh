// Learning Centre — real Drummonds read-only proof.
//
// Runs the SAME projection the (undeployed) `learning.overview` edge action will run, against
// REAL prod data via the read-only verify harness. Proves the numbers are live-queried, not
// hard-coded. No writes; project-ref allowlisted. PII is not surfaced (counts + timestamps only).
//
// Run: node scripts/learning-centre-proof.ts   (needs .env.verify)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  gatherLearningMetrics,
  buildLearningOverview,
} from "../supabase/functions/_shared/controlplane/learning_centre.ts";

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
  const metrics = await gatherLearningMetrics(db, TENANT, NOW);
  const o = buildLearningOverview(metrics);

  console.log("═══ SOURCE TRUTH — summary ═══");
  const su = o.sourceTruth.summary;
  console.log("  live:", su.sourcesLive.join(", "));
  console.log("  missing:", su.sourcesMissing.join(", "));
  console.log("  latest evidence:", su.latestEvidenceAt);
  console.log("  processing:", su.processingHealth);
  console.log(
    `  identity coverage: ${su.identityCoverage.confirmed} confirmed / ${su.identityCoverage.unresolved} unresolved (${su.identityCoverage.pct ?? "—"}%)`,
  );
  console.log("  blind spots:", su.majorBlindSpots.join(" · "));

  console.log("\n═══ SOURCE TRUTH — per source ═══");
  for (const s of o.sourceTruth.sources) {
    console.log(
      `  ${s.label}: ${s.connectionState} · schedule ${s.scheduleState} · ${s.freshness} · latest ${s.latestEvidenceAt ?? "-"}`,
    );
    console.log(
      `    received=${s.received} processed=${s.processed} failed/pending=${s.failedOrPending} · coverage ${s.coverage.map((c) => `${c.label}=${c.value}`).join(", ")}`,
    );
    console.log(
      `    identities: ${s.confirmedIdentities ?? "-"} confirmed / ${s.unresolvedIdentities ?? "-"} unresolved · gaps: ${s.gaps.join("; ") || "none"} · action: ${s.actionRequired ?? "none"}`,
    );
  }

  console.log("\n═══ EXISTING INTELLIGENCE ═══");
  const ei = o.existingIntelligence;
  console.log("  totals:", JSON.stringify(ei.totals));
  for (const q of ei.queues)
    console.log(`  • ${q.label}: ${q.count}  → drill ${q.drill.table} [${q.drill.filter}]`);
  console.log("  waiting:", ei.waiting.note);
  console.log(
    "  repeated themes:",
    ei.repeatedThemes
      .map((t) => `${t.subject} ×${t.count}`)
      .slice(0, 5)
      .join(" | "),
  );
  console.log("\n✅ Learning overview generated dynamically from real prod data (read-only).");
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
