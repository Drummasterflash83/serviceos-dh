// One-time, service-role-only launch repair. Does not alter a live assistant,
// telephone number or existing tool. Original provider configuration is retained.
import { releaseConfiguration } from "./receptionist-release.ts";

// Inline copy belongs only to the isolated helper. Vapi's assistant model.tools
// supports built-in transferCall tools; never add 603 to the published shared
// emergency tool just to make the candidate pass its later release gate.
export function candidateEmergencyTool(source: any) {
  if (source?.type !== "transferCall" || source?.function?.name !== "Route-Emergency-to-Rob-or-Tony" ||
    !Array.isArray(source.destinations) || source.destinations.length !== 2)
    throw Error("Reviewed emergency transfer source required.");
  return structuredClone(releaseConfiguration(source));
}

export const EMMA_TRANSFER_ASSISTANT_CONTRACT =
  "You are Emma speaking privately to the destination engineer while the caller is on hold. Call transferSuccessful only after a live human operator explicitly accepts this caller. Call transferCancel for voicemail, an automated greeting, an IVR, busy, no answer, an unreachable destination or a declined call. Do not treat a ring, transfer request or voicemail greeting as human acceptance. Return the caller to Emma on cancellation so the reviewed next destination can be attempted once. Never promise an engineer connection or message delivery without a provider receipt.";

export const EMERGENCY_CONTINUATION_CONTRACT =
  "EMERGENCY CONTINUATION: You are the SAME Emma, continuing an eligible out-of-hours emergency already assessed in the conversation. Do not introduce yourself, repeat the recording notice or office-closed message, or repeat any safety advice or details already given. Use the full conversation history. Ask only missing minimum details: name, confirmed callback number, concrete site/address and brief issue. Commercial urgent: attempt Rob 109 once. Domestic urgent: attempt Tony 105 once. If the caller genuinely cannot establish whether the property is domestic or commercial, attempt Tony 105 once; do not invent a classification. Use only Route-Emergency-to-Rob-or-Tony. One invocation selects ONE destination; it does not ring all destinations. Never try the other engineer as cross-cover or retry the selected engineer. A voicemail greeting, ringing, busy, no answer or declined call is not human acceptance. After the selected engineer transfer explicitly fails and returns the caller to you, explain that the engineer could not take the call, then use the reviewed shared emergency mailbox 603 destination once if it is available in that tool. If the 603 destination is unavailable or its transfer fails, collect any missing message details and explain the limitation; do not invent another route. Never claim an engineer answered, a voicemail was deposited, either email was delivered, a Slack alert was sent, or attendance was promised without independent confirmation. The intended 603 deposit must be independently matched to delivery receipts for both rob@drummondheating.co.uk and tony@drummondheating.co.uk and to a scoped #ai-emma Slack alert before operational acceptance; you have no email or Slack tool and cannot certify those receipts to the caller. Do not use ordinary routing or return to the main number. Preserve existing safety advice and do not delay immediate emergency action.";

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
            "Then immediately use `Route-Emergency-to-Rob-or-Tony` to continue the emergency response.",
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
      tools: [candidateEmergencyTool(emergency)],
      toolIds: [],
      messages: [
        ...messages,
        {
          role: "system",
          content: EMERGENCY_CONTINUATION_CONTRACT,
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
        "Eligible out-of-hours emergencies only, after safety advice and minimum details. Continue seamlessly as Emma: commercial urgent to Rob; domestic or genuinely uncertain urgent to Tony; one failed selected engineer then shared mailbox 603. This is an internal handoff, not a completed telephone transfer.",
    },
    destinations: [
      {
        type: "assistant",
        assistantId: helper.id,
        description:
          "Emergency continuation for eligible out-of-hours commercial, domestic or genuinely uncertain incidents.",
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
            "TRANSFER IMPLEMENTATION: Route-Emergency-to-Rob-or-Tony is an internal handoff to Emma’s emergency continuation, not a transferCall tool on this assistant. Use it for eligible out-of-hours emergencies after safety advice and required minimum details. Do not announce a new assistant or say the caller has reached an engineer. Ordinary and daytime calls continue to use Route-Call-to-Drummond-Team-20260929. Never use the ordinary tool for this emergency route.",
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
