import { timingSafeEqualStr } from "./marketing_tracking.ts";
import { evaluateEmergencyIntake, validateEmergencyIntake, emergencyIntakeIds } from "./receptionist-emergency-intake-gate.ts";
import { intakeOfficeClosed } from "./receptionist-intake-office.ts";
import { stableJson } from "./receptionist-release.ts";
import { launchPromotionIds } from "./receptionist-launch-promotion.ts";

type Dependencies = {
  token: string;
  now: () => Date;
  readCall: (id: string) => Promise<any>;
  readCandidate: () => Promise<any>;
  readLive: () => Promise<any>;
  installationVerified: () => Promise<boolean>;
  record: (values: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const denied = () => reply({ error: "The emergency intake check is unavailable. Do not hand over or claim a connection." }, 503);
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
  .map(byte => byte.toString(16).padStart(2, "0")).join("");

// Candidate-only webhook. It never takes tenant, destination or assistant IDs
// from the caller as authority. No caller text or credential is logged.
export async function handleEmergencyIntake(req: Request, deps: Dependencies): Promise<Response> {
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const supplied = req.headers.get("x-openfolk-intake-token") ?? "";
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(deps.token) ||
      !timingSafeEqualStr(deps.token, supplied)) return reply({ error: "Unauthorized" }, 401);
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) return reply({ error: "JSON required" }, 415);
  const declared = Number(req.headers.get("content-length"));
  if (declared > 96_000) return reply({ error: "Request too large" }, 413);
  let raw: string;
  try {
    raw = await req.text();
    if (new TextEncoder().encode(raw).length > 96_000) return reply({ error: "Request too large" }, 413);
  } catch { return denied(); }
  let envelope: any;
  try { envelope = JSON.parse(raw); } catch { return reply({ error: "Invalid JSON" }, 400); }
  const message = envelope?.message;
  const callId = message?.call?.id;
  if (!id.test(callId ?? "") || message?.type !== "handoff-destination-request") return denied();
  try {
    if (!await deps.installationVerified()) return denied();
    const [call, candidate, live] = await Promise.all([
      deps.readCall(callId), deps.readCandidate(), deps.readLive(),
    ]);
    if (candidate?.id !== emergencyIntakeIds.candidate || live?.id !== launchPromotionIds.live ||
        !id.test(candidate?.orgId ?? "") || candidate.orgId !== live?.orgId ||
        call?.id !== callId || call?.orgId !== candidate.orgId ||
        call?.assistantId !== candidate.id) return denied();
    const now = deps.now();
    const started = Date.parse(call.startedAt ?? "");
    if (!Number.isFinite(started) || started > now.getTime() + 30_000 ||
        now.getTime() - started > 15 * 60_000) return denied();
    const binding = {
      authenticated: true, tenantId: emergencyIntakeIds.tenant,
      orgId: candidate.orgId, callId, assistantId: candidate.id,
      helperAssistantId: emergencyIntakeIds.helper,
      officeClosed: intakeOfficeClosed(now),
    };
    const decision = validateEmergencyIntake(message, binding);
    const response = evaluateEmergencyIntake(message, binding);
    // No Vapi event ID is documented. Exact current-message bytes, bound call
    // and trusted assistant make a stable retry key; changed evidence gets a
    // distinct key and still faces the per-call limit in the atomic RPC.
    const eventKey = await digest(stableJson({ callId, message }));
    const payloadHash = await digest(raw);
    const result = await deps.record({
      p_event_key: eventKey, p_payload_hash: payloadHash, p_call_id: callId,
      p_reason: decision.allowed ? "accepted" : decision.reason,
      p_accepted: decision.allowed, p_response: response,
    });
    if (result.error || !result.data || typeof result.data !== "object") return denied();
    const saved = result.data as Record<string, unknown>;
    if (saved.destination && saved.error) return denied();
    if (saved.destination) {
      const target = saved.destination as Record<string, unknown>;
      if (target.type !== "assistant" || target.assistantId !== emergencyIntakeIds.helper)
        return denied();
    } else if (typeof saved.error !== "string") return denied();
    return reply(saved);
  } catch {
    // Fail closed on provider, clock, database or malformed-body uncertainty.
    return denied();
  }
}
