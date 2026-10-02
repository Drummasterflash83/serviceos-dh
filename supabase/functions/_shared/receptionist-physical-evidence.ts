// Summarise only the four explicitly authorised, labelled launch calls. These
// are observations, not a telephone-health pass or proof of mailbox delivery.
const reviewed = [
  { id: "03a1c601-7ba1-4869-a83d-16c9075a6431", call: "01a0fb3b-79ef-7444-ba1d-ce604600c47d", destination: "+441794840043", label: "Shared office mailbox · 601", detail: "The direct number answered with the Drummonds office voicemail greeting.", state: "observed" },
  { id: "03a1c109-7ba1-4869-a83d-16c9075a6431", call: "01a0fb40-e115-7444-ba40-b1eaf1359321", destination: "+441794378105", label: "Rob · extension 109", detail: "The direct number reached a greeting identifying Rob. A human handset answer has not been verified by this test.", state: "observed" },
  { id: "03a1c104-7ba1-4869-a83d-16c9075a6431", call: "01a0fb41-5a1d-7004-bae0-78b55e996409", destination: "+441794378096", label: "Alan · extension 104", detail: "This call reached a greeting identifying Rob, not Alan. Retest the greeting after restoration; this historical result is retained.", state: "needs_attention" },
  { id: "03a1c602-7ba1-4869-a83d-16c9075a6431", call: "01a0fb4c-8a42-7663-9cc2-8163788223ce", destination: "+441794840043", label: "Office voicemail deposit · 601", detail: "The test caller spoke the labelled message after the greeting. Finding and playing that message in mailbox 601, and verifying email receipt, remain outstanding.", state: "observed" },
] as const;
const alanRestorationId = "03a1c104-7ba1-4869-a83d-16c9075a6432";
export const PHYSICAL_EVIDENCE_IDS: string[] = [...reviewed.map(r => r.id), alanRestorationId];
export function physicalEvidence(rows: any[], tenantId: string) {
  if (tenantId !== "00000000-0000-0000-0000-000000000001") return [];
  const restored = rows.find(r => r.id === alanRestorationId && r.tenant_id === tenantId && r.resource_type === "birchills_greeting" && r.action === "alan_greetings_restored_verified");
  const verified = restored?.after_state;
  const alanRestored = verified?.busyMatchesApproved === true && verified?.unavailableMatchesApproved === true && verified?.approvedAudioSha256 === "66a96d4edaec54fb32ead4b6f6700cf804c7e4c9164a1f98c2a1c99da3d7ad68" && typeof verified?.verifiedAt === "string";
  return reviewed.flatMap(r => {
    const row = rows.find(x => x.id === r.id && x.tenant_id === tenantId && x.resource_type === "vapi_physical_test");
    const saved = row?.after_state;
    if (saved?.callId !== r.call || saved?.destination !== r.destination || saved?.status !== "ended" || !saved?.endedAt) return [];
    const repaired = r.label === "Alan · extension 104" && alanRestored;
    return [{ id: r.id, label: r.label, detail: repaired ? "The earlier call heard Rob's greeting. Alan's own greeting has since been restored in both slots and the provider audio verified. A fresh phone call is still required." : r.detail, state: repaired ? "observed" : r.state, checkedAt: saved.endedAt, providerCallId: r.call, ...(repaired ? { restoredAt: verified.verifiedAt } : {}) }];
  });
}
