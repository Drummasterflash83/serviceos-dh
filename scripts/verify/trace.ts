// Phase 5 — prove the REAL ingestion loop + trace real call/email. Reads live data;
// drains the small enriched-but-uningested backlog through the deployed worker (bounded).
// The only writes are intelligence.ingest_interaction jobs (internal; no external effect).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDotenv, resolveEnv, mergeEnv } from "./lib.ts";
import { makeClient } from "./client.ts";
import { MAPPER_VERSION } from "../../supabase/functions/_shared/observation_ingest.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envFile = join(REPO, ".env.verify");
const env = resolveEnv(mergeEnv(existsSync(envFile) ? parseDotenv(readFileSync(envFile, "utf8")) : {}, process.env)).env!;
const c = await makeClient(env);
const T = env.tenantId;
const nowIso = () => new Date().toISOString();

async function driveJob(jobType: string, jobId: string) {
  for (let i = 0; i < 25; i++) {
    await c.invokeWorker([jobType]);
    const { data: j } = await c.db.from("platform_jobs").select("status").eq("id", jobId).maybeSingle();
    if (j && ["succeeded", "failed", "dead_letter", "cancelled"].includes(j.status as string)) return j.status as string;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "timeout";
}

// ── A) Deployed eligibility fix: newest ledger row carries the verdict ──────────
console.log("\n― A) Deployed eligibility persistence (the drift fix) ―");
{
  const { data, error } = await c.db
    .from("intelligence_ingestions")
    .select("interaction_id, eligibility_reason, eligibility_confidence, created_at")
    .eq("tenant_id", T)
    .not("eligibility_reason", "is", null)
    .order("created_at", { ascending: false })
    .limit(3);
  if (error) console.log("  eligibility columns:", error.message);
  else if (!data?.length) console.log("  no ledger row carries eligibility yet (pre-fix rows only)");
  else for (const r of data) console.log(`  ledger ${String(r.interaction_id).slice(0, 8)} → ${r.eligibility_reason} @ ${r.eligibility_confidence}`);
}

// ── B) Real enriched interactions + the backlog ────────────────────────────────
console.log("\n― B) Real enriched interactions ―");
const { data: enriched } = await c.db
  .from("interactions")
  .select("id, source_type, interaction_type, subject, from_address, related_person_id, occurred_at")
  .eq("tenant_id", T)
  .eq("processing_status", "enriched")
  .order("occurred_at", { ascending: false })
  .limit(30);
const list = enriched ?? [];
console.log(`  ${list.length} enriched interactions:`);
for (const i of list.slice(0, 12))
  console.log(`   ${i.source_type?.padEnd(6)} ${String(i.subject ?? "").slice(0, 46).padEnd(46)} person=${i.related_person_id ? "yes" : "no "} ${String(i.occurred_at).slice(0, 10)}`);

// backlog = enriched with no ledger row for this mapper
const ids = list.map((i: any) => i.id);
const { data: led } = await c.db.from("intelligence_ingestions").select("interaction_id").eq("tenant_id", T).eq("mapper_version", MAPPER_VERSION).in("interaction_id", ids);
const have = new Set((led ?? []).map((r: any) => r.interaction_id));
const backlog = list.filter((i: any) => !have.has(i.id));
console.log(`\n  backlog (enriched, not yet ingested): ${backlog.length}`);

// ── C) Drain the backlog through the deployed worker (bounded to 5) ─────────────
console.log("\n― C) Drain the REAL backlog through the deployed loop (bounded) ―");
for (const it of backlog.slice(0, 5)) {
  const jobKey = `trace:ingest:${it.id}`;
  const { data: existing } = await c.db.from("platform_jobs").select("id").eq("tenant_id", T).eq("job_key", jobKey).maybeSingle();
  let jid = existing?.id as string | undefined;
  if (!jid) {
    const { data: ins, error } = await c.db.from("platform_jobs").insert({
      tenant_id: T, connector_id: "openfolk-core", module_id: "trace", job_type: "intelligence.ingest_interaction",
      job_key: jobKey, status: "queued", priority: 90, max_attempts: 2, available_at: nowIso(), payload: { interaction_ids: [it.id] },
    }).select("id").single();
    if (error) { console.log(`   ${String(it.id).slice(0,8)} enqueue ERR ${error.message.slice(0,50)}`); continue; }
    jid = ins!.id as string;
  }
  const st = await driveJob("intelligence.ingest_interaction", jid!);
  // read the resulting ledger verdict + whether an observation now exists
  const { data: lrow } = await c.db.from("intelligence_ingestions").select("status, eligibility_reason, eligibility_confidence").eq("tenant_id", T).eq("interaction_id", it.id).eq("mapper_version", MAPPER_VERSION).maybeSingle();
  console.log(`   ${it.source_type?.padEnd(6)} ${String(it.id).slice(0,8)} ingest=${st} ledger=${lrow?.status ?? "-"} verdict=${lrow?.eligibility_reason ?? "-"}@${lrow?.eligibility_confidence ?? "-"}`);
}

// ── D) Trace one real phone call end-to-end ────────────────────────────────────
console.log("\n― D) Real call trace (latest) ―");
{
  const { data: call } = await c.db.from("phone_calls").select("id, external_id, direction, from_number, to_number, recording_url, transcript, processing_status, occurred_at, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!call) console.log("  no phone_calls");
  else {
    const cl = call as any;
    console.log(`  call ${String(cl.id).slice(0,8)} ${cl.direction ?? "?"} ${String(cl.occurred_at ?? cl.created_at).slice(0,19)} status=${cl.processing_status}`);
    console.log(`    recording=${cl.recording_url ? "yes" : "no"} transcript=${cl.transcript ? (String(cl.transcript).length + " chars") : "none"}`);
    const { data: inter } = await c.db.from("interactions").select("id, processing_status, related_person_id, subject").eq("tenant_id", T).eq("source_type", "phone").eq("source_id", cl.id).maybeSingle();
    console.log(`    → interaction ${inter ? String(inter.id).slice(0,8) + " status=" + (inter as any).processing_status + " person=" + ((inter as any).related_person_id ? "resolved" : "unresolved") : "NOT projected yet"}`);
  }
}

// ── E) Trace one real email end-to-end ─────────────────────────────────────────
console.log("\n― E) Real email trace (latest) ―");
{
  const { data: msg } = await c.db.from("email_messages").select("id, subject, from_address, processing_status, occurred_at, created_at").eq("tenant_id", T).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!msg) console.log("  no email_messages");
  else {
    const m = msg as any;
    console.log(`  email ${String(m.id).slice(0,8)} "${String(m.subject ?? "").slice(0,40)}" from ${m.from_address ?? "?"} ${String(m.occurred_at ?? m.created_at).slice(0,19)}`);
    const { data: inter } = await c.db.from("interactions").select("id, processing_status, related_person_id").eq("tenant_id", T).eq("source_type", "email").eq("source_id", m.id).maybeSingle();
    console.log(`    → interaction ${inter ? String(inter.id).slice(0,8) + " status=" + (inter as any).processing_status + " person=" + ((inter as any).related_person_id ? "resolved" : "unresolved") : "NOT projected yet"}`);
  }
}

console.log("\n▐ trace complete.\n");
process.exit(0);
