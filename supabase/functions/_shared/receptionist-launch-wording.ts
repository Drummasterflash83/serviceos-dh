// Candidate-only wording repair. Never mutates a shared tool or live number.
export function launchWordingModel(assistant: any, tools: any[]) {
  if (assistant.id !== "dcfc2e66-a438-43ab-b863-467f5a5089df")
    throw Error("Isolated launch candidate required");
  const ordinary = tools.find((t) => t.id === "89c45170-c66f-4688-a349-4a354892ba57");
  if (!ordinary || ordinary.type !== "transferCall" || ordinary.destinations?.length !== 10)
    throw Error("Reviewed ordinary routing configuration changed");
  if (assistant.model.tools?.length) throw Error("Candidate already has inline tools; review first");
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
    let content = m.content.replace(/^# CONVERSATION ACCURACY — TEST CANDIDATE[\s\S]*?(?=# APPROVED ROUTING UPDATE)/, "");
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
  return { ...assistant.model, messages, toolIds: assistant.model.toolIds.filter((id: string) => id !== ordinary.id), tools: [silent] };
}
