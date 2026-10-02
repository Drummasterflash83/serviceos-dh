// Read-only, fixed-DH diagnostic. Full provider/source payloads never leave this
// function. Inspection neither updates the saved baseline nor permits promotion.
import { launchPromotionIds as ids } from "./receptionist-launch-promotion.ts";
import { releaseConfiguration, releaseHash, stableJson } from "./receptionist-release.ts";
import { approvedOrdinaryDestination } from "./receptionist-launch-destinations.ts";
import { list, UUID } from "./receptionist-testing.ts";

type Api = (path: string, method?: string, payload?: unknown) => Promise<any>;
const names = ["live", "candidate", "helper", "handoff", "ordinary", "emergency"] as const;
const same = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const secretKey = /secret|password|authorization|api.?key|private.?key|signing.?key|token|headers|credential|pin$/i;

function redactor(resources: unknown[]) {
  const secrets = new Set<string>();
  function collect(value: unknown, sensitive = false) {
    if (typeof value === "string" && sensitive && value) secrets.add(value);
    else if (Array.isArray(value)) value.forEach(v => collect(v, sensitive));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, child]) => collect(child, sensitive || secretKey.test(key)));
  }
  resources.forEach(r => collect(r));
  const values = [...secrets].sort((a, b) => b.length - a.length);
  return (value: unknown, max = 64000): string | null => {
    if (typeof value !== "string") return null;
    let text = value;
    for (const secret of values) text = text.split(secret).join("[credential redacted]");
    return text
      .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, "[credential redacted]")
      .replace(/\b(?:https?|wss?|ftp|sips?):(?:\/\/)?[^\s<>"']+/gi, "[URL redacted]")
      .replace(/\bwww\.[^\s<>"']+/gi, "[URL redacted]")
      .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[credential redacted]")
      .replace(/\b(?:sk-(?:proj-|svcacct-)?|xox[baprs]-)[A-Za-z0-9_-]+/g, "[credential redacted]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[credential redacted]")
      .replace(/\b(?:(?:api|private|signing)[_ -]?key|access[_ -]?token|password|secret|authorization|pin)["']?\s*[:=]\s*["']?[^\s,;"']+/gi, "[credential assignment redacted]")
      .slice(0, max);
  };
}

const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown) => typeof v === "boolean" ? v : null;
const uuid = (v: unknown) => typeof v === "string" && UUID.test(v) ? v : null;
type Clean = ReturnType<typeof redactor>;
function messages(value: unknown, clean: Clean) {
  return list(value).map(m => ({
    role: ["system", "user", "assistant"].includes(m.role) ? m.role : "other",
    content: clean(m.content),
    contentTruncated: typeof m.content === "string" && m.content.length > 64000,
  }));
}
function model(value: any, clean: Clean) {
  return {
    provider: clean(value?.provider, 100), model: clean(value?.model, 200),
    temperature: number(value?.temperature), toolIds: list(value?.toolIds).map(uuid).filter(Boolean),
    inlineToolCount: list(value?.tools).length, messages: messages(value?.messages, clean),
  };
}
function assistant(value: any, clean: Clean) {
  return {
    firstMessage: clean(value?.firstMessage), firstMessageMode: clean(value?.firstMessageMode, 100),
    maxDurationSeconds: number(value?.maxDurationSeconds), silenceTimeoutSeconds: number(value?.silenceTimeoutSeconds),
    model: model(value?.model, clean),
  };
}
function destination(value: any, clean: Clean) {
  const plan = value?.transferPlan;
  return {
    type: clean(value?.type, 100),
    number: typeof value?.number === "string" && /^\+[1-9]\d{7,14}$/.test(value.number) ? value.number : null,
    assistantId: uuid(value?.assistantId), description: clean(value?.description), message: clean(value?.message),
    contextEngineeringType: clean(value?.contextEngineeringPlan?.type, 100),
    transferPlan: !plan || typeof plan !== "object" ? null : {
      mode: clean(plan.mode, 100), sipVerb: clean(plan.sipVerb, 100), message: clean(plan.message),
      timeoutSeconds: number(plan.timeoutSeconds),
      fallbackPlan: plan.fallbackPlan ? {
        endCallEnabled: bool(plan.fallbackPlan.endCallEnabled), message: clean(plan.fallbackPlan.message),
      } : null,
      summaryPlan: plan.summaryPlan ? {
        enabled: bool(plan.summaryPlan.enabled), timeoutSeconds: number(plan.summaryPlan.timeoutSeconds),
        useAssistantLlm: bool(plan.summaryPlan.useAssistantLlm), messages: messages(plan.summaryPlan.messages, clean),
      } : null,
      transferAssistant: plan.transferAssistant ? assistant(plan.transferAssistant, clean) : null,
    },
  };
}
function tool(value: any, clean: Clean) {
  return {
    id: uuid(value?.id), type: clean(value?.type, 100),
    function: { name: clean(value?.function?.name, 200), description: clean(value?.function?.description) },
    destinations: list(value?.destinations).map(d => destination(d, clean)),
  };
}

export async function inspectLaunchGraph(db: any, api: Api, settings: any, workspace: any, actor: string) {
  if (settings?.tenant_id !== ids.tenant || settings?.assistant_id !== ids.candidate ||
    workspace?.assistant_id !== ids.live || !UUID.test(actor))
    throw Error("Launch inspection target is not approved.");
  // Includes the exact Chris email check, current admin authority and preview
  // exclusion. The HTTP action additionally requires a validated service JWT.
  const gate = await db.rpc("care_release_actor", { p_actor: actor });
  if (gate.error) throw Error("Launch inspection requires the authorised OpenFolk administrator.");
  const saved = await db.from("receptionist_test_candidates")
    .select("state,candidate_id,helper_id,handoff_id,source_assistant,source_tools")
    .eq("tenant_id", ids.tenant).single();
  if (saved.error || saved.data?.source_assistant?.id !== ids.live ||
    saved.data?.candidate_id !== ids.candidate || saved.data?.helper_id !== ids.helper || saved.data?.handoff_id !== ids.handoff)
    throw Error("Launch inspection baseline is unavailable or has a different identity.");
  const startedAt = new Date().toISOString();
  // Explicit GET and fixed paths only: the caller supplies no resource or URL.
  const resources = await Promise.all(names.map(name => api(
    `${["handoff", "ordinary", "emergency"].includes(name) ? "tool" : "assistant"}/${ids[name]}`, "GET",
  )));
  const graph: any = Object.fromEntries(names.map((name, i) => [name, resources[i]]));
  if (!UUID.test(graph.live?.orgId ?? "") || names.some(name =>
    graph[name]?.id !== ids[name] || graph[name]?.orgId !== graph.live.orgId) ||
    saved.data.source_assistant.orgId !== graph.live.orgId)
    throw Error("Launch inspection provider identity does not match the reviewed account.");
  const source = saved.data;
  const baseline: any = {
    live: source.source_assistant,
    ordinary: list(source.source_tools).find(t => t.id === ids.ordinary),
    emergency: list(source.source_tools).find(t => t.id === ids.emergency),
  };
  if (!baseline.ordinary || !baseline.emergency)
    throw Error("Launch inspection shared-tool baseline is incomplete.");
  const clean = redactor([...resources, source]);
  const hashes = Object.fromEntries(await Promise.all(names.map(async name => [name, {
    id: ids[name], name: clean(graph[name].name, 200), configurationHash: await releaseHash(graph[name]),
    updatedAt: typeof graph[name].updatedAt === "string" && Number.isFinite(Date.parse(graph[name].updatedAt))
      ? new Date(graph[name].updatedAt).toISOString() : null,
  }])));
  const comparisons = await Promise.all((["live", "ordinary", "emergency"] as const).map(async name => {
    const before = releaseConfiguration(baseline[name]), current = releaseConfiguration(graph[name]);
    return {
      resource: name, sourceHash: await releaseHash(baseline[name]), currentHash: hashes[name].configurationHash,
      matchesSavedSource: same(before, current),
      differingFields: Object.keys({ ...before, ...current }).filter(key => !same(before[key], current[key]))
        .map(key => /^[a-zA-Z][a-zA-Z0-9]{0,63}$/.test(key) ? key : "other configuration"),
    };
  }));
  let ordinaryCandidateMatches = false;
  try {
    ordinaryCandidateMatches = same(graph.candidate.model?.tools?.[0]?.destinations,
      graph.ordinary.destinations?.map(approvedOrdinaryDestination));
  } catch { /* An unsupported shared destination is evidence to review, not a bypass. */ }
  return {
    readOnly: true, tenantId: ids.tenant, startedAt, completedAt: new Date().toISOString(),
    evidence: "Fresh provider GETs; sequentially observed configuration, not an atomic snapshot or call test.",
    projection: "Whitelisted fields; URLs and credentials redacted; unlisted fields are not shown. Hashes cover the full release configuration.",
    hashes, savedSource: { state: clean(source.state, 100), comparisons, unchanged: comparisons.every(c => c.matchesSavedSource) },
    checks: {
      candidateOrdinaryDestinationsMatchApprovedTransform: ordinaryCandidateMatches,
      helperOnlyUsesEmergencyTool: same(graph.helper.model?.toolIds, [ids.emergency]) && list(graph.helper.model?.tools).length === 0,
      handoffPreservesAllContext: graph.handoff.destinations?.length === 1 &&
        graph.handoff.destinations[0].assistantId === ids.helper && graph.handoff.destinations[0].contextEngineeringPlan?.type === "all",
      candidateVoiceMatchesLive: same(graph.candidate.voice, graph.live.voice),
      helperVoiceMatchesLive: same(graph.helper.voice, graph.live.voice),
    },
    helper: { id: ids.helper, ...assistant(graph.helper, clean) },
    handoff: tool(graph.handoff, clean), ordinary: tool(graph.ordinary, clean), emergency: tool(graph.emergency, clean),
    baselineEmergencyDestinations: list(baseline.emergency.destinations).map(d => ({ number: destination(d, clean).number, description: clean(d.description) })),
    providerChanged: false, savedBaselineChanged: false, promotionAttempted: false, callsPlaced: false,
  };
}
