// Seed the persistent "Sarah Mitchell" golden scenario into the live remote and export
// the resulting Command Centre feed for the demo render harness.
//
//   node scripts/demo/seed_sarah.ts            # seed + drive to pending-approval + export
//   node scripts/demo/seed_sarah.ts --export   # re-export the feed only (no seeding)
//
// It reuses the SAME pure feed mapper the authenticated UI uses (src/lib/command-feed.ts),
// so the exported JSON is exactly what <CommandCentreView> would render. Writes
// src/lib/demo-command-feed.json (git-ignored is NOT required — it is synthetic data).

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDotenv, resolveEnv, mergeEnv } from "../verify/lib.ts";
import { makeClient } from "../verify/client.ts";
import {
  MAPPER_VERSION,
  observeJobKey,
} from "../../supabase/functions/_shared/observation_ingest.ts";
import { fetchCommandRows, mapCommandFeed, type CommandFeed } from "../../src/lib/command-feed.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(REPO, "src", "lib", "demo-command-feed.ts");
const exportOnly = process.argv.includes("--export");

const envFile = join(REPO, ".env.verify");
const fileEnv = existsSync(envFile) ? parseDotenv(readFileSync(envFile, "utf8")) : {};
const resolved = resolveEnv(mergeEnv(fileEnv, process.env));
if (!resolved.ok) throw new Error("env missing: " + resolved.missing.join(","));
const env = resolved.env!;
const c = await makeClient(env);
const T = env.tenantId;
const now = new Date();
const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const TAG = { demo: true, scenario: "sarah_mitchell" };

function complaint(kind: "trigger" | "history", personId: string, id: string, i: number) {
  const t = kind === "trigger";
  return {
    id,
    tenant_id: T,
    source_connector_id: "google-workspace",
    source_type: "email",
    source_table: "email_messages",
    source_id: id,
    source_external_id: `demo-sarah-${kind}-${i}`,
    interaction_type: "email_message",
    direction: "inbound",
    occurred_at: t ? iso(now) : iso(daysAgo(28 - i * 10)),
    subject: t
      ? "My boiler has broken again and nobody has resolved it"
      : `Heating failure — no hot water (report ${i})`,
    summary: t
      ? "Customer is frustrated after a third heating breakdown in a month with no resolution."
      : "Reported heating breakdown; engineer attended.",
    body_preview: t
      ? "This is the third time my boiler has broken in a month. I have no heating and nobody has fixed it. I am extremely unhappy and want this resolved urgently."
      : "The boiler has stopped working again. Please send someone.",
    from_address: "sarah.mitchell@example.invalid",
    from_name: "Sarah Mitchell",
    to_addresses: [],
    status: "active",
    processing_status: "enriched",
    sentiment: t ? "negative" : "neutral",
    priority: t ? "high" : "medium",
    related_person_id: personId,
    metadata: TAG,
  };
}

