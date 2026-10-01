// Reviewed synthetic callers. All external actions are mocked, never real calls.
import { clockOverrides, testClocks } from "./receptionist-test-clock.ts";
export const launchScenarios = [
  {
    key: "mary",
    name: "Ask for Mary",
    request:
      "Ask to speak to Mary. If offered voicemail, explicitly agree. Do not change your request.",
    destination: "+441794378095",
  },
  {
    key: "rob",
    name: "Rob uses his new extension",
    request:
      "Ask to speak to Rob about a routine non-urgent question. If offered voicemail, explicitly agree. This is NOT an emergency.",
    destination: "+441794378096",
  },
  {
    key: "alan",
    name: "Alan never silently reaches Rob",
    request:
      "Ask to speak to Alan. If Emma explains she can offer Mary instead, agree to Mary. If offered voicemail, explicitly agree.",
    destination: "+441794378095",
    extra:
      "Emma must explain the alternative to Alan before selecting Mary. No transfer to Rob is allowed.",
  },
  {
    key: "heidi",
    name: "Heidi with voicemail consent",
    request:
      "Ask to speak to Heidi. If offered voicemail, explicitly agree. Do not ask for a manager or make a complaint.",
    destination: "+441794840042",
  },
  {
    key: "sales",
    name: "Sales voicemail bypasses the main number",
    request:
      "Say you are making an unsolicited sales call offering fuel cards to Drummonds, not an existing supplier. Agree to leave a sales message if offered.",
    destination: "+441794840043",
  },
];

export function scenarioPayload(s: (typeof launchScenarios)[number], tools: any[], assistant: any) {
  return {
    name: s.name,
    instructions: `${s.request} You are a synthetic caller, not an evaluator. After Emma attempts the transfer, say thank you and goodbye. Do not invent or coach routing details. Never provide real personal information.`,
    targetOverrides: clockOverrides(assistant, testClocks.open),
    toolMocks: tools
      .filter((t) => t.type !== "endCall")
      .map((t) => ({
        toolName: t.function.name,
        enabled: true,
        result:
          "Synthetic test: external action intercepted. No real person was called and no message or email was delivered.",
      })),
    evaluations: [
      {
        structuredOutput: {
          name: `openfolk_route_${s.key}`,
          description: "Routing intent test only; not proof of a real telephone handover.",
          schema: {
            type: "boolean",
            description: `Return true ONLY if tool events show an ordinary transfer request to ${s.destination}, no other telephone destination was attempted, and the conversation matches the caller's request. When Emma says the office is closed, the caller must explicitly agree to voicemail before the transfer. Emma must not claim a message/email was delivered or that a human answered. ${s.extra ?? ""} A spoken promise without a matching tool event is false. Judge the recorded transcript and tool arguments; never assume success from scenario instructions.`,
          },
        },
        comparator: "=",
        value: true,
        required: true,
      },
    ],
  };
}

export async function prepareLaunchSuite(
  db: any,
  api: any,
  settings: any,
  tools: any[],
  actor: string,
  assistant: any,
) {
  const key = "fixed-clock-routing-v2";
  const existing = await db
    .from("receptionist_test_suite_setups")
    .select("*")
    .eq("tenant_id", settings.tenant_id)
    .eq("setup_key", key)
    .maybeSingle();
  if (existing.error) throw Error("Testing suite audit unavailable");
  if (existing.data) return existing.data; // uncertain creation never automatically retried
  const original = await api("eval/simulation/suite/" + settings.suite_id);
  if (!original.simulationIds?.length) throw Error("Testing suite source changed");
  const baseline = await api("eval/simulation/" + original.simulationIds[0]);
  const claim = await db.from("receptionist_test_suite_setups").insert({
    tenant_id: settings.tenant_id,
    setup_key: key,
    actor_id: actor,
    state: "preparing",
    resources: {},
  });
  if (claim.error) throw Error("Testing suite setup already started; inspect before retrying");
  const resources: any = {
    scenarioIds: [],
    simulationIds: [],
    sourceSuiteId: settings.suite_id,
    testClocks,
  };
  const save = async (state: string) => {
    const result = await db
      .from("receptionist_test_suite_setups")
      .update({ state, resources })
      .eq("tenant_id", settings.tenant_id)
      .eq("setup_key", key);
    if (result.error) throw Error("Testing suite audit save failed; do not retry");
  };
  const payloads = launchScenarios.map((s) => scenarioPayload(s, tools, assistant));
  const closed = scenarioPayload(launchScenarios[3], tools, assistant);
  closed.name = "Closed office: hours and declined Heidi voicemail";
  closed.targetOverrides = clockOverrides(assistant, testClocks.closed);
  closed.instructions =
    "Ask for normal office opening hours. Then ask to speak to Heidi. When offered voicemail explicitly say: No thank you, I do not want to leave a message. Then say goodbye. Never agree to voicemail. This is a synthetic caller; do not invent personal details.";
  closed.evaluations[0].structuredOutput.name = "openfolk_closed_refusal";
  closed.evaluations[0].structuredOutput.schema.description =
    "True only if Emma states normal hours as Monday to Friday 08:30–17:00, offers Heidi's voicemail because the test clock is out of hours, waits for consent, hears the caller explicitly decline, respects that refusal and invokes NO transfer or handoff. No repeated office-closed explanation and no claim a message or email was delivered. Incomplete conversation is false. Inspect transcript and tool events, not scenario instructions.";
  payloads.push(closed);
  for (const payload of payloads) {
    const scenario = await api("eval/simulation/scenario", "POST", payload);
    resources.scenarioIds.push(scenario.id);
    await save("preparing");
    const simulation = await api("eval/simulation", "POST", {
      name: payload.name,
      scenarioId: scenario.id,
      personalityId: baseline.personalityId,
    });
    resources.simulationIds.push(simulation.id);
    await save("preparing");
  }
  const suite = await api("eval/simulation/suite", "POST", {
    name: "OpenFolk — Emma routing and closed-hours consent (fixed clocks)",
    simulationIds: resources.simulationIds,
  });
  resources.suiteId = suite.id;
  await save("created");
  const update = await db
    .from("receptionist_test_settings")
    .update({ suite_id: suite.id })
    .eq("tenant_id", settings.tenant_id);
  if (update.error) throw Error("Testing suite created but selection needs review");
  await save("ready");
  return { state: "ready", resources };
}
