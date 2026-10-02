// One-off DH behaviour promotion. The authenticated service boundary must call
// this explicitly; it never runs automatically when a simulation passes.
// No calls are placed and no phone number, shared tool, helper or PBX route is
// modified. Full snapshots stay in a service-role-only table, NEVER in the
// operator-facing phone_operations_audit table.
import { evidenceHash } from "./receptionist-care.ts";
import { releaseConfiguration, releaseHash, stableJson } from "./receptionist-release.ts";
import { launchScenarioPayloads } from "./receptionist-launch-scenarios.ts";
import { approvedOrdinaryDestination } from "./receptionist-launch-destinations.ts";
import { captureTestHarness } from "./receptionist-test-harness.ts";
import { list, UUID } from "./receptionist-testing.ts";

export const launchPromotionIds = Object.freeze({
  tenant: "00000000-0000-0000-0000-000000000001",
  live: "4eb2bee8-ac25-47c9-b962-409ed250ceb6",
  candidate: "dcfc2e66-a438-43ab-b863-467f5a5089df",
  handoff: "94864962-b4c2-4364-ad82-6939cb9d4cb6",
  helper: "41bd1fd0-3ebf-4f43-9ded-512cb9305455",
  ordinary: "89c45170-c66f-4688-a349-4a354892ba57",
  emergency: "ac550bea-6e64-4614-8dcf-a0a32856694e",
});
const ids = launchPromotionIds;
const table = "receptionist_launch_promotions";
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
type Api = (path: string, method?: string, payload?: unknown) => Promise<any>;

function validateGraph(g: any, source: any) {
  for (const key of ["live", "candidate", "handoff", "helper", "ordinary", "emergency"] as const)
    if (g[key]?.id !== ids[key] || g[key]?.orgId !== g.live.orgId || !UUID.test(g.live.orgId ?? ""))
      throw Error("Launch provider identity changed; nothing published.");
  if (source?.source_assistant?.id !== ids.live || source?.source_assistant?.orgId !== g.live.orgId ||
    source?.candidate_id !== ids.candidate || source?.helper_id !== ids.helper ||
    source?.handoff_id !== ids.handoff || source?.state !== "prepared")
    throw Error("Launch candidate audit does not match the reviewed graph.");
  const c = g.candidate;
  if (c.model?.provider !== "openai" || typeof c.firstMessage !== "string" || !c.firstMessage.includes("openfolk_holidays") ||
    !c.model.messages?.some((m: any) => m.content?.startsWith("CONSOLIDATED HANDOVER CONTRACT") ||
      m.content?.startsWith("DRUMMONDS — EMMA. SINGLE APPROVED LAUNCH CONTRACT, 2 OCTOBER 2026")) ||
    !same(c.model.toolIds, [ids.handoff]) || c.model.tools?.length !== 1 ||
    c.model.tools[0]?.type !== "transferCall" ||
    c.model.tools[0]?.function?.name !== "Route-Call-to-Drummond-Team-20260929" ||
    c.model.tools[0]?.destinations?.length !== 10 ||
    !c.model.tools[0].destinations.every((d: any) => d.message === "" && d.number !== "+441794341600"))
    throw Error("Launch root routing or holiday contract changed.");
  const recordedOrdinary = list(source.source_tools).find(t => t.id === ids.ordinary);
  const recordedEmergency = list(source.source_tools).find(t => t.id === ids.emergency);
  if (!recordedOrdinary || !recordedEmergency ||
    !same(releaseConfiguration(g.ordinary), releaseConfiguration(recordedOrdinary)) ||
    !same(releaseConfiguration(g.emergency), releaseConfiguration(recordedEmergency)) ||
    !same(c.model.tools[0].function, g.ordinary.function) ||
    !same(c.model.tools[0].destinations, g.ordinary.destinations?.map(approvedOrdinaryDestination)))
    throw Error("Launch destination definitions changed; review the shared tools first.");
  const required = ["+441794378095", "+441794378105", "+441794378096", "+441794840042", "+441794840043"];
  if (!required.every(n => c.model.tools[0].destinations.some((d: any) => d.number === n)))
    throw Error("Launch reviewed ordinary destination is missing.");
  if (g.handoff.type !== "handoff" || g.handoff.function?.name !== "Route-Emergency-to-Rob-or-Tony" ||
    g.handoff.destinations?.length !== 1 || g.handoff.destinations[0].type !== "assistant" ||
    g.handoff.destinations[0].assistantId !== ids.helper ||
    g.handoff.destinations[0].contextEngineeringPlan?.type !== "all" ||
    !same(g.helper.model?.toolIds, [ids.emergency]) || list(g.helper.model?.tools).length ||
    g.emergency.type !== "transferCall" || g.emergency.function?.name !== "Route-Emergency-to-Rob-or-Tony" ||
    !g.helper.model?.messages?.some((m: any) => m.content?.startsWith("EMERGENCY CONTINUATION:")))
    throw Error("Launch emergency continuation graph changed.");
  for (const assistant of [c, g.helper])
    if (!same(assistant.voice, g.live.voice) || !same(assistant.transcriber, g.live.transcriber))
      throw Error("Launch voice or transcription differs from the existing live service.");
}

