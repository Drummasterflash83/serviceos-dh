// Seed the PROPOSED (draft, unpublished) Drummond strategic configuration + operational
// team/ownership. Everything is source='openfolk_proposed', status='draft', unconfirmed —
// it is a proposal for review, NOT Drummond's agreed strategy. Reversible: re-running
// deletes prior openfolk_proposed rows for the tenant first. Never publishes/activates.
//
//   node scripts/seed-drummond-draft-strategy.mjs           # against .env.verify (remote)
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-drummond-draft-strategy.mjs
//   node scripts/seed-drummond-draft-strategy.mjs --clean   # remove all openfolk_proposed drafts
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

let URL = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY,
  T = process.env.VERIFY_TENANT;
if ((!URL || !SR) && existsSync("./.env.verify")) {
  const env = Object.fromEntries(readFileSync("./.env.verify", "utf8").split("\n")
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  URL ||= env.SUPABASE_URL; SR ||= env.SUPABASE_SERVICE_ROLE_KEY; T ||= env.VERIFY_TENANT;
}
T ||= "00000000-0000-0000-0000-000000000001";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const SRC = "openfolk_proposed";
const clean = process.argv.includes("--clean");

async function wipe() {
  // delete in FK-safe order; only openfolk_proposed rows
  const objs = (await db.from("objectives").select("id").eq("tenant_id", T).eq("source", SRC)).data ?? [];
  const objIds = objs.map((o) => o.id);
  if (objIds.length) {
    await db.from("objective_constraints").delete().eq("tenant_id", T).in("objective_id", objIds);
    await db.from("objective_metrics").delete().eq("tenant_id", T).in("objective_id", objIds);
  }
  await db.from("objectives").delete().eq("tenant_id", T).eq("source", SRC);
  await db.from("metric_definitions").delete().eq("tenant_id", T).like("key", "proposed.%");
  const mem = (await db.from("team_members").select("id").eq("tenant_id", T).eq("source", SRC)).data ?? [];
  const memIds = mem.map((m) => m.id);
  if (memIds.length) {
    await db.from("authority_grants").delete().eq("tenant_id", T).in("member_id", memIds);
    await db.from("responsibility_assignments").delete().eq("tenant_id", T).in("member_id", memIds);
  }
  await db.from("team_members").delete().eq("tenant_id", T).eq("source", SRC);
  await db.from("config_versions").delete().eq("tenant_id", T).eq("artifact_key", "strategic_objectives").eq("author", "openfolk");
}

async function main() {
  await wipe();
  if (clean) { console.log("cleaned openfolk_proposed drafts for tenant", T); return; }

  // 0) config version to anchor the draft strategy
  const cv = (await db.from("config_versions").insert({
    tenant_id: T, artifact_kind: "operating_profile", artifact_key: "strategic_objectives",
    version: 1, status: "draft", author: "openfolk",
    note: "Proposed Drummond strategy (openfolk_proposed, unpublished — review required)",
  }).select("id").single()).data;
  const version_id = cv.id;

  // 1) team members (owner linked to the real login; 7 staff proposed, no login)
  const ownerProfile = (await db.from("profiles").select("id").eq("tenant_id", T).eq("role", "owner").limit(1).maybeSingle()).data;
  const members = [
    { key: "owner", display_name: "Owner / MD", profile_id: ownerProfile?.id ?? null, formal_role: "Managing Director", observed_role: "Owner / final authority", authority_level: "owner", confidence: 0.9 },
    { key: "rudi", display_name: "Rudi", formal_role: "Operations", observed_role: "Operations & emergencies", authority_level: "manager", confidence: 0.5 },
    { key: "julie", display_name: "Julie", formal_role: "Scheduling / office", observed_role: "Scheduling (esp. Mon/Wed)", authority_level: "lead", confidence: 0.5 },
    { key: "mary", display_name: "Mary", formal_role: "Office", observed_role: "PPM, VIP customers, complaints, prison-estate work", authority_level: "lead", confidence: 0.5 },
    { key: "liz", display_name: "Liz", formal_role: "Finance / office", observed_role: "Finance & front-line office cover", authority_level: "lead", confidence: 0.5 },
    { key: "larne", display_name: "Larne", formal_role: "New business", observed_role: "New business", authority_level: "individual", confidence: 0.5 },
    { key: "tony", display_name: "Tony", formal_role: "Supply / stores", observed_role: "Suppliers, parts, out-of-hours", authority_level: "lead", confidence: 0.5 },
    { key: "heidi", display_name: "Heidi", formal_role: "Senior management", observed_role: "Escalation & senior oversight", authority_level: "director", confidence: 0.6 },
  ];
  const memId = {};
  for (const m of members) {
    const row = (await db.from("team_members").insert({
      tenant_id: T, profile_id: m.profile_id ?? null, display_name: m.display_name,
      formal_role: m.formal_role, observed_role: m.observed_role, observed_status: "proposed",
      authority_level: m.authority_level, confidence: m.confidence, source: SRC,
      evidence: [{ source: "openfolk", detail: "draft from current Drummond team context — unconfirmed" }],
    }).select("id").single()).data;
    memId[m.key] = row.id;
  }

  // 2) North Star + 8 objectives (all draft, openfolk_proposed)
  const northStar = (await db.from("objectives").insert({
    tenant_id: T, objective_type: "north_star",
    title: "Run a proactive, scalable and consistently profitable service operation with fewer dropped actions, faster customer response, stronger ownership and less dependence on individual memory.",
    description: "Proposed North Star for review. Not published; not Drummond's agreed strategy.",
    status: "draft", source: SRC, priority: "top", weight: 1, confidence: 0.6,
    owner: { kind: "team_member", ref: memId.owner, proposed: true },
    accountable_owner: { kind: "team_member", ref: memId.owner, proposed: true },
    version_id, review_cadence: "quarterly",
    target_at: new Date(Date.parse("2026-07-22") + 365 * 864e5).toISOString(),
  }).select("id").single()).data;

  // objective, proposed owner member, metric (key,name,unit,direction), baseline note
  const OBJS = [
    ["customer_target", "Respond to every customer requirement quickly and reliably.", "julie", "proposed.first_response_time", "Median first-response time", "minutes", "decrease"],
    ["service_target", "Complete jobs correctly, efficiently and profitably.", "rudi", "proposed.job_margin", "Average job gross margin", "%", "increase"],
    ["financial_target", "Capture every valid quote, service and recurring-revenue opportunity.", "larne", "proposed.opportunities_captured", "Qualified opportunities captured", "count", "increase"],
    ["optimisation_target", "Reduce avoidable office administration and repeated work.", "liz", "proposed.manual_touches", "Manual touches per job", "count", "decrease"],
    ["people_target", "Improve engineer and team performance fairly using reviewable evidence.", "heidi", "proposed.evidence_reviews", "Evidence-based performance reviews", "count", "increase"],
    ["risk_reduction", "Give management early warning of customer, operational and margin risk.", "heidi", "proposed.risks_pre_escalation", "Risks surfaced before escalation", "%", "increase"],
    ["operational_target", "Improve ownership and reduce work falling between teams.", "heidi", "proposed.dropped_actions", "Dropped / unowned actions", "count", "decrease"],
    ["capacity_target", "Increase operational capacity without proportional headcount.", "rudi", "proposed.jobs_per_fte", "Jobs completed per FTE", "count", "increase"],
  ];
  let n = 0;
  for (const [type, title, ownerKey, mkey, mname, unit, dir] of OBJS) {
    n++;
    const obj = (await db.from("objectives").insert({
      tenant_id: T, objective_type: type, title,
      description: "Proposed objective for review (openfolk_proposed, unpublished).",
      status: "draft", source: SRC, parent_objective_id: northStar.id,
      priority: n <= 3 ? "high" : "medium", weight: 1 - n * 0.05, confidence: 0.55,
      owner: { kind: "team_member", ref: memId[ownerKey], proposed: true },
      version_id, review_cadence: "quarterly",
      target_at: new Date(Date.parse("2026-07-22") + 90 * 864e5).toISOString(),
    }).select("id").single()).data;

    const metric = (await db.from("metric_definitions").insert({
      tenant_id: T, key: mkey, name: mname, unit, direction: dir, version_id,
      source_system: "not_connected", update_cadence: "unknown",
      owner: { kind: "team_member", ref: memId[ownerKey], proposed: true },
    }).select("id").single()).data;
    // baseline UNAVAILABLE — do not invent a number (baseline_value left null).
    await db.from("objective_metrics").insert({
      tenant_id: T, objective_id: obj.id, metric_id: metric.id, role: "primary",
      direction: dir, baseline_value: null, baseline_unit: unit, target_value: null, target_unit: unit,
    });
    // one honest guardrail: never sacrifice safety/quality for the target
    await db.from("objective_constraints").insert({
      tenant_id: T, objective_id: obj.id, key: "no_safety_or_quality_tradeoff", kind: "guardrail",
      description: "Do not sacrifice safety, compliance or job quality to move this objective.", version_id,
    });

    // objective ownership as a responsibility assignment (draft)
    await db.from("responsibility_assignments").insert({
      tenant_id: T, member_id: memId[ownerKey], kind: "objective", target_ref: obj.id,
      label: `Owns objective: ${title.slice(0, 60)}…`, raci_role: "accountable",
      source: SRC, confidence: 0.5, evidence: [{ source: "openfolk", detail: "proposed owner from role context" }],
    });
  }

  // 3) responsibilities (areas / weekday / cover / escalation) — draft
  const MON = 1, WED = 4;
  const RESP = [
    ["rudi", "responsibility_area", "operations", "Operations", null, null],
    ["rudi", "responsibility_area", "emergencies", "Emergencies", null, null],
    ["julie", "responsibility_area", "scheduling", "Scheduling (esp. Mon/Wed)", MON | WED, null],
    ["mary", "responsibility_area", "ppm", "Planned preventative maintenance (PPM)", null, null],
    ["mary", "customer_segment", "vip", "VIP customers", null, null],
    ["mary", "responsibility_area", "complaints", "Complaints", null, null],
    ["mary", "customer_segment", "prison_estate", "Prison-estate work", null, null],
    ["liz", "responsibility_area", "finance", "Finance", null, null],
    ["liz", "responsibility_area", "office_cover", "Front-line office cover", null, null],
    ["larne", "responsibility_area", "new_business", "New business", null, null],
    ["tony", "responsibility_area", "suppliers", "Suppliers & parts", null, null],
    ["tony", "cover", "out_of_hours", "Out-of-hours cover", null, "tony"],
    ["heidi", "escalation", "senior_escalation", "Escalation & senior oversight", null, null],
  ];
  for (const [who, kind, ref, label, weekday, coverKey] of RESP) {
    await db.from("responsibility_assignments").insert({
      tenant_id: T, member_id: memId[who], kind, target_ref: ref, label,
      raci_role: kind === "escalation" ? "accountable" : "responsible",
      weekday_mask: weekday, cover_for: coverKey ? memId[coverKey] : null,
      source: SRC, confidence: 0.5,
      evidence: [{ source: "openfolk", detail: "draft responsibility from team context — unconfirmed" }],
    });
  }

  // 4) authority grants — governance (draft). Owner=all company; Heidi=leader; others=self.
  const ALL_AGENT = ["agent.view", "agent.interact", "agent.correct", "agent.approve_action", "agent.pause", "agent.configure", "agent.create", "agent.activate", "agent.set_autonomy", "agent.set_access", "agent.assign", "agent.retire"];
  const grant = async (who, perm, scope) =>
    db.from("authority_grants").insert({ tenant_id: T, member_id: memId[who], permission: perm, scope, source: SRC });
  for (const p of [...ALL_AGENT, "work.approve", "work.assign", "objective.publish", "ownership.confirm"]) await grant("owner", p, "company");
  for (const p of ["agent.view", "agent.interact", "agent.correct", "agent.approve_action", "agent.pause", "agent.configure", "agent.activate", "agent.set_autonomy", "agent.assign", "work.approve", "work.assign", "ownership.confirm"]) await grant("heidi", p, "company");
  for (const who of ["rudi", "julie", "mary", "liz", "tony"]) {
    for (const p of ["agent.view", "agent.interact", "agent.correct", "agent.approve_action"]) await grant(who, p, "self");
    await grant(who, "work.approve", "self");
  }
  await grant("rudi", "agent.pause", "team");
  await grant("larne", "agent.view", "self");
  await grant("larne", "agent.interact", "self");

  // summary
  const c = async (t, f = (q) => q) => (await f(db.from(t).select("*", { count: "exact", head: true }).eq("tenant_id", T))).count;
  console.log("SEEDED (draft/openfolk_proposed):");
  console.log("  objectives:", await c("objectives", (q) => q.eq("source", SRC)), "(1 north_star + 8)");
  console.log("  metric_definitions:", await c("metric_definitions", (q) => q.like("key", "proposed.%")));
  console.log("  team_members:", await c("team_members", (q) => q.eq("source", SRC)));
  console.log("  responsibility_assignments:", await c("responsibility_assignments", (q) => q.eq("source", SRC)));
  console.log("  authority_grants:", await c("authority_grants", (q) => q.eq("source", SRC)));
  console.log("  owner linked to login profile:", !!ownerProfile?.id);
  console.log("Reversible: node scripts/seed-drummond-draft-strategy.mjs --clean");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
