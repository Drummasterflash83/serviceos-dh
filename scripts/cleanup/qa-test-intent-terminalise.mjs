// QA test-intent terminalisation (STAGING-GATED; deterministic; bounded).
//
// The marketing-test-cancel HTTP suite proves the worker-race boundary by
// SIMULATING a claiming worker (a direct pending→claimed update with no
// execution attempt). On an append-only remote project the suite's tenant
// cleanup cannot cascade (decision_log is immutable), so those simulated
// claims survive as NON-TERMINAL `claimed` intents that no engine worker owns.
// Launch hygiene demands zero non-terminal QA test intents.
//
// This script terminalises ONLY:
//   * intent_type = 'send_marketing_test_email'
//   * status = 'claimed'
//   * with ZERO automation_execution_attempts (a REAL claim always writes an
//     inflight attempt — absence proves the claim was the suite's simulation)
// through the engine's OWN legal path: claimed→pending (release of an
// abandoned pre-execution claim — the lease holder never existed) followed by
// pending→cancelled (the governed withdrawal of never-attempted work).
//
// STAGING-GATED: refuses to run against any project except the designated
// staging ref. DRY-RUN by default.
//
// Usage:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/cleanup/qa-test-intent-terminalise.mjs           # dry-run
//   … --apply                                                                                                # execute
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "eityajdtzvdbdqtoipia";
const APPLY = process.argv.includes("--apply");
const URL = process.env.SUPABASE_URL ?? "";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL.includes(STAGING_REF)) {
  console.error(`REFUSED: this cleanup only runs against staging ${STAGING_REF} (got ${URL || "unset"}).`);
  process.exit(1);
}
if (!SR) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });

const claimed = await admin
  .from("automation_intents")
  .select("id, tenant_id, status, created_at")
  .eq("intent_type", "send_marketing_test_email")
  .eq("status", "claimed");
if (claimed.error) {
  console.error("read failed:", claimed.error.message);
  process.exit(1);
}
const candidates = [];
for (const i of claimed.data ?? []) {
  const att = await admin
    .from("automation_execution_attempts")
    .select("id", { count: "exact", head: true })
    .eq("automation_intent_id", i.id);
  if ((att.count ?? 0) === 0) candidates.push(i);
  else console.log(`SKIP ${i.id} — has real execution attempts (a genuine worker owns it)`);
}
console.log(`${candidates.length} simulated-claim QA intent(s) to expire:`, candidates.map((c) => c.id));
if (!APPLY) {
  console.log("DRY-RUN — re-run with --apply to terminalise.");
  process.exit(0);
}
let okCount = 0;
for (const c of candidates) {
  // 1 · release the abandoned claim (legal: claimed→pending, lease recovery)
  const rel = await admin
    .from("automation_intents")
    .update({ status: "pending" })
    .eq("id", c.id)
    .eq("status", "claimed")
    .select("id, status");
  if (rel.error || rel.data?.length !== 1) {
    console.error(`FAILED release ${c.id}: ${rel.error?.message ?? "no row"}`);
    continue;
  }
  // 2 · governed withdrawal of never-attempted work (legal: pending→cancelled)
  const cxl = await admin
    .from("automation_intents")
    .update({ status: "cancelled" })
    .eq("id", c.id)
    .eq("status", "pending")
    .eq("attempts", 0)
    .select("id, status");
  if (cxl.error || cxl.data?.length !== 1) {
    console.error(`FAILED cancel ${c.id}: ${cxl.error?.message ?? "no row"}`);
    continue;
  }
  okCount += 1;
  console.log(`CANCELLED ${c.id} (released abandoned claim, then withdrew)`);
}
console.log(`${okCount}/${candidates.length} terminalised.`);
process.exit(okCount === candidates.length ? 0 : 1);
