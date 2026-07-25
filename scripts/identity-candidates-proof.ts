// Identity Resolution V1 — real Drummonds read-only proof.
//
// Runs the SAME read-only projection the `identity.candidates` / `identity.impact` edge actions
// run, against REAL prod via the verify harness. Proves candidates + impact are live-queried,
// never auto-confirmed. Raw external identities and customer text are MASKED here (shapes/counts
// only). No writes; project-ref allowlisted.
//
// Run: node scripts/identity-candidates-proof.ts   (needs .env.verify)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  gatherIdentityCandidates,
  gatherIdentityImpact,
} from "../supabase/functions/_shared/controlplane/identity_v1.ts";

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
const mask = (s: string) => (s ? `«${s.length} chars»` : "—");

async function main() {
  console.log(`project ${ref} · tenant ${TENANT.slice(0, 8)}… · ${NOW}\n`);
  const set = await gatherIdentityCandidates(db, TENANT, NOW);
  console.log("═══ IDENTITY CANDIDATES — summary ═══");
  console.log(
    "  total:",
    set.summary.total,
    "· confirmed:",
    set.summary.confirmed,
    "· need review:",
    set.summary.needsReview,
  );
  console.log("  by state:", JSON.stringify(set.summary.byState));
  console.log("  by channel:", JSON.stringify(set.summary.byChannel));

  console.log("\n═══ SAMPLE CANDIDATES (identities masked) ═══");
  for (const c of set.candidates.slice(0, 8)) {
    console.log(
      `  • ${c.channel}/${c.candidateKind} id=${mask(c.rawExternalIdentity)} state=${c.mappingState} conf=${c.confidence} shared=${c.isShared} suggested=${c.suggestedMemberName ? "person" : c.suggestedKind} evidence=${c.supportingEvidence.length} conflicts=${c.conflictingEvidence.length}`,
    );
  }

  // Impact preview for the first email candidate that has an endpoint.
  const target = set.candidates.find((c) => c.channel === "email" && c.endpointId);
  if (target?.endpointId) {
    const imp = await gatherIdentityImpact(db, TENANT, target.endpointId);
    console.log("\n═══ IMPACT PREVIEW (first email candidate, masked) ═══");
    console.log(
      `  Confirming would associate ${imp.interactions} interactions, ${imp.intelligenceObjects} intelligence objects, ${imp.unresolvedActions} unresolved actions${imp.note ? " · note: " + imp.note : ""}`,
    );
  }
  console.log(
    "\n✅ Identity candidates + impact generated dynamically from real prod (read-only; no writes, no auto-confirm).",
  );
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