async function driveJob(jobType: string, jobId: string) {
  for (let i = 0; i < 30; i++) {
    await c.invokeWorker([jobType]);
    const { data: j } = await c.db
      .from("platform_jobs")
      .select("status")
      .eq("id", jobId)
      .maybeSingle();
    if (j && ["succeeded", "failed", "dead_letter", "cancelled"].includes(j.status as string)) {
      return j.status as string;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return "timeout";
}

async function seed(): Promise<string> {
  // Activate the internal-note vertical (idempotent).
  await c.db.rpc("serviceos_set_automation_vertical", { p_tenant: T, p_enable: true });

  const personId = crypto.randomUUID();
  await c.db.from("people").insert({
    id: personId,
    tenant_id: T,
    display_name: "Sarah Mitchell",
    first_name: "Sarah",
    last_name: "Mitchell",
    primary_email: "sarah.mitchell@example.invalid",
    metadata: TAG,
  });
  await c.db.from("customer_cards").insert({
    tenant_id: T,
    person_id: personId,
    title: "Sarah Mitchell",
    summary:
      "Repeat heating failure — 3 breakdowns in 30 days, unresolved. High-value customer (£8,400 lifetime); sentiment declining.",
    status: "red",
    priority: "high",
    priority_score: 88,
    confidence: 0.94,
    recommended_action: "Escalate to priority response",
    latest_activity_at: iso(now),
    context: { projection: { business: { relationship_count: 3, lifetime_value_gbp: 8400 } } },
    metadata: TAG,
  });
  for (let i = 1; i <= 3; i++) {
    await c.db.from("interactions").insert(complaint("history", personId, crypto.randomUUID(), i));
  }
  const triggerId = crypto.randomUUID();
  await c.db.from("interactions").insert(complaint("trigger", personId, triggerId, 0));

  // Ingest → observe → materialise a PENDING intent (assisted mode).
  const ingestKey = `demo:ingest:${triggerId}`;
  const { data: ins } = await c.db
    .from("platform_jobs")
    .insert({
      tenant_id: T,
      connector_id: "openfolk-core",
      module_id: "demo",
      job_type: "intelligence.ingest_interaction",
      job_key: ingestKey,
      status: "queued",
      priority: 100,
      max_attempts: 3,
      available_at: iso(now),
      payload: { interaction_ids: [triggerId] },
    })
    .select("id")
    .single();
  console.log("ingest:", await driveJob("intelligence.ingest_interaction", ins!.id as string));

  const { data: led } = await c.db
    .from("intelligence_ingestions")
    .select("observe_job_id")
    .eq("tenant_id", T)
    .eq("interaction_id", triggerId)
    .eq("mapper_version", MAPPER_VERSION)
    .maybeSingle();
  let observeJobId = (led?.observe_job_id as string | null) ?? null;
  if (!observeJobId) {
    const { data: oj } = await c.db
      .from("platform_jobs")
      .select("id")
      .eq("tenant_id", T)
      .eq("job_key", observeJobKey(T, triggerId, MAPPER_VERSION))
      .maybeSingle();
    observeJobId = (oj?.id as string | null) ?? null;
  }
  console.log(
    "observe:",
    observeJobId ? await driveJob("intelligence.observe", observeJobId) : "no job",
  );

  // Report the pending intent.
  const { data: obs } = await c.db
    .from("intelligence_objects")
    .select("id, decision_id, confidence")
    .eq("tenant_id", T)
    .eq("object_class", "observation")
    .contains("source_interactions", [triggerId])
    .maybeSingle();
  const decisionId = (obs?.decision_id as string | null) ?? null;
  const { data: intent } = await c.db
    .from("automation_intents")
    .select("id, status")
    .eq("tenant_id", T)
    .eq("decision_id", decisionId as string)
    .maybeSingle();
  console.log(
    `seeded Sarah — person=${personId} trigger=${triggerId} observation=${obs?.id} decision=${decisionId} intent=${intent?.id} (${intent?.status})`,
  );
  return decisionId ?? "";
}

let heroDecision = "";
if (!exportOnly) heroDecision = await seed();

// ── Export the feed exactly as the UI maps it ─────────────────────────────────
const rows = await fetchCommandRows(c.db, { tenantId: T, perSource: 80 });
const feed: CommandFeed = mapCommandFeed(rows);

// Curate to Sarah's story (the hero). Every item on her decision thread — Observation,
// Action, pending intent, and (once executed) the outcome — shares one storyKey, so the
// whole journey is included and nothing else clutters the demo.
const heroKey = heroDecision
  ? `decision:${heroDecision}`
  : // --export re-run: rediscover the most recent Sarah story from the mapped feed.
    (feed.items.find((i) => i.customerName === "Sarah Mitchell")?.storyKey ?? null);
const items = heroKey ? feed.items.filter((i) => i.storyKey === heroKey) : feed.items;
const chosen = new Set(items.map((i) => i.storyKey));
const curated: CommandFeed = {
  items,
  summary: { ...feed.summary, total: feed.summary.total }, // keep the true reviewed count
  sources: feed.sources,
};

const banner =
  "// AUTO-GENERATED by scripts/demo/seed_sarah.ts — do not edit by hand.\n" +
  "// A real Command Centre feed exported from the live remote (the seeded Sarah Mitchell\n" +
  "// scenario), mapped by the SAME src/lib/command-feed.ts the authenticated UI uses.\n";
writeFileSync(
  OUT,
  `${banner}import type { CommandFeed } from "./command-feed";\n\nexport const demoCommandFeed: CommandFeed = ${JSON.stringify(
    curated,
    null,
    2,
  )};\n`,
);
console.log(
  `\nexported ${items.length} items across ${chosen.size} stories (of ${feed.summary.total} reviewed) → ${OUT}`,
);
console.log("stories:");
const seen = new Set<string>();
for (const i of items) {
  if (seen.has(i.storyKey)) continue;
  seen.add(i.storyKey);
  console.log(`  [${i.priority}] ${i.customerName ? i.customerName + " — " : ""}${i.title}`);
}
process.exit(0);
