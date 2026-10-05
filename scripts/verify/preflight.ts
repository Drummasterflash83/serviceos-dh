// Phase 3 — live Supabase preflight (READ-ONLY). Reports health/backlog before any
// migration or function deploy. No mutation. Run: node scripts/verify/preflight.ts
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDotenv, resolveEnv, mergeEnv } from "./lib.ts";
import { makeClient } from "./client.ts";
import { MAPPER_VERSION } from "../../supabase/functions/_shared/observation_ingest.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = join(REPO, ".env.verify");
const fileEnv = existsSync(envFile) ? parseDotenv(readFileSync(envFile, "utf8")) : {};
const env = resolveEnv(mergeEnv(fileEnv, process.env)).env!;
const c = await makeClient(env);
const T = env.tenantId;
const line = (k: string, v: unknown) => console.log(`  ${k.padEnd(52)} ${v}`);

async function count(table: string, match: Record<string, unknown> = {}, mods?: (q: any) => any) {
  let q = c.db.from(table).select("*", { head: true, count: "exact" });
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v as never);
  if (mods) q = mods(q);
  const { count: n, error } = await q;
  return error ? `ERR ${error.message.slice(0, 60)}` : (n ?? 0);
}

console.log(`\n▐ PREFLIGHT — project=${env.projectRef} tenant=${T}\n`);

console.log("― Tenancy ―");
for (const tbl of ["interactions", "intelligence_objects", "automation_intents", "outcomes"]) {
  const { data } = await c.db.from(tbl).select("tenant_id").limit(1000);
  const tenants = new Set((data ?? []).map((r: any) => r.tenant_id));
  line(`${tbl}: distinct tenant_ids (sample 1000)`, [...tenants].length + " → " + [...tenants].slice(0, 3).join(","));
}

console.log("\n― Intelligence ingestion backlog ―");
line("interactions: total", await count("interactions"));
line("interactions: enriched", await count("interactions", { processing_status: "enriched" }));
line("intelligence_ingestions: total", await count("intelligence_ingestions"));
// enriched interactions with NO ledger row for this mapper (the backlog the scan drains)
{
  const { data: enriched } = await c.db
    .from("interactions")
    .select("id, tenant_id")
    .eq("processing_status", "enriched")
    .limit(2000);
  const ids = (enriched ?? []).map((r: any) => r.id);
  let backlog = 0;
  if (ids.length) {
    const { data: led } = await c.db
      .from("intelligence_ingestions")
      .select("interaction_id")
      .eq("mapper_version", MAPPER_VERSION)
      .in("interaction_id", ids);
    const have = new Set((led ?? []).map((r: any) => r.interaction_id));
    backlog = ids.filter((id: string) => !have.has(id)).length;
  }
  line(`enriched interactions WITHOUT ledger (mapper ${MAPPER_VERSION})`, `${backlog} / ${ids.length} sampled`);
}
line("intelligence_objects: observations", await count("intelligence_objects", { object_class: "observation" }));
line("intelligence_objects: actions", await count("intelligence_objects", { object_class: "action" }));

console.log("\n― Platform jobs ―");
for (const s of ["queued", "running", "retrying", "succeeded", "failed", "dead_letter", "cancelled"]) {
  line(`platform_jobs: ${s}`, await count("platform_jobs", { status: s }));
}

console.log("\n― Automation ―");
line("automation_intents: pending", await count("automation_intents", { status: "pending" }));
line("automation_intents: succeeded", await count("automation_intents", { status: "succeeded" }));
line("automation_intents: failed", await count("automation_intents", { status: "failed" }));
line("automation_approvals: total", await count("automation_approvals"));
line("outcomes: total", await count("outcomes"));
// succeeded intents without an outcome
{
  const { data: succ } = await c.db.from("automation_intents").select("id").eq("status", "succeeded").limit(1000);
  const ids = (succ ?? []).map((r: any) => r.id);
  let missing = 0;
  if (ids.length) {
    const { data: outs } = await c.db.from("outcomes").select("automation_intent_id").in("automation_intent_id", ids);
    const have = new Set((outs ?? []).map((r: any) => r.automation_intent_id));
    missing = ids.filter((id: string) => !have.has(id)).length;
  }
  line("succeeded intents WITHOUT any outcome", `${missing} / ${ids.length} sampled`);
}
// intents referencing a capability not in the contracts table
{
  const { data: intents } = await c.db.from("automation_intents").select("capability_key").not("capability_key", "is", null).limit(2000);
  const keys = new Set((intents ?? []).map((r: any) => r.capability_key));
  const { data: caps } = await c.db.from("automation_connector_capabilities").select("capability_key");
  const known = new Set((caps ?? []).map((r: any) => r.capability_key));
  const missing = [...keys].filter((k) => !known.has(k));
  line("intent capability_keys missing a contract", missing.length ? missing.join(",") : "none");
}

console.log("\n― Email health ―");
for (const tbl of ["email_messages"]) {
  const total = await count(tbl);
  line(`${tbl}: total`, total);
  const { data: latest } = await c.db.from(tbl).select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  line(`${tbl}: latest created_at`, (latest as any)?.created_at ?? "—");
}
line("tenant_connectors: email/gmail enabled", await count("tenant_connectors", {}, (q: any) => q.in("provider", ["google", "gmail", "google_workspace"]).eq("enabled", true)));

console.log("\n― Phone health ―");
line("phone_calls: total", await count("phone_calls"));
{
  const { data: latest } = await c.db.from("phone_calls").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  line("phone_calls: latest created_at", (latest as any)?.created_at ?? "—");
}

console.log("\n― Scheduler (pg_cron) ―");
{
  const { data, error } = await c.db.rpc("serviceos_schedule_defs");
  if (error) line("serviceos_schedule_defs()", `ERR ${error.message.slice(0, 60)}`);
  else line("registered schedule defs", (data ?? []).length);
}

console.log("\n▐ preflight complete (read-only).\n");
process.exit(0);
