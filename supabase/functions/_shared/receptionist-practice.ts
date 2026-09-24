import { record } from "./receptionist-data.ts";

export const PRACTICE_SECONDS = 180;
export function practiceAssistant(source: unknown, queryToolIds: string[]) {
  const a = record(source),
    model = record(a.model),
    voice = record(a.voice);
  if (
    typeof model.provider !== "string" ||
    typeof model.model !== "string" ||
    !Array.isArray(model.messages) ||
    typeof voice.provider !== "string" ||
    !voice.voiceId ||
    voice.provider === "tavus"
  )
    throw Error("Assistant configuration needs review");
  // Strict allowlists. Never copy provider servers, credentials, hooks, workflows,
  // transfer destinations, fallback destinations or arbitrary tools into practice.
  const pick = (r: Record<string, unknown>, keys: string[]) =>
    Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
  const rules = model.messages
    .filter((m) => record(m).role === "system")
    .map((m) => record(m).content)
    .filter((x) => typeof x === "string")
    .join("\n\n");
  if (!rules) throw Error("Published instructions unavailable");
  if (
    model.knowledgeBase ||
    (Array.isArray(model.tools) && model.tools.some((t) => record(t).type === "query"))
  )
    throw Error("Inline knowledge needs an explicit practice adapter");
  return {
    name: "OpenFolk private practice",
    model: {
      ...pick(model, ["temperature", "maxTokens"]),
      provider: model.provider,
      model: model.model,
      toolIds: queryToolIds,
      messages: [
        {
          role: "system",
          content:
            rules +
            "\n\nPRACTICE MODE: This is an internal rehearsal, never a real customer call. No calls can be transferred, appointments booked, messages sent or records changed. When a route is identified, explain who you would connect the caller to and why. Never claim a transfer occurred. Knowledge lookup is read-only. Apply the approved conversation rules above otherwise.",
        },
      ],
    },
    voice: pick(voice, [
      "provider",
      "voiceId",
      "model",
      "stability",
      "similarityBoost",
      "style",
      "useSpeakerBoost",
      "speed",
    ]),
    ...(record(a.transcriber).provider
      ? { transcriber: pick(record(a.transcriber), ["provider", "model", "language"]) }
      : {}),
    firstMessage: typeof a.firstMessage === "string" ? a.firstMessage : undefined,
    firstMessageMode: "assistant-speaks-first",
    startSpeakingPlan: pick(record(a.startSpeakingPlan), [
      "waitSeconds",
      "smartEndpointingEnabled",
    ]),
    stopSpeakingPlan: pick(record(a.stopSpeakingPlan), [
      "numWords",
      "voiceSeconds",
      "backoffSeconds",
    ]),
    maxDurationSeconds: PRACTICE_SECONDS,
    silenceTimeoutSeconds: 30,
    clientMessages: ["transcript", "status-update"],
    serverMessages: [],
    artifactPlan: { recordingEnabled: true },
    analysisPlan: { summaryPlan: { enabled: true }, successEvaluationPlan: { enabled: false } },
  };
}

export function assistantOverview(source: unknown, queryToolCount: number, otherToolCount: number) {
  const a = record(source),
    model = record(a.model);
  const prompt = Array.isArray(model.messages)
    ? model.messages
        .filter((m) => record(m).role === "system")
        .map((m) => record(m).content)
        .filter((x) => typeof x === "string")
        .join("\n\n")
    : "";
  // Source text, not generated claims. Publish only approved behavioural sections,
  // never the whole provider payload or keys/configuration objects.
  const sections = prompt
    .split(/\n(?=#{1,4}\s)/)
    .map((text) => {
      const [heading, ...body] = text.split("\n");
      return { title: heading.replace(/^#+\s*/, ""), text: body.join("\n").trim() };
    })
    .filter(
      (s) =>
        /^(role|identity|voice|tone|first message|priority|daytime|office hours|direct person|scheduling|operations|finance|suppliers|service plans|new commercial|complaints|sales|out.of.hours|safety|knowledge|boundaries|pronunciation)/i.test(
          s.title,
        ) && s.text,
    );
  return {
    updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : null,
    name: typeof a.name === "string" ? a.name : "Your receptionist",
    voiceProvider: record(a.voice).provider ?? null,
    firstMessage: typeof a.firstMessage === "string" ? a.firstMessage : null,
    sections: sections.slice(0, 30),
    queryToolCount,
    otherToolCount,
  };
}
export function allowedQueryTools(tools: unknown[]) {
  return tools
    .filter((t) => record(t).type === "query" && !record(t).server && !record(t).serverUrl)
    .map((t) => record(t).id)
    .filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id));
}
export function practiceRoom(value: unknown) {
  if (typeof value !== "string") throw Error("Practice connection unavailable");
  const u = new URL(value);
  if (u.protocol !== "https:" || !u.hostname.endsWith(".daily.co") || u.username || u.password)
    throw Error("Unexpected practice connection");
  return u.href;
}