async function readGraph(api: Api) {
  const names = ["live", "candidate", "handoff", "helper", "ordinary", "emergency"] as const;
  const resources = await Promise.all(names.map(k => api(`${["handoff", "ordinary", "emergency"].includes(k) ? "tool" : "assistant"}/${ids[k]}`)));
  const g: any = Object.fromEntries(names.map((k, i) => [k, resources[i]]));
  const phones = await api("phone-number");
  if (!Array.isArray(phones)) throw Error("Launch phone binding inventory unavailable.");
  g.phoneBindings = phones.filter(p => [ids.live, ids.candidate, ids.helper].includes(p.assistantId)).map(p => ({
    id: p.id, number: p.number, assistantId: p.assistantId, provider: p.provider,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return g;
}

async function graphHash(g: any) {
  return evidenceHash(stableJson({
    ...Object.fromEntries(["live", "candidate", "handoff", "helper", "ordinary", "emergency"].map(k => [k, {
      id: g[k].id, orgId: g[k].orgId, configuration: releaseConfiguration(g[k]),
    }])),
    phoneBindings: g.phoneBindings,
  }));
}

export function requireLaunchEvidence(run: any, settings: any, candidateHash: string, expected: any[]) {
  if (!run || !UUID.test(run.id ?? "") || !UUID.test(run.provider_id ?? "") ||
    run.tenant_id !== ids.tenant || run.assistant_id !== ids.candidate || run.suite_id !== settings.suite_id ||
    run.assistant_hash !== candidateHash || run.state !== "passed" || run.report?.configurationChanged !== false)
    throw Error("Latest launch run must fully pass against this exact candidate and suite.");
  const harness = run.report?.harness;
  if (harness?.version !== 1 || harness.suite?.id !== settings.suite_id ||
    !/^[a-f0-9]{64}$/.test(harness.fingerprint ?? "") ||
    !Number.isFinite(Date.parse(harness.capturedAt ?? "")) ||
    run.report?.harnessCheck?.state !== "unchanged" ||
    list(harness.simulations).length !== 12 || list(harness.scenarios).length !== 12)
    throw Error("Launch requires captured, unchanged test-setup evidence; historical runs cannot be backfilled.");
  const items = list(run.report?.items);
  if (expected.length !== 12 || items.length !== 12 || new Set(items.map(i => i.name)).size !== 12 ||
    new Set(items.map(i => i.callId)).size !== 12)
    throw Error("Launch needs all twelve distinct reviewed scenarios, not a partial run.");
  for (const scenario of expected) {
    const item = items.find(i => i.name === scenario.name);
    const criteria = list(item?.evaluations);
    if (!item || item.status !== "passed" || item.passed !== true || item.outcome !== "passed" ||
      item.evidenceIssue || item.failure || !UUID.test(item.callId ?? "") || !item.transcript?.trim() ||
      criteria.length !== 2 || scenario.evaluations.some((rule: any) => {
        const actual = criteria.find(e => e.name === rule.structuredOutput.name);
        return !actual || actual.passed !== true || actual.required !== true || actual.comparator !== "=" ||
          actual.expectedValue !== true || actual.extractedValue !== true ||
          !same(actual.schema, rule.structuredOutput.schema);
      }))
      throw Error("Every launch scenario needs independent passing routing and wording evidence.");
  }
}

const receipt = (row: any, retried = false) => ({
  state: row.state, liveAssistantId: ids.live, candidateId: ids.candidate,
  runId: row.run_id, candidateHash: row.candidate_hash, providerVersion: row.provider_version ?? null,
  mainNumberChanged: false, sharedToolsChanged: false, retried,
  emergencyTelephonyAcceptance: "not_verified", mailboxDelivery: "not_verified",
  limitation: "Root-assistant simulations intercept the handoff. This is behaviour publication, not main-line launch or proof of emergency cross-cover, voicemail or email delivery.",
});

export async function launchPromotion(db: any, api: Api, settings: any, workspace: any, actor: string, expectedHash: string) {
  if (settings?.tenant_id !== ids.tenant || settings?.assistant_id !== ids.candidate || !UUID.test(settings?.suite_id ?? "") ||
    workspace?.assistant_id !== ids.live || !UUID.test(actor) || !/^[a-f0-9]{64}$/.test(expectedHash))
    throw Error("Launch promotion target or operator is not approved.");
  const gate = await db.rpc("care_release_actor", { p_actor: actor });
  if (gate.error) throw Error("OpenFolk launch administrator required.");
  // One fixed reservation per DH launch. Any previous attempt, including an
  // ambiguous one, returns its receipt. A second call never repeats the PATCH.
  const previous = await db.from(table).select("state,run_id,candidate_hash,provider_version").eq("tenant_id", ids.tenant).maybeSingle();
  if (previous.error) throw Error("Private launch audit unavailable; nothing published.");
  if (previous.data) return receipt(previous.data, false);
  const source = await db.from("receptionist_test_candidates").select("*").eq("tenant_id", ids.tenant).single();
  if (source.error) throw Error("Launch candidate snapshot unavailable.");
  const latest = await db.from("receptionist_test_runs").select("*").eq("tenant_id", ids.tenant).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) throw Error("Latest launch evidence unavailable.");
  const g = await readGraph(api);
  validateGraph(g, source.data);
  const tools = [g.handoff, ...g.candidate.model.tools];
  const candidateHash = await evidenceHash({ assistant: g.candidate, tools });
  if (candidateHash !== expectedHash) throw Error("Launch candidate changed since approval.");
  if (await releaseHash(g.live) !== await releaseHash(source.data.source_assistant))
    throw Error("Live Emma changed since the candidate was created; review before publication.");
  const scenarios = launchScenarioPayloads(tools, g.candidate);
  requireLaunchEvidence(latest.data, settings, candidateHash, scenarios);
  const harness = await captureTestHarness(api, settings.suite_id);
  if (harness.fingerprint !== latest.data.report.harness.fingerprint)
    throw Error("Launch test setup changed since the passing run.");
  const providerRun = await api("eval/simulation/run/" + latest.data.provider_id);
  if (providerRun.id !== latest.data.provider_id || providerRun.status !== "ended" ||
    providerRun.orgId !== g.live.orgId || providerRun.target?.assistantId !== ids.candidate ||
    providerRun.itemCounts?.total !== 12)
    throw Error("Launch provider completion evidence does not match the saved run.");
  const beforeHash = await releaseHash(g.live);
  const patch = { model: g.candidate.model, firstMessage: g.candidate.firstMessage };
  const target = { ...g.live, ...patch };
  const targetHash = await releaseHash(target);
  const stableGraphHash = await graphHash(g);
  const reserved = await db.from(table).insert({
    tenant_id: ids.tenant, actor_id: actor, state: "reserved", run_id: latest.data.id,
    candidate_hash: candidateHash, source_hash: beforeHash, target_hash: targetHash, graph_hash: stableGraphHash,
    before_config: g.live, target_config: target, provider_graph: g, run_evidence: latest.data.report,
  });
  if (reserved.error) throw Error("Launch already reserved or another release is active; no provider write sent.");
  const finish = async (state: string, version: unknown = null) => {
    const result = await db.from(table).update({ state, provider_version: typeof version === "string" ? version : null, finished_at: new Date().toISOString() }).eq("tenant_id", ids.tenant);
    if (result.error) throw Error("Launch outcome needs audit reconciliation. Never resend the provider change.");
    return receipt({ state, run_id: latest.data.id, candidate_hash: candidateHash, provider_version: version });
  };
  // Recheck the ENTIRE graph immediately before mutation, plus latest run and
  // selected suite, so another edit/new failing run cannot silently be ignored.
  try {
    const current = await readGraph(api);
    const newest = await db.from("receptionist_test_runs").select("*").eq("tenant_id", ids.tenant).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const selected = await db.from("receptionist_test_settings").select("*").eq("tenant_id", ids.tenant).single();
    const bound = await db.from("receptionist_workspaces").select("assistant_id").eq("tenant_id", ids.tenant).single();
    if (newest.error || selected.error || bound.error || bound.data?.assistant_id !== ids.live || newest.data?.id !== latest.data.id ||
      selected.data?.suite_id !== settings.suite_id || selected.data?.assistant_id !== ids.candidate ||
      await graphHash(current) !== stableGraphHash) return await finish("conflict");
    requireLaunchEvidence(newest.data, selected.data, candidateHash, scenarios);
    const freshHarness = await captureTestHarness(api, selected.data.suite_id);
    if (freshHarness.fingerprint !== newest.data.report.harness.fingerprint)
      return await finish("conflict");
  } catch { return await finish("conflict"); }
  // Vapi does not expose atomic compare-and-swap. An external edit in the
  // final GET-to-PATCH gap cannot be prevented here; read-back detects drift,
  // and a mismatch stays uncertain instead of triggering a second write.
  try { await api("assistant/" + ids.live, "PATCH", patch); }
  catch { /* A 5xx/timeout may follow an applied PATCH. GET, never repeat. */ }
  try {
    const after = await readGraph(api);
    // Full hash comparison also protects all non-promoted operational settings
    // and phone bindings, while ignoring only provider metadata/version labels.
    if (await graphHash(after) === await graphHash({ ...g, live: target }))
      return await finish("applied", after.live.updatedAt);
  } catch { /* Unavailable read-back remains uncertain and permanently locked. */ }
  return await finish("uncertain");
}
