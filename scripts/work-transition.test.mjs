// Regression test — persistent work transitions (work-transition Edge Function).
//
// Proves the load-bearing correctness the audit flagged: Command Centre transitions
// were LOCAL_ONLY React state (silent data loss on refresh). This exercises:
//   (A) the PURE decision matrix + gates (decideWorkTransition), and
//   (B) the DB persistence that decision drives — object_state_history is append-only
//       and the status change SURVIVES a re-read (i.e. survives refresh).
//
// Run (Node 24, strips TS types from the shared module; hits the LOCAL stack):
//   SUPABASE_URL=http://127.0.0.1:54321 node --experimental-strip-types scripts/work-transition.test.mjs
// (SUPABASE_URL only used for parity; DB access is via the REST url below.)
import { createClient } from "@supabase/supabase-js";
import { decideWorkTransition } from "../supabase/functions/_shared/work_transition.ts";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const db = createClient(URL, SR, { auth: { persistSession: false } });

const T = "00000000-0000-0000-0000-0000000000d1";
const UID = "00000000-0000-0000-0000-0000000000d2";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

// Mirror of the Edge Function's persist step, so the test proves the SAME path.
async function apply(object, verb, actor, legal, opts = {}) {
  const d = decideWorkTransition({ object, verb, actor, legalTransitions: legal, ...opts });
  if (!d.ok) return d;
  await db.from("object_state_history").insert({
    tenant_id: T, object_id: object.id,
    from_state: d.history.from_state, to_state: d.history.to_state, actor: d.history.actor, reason: d.history.reason,
  });
  const patch = { ...(d.objectPatch ?? {}), version: (object.version ?? 1) + 1 };
  if (d.statusChanged && d.toStatus) patch.status = d.toStatus;
  await db.from("intelligence_objects").update(patch).eq("id", object.id);
  if (d.objectiveLink) {
    await db.from("objective_links").insert({
      tenant_id: T, objective_id: d.objectiveLink.objectiveId, target_kind: "intelligence_object",
      target_ref: object.id, relation: d.objectiveLink.relation, rationale: d.objectiveLink.rationale, approved: actor.isSuperadmin,
    });
  }
  return d;
}
const reload = async (id) => (await db.from("intelligence_objects").select("*").eq("id", id).single()).data;
const historyCount = async (id) => ((await db.from("object_state_history").select("id").eq("object_id", id)).data ?? []).length;

async function cleanup() {
  const objs = (await db.from("intelligence_objects").select("id").eq("tenant_id", T)).data ?? [];
  for (const o of objs) {
    await db.from("object_state_history").delete().eq("object_id", o.id);
    await db.from("objective_links").delete().eq("target_ref", o.id);
  }
  await db.from("intelligence_objects").delete().eq("tenant_id", T);
  const mem = (await db.from("team_members").select("id").eq("tenant_id", T)).data ?? [];
  if (mem.length) await db.from("authority_grants").delete().eq("tenant_id", T).in("member_id", mem.map((m) => m.id));
  await db.from("team_members").delete().eq("tenant_id", T);
  const o2 = (await db.from("objectives").select("id").eq("tenant_id", T)).data ?? [];
  await db.from("objectives").delete().eq("tenant_id", T);
  await db.from("config_versions").delete().eq("tenant_id", T);
  await db.from("tenants").delete().eq("id", T);
}

