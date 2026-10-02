import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectLaunchGraph } from "./receptionist-launch-inspection.ts";
import { launchPromotionIds as ids } from "./receptionist-launch-promotion.ts";
import { approvedOrdinaryDestination } from "./receptionist-launch-destinations.ts";

function fixture() {
  const orgId = "10000000-0000-0000-0000-000000000001", actor = "20000000-0000-0000-0000-000000000001";
  const voice = { provider: "11labs", voiceId: "Emma", apiKey: "VOICE_SECRET" };
  const ordinary = { id: ids.ordinary, orgId, type: "transferCall", function: { name: "Route-Call-to-Drummond-Team-20260929" }, destinations: [{ type: "number", number: "+441794378105", description: "Rob109", message: "", transferPlan: { mode: "blind-transfer" } }] };
  const emergency = { id: ids.emergency, orgId, type: "transferCall", function: { name: "Route-Emergency-to-Rob-or-Tony", description: "Try other person on failure." }, destinations: [{ type: "number", number: "+441794378105", description: "ROB EMERGENCY109", message: "Please hold.", transferPlan: { mode: "warm-transfer-experimental", sipVerb: "refer", fallbackPlan: { endCallEnabled: false, message: "Could not connect." }, transferAssistant: { model: { provider: "openai", model: "gpt-4.1", messages: [{ role: "system", content: "Require human acceptance. Voicemail cancels." }] } }, summaryPlan: { enabled: true, customLlmUrl: "https://private.example/secret" } } }] };
  const helper = { id: ids.helper, orgId, voice, model: { provider: "openai", model: "gpt-4.1", toolIds: [ids.emergency], tools: [], messages: [{ role: "system", content: "EMERGENCY CONTINUATION: primary then backup. No invented delivery." }] } };
  const live = { id: ids.live, orgId, name: "Emma", voice, firstMessage: "Hello", server: { url: "https://private.example", headers: { Authorization: "PRIVATE_SECRET" } } };
  const candidate = { id: ids.candidate, orgId, voice, model: { toolIds: [ids.handoff], tools: [{ destinations: ordinary.destinations.map(approvedOrdinaryDestination) }] } };
  const handoff = { id: ids.handoff, orgId, type: "handoff", function: { name: "Route-Emergency-to-Rob-or-Tony" }, destinations: [{ type: "assistant", assistantId: ids.helper, contextEngineeringPlan: { type: "all" } }] };
  const graph: any = { live, candidate, helper, handoff, ordinary, emergency };
  const source: any = { state: "prepared", candidate_id: ids.candidate, helper_id: ids.helper, handoff_id: ids.handoff, source_assistant: structuredClone(live), source_tools: structuredClone([ordinary, emergency]) };
  const state: any = { reads: [], denied: false, sourceError: false, rpcs: [] };
  const db = {
    rpc: async (name: string, args: any) => { state.rpcs.push({ name, args }); return { error: state.denied ? "denied" : null }; },
    from(table: string) {
      assert.equal(table, "receptionist_test_candidates");
      return { select(fields: string) {
        assert.equal(fields, "state,candidate_id,helper_id,handoff_id,source_assistant,source_tools");
        return { eq(key: string, value: string) {
          assert.equal(key, "tenant_id"); assert.equal(value, ids.tenant);
          return { single: async () => ({ data: structuredClone(source), error: state.sourceError ? "denied" : null }) };
        } };
      } };
    },
  };
  const api = async (path: string, method?: string, payload?: unknown) => {
    state.reads.push(path); assert.equal(method, "GET"); assert.equal(payload, undefined);
    const name = Object.keys(graph).find(k => path === `${["handoff", "ordinary", "emergency"].includes(k) ? "tool" : "assistant"}/${ids[k as keyof typeof ids]}`);
    assert.ok(name, "Only the six pinned endpoints may be requested");
    return structuredClone(graph[name]);
  };
  const settings = { tenant_id: ids.tenant, assistant_id: ids.candidate }, workspace = { assistant_id: ids.live };
  return { graph, source, state, settings, workspace, actor, inspect: () => inspectLaunchGraph(db, api, settings, workspace, actor), db, api };
}

test("inspection performs six pinned GETs and does not write or refresh the saved source", async () => {
  const f = fixture(), before = structuredClone(f.source);
  const result = await f.inspect();
  assert.equal(f.state.reads.length, 6);
  assert.deepEqual(f.state.rpcs, [{ name: "care_release_actor", args: { p_actor: f.actor } }]);
  assert.deepEqual(f.source, before);
  assert.equal(result.savedSource.unchanged, true);
  assert.equal(result.checks.candidateOrdinaryDestinationsMatchApprovedTransform, true);
  assert.equal(result.checks.helperOnlyUsesEmergencyTool, true);
  assert.equal(result.checks.handoffPreservesAllContext, true);
  for (const key of ["providerChanged", "savedBaselineChanged", "promotionAttempted", "callsPlaced"] as const)
    assert.equal(result[key], false);
  assert.equal(result.emergency.destinations[0].transferPlan?.fallbackPlan?.endCallEnabled, false);
  assert.equal(result.helper.model.provider, "openai");
  assert.deepEqual(result.helper.model.toolIds, [ids.emergency]);
  assert.match(result.hashes.emergency.configurationHash, /^[a-f0-9]{64}$/);
});

