/** Paid processing is admitted once; output and previous-result history settle atomically. */
type Db = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<any> };
export type DerivedScope = {
  tenantId: string;
  recordingId: string;
  runId: string;
  stage: "transcription" | "analysis";
  transcriptId?: string;
};
type Result = Record<string, unknown>;
type Prepared =
  | {
      ok: true;
      request: { sha256: string; bytes: number };
      invoke: () => Promise<{ ok: true; output: Result } | { ok: false; code: string }>;
    }
  | { ok: false; code: string };
const safeCodes = new Set([
  "missing_audio",
  "empty_audio",
  "audio_too_large",
  "config_error",
  "input_unavailable",
  "openai_rate_limited",
  "openai_auth_failed",
  "openai_quota_exhausted",
  "openai_invalid_request",
  "audio_too_short",
  "invalid_audio",
  "malformed_response",
]);
const failure = (code = "phone_processing_unconfirmed") => ({
  ok: false as const,
  code,
  httpStatus: code === "phone_recording_processing_held" ? 409 : 503,
  message: "Processing needs review. Previous saved results remain available.",
});
export const phoneInputDigest = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const canonical = (v: any): string =>
  JSON.stringify(
    v === null || typeof v !== "object"
      ? v
      : Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(canonical(v[k]))]),
          ),
  );
async function phase(db: Db, s: DerivedScope, action: string, data: Result) {
  try {
    const r = await db.rpc("learn_phone_derived_attempt", {
      p_tenant: s.tenantId,
      p_run: s.runId,
      p_recording: s.recordingId,
      p_stage: s.stage,
      p_phase: action,
      p_data: data,
    });
    if (r.error)
      return {
        error: [
          "learn_capture_paused",
          "phone_recording_processing_held",
          "phone_attempt_source_changed",
        ].includes(r.error.message)
          ? r.error.message
          : "phone_processing_unconfirmed",
        data: null,
      };
    const d = r.data;
    if (
      !d ||
      d.version !== "learn-phone-derived-attempt/1" ||
      d.tenantId !== s.tenantId ||
      d.recordingId !== s.recordingId ||
      d.runId !== s.runId ||
      d.stage !== s.stage ||
      (s.stage === "analysis" && d.transcriptId !== s.transcriptId)
    )
      return { error: "phone_processing_unconfirmed", data: null };
    return { error: null, data: d };
  } catch {
    return { error: "phone_processing_unconfirmed", data: null };
  }
}
function success(receipt: any) {
  if (
    receipt?.state !== "succeeded" ||
    typeof receipt.resultId !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.resultId) ||
    !receipt.result ||
    typeof receipt.result !== "object"
  )
    return failure();
  return {
    ok: true as const,
    resultId: receipt.resultId as string,
    result: receipt.result as Result,
    cached: receipt.cached === true,
    intelligencePublished: receipt.intelligencePublished === true,
  };
}
async function complete(db: Db, s: DerivedScope, output: Result) {
  let settled = await phase(db, s, "complete", output);
  if (settled.error === "phone_processing_unconfirmed")
    settled = await phase(db, s, "complete", output);
  if (settled.error) return failure(settled.error);
  if (canonical(settled.data.result) !== canonical(output)) return failure();
  return success(settled.data);
}
export async function runPhoneDerivedVersion(input: {
  db: Db;
  scope: DerivedScope;
  request: Result;
  prepareInput: (source: any) => Promise<Prepared>;
}) {
  const { db, scope, request, prepareInput } = input;
  const claim = await phase(db, scope, "claim", request);
  if (claim.error) return failure(claim.error);
  if (claim.data.replayed !== false) return failure("phone_recording_processing_held");
  if (claim.data.state === "succeeded") return success(claim.data);
  if (claim.data.state !== "running" || !claim.data.source) return failure();
  const fail = async (code: string) => {
    const marked = await phase(db, scope, "fail", {
      code: safeCodes.has(code) ? code : "processing_unconfirmed",
    });
    return marked.error
      ? failure(marked.error)
      : failure(
          marked.data.state === "needs_review"
            ? "phone_recording_processing_held"
            : safeCodes.has(code)
              ? code
              : "phone_processing_unconfirmed",
        );
  };
  try {
    const prepared = await prepareInput(claim.data.source);
    if (!prepared.ok) return await fail(prepared.code);
    const dispatch = await phase(db, scope, "dispatch", prepared.request);
    // An uncertain or replayed dispatch never authorises repeating a paid request.
    if (dispatch.error || dispatch.data.state !== "dispatched" || dispatch.data.replayed !== false)
      return failure(dispatch.error ?? undefined);
    const response = await prepared.invoke();
    if (!response.ok) return await fail(response.code);
    const saved = await phase(db, scope, "prepare", response.output);
    if (
      saved.error ||
      saved.data.state !== "prepared" ||
      canonical(saved.data.prepared) !== canonical(response.output)
    )
      return failure(saved.error ?? undefined);
    return await complete(db, scope, response.output);
  } catch {
    return await fail("processing_unconfirmed");
  }
}
export async function reconcilePhoneDerivedVersion(db: Db, scope: DerivedScope) {
  const inspected = await phase(db, scope, "inspect", {});
  if (inspected.error) return failure(inspected.error);
  const a = inspected.data;
  if (a.state === "succeeded") {
    const r = a.receipt;
    if (
      !r ||
      r.version !== a.version ||
      r.tenantId !== scope.tenantId ||
      r.runId !== scope.runId ||
      r.recordingId !== scope.recordingId ||
      r.stage !== scope.stage ||
      (scope.stage === "analysis" && r.transcriptId !== scope.transcriptId)
    )
      return failure();
    return success(r);
  }
  if (
    !["prepared", "needs_review"].includes(a.state) ||
    !a.prepared ||
    typeof a.prepared !== "object"
  )
    return failure("phone_recording_processing_held");
  return await complete(db, scope, a.prepared);
}
