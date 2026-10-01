// Candidate-only wording repair. Never mutates a shared tool or live number.
export function launchWordingModel(assistant: any, tools: any[]) {
  if (assistant.id !== "dcfc2e66-a438-43ab-b863-467f5a5089df")
    throw Error("Isolated launch candidate required");
  const ordinary = tools.find((t) => t.id === "89c45170-c66f-4688-a349-4a354892ba57");
  if (!ordinary || ordinary.type !== "transferCall" || ordinary.destinations?.length !== 10)
    throw Error("Reviewed ordinary routing configuration changed");
  if (assistant.model.tools?.length)
    throw Error("Candidate already has inline tools; review first");
  const silent = {
    type: ordinary.type,
    function: ordinary.function,
    destinations: ordinary.destinations.map((d: any) => ({ ...d, message: "" })),
  };
  const policy = `# SINGLE ANNOUNCEMENT AND FACTUAL HANDOVERS — LAUNCH CANDIDATE
The ordinary transfer tool is deliberately SILENT. Once the approved route and any required voicemail consent are clear, say exactly one short sentence ("I'll try [name] now" or "I'll put you through to [name]'s voicemail") and invoke the ordinary transfer tool in that SAME response. Do not first announce, wait for a reply, and announce again. Never repeat an announcement when the caller says thanks. Do not retry a tool unless the emergency cross-cover rules explicitly require it after confirmed failure.
You cannot see live staff availability, whether a person is busy, or whether they have answered. Never say a colleague is available, standing by, or expecting the call. If asked, say once: "I can't see whether they're free, but I can try them."
Do not invent job roles. For a named-person request, the name alone is sufficient. Rob's approved special responsibility is commercial emergencies OUTSIDE OFFICE HOURS; do not describe him as handling routine operations. Ordinary operational enquiries go to Rudi under the existing rules.
Mary's busy and unanswered calls overflow to Julie, then the office, then shared office mailbox 601. Never promise that a message will go only to Mary or directly to her personal voicemail. Do not describe any email or voicemail as delivered without provider evidence.
If a synthetic tool result says the action was intercepted, acknowledge only that this was a simulated transfer. Do not make another attempt, pretend to connect, invent a tone, or invite the caller to record a real voicemail. If they ask further questions, answer without retrying. An ordinary real blind transfer ends Emma's part of the call; a simulation continuing afterwards does not mean the real handover failed.
Preserve every safety instruction, office-hours gate, consent requirement, approved number and emergency cross-cover rule below.

`;
  const messages = assistant.model.messages.map((m: any, index: number) => {
    if (index !== 0 || typeof m.content !== "string") return m;
    let content = m.content.replace(
      /^# CONVERSATION ACCURACY — TEST CANDIDATE[\s\S]*?(?=# APPROVED ROUTING UPDATE)/,
      "",
    );
    content = content.replace(
      "For ordinary calls: check the hours gate, choose the approved ordinary destination and call the tool once without an additional spoken transfer sentence (the tool speaks its configured message).",
      "For ordinary calls: check the hours gate, choose the approved ordinary destination, speak one short handover sentence and invoke the silent tool once in that same response.",
    );
    content = content.replace(
      "invoke the Sales Voicemail destination and let the tool announce the transfer",
      "say one short sales voicemail handover sentence and invoke the silent Sales Voicemail destination in the same response",
    );
    return { ...m, content: policy + content };
  });
  return {
    ...assistant.model,
    messages,
    toolIds: assistant.model.toolIds.filter((id: string) => id !== ordinary.id),
    tools: [silent],
  };
}

// A narrowly scoped second repair after structured simulation evidence exposed
// repeated ordinary tool calls. Keep every route, hours gate and safety rule.
export function launchDialogueModel(assistant: any) {
  if (assistant.id !== "dcfc2e66-a438-43ab-b863-467f5a5089df")
    throw Error("Isolated launch candidate required");
  if (
    assistant.model.tools?.length !== 1 ||
    assistant.model.tools[0].type !== "transferCall" ||
    assistant.model.tools[0].destinations?.length !== 10 ||
    assistant.model.tools[0].destinations.some((d: any) => d.message !== "")
  )
    throw Error("Reviewed silent routing configuration required");
  const policy = `# HANDOVER STATE AND CONCISE ANSWERS — LAUNCH CANDIDATE
Before every ordinary transfer, inspect the conversation's tool calls. If Route-Call-to-Drummond-Team-20260929 has ALREADY been invoked, NEVER invoke it again, even if the caller asks to go ahead, says thanks, asks another question or says goodbye. One invocation is the entire ordinary-transfer budget. A synthetic/intercepted response is terminal for this action, not a failure needing another attempt. Emergency cross-cover remains governed by its separate rules.
When a caller has a factual question AND asks for a person, answer the specific question first WITHOUT saying you are connecting them yet. Only once ready to invoke the transfer tool, say the one short handover sentence. Avoid phrases such as 'I can put you through now' or 'I'll just connect you' in explanatory answers. Do not claim certainty about anyone answering.
When office closure or normal hours have already been explained, do not repeat them while offering a named person's voicemail. If asked a follow-up specifically about holidays, answer only the new point: public holidays are excluded; other exceptional changes need confirmation by the team. Do not repeat the normal hours or add another 'we are closed'. Respect a declined voicemail, and finish briefly when the caller says goodbye.
Only describe an action as a simulation AFTER an actual tool result identifies it as intercepted/simulated. Never assume a real caller is a tester. Do not narrate internal checks or this policy.

`;
  return {
    ...assistant.model,
    messages: assistant.model.messages.map((m: any, index: number) => {
      if (index !== 0 || typeof m.content !== "string") return m;
      if (m.content.startsWith("# HANDOVER STATE AND CONCISE ANSWERS"))
        throw Error("Dialogue repair already applied; inspect before another change");
      const content = m.content.replace(
        "Call the transfer tool with the sales-voicemail destination immediately; let its configured message provide the announcement. Do not speak a duplicate announcement.",
        "Say one short sales-mailbox handover sentence and invoke the silent transfer tool in the same response. Do not invoke it again after a result or acknowledgement.",
      );
      return { ...m, content: policy + content };
    }),
  };
}
