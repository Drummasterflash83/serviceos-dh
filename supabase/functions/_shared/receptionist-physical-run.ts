import { physicalTestCall, physicalVoicemailTestCall } from "./receptionist-physical-test.ts";
// Fixed one-off IDs make retries return the original audit, never another call.
const tests: Record<string, string> = {
  office601: "03a1c601-7ba1-4869-a83d-16c9075a6431",
  rob109: "03a1c109-7ba1-4869-a83d-16c9075a6431",
  alan104: "03a1c104-7ba1-4869-a83d-16c9075a6431",
  office601Deposit: "03a1c602-7ba1-4869-a83d-16c9075a6431",
};
const sourceId = "f498d946-a70a-48c1-9728-ae9bc1ef2966";
export async function startPhysicalTest(db: any, api: any, tenant: string, actor: string, assistant: any, destination: string) {
  const id = tests[destination];
  if (!id) throw Error("Unapproved physical test destination");
  const payload = (destination === "office601Deposit" ? physicalVoicemailTestCall : physicalTestCall)({ tenantId: tenant, destination: destination === "office601Deposit" ? "office601" : destination, phoneNumberId: sourceId, auditId: id, voice: assistant.voice, now: new Date() });
  const source = await api("phone-number/" + sourceId);
  if (source.number !== "+447426924154" || source.assistantId !== "4eb2bee8-ac25-47c9-b962-409ed250ceb6")
    throw Error("Physical test source changed");
  const existing = await db.from("phone_operations_audit").select("id,action,after_state").eq("id", id).eq("tenant_id", tenant).maybeSingle();
  if (existing.error) throw Error("Physical test audit unavailable");
  if (existing.data) return { ...existing.data, retried: false };
  const audit = await db.from("phone_operations_audit").insert({ id, tenant_id: tenant, actor_user_id: actor,
    actor_label: "OpenFolk authorised pre-opening test", action: "physical_test_reserved", resource_type: "vapi_physical_test",
    resource_ref: destination, after_state: { destination: payload.customer.number, deadline: "2026-10-02T07:00:00Z" },
    reason: "User authorised controlled DH tests before 08:00 London on 2 October. No live number or routing edits." });
  if (audit.error) throw Error("Physical test already reserved; no call sent");
  let call: any;
  try { call = await api("call", "POST", payload); }
  catch (e) {
    await db.from("phone_operations_audit").update({ action: String(e).includes("rejected (400)") ? "physical_test_rejected" : "physical_test_uncertain" }).eq("id", id);
    throw e;
  }
  if (!/^[0-9a-f-]{36}$/i.test(call.id ?? "")) throw Error("Physical test uncertain; no retry sent");
  const saved = await db.from("phone_operations_audit").update({ action: "physical_test_started", after_state: {
    callId: call.id, destination: payload.customer.number, status: call.status, deadline: "2026-10-02T07:00:00Z",
  } }).eq("id", id);
  if (saved.error) throw Error("Physical test started; audit needs reconciliation. No retry.");
  return { id, callId: call.id, status: call.status, destination: payload.customer.number };
}
export async function inspectPhysicalTest(db: any, api: any, tenant: string, destination: string) {
  const id = tests[destination];
  if (!id) throw Error("Unapproved physical test destination");
  const row = await db.from("phone_operations_audit").select("after_state").eq("id", id).eq("tenant_id", tenant).single();
  if (row.error || !row.data?.after_state?.callId) throw Error("No saved physical call");
  const call = await api("call/" + row.data.after_state.callId);
  if (call.phoneNumberId !== sourceId || call.customer?.number !== row.data.after_state.destination) throw Error("Physical call evidence mismatch");
  const result = { callId: call.id, status: call.status, endedReason: call.endedReason, startedAt: call.startedAt, endedAt: call.endedAt,
    transcript: call.artifact?.transcript ?? call.transcript ?? null, cost: call.cost ?? null,
    callDiagnostics: (call.artifact?.messages ?? call.messages ?? []).filter((m: any) => m.role === "tool" || m.role === "tool_calls" || m.toolCalls?.length).map((m: any) => ({ role: m.role, message: m.message, toolCalls: m.toolCalls, time: m.time })),
    actualMailboxReceipt: "not_verified", emailDelivery: "not_verified", humanAudioAcceptance: "not_verified" };
  await db.from("phone_operations_audit").update({ action: call.status === "ended" ? "physical_test_ended_review_required" : "physical_test_started", after_state: { ...row.data.after_state, ...result } }).eq("id", id);
  return result;
}
