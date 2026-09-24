import { record } from "./receptionist-data.ts";

export const PRACTICE_SECONDS = 180;

// Vapi supports file-backed query tools inline as well as by saved tool ID.
// Rebuild only the read-only file lookup configuration. Never forward an entire
// source tool, callbacks, credentials, hooks or function/action implementations.
export function practiceKnowledgeTools(modelValue: unknown) {
  const model = record(modelValue);
  if (model.knowledgeBaseId) throw Error("Custom knowledge requires review");
  const legacy = record(model.knowledgeBase);
  if (
    model.knowledgeBase &&
    (legacy.provider !== "google" ||
      legacy.server ||
      legacy.serverUrl ||
      legacy.credentialsId ||
      legacy.credentialId)
  )
    throw Error("Custom knowledge requires review");
  if (model.tools != null && !Array.isArray(model.tools))
    throw Error("Invalid inline knowledge configuration");
  const tools = (Array.isArray(model.tools) ? model.tools : []).filter(
    (t) => record(t).type === "query",
  );
  // Older Vapi assistants store Google file retrieval directly on the model.
  // Re-express the exact file set as a current read-only query tool; no re-upload,
  // alternate document set, custom server or mutation of the saved assistant.
  if (model.knowledgeBase)
    tools.push({
      type: "query",
      function: {
        name: "openfolk_practice_knowledge",
        description:
          "Retrieve Emma's existing approved company knowledge for this practice conversation.",
      },
      knowledgeBases: [
        {
          provider: "google",
          name: "Emma published knowledge",
          description: "The same knowledge files attached to the published receptionist.",
          fileIds: legacy.fileIds,
          ...(legacy.model !== undefined ? { model: legacy.model } : {}),
        },
      ],
    });
  return tools.map((raw) => {
    const tool = record(raw);
    if (
      tool.server ||
      tool.serverUrl ||
      tool.credentialsId ||
      tool.credentialId ||
      tool.async === true
    )
      throw Error("Custom knowledge requires review");
    if (!Array.isArray(tool.knowledgeBases) || !tool.knowledgeBases.length)
      throw Error("Invalid inline knowledge configuration");
    const knowledgeBases = tool.knowledgeBases.map((value) => {
      const kb = record(value);
      if (
        kb.provider !== "google" ||
        typeof kb.name !== "string" ||
        !kb.name.trim() ||
        typeof kb.description !== "string" ||
        !Array.isArray(kb.fileIds) ||
        !kb.fileIds.length ||
        kb.fileIds.some(
          (id) =>
            typeof id !== "string" ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id),
        ) ||
        (kb.model !== undefined && typeof kb.model !== "string")
      )
        throw Error("Invalid inline knowledge configuration");
      return {
        provider: "google",
        name: kb.name,
        description: kb.description,
        fileIds: [...kb.fileIds],
        ...(kb.model !== undefined ? { model: kb.model } : {}),
      };
    });
    const fn = record(tool.function);
    if (
      tool.function != null &&
      (typeof fn.name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(fn.name))
    )
      throw Error("Invalid inline knowledge configuration");
    return {
      type: "query",
      knowledgeBases,
      ...(typeof fn.name === "string"
        ? {
            function: {
              name: fn.name,
              ...(typeof fn.description === "string" ? { description: fn.description } : {}),
            },
          }
        : {}),
    };
  });
}

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
  const knowledgeTools = practiceKnowledgeTools(model);
  return {
    name: "OpenFolk private practice",
    model: {
      ...pick(model, ["temperature", "maxTokens"]),
      provider: model.provider,
      model: model.model,
      toolIds: queryToolIds,
      ...(knowledgeTools.length ? { tools: knowledgeTools } : {}),
      messages: [
        {
          role: "system",
          content:
            rules +
            (model.knowledgeBase
              ? "\n\nKNOWLEDGE LOOKUP: Your existing company knowledge is available through openfolk_practice_knowledge. Use it for company facts and policies not explicitly contained in these instructions. Do not invent an answer when the lookup does not supply it."
              : "") +
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