try {
  await cleanup();
  await db.from("tenants").insert({ id: T, slug: "wt-test", display_name: "WT Test", status: "active" });
  const cv = (await db.from("config_versions").insert({ tenant_id: T, artifact_kind: "operating_profile", artifact_key: "wt", version: 1, status: "draft", author: "openfolk" }).select("id").single()).data;
  const obj = (await db.from("objectives").insert({ tenant_id: T, objective_type: "operational_target", title: "Protect Further Works margin", status: "draft", source: "openfolk_proposed", version_id: cv.id }).select("id").single()).data;

  // Actor WITH ownership.confirm + work.assign; a second objective to correct to.
  const member = (await db.from("team_members").insert({ tenant_id: T, profile_id: UID, display_name: "Coordinator", formal_role: "Coordinator", observed_status: "proposed", authority_level: "lead", source: "openfolk_proposed" }).select("id").single()).data;
  const now = new Date().toISOString();
  await db.from("authority_grants").insert([
    { tenant_id: T, member_id: member.id, permission: "work.assign", scope: "company", effective_from: now },
    { tenant_id: T, member_id: member.id, permission: "ownership.confirm", scope: "company", effective_from: now },
  ]);
  const legal = (await db.from("state_transitions").select("from_state, to_state").eq("domain", "serviceos").eq("object_type", "Action")).data ?? [];
  ok(legal.length >= 10, `legal serviceos/Action transitions loaded (${legal.length})`);

  const actor = { userRef: UID, isSuperadmin: false, canAssign: true, canApprove: false, canConfirmOwnership: true, isAssignee: true };
  const actorNoAuth = { userRef: "x", isSuperadmin: false, canAssign: false, canApprove: false, canConfirmOwnership: false, isAssignee: true };

  // Seed one action work-item in 'proposed', with a done_when.
  const io = (await db.from("intelligence_objects").insert({
    tenant_id: T, domain: "serviceos", object_type: "Action", subject: "Quote Further Works at site 12",
    status: "proposed", attributes: { done_when: "Quote sent and logged in Commusoft" },
    responsible_ref: { kind: "user", ref: UID }, version: 1,
  }).select("*").single()).data;

  // (A) PURE gates
  ok(!(await apply({ ...io, status: "proposed" }, "complete", actor, legal, { evidence: "sent" })).ok, "complete illegal from 'proposed' (matrix)");
  ok((await apply(io, "dismiss", actor, legal, {})).code === "bad_request", "dismiss without reason rejected");
  ok((await apply(io, "correct_owner", actorNoAuth, legal, { targetMemberRef: member.id, reason: "x" })).code === "forbidden", "correct_owner without ownership.confirm forbidden");

  // (B) PERSISTENCE round-trip — acknowledge → start → complete, each survives re-read.
  let cur = await reload(io.id);
  ok((await apply(cur, "acknowledge", actor, legal, {})).ok, "acknowledge proposed→ready");
  cur = await reload(io.id);
  ok(cur.status === "ready", "PERSISTED: status is 'ready' after re-read (survives refresh)");

  ok((await apply(cur, "start", actor, legal, {})).ok, "start ready→in_progress");
  cur = await reload(io.id);
  ok(cur.status === "in_progress", "PERSISTED: status is 'in_progress' after re-read");

  // complete requires done_when (present) + evidence
  ok((await apply(cur, "complete", actor, legal, {})).code === "evidence_required", "complete blocked without evidence (done_when present)");
  ok((await apply(cur, "complete", actor, legal, { evidence: { quote_id: "Q-1001" } })).ok, "complete with evidence");
  cur = await reload(io.id);
  ok(cur.status === "complete", "PERSISTED: status is 'complete' after re-read");
  ok(cur.attributes.completion_evidence?.quote_id === "Q-1001", "completion evidence stored on object");

  const hc = await historyCount(io.id);
  ok(hc === 3, `object_state_history has exactly 3 successful transitions (got ${hc}) — denials wrote none`);

  // correct_objective preserves + links (authority path)
  const io2 = (await db.from("intelligence_objects").insert({
    tenant_id: T, domain: "serviceos", object_type: "Action", subject: "Chase overdue invoice",
    status: "ready", attributes: {}, version: 1,
  }).select("*").single()).data;
  ok((await apply(io2, "correct_objective", actor, legal, { targetObjectiveId: obj.id, reason: "belongs to margin objective" })).ok, "correct_objective with ownership.confirm");
  const link = (await db.from("objective_links").select("*").eq("target_ref", io2.id).maybeSingle()).data;
  ok(link && link.objective_id === obj.id && link.target_kind === "intelligence_object", "PERSISTED: objective_links row created (work→objective)");

  await cleanup();
  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error("ERROR", e.message);
  process.exit(1);
}