test("fresh provider differences expose precise source mismatches without accepting them", async () => {
  const f = fixture();
  f.source.source_tools[1].destinations[0].number = "+441794378096";
  f.source.source_tools[1].destinations[0].description = "ROB EMERGENCY104";
  const result = await f.inspect();
  const emergency = result.savedSource.comparisons.find(c => c.resource === "emergency")!;
  assert.equal(result.savedSource.unchanged, false);
  assert.equal(emergency.matchesSavedSource, false);
  assert.deepEqual(emergency.differingFields, ["destinations"]);
  assert.notEqual(emergency.sourceHash, emergency.currentHash);
  assert.equal(result.baselineEmergencyDestinations[0].number, "+441794378096");
  assert.equal(result.emergency.destinations[0].number, "+441794378105");
});

test("whitelist and text redaction exclude provider URLs, credentials and arbitrary nested fields", async () => {
  const f = fixture();
  f.graph.helper.model.messages[0].content += " PRIVATE_SECRET VOICE_SECRET https://signed.example/audio?token=INLINE_TOKEN www.hidden.example Bearer INLINE_BEARER sk-proj-PRIVATEKEY xoxb-PRIVATESLACK password=INLINE_PASSWORD PIN=6789 {\"password\":\"INLINE_JSON_PASSWORD\"}";
  f.graph.helper.model.apiKey = "MODEL_SECRET";
  f.graph.live.privateKey = "OPAQUE_PRIVATE_VALUE";
  f.graph.live.signing_key = "OPAQUE_SIGNING_VALUE";
  f.graph.helper.model.messages[0].content += " OPAQUE_PRIVATE_VALUE OPAQUE_SIGNING_VALUE -----BEGIN RSA PRIVATE KEY-----\nPEM_PRIVATE_VALUE\n-----END RSA PRIVATE KEY-----";
  f.graph.helper.model.messages.push({ role: "system", content: "MODEL_SECRET", secret: "NESTED_SECRET" });
  f.graph.emergency.destinations[0].transferPlan.transferAssistant.server = { url: "https://secret.example", headers: { Authorization: "OPERATOR_SECRET" } };
  f.graph.emergency.destinations[0].transferPlan.transferAssistant.model.messages[0].content += " OPERATOR_SECRET";
  f.graph.emergency.destinations[0].transferPlan.unlisted = "UNLISTED_SECRET";
  const result = await f.inspect(), text = JSON.stringify(result);
  for (const secret of ["OPAQUE_PRIVATE_VALUE", "OPAQUE_SIGNING_VALUE", "PEM_PRIVATE_VALUE", "PRIVATE_SECRET", "VOICE_SECRET", "INLINE_TOKEN", "INLINE_BEARER", "PRIVATEKEY", "PRIVATESLACK", "INLINE_PASSWORD", "INLINE_JSON_PASSWORD", "6789", "MODEL_SECRET", "NESTED_SECRET", "OPERATOR_SECRET", "UNLISTED_SECRET", "signed.example", "hidden.example", "secret.example", "private.example"])
    assert.equal(text.includes(secret), false, secret);
  assert.match(result.helper.model.messages[0].content!, /URL redacted/);
  assert.match(result.helper.model.messages[0].content!, /credential redacted/);
  assert.equal("server" in result.helper, false);
  assert.equal("apiKey" in result.helper.model, false);
  assert.equal("voice" in result.helper, false);
});

test("Chris authority, fixed bindings and valid source must pass before provider reads", async () => {
  for (const kind of ["denied", "source", "tenant", "workspace", "settings"] as const) {
    const f = fixture();
    if (kind === "denied") f.state.denied = true;
    if (kind === "source") f.state.sourceError = true;
    if (kind === "tenant") f.settings.tenant_id = "30000000-0000-0000-0000-000000000001";
    if (kind === "workspace") f.workspace.assistant_id = ids.candidate;
    if (kind === "settings") f.settings.assistant_id = ids.live;
    await assert.rejects(f.inspect());
    assert.deepEqual(f.state.reads, []);
  }
});

test("provider identity mismatch fails closed without exposing returned content", async () => {
  const f = fixture(); f.graph.helper.orgId = "30000000-0000-0000-0000-000000000001";
  await assert.rejects(f.inspect(), /provider identity/);
});

test("HTTP inspection action is explicit service-only, nonscheduled and wraps unsafe errors", () => {
  const source = readFileSync(new URL("../receptionist-testing/index.ts", import.meta.url), "utf8");
  const action = source.slice(source.indexOf('if (body.action === "inspect_launch_graph")'), source.indexOf('if (body.action === "promote_launch_candidate")'));
  assert.match(action, /if \(!service \|\| scheduled\)/);
  assert.match(action, /inspectLaunchGraph\(db, api, settings.data, workspace.data, actor\)/);
  assert.match(action, /catch \{/);
  assert.doesNotMatch(action, /error\.message|JSON\.stringify\(error|\.insert\(|\.update\(|PATCH|POST/);
});
