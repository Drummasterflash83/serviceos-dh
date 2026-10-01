// One-time, service-role-only launch repair. Does not alter a live assistant,
// telephone number or existing tool. Original provider configuration is retained.
export async function prepareLaunchCandidate(
  db: any,
  api: any,
  assistant: any,
  tools: any[],
  hash: string,
  actor: string,
  tenant: string,
) {
  if (
    tenant !== "00000000-0000-0000-0000-000000000001" ||
    assistant.id !== "4eb2bee8-ac25-47c9-b962-409ed250ceb6"
  )
    throw Error("Launch candidate target mismatch.");
  const ordinary = tools.find((t) => t.id === "89c45170-c66f-4688-a349-4a354892ba57");
  const emergency = tools.find((t) => t.id === "ac550bea-6e64-4614-8dcf-a0a32856694e");
  if (!ordinary || !emergency || tools.length !== 2)
    throw Error("Launch candidate source changed.");
  const existing = await db
    .from("receptionist_test_candidates")
    .select("state,helper_id,handoff_id,candidate_id")
    .eq("tenant_id", tenant)
    .maybeSingle();
  if (existing.error) throw Error("Launch candidate audit unavailable.");
  if (
    existing.data &&
    !(
      existing.data.state === "rejected" &&
      !existing.data.helper_id &&
      !existing.data.handoff_id &&
      !existing.data.candidate_id
    )
  )
    return existing.data;
  if (!existing.data) {
    const saved = await db
      .from("receptionist_test_candidates")
      .insert({
        tenant_id: tenant,
        actor_id: actor,
        source_hash: hash,
        source_assistant: assistant,
        source_tools: tools,
      });
    if (saved.error) throw Error("Launch candidate already preparing. No retry sent.");
  }
  const update = async (fields: any) => {
    const r = await db.from("receptionist_test_candidates").update(fields).eq("tenant_id", tenant);
    if (r.error) throw Error("Launch candidate audit save failed. Review Vapi before retry.");
  };
  const messages = assistant.model.messages.map((m: any) => ({
    ...m,
    content:
      typeof m.content === "string"
        ? m.content.replace(
            "Then immediately emit `Route-Call-to-Drummond-Team-20260929` with `appropriate ROB EMERGENCY or TONY EMERGENCY destination under the emergency cross-cover sequence`.",
            "Then immediately use `Route-Emergency-to-Rob-or-Tony` to continue the emergency cross-cover sequence.",
          )
        : m.content,
  }));
  const common = {
    voice: assistant.voice,
    transcriber: assistant.transcriber,
    maxDurationSeconds: 300,
  };
  const helper = await api("assistant", "POST", {
    ...common,
    name: "Emma emergency — test candidate",
    firstMessageMode: "assistant-speaks-first-with-model-generated-message",
    model: {
      ...assistant.model,
      tools: [],
      toolIds: [emergency.id],
      messages: [
        ...messages,
        {
          role: "system",
          content:
            "EMERGENCY CONTINUATION: You are the SAME Emma, continuing an eligible out-of-hours emergency already assessed in the conversation. Do not introduce yourself, repeat the recording notice or office-closed message, or repeat any safety advice or details already given. Use the full conversation history. Ask only missing minimum details: commercial/domestic if unclear, name, confirmed callback number, site/address and brief issue. Commercial tries Rob first then Tony once after failure; domestic tries Tony first then Rob once after failure. Use only Route-Emergency-to-Rob-or-Tony. Never retry either person. A voicemail greeting is not human acceptance. If both fail, explain clearly, collect any missing message details, and never claim an email was sent, a voicemail delivered, an engineer dispatched or attendance promised. There is no email tool. Do not use ordinary routing or return to the main number. Preserve existing safety advice and do not delay immediate emergency action.",
        },
      ],
    },
  });
  await update({ helper_id: helper.id });
  const handoff = await api("tool", "POST", {
    type: "handoff",
    function: {
      name: "Route-Emergency-to-Rob-or-Tony",
      description:
        "Eligible out-of-hours emergencies only, after safety advice and minimum details. Continue seamlessly as Emma with emergency cross-cover: commercial Rob then Tony; domestic Tony then Rob. This is an internal handoff, not a completed telephone transfer.",
    },
    destinations: [
      {
        type: "assistant",
        assistantId: helper.id,
        description:
          "Emergency cross-cover continuation for eligible out-of-hours commercial or domestic incidents.",
        contextEngineeringPlan: { type: "all" },
      },
    ],
  });
  await update({ handoff_id: handoff.id });
  const candidate = await api("assistant", "POST", {
    ...common,
    name: "Emma launch candidate — not live",
    firstMessage: assistant.firstMessage,
    model: {
      ...assistant.model,
      toolIds: [ordinary.id, handoff.id],
      messages: [
        ...messages,
        {
          role: "system",
          content:
            "TRANSFER IMPLEMENTATION: Route-Emergency-to-Rob-or-Tony is an internal handoff to Emma’s emergency continuation, not a transferCall tool on this assistant. Use it for eligible out-of-hours emergencies after safety advice and required minimum details. Do not announce a new assistant or say the caller has reached an engineer. Ordinary and daytime calls continue to use Route-Call-to-Drummond-Team-20260929. Never use the ordinary tool for emergency cross-cover.",
        },
      ],
    },
  });
  await update({ candidate_id: candidate.id, state: "prepared" });
  const setting = await db
    .from("receptionist_test_settings")
    .update({
      assistant_id: candidate.id,
      label: "Emma launch candidate — live main number unchanged",
    })
    .eq("tenant_id", tenant);
  if (setting.error) throw Error("Launch candidate prepared but test selection needs review.");
  return {
    state: "prepared",
    helper_id: helper.id,
    handoff_id: handoff.id,
    candidate_id: candidate.id,
  };
}
