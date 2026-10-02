import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launchPromotion, launchPromotionIds as ids, requireLaunchEvidence } from "./receptionist-launch-promotion.ts";
import { evidenceHash } from "./receptionist-care.ts";
import { launchScenarioPayloads } from "./receptionist-launch-scenarios.ts";
import { approvedOrdinaryDestination } from "./receptionist-launch-destinations.ts";
import { captureTestHarness } from "./receptionist-test-harness.ts";

const clone = <T>(x: T): T => structuredClone(x);
const uid = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, "0")}`;
async function fixture() {
  const orgId = uid(30), actor = uid(31);
  const voice = { provider: "11labs", voiceId: "approved" }, transcriber = { provider: "soniox" };
  const ordinary = { id: ids.ordinary, orgId, type: "transferCall", function: { name: "Route-Call-to-Drummond-Team-20260929" },
    destinations: ["+441794378095", "+441794378105", "+441794378096", "+441794840042", "+441794840043", ...Array.from({ length: 5 }, (_, i) => `+44179400000${i}`)].map(number => ({ type: "number", number, description: "Reviewed original destination", message: "Original announcement", transferPlan: { mode: "blind-transfer" } })) };
  const emergency = { id: ids.emergency, orgId, type: "transferCall", function: { name: "Route-Emergency-to-Rob-or-Tony" }, destinations: [{ number: "+441794378105", transferPlan: { mode: "warm-transfer" } }] };
  const handoff = { id: ids.handoff, orgId, type: "handoff", function: { name: "Route-Emergency-to-Rob-or-Tony" }, destinations: [{ type: "assistant", assistantId: ids.helper, contextEngineeringPlan: { type: "all" } }] };
  const live = { id: ids.live, orgId, name: "Emma", updatedAt: "original", voice, transcriber,
    server: { url: "https://private.example", headers: { Authorization: "PRIVATE_SECRET" } }, artifactPlan: { recordingEnabled: true },
    maxDurationSeconds: 300, firstMessage: "Live welcome", model: { provider: "openai", model: "gpt-4.1", tools: [], toolIds: [ids.ordinary, ids.emergency], messages: [{ role: "system", content: "Existing live policy" }] } };
  const candidate = { id: ids.candidate, orgId, updatedAt: "candidate-revision", voice, transcriber,
    firstMessage: 'openfolk_holidays {{"now" | date: "%Y"}}', model: { provider: "openai", model: "gpt-4.1", toolIds: [ids.handoff],
      tools: [{ type: ordinary.type, function: ordinary.function, destinations: ordinary.destinations.map(approvedOrdinaryDestination) }],
      messages: [{ role: "system", content: "CONSOLIDATED HANDOVER CONTRACT\nReviewed safety policy" }] } };
  const helper = { id: ids.helper, orgId, voice, transcriber, model: { toolIds: [ids.emergency], tools: [], messages: [{ role: "system", content: "EMERGENCY CONTINUATION: reviewed policy" }] } };
  const graph: any = { live, candidate, ordinary, emergency, handoff, helper };
  const phones = [{ id: uid(90), assistantId: ids.live, number: "+447426924154", provider: "twilio" }];
  const tools = [handoff, ...candidate.model.tools];
  const hash = await evidenceHash({ assistant: candidate, tools });
  const expected = launchScenarioPayloads(tools, candidate);
  const settings = { tenant_id: ids.tenant, assistant_id: ids.candidate, suite_id: uid(40) };
  const harnessData: Record<string, any> = {
    [`eval/simulation/suite/${settings.suite_id}`]: { id: settings.suite_id, name: "Reviewed suite", simulationIds: expected.map((_s, n) => uid(300 + n)) },
    [`eval/simulation/personality/${uid(600)}`]: { id: uid(600), name: "Reviewed Sam", assistant: { model: { provider: "openai", model: "gpt-4.1", messages: [{ role: "system", content: "Be sceptical" }] } } },
  };
  expected.forEach((scenario, n) => {
    harnessData[`eval/simulation/${uid(300 + n)}`] = { id: uid(300 + n), name: scenario.name, scenarioId: uid(400 + n), personalityId: uid(600) };
    harnessData[`eval/simulation/scenario/${uid(400 + n)}`] = { id: uid(400 + n), ...scenario };
  });
  const workspace = { assistant_id: ids.live };
  const run: any = { id: uid(41), provider_id: uid(42), tenant_id: ids.tenant, assistant_id: ids.candidate,
    suite_id: settings.suite_id, assistant_hash: hash, state: "passed", report: { configurationChanged: false,
      items: expected.map((s, n) => ({ id: uid(100 + n), name: s.name, callId: uid(200 + n), status: "passed", passed: true, outcome: "passed", transcript: "AI: Reviewed transcript", evidenceIssue: null, failure: null,
        evaluations: s.evaluations.map(e => ({ name: e.structuredOutput.name, schema: e.structuredOutput.schema, passed: true, required: true, comparator: "=", expectedValue: true, extractedValue: true })) })) } };
  const source = { state: "prepared", candidate_id: ids.candidate, helper_id: ids.helper, handoff_id: ids.handoff, source_assistant: clone(live), source_tools: clone([ordinary, emergency]) };
  const state: any = { saved: null, reads: {}, writes: [], rpcDenied: false, auditDenied: false, finishDenied: false,
    patchMode: "apply", beforeSecondRead: null, afterPatch: null };
  const db = {
    rpc: async (name: string, args: any) => { assert.equal(name, "care_release_actor"); assert.equal(args.p_actor, actor); return { error: state.rpcDenied ? "denied" : null }; },
    from(table: string) {
      const builder: any = { op: "select", value: null,
        select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
        insert(value: any) { this.op = "insert"; this.value = value; return this; },
        update(value: any) { this.op = "update"; this.value = value; return this; },
        execute() {
          state.reads[table] = (state.reads[table] ?? 0) + (this.op === "select" ? 1 : 0);
          if (table === "receptionist_launch_promotions") {
            if (this.op === "insert") { if (state.auditDenied || state.saved) return { error: "denied" }; state.saved = clone(this.value); return { error: null }; }
            if (this.op === "update") { if (state.finishDenied) return { error: "denied" }; state.saved = { ...state.saved, ...clone(this.value) }; return { error: null }; }
            return { error: null, data: state.saved && clone(state.saved) };
          }
          if (table === "receptionist_test_candidates") return { error: null, data: clone(source) };
          if (table === "receptionist_test_runs") return { error: null, data: clone(run) };
          if (table === "receptionist_test_settings") return { error: null, data: clone(settings) };
          if (table === "receptionist_workspaces") return { error: null, data: clone(workspace) };
          throw Error("Unexpected table " + table);
        },
        single() { return Promise.resolve(this.execute()); }, maybeSingle() { return Promise.resolve(this.execute()); },
        then(resolve: any, reject: any) { return Promise.resolve(this.execute()).then(resolve, reject); },
      };
      return builder;
    },
  };
  let liveReads = 0;
  const api = async (path: string, method = "GET", body?: any) => {
    if (method !== "GET") {
      assert.equal(path, "assistant/" + ids.live); assert.equal(method, "PATCH"); state.writes.push(clone(body));
      if (state.patchMode === "reject") throw Error("provider rejected");
      graph.live = { ...graph.live, ...clone(body), updatedAt: "new-provider-version", latestVersion: "history-v2" };
      if (state.patchMode === "partial") graph.live.firstMessage = "Live welcome";
      state.afterPatch?.(graph);
      if (state.patchMode === "applied500") throw Error("HTTP 500");
      return clone(graph.live);
    }
    if (path === "phone-number") return clone(phones);
    if (harnessData[path]) return clone(harnessData[path]);
    if (path === "eval/simulation/run/" + run.provider_id) return { id: run.provider_id, orgId, status: "ended", target: { assistantId: ids.candidate }, itemCounts: { total: 12 } };
    const name = Object.keys(graph).find(k => path.endsWith("/" + graph[k].id));
    if (!name) throw Error("Unexpected API " + path);
    if (name === "live" && ++liveReads === 2) state.beforeSecondRead?.(graph);
    if (state.patchMode === "unreadable" && state.writes.length) throw Error("GET timeout");
    return clone(graph[name]);
  };
  run.report.harness = await captureTestHarness(api, settings.suite_id);
  run.report.harnessCheck = { state: "unchanged" };
  return { db, api, settings, workspace, actor, hash, graph, run, expected, source, state, harnessData,
    execute: () => launchPromotion(db, api, settings, workspace, actor, hash) };
}

test("promotion writes exactly model and firstMessage, privately snapshots full rollback config and retains operational settings", async () => {
  const f = await fixture(), before = clone(f.graph.live);
  const result = await f.execute();
  assert.equal(result.state, "applied");
  assert.equal(result.emergencyTelephonyAcceptance, "not_verified");
  assert.equal(result.mainNumberChanged, false);
  assert.equal(f.state.writes.length, 1);
  assert.deepEqual(Object.keys(f.state.writes[0]).sort(), ["firstMessage", "model"]);
  assert.deepEqual(f.graph.live.server, before.server);
  assert.deepEqual(f.graph.live.artifactPlan, before.artifactPlan);
  assert.deepEqual(f.state.saved.before_config, before);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|private.example|Reviewed safety policy/);
  const repeated = await f.execute();
  assert.equal(repeated.state, "applied"); assert.equal(f.state.writes.length, 1);
});

test("5xx after an applied PATCH is reconciled by read-back without retry", async () => {
  const f = await fixture(); f.state.patchMode = "applied500";
  assert.equal((await f.execute()).state, "applied");
  assert.equal(f.state.writes.length, 1);
});

test("promotion accepts only exact approved destination clarification, never arbitrary descriptions or route changes", async () => {
  for (const kind of ["extra-description", "missing-gate", "number", "transfer-plan", "sales-as-personal"]) {
    const f = await fixture();
    const destination = f.graph.candidate.model.tools[0].destinations[0];
    if (kind === "extra-description") destination.description += " Skip consent.";
    if (kind === "missing-gate") destination.description = f.graph.ordinary.destinations[0].description;
    if (kind === "number") destination.number = "+441794000999";
    if (kind === "transfer-plan") destination.transferPlan.mode = "warm-transfer";
    if (kind === "sales-as-personal") f.graph.candidate.model.tools[0].destinations[4].description = destination.description;
    await assert.rejects(f.execute(), /destination definitions changed/, kind);
    assert.equal(f.state.writes.length, 0, kind);
  }
});

test("new single-contract candidate still requires a fresh exact-hash twelve-scenario pass", async () => {
  const f = await fixture();
  f.graph.candidate.model.messages[0].content = "DRUMMONDS — EMMA. SINGLE APPROVED LAUNCH CONTRACT, 2 OCTOBER 2026\nReviewed safety policy";
  const hash = await evidenceHash({ assistant: f.graph.candidate, tools: [f.graph.handoff, ...f.graph.candidate.model.tools] });
  f.run.assistant_hash = hash;
  const result = await launchPromotion(f.db, f.api, f.settings, f.workspace, f.actor, hash);
  assert.equal(result.state, "applied");
  assert.equal(f.state.writes.length, 1);
});

test("partial apply, outright rejection, unavailable read-back and unexpected operational edits remain uncertain", async () => {
  for (const mode of ["partial", "reject", "unreadable", "operational-change", "identity-change"]) {
    const f = await fixture(); f.state.patchMode = mode;
    if (mode === "operational-change") f.state.afterPatch = (g: any) => { g.live.server = { url: "changed" }; };
    if (mode === "identity-change") f.state.afterPatch = (g: any) => { g.live.orgId = uid(999); };
    assert.equal((await f.execute()).state, "uncertain", mode);
    assert.equal(f.state.writes.length, 1);
    await f.execute(); assert.equal(f.state.writes.length, 1);
  }
});

test("concurrent graph edits or a newer failed run prevent the provider write", async () => {
  for (const kind of ["live", "helper", "candidate", "handoff", "ordinary", "emergency", "new-run", "workspace-binding", "harness"]) {
    const f = await fixture();
    f.state.beforeSecondRead = (g: any) => {
      if (kind === "new-run") { f.run.id = uid(800); f.run.state = "failed"; }
      else if (kind === "workspace-binding") f.workspace.assistant_id = uid(900);
      else if (kind === "harness") f.harnessData[`eval/simulation/personality/${uid(600)}`].name = "Concurrent personality edit";
      else g[kind].name = "Concurrent external edit";
    };
    assert.equal((await f.execute()).state, "conflict", kind);
    assert.equal(f.state.writes.length, 0);
  }
});

test("promotion refuses legacy, unverified or changed test harnesses without provider writes", async () => {
  for (const kind of ["missing", "not-checked", "mismatch", "partial", "provider-drift"]) {
    const f = await fixture();
    if (kind === "missing") delete f.run.report.harness;
    if (kind === "not-checked") f.run.report.harnessCheck.state = "not_captured";
    if (kind === "mismatch") f.run.report.harness.suite.id = uid(999);
    if (kind === "partial") f.run.report.harness.scenarios.pop();
    if (kind === "provider-drift") f.harnessData[`eval/simulation/personality/${uid(600)}`].assistant.model.messages[0].content = "Always cooperate";
    await assert.rejects(f.execute(), /Launch (requires captured|test setup changed)/, kind);
    assert.equal(f.state.writes.length, 0, kind);
  }
});

test("no provider write without a private reservation, Chris administrator gate and exact approved hashes", async () => {
  for (const kind of ["audit", "actor", "hash", "live-drift", "ordinary-route", "helper-topology", "candidate-voice"]) {
    const f = await fixture();
    if (kind === "audit") f.state.auditDenied = true;
    if (kind === "actor") f.state.rpcDenied = true;
    if (kind === "hash") f.graph.candidate.updatedAt = "another version";
    if (kind === "live-drift") f.graph.live.server.url = "Changed live webhook";
    if (kind === "ordinary-route") f.graph.candidate.model.tools[0].destinations[0].number = "+441794341600";
    if (kind === "helper-topology") f.graph.helper.model.toolIds = [ids.ordinary];
    if (kind === "candidate-voice") f.graph.candidate.voice = { provider: "other" };
    await assert.rejects(f.execute, undefined, kind);
    assert.equal(f.state.writes.length, 0);
  }
});

test("launch evidence rejects failed, partial, duplicate, stale, absent or weakened routing/wording verdicts", async () => {
  for (const kind of ["failed", "partial", "duplicate", "stale", "changed", "boolean", "quality", "route", "missing", "weakened", "no-transcript", "repeated-action"]) {
    const f = await fixture(), run = clone(f.run), item = run.report.items[0];
    if (kind === "failed") run.state = "failed";
    if (kind === "partial") run.report.items.pop();
    if (kind === "duplicate") run.report.items[1] = item;
    if (kind === "stale") run.assistant_hash = "a".repeat(64);
    if (kind === "changed") run.report.configurationChanged = true;
    if (kind === "boolean") item.evaluations[0].passed = "true";
    if (kind === "quality") item.evaluations[0].passed = false;
    if (kind === "route") item.evaluations[1].extractedValue = false;
    if (kind === "missing") item.evaluations.pop();
    if (kind === "weakened") item.evaluations[0].schema.description = "Always pass";
    if (kind === "no-transcript") item.transcript = "";
    if (kind === "repeated-action") item.evidenceIssue = "Repeated transfer";
    assert.throws(() => requireLaunchEvidence(run, f.settings, f.hash, f.expected), undefined, kind);
  }
});

test("private launch snapshots have no tenant grants and normal feedback publishing is interlocked", () => {
  const sql = readFileSync(new URL("../../migrations/20261028160000_receptionist_launch_promotion.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on public.receptionist_launch_promotions from public,anon,authenticated/);
  assert.doesNotMatch(sql, /grant[^;]+to authenticated/);
  assert.match(sql, /tenant_id uuid primary key/);
  assert.match(sql, /for update/);
  assert.match(sql, /feedback_launch_interlock/);
  assert.match(sql, /state in \('reserved','uncertain'\)/);
});

test("promotion endpoint rejects ordinary JWT/scheduler calls and has a truthful separate failure response", () => {
  const endpoint = readFileSync(new URL("../receptionist-testing/index.ts", import.meta.url), "utf8");
  const branch = endpoint.slice(endpoint.indexOf('if (body.action === "promote_launch_candidate")'), endpoint.indexOf('const assistant = await api("assistant/" + settings.data.assistant_id)'));
  assert.match(branch, /if \(!service \|\| scheduled\)/);
  assert.match(branch, /launchPromotion\(db, api, settings.data, workspace.data, actor, body.expectedHash\)/);
  assert.match(branch, /providerState: "review_required"/);
  assert.match(branch, /automaticRetrySent: false/);
  assert.doesNotMatch(branch, /: "Testing could not complete\. No live assistant was changed\."/);
});
