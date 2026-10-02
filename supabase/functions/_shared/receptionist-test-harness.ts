import { evidenceHash } from "./receptionist-care.ts";
import { stableJson } from "./receptionist-release.ts";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type Api = (path: string) => Promise<any>;
type Stamp = { id: string; name: string; hash: string };
export type TestHarness = {
  version: 1;
  capturedAt: string;
  fingerprint: string;
  suite: Stamp;
  simulations: (Stamp & { scenarioId: string; personalityId: string })[];
  scenarios: Stamp[];
  personalities: Stamp[];
};
const label = (value: unknown) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, 160) : "Unnamed";
async function stamp(value: any, expectedId: string): Promise<Stamp> {
  if (!value || value.id !== expectedId || !UUID.test(expectedId))
    throw Error("Testing harness resource identity changed.");
  // Hash the full provider resource, but persist only these safe identity fields.
  // Authentication, model prompts and processor settings never enter the report.
  return { id: value.id, name: label(value.name), hash: await evidenceHash(stableJson(value)) };
}

export async function captureTestHarness(
  api: Api,
  suiteId: string,
  options: { suite?: any; onScenario?: (scenario: any) => void } = {},
): Promise<TestHarness> {
  if (!UUID.test(suiteId)) throw Error("Testing harness suite identity unavailable.");
  const suite = options.suite ?? await api("eval/simulation/suite/" + suiteId);
  const suiteStamp = await stamp(suite, suiteId);
  const ids = suite.simulationIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 12 ||
    new Set(ids).size !== ids.length || ids.some(id => !UUID.test(id)))
    throw Error("Testing harness needs one to twelve distinct simulations.");
  const simulations: TestHarness["simulations"] = [];
  const scenarios = new Map<string, Stamp>();
  const personalities = new Map<string, Stamp>();
  for (const id of ids) {
    const sim = await api("eval/simulation/" + id);
    const simulation = await stamp(sim, id);
    if (!UUID.test(sim.scenarioId ?? "") || !UUID.test(sim.personalityId ?? ""))
      throw Error("Testing harness scenario or personality identity unavailable.");
    simulations.push({ ...simulation, scenarioId: sim.scenarioId, personalityId: sim.personalityId });
    if (!scenarios.has(sim.scenarioId)) {
      const scenario = await api("eval/simulation/scenario/" + sim.scenarioId);
      const scenarioStamp = await stamp(scenario, sim.scenarioId);
      options.onScenario?.(scenario);
      scenarios.set(sim.scenarioId, scenarioStamp);
    }
    if (!personalities.has(sim.personalityId)) {
      const personality = await api("eval/simulation/personality/" + sim.personalityId);
      personalities.set(sim.personalityId, await stamp(personality, sim.personalityId));
    }
  }
  const compare = (a: Stamp, b: Stamp) => a.id.localeCompare(b.id);
  const manifest = {
    version: 1 as const,
    suite: suiteStamp,
    simulations: simulations.sort(compare),
    scenarios: [...scenarios.values()].sort(compare),
    personalities: [...personalities.values()].sort(compare),
  };
  return { ...manifest, capturedAt: new Date().toISOString(), fingerprint: await evidenceHash(stableJson(manifest)) };
}

export function compareTestHarness(saved: any, current: TestHarness | null, previous?: any) {
  const checkedAt = new Date().toISOString();
  if (!saved || saved.version !== 1 || !/^[a-f0-9]{64}$/.test(saved.fingerprint ?? ""))
    return { state: "not_captured", checkedAt,
      detail: "This run predates test-setup fingerprinting. Its caller personality and scenario configuration were not frozen in the saved evidence." };
  if (previous?.state === "changed" || (current && saved.fingerprint !== current.fingerprint))
    return { state: "changed", checkedAt,
      detail: "The test setup changed after preflight. These results cannot verify the original scenario and caller setup." };
  if (!current)
    return { state: "unavailable", checkedAt,
      detail: "The saved setup exists, but its current provider configuration could not be verified. Review before relying on this run." };
  return { state: "unchanged", checkedAt,
    detail: "Suite, scenarios, simulations and caller personality match the saved preflight fingerprints. This does not make AI conversations deterministic." };
}

// Vapi places the AI tester configuration inside personality.assistant.
// Return only useful reviewed fields; never copy server credentials or tools.
export function inspectTestPersonality(personality: any) {
  const a = personality?.assistant ?? {};
  const m = a.model ?? {};
  return {
    id: personality?.id,
    name: label(personality?.name),
    model: { provider: m.provider, model: m.model, temperature: m.temperature,
      messages: Array.isArray(m.messages) ? m.messages.map((message: any) => ({
        role: message.role,
        content: typeof message.content === "string" ? message.content.slice(0, 16000) : undefined,
      })) : [] },
    voice: { provider: a.voice?.provider, voiceId: a.voice?.voiceId },
    transcriber: { provider: a.transcriber?.provider, model: a.transcriber?.model, language: a.transcriber?.language },
    firstMessageMode: a.firstMessageMode,
    maxDurationSeconds: a.maxDurationSeconds,
    timing: { startSpeakingPlan: a.startSpeakingPlan ? {
      waitSeconds: a.startSpeakingPlan.waitSeconds,
      smartEndpointingEnabled: a.startSpeakingPlan.smartEndpointingEnabled,
    } : undefined, stopSpeakingPlan: a.stopSpeakingPlan ? {
      numWords: a.stopSpeakingPlan.numWords, voiceSeconds: a.stopSpeakingPlan.voiceSeconds,
      backoffSeconds: a.stopSpeakingPlan.backoffSeconds,
    } : undefined },
  };
}
