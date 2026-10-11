/** One read-only provider download, immutable upload and fenced pointer publication. */
type Db = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<any>; storage: any };
type Scope = { tenantId: string; runId: string; recordingId: string };
type Output = { storagePath: string; sha256: string; bytes: number };
type Audio = { ok: true; bytes: Uint8Array } | { ok: false; code: string };
const failure = (code = "phone_download_unconfirmed", httpStatus = 503) => ({
  ok: false as const,
  code,
  httpStatus,
  message:
    "The recording download could not be confirmed. Retained audio remains available; review the attempt before retrying.",
});
const digest = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const equivalent = (a: any, b: Output) =>
  a &&
  Object.keys(a).length === 3 &&
  a.storagePath === b.storagePath &&
  a.sha256 === b.sha256 &&
  a.bytes === b.bytes;
const knownFailure = new Set([
  "provider_rate_limited",
  "provider_timeout",
  "download_failed",
  "provider_recording_missing",
  "recording_not_ready",
  "auth_failed",
  "empty_audio",
  "audio_too_large",
]);
async function attempt(db: Db, scope: Scope, phase: string, data: Record<string, unknown>) {
  try {
    const response = await db.rpc("learn_phone_download_attempt", {
      p_tenant: scope.tenantId,
      p_run: scope.runId,
      p_recording: scope.recordingId,
      p_phase: phase,
      p_data: data,
    });
    if (response.error) {
      const code = response.error.message;
      return [
        "learn_capture_paused",
        "phone_account_unavailable",
        "phone_recording_processing_held",
        "phone_attempt_source_changed",
      ].includes(code)
        ? { error: code, data: null }
        : { error: "phone_download_unconfirmed", data: null };
    }
    const r = response.data;
    if (
      !r ||
      r.version !== "learn-phone-download-attempt/1" ||
      r.tenantId !== scope.tenantId ||
      r.runId !== scope.runId ||
      r.recordingId !== scope.recordingId
    )
      return { error: "phone_download_unconfirmed", data: null };
    return { error: null, data: r };
  } catch {
    return { error: "phone_download_unconfirmed", data: null };
  }
}
export async function capturePhoneRecordingVersion(input: {
  db: Db;
  scope: Scope;
  definition: {
    accountId: string;
    connectorId: string;
    customerId: string;
    source: Record<string, unknown>;
  };
  fetchAudio: () => Promise<Audio>;
}) {
  const { db, scope, definition, fetchAudio } = input;
  const claim = await attempt(db, scope, "claim", definition);
  if (claim.error)
    return failure(claim.error, claim.error === "phone_recording_processing_held" ? 409 : 503);
  // A replay is evidence to reconcile, never permission to repeat an external step.
  if (claim.data.state !== "running" || claim.data.replayed !== false) return failure();
  let prepared = false;
  const stop = async (code: string) => {
    const marked = await attempt(db, scope, "fail", { code });
    if (marked.error || marked.data.state !== (prepared ? "needs_review" : "failed"))
      return failure();
    return failure(prepared ? "phone_recording_processing_held" : code, prepared ? 409 : 502);
  };
  try {
    const audio = await fetchAudio();
    if (!audio.ok)
      return await stop(knownFailure.has(audio.code) ? audio.code : "unexpected_failure");
    if (!audio.bytes.byteLength) return await stop("empty_audio");
    if (audio.bytes.byteLength > 64 * 1024 * 1024) return await stop("audio_too_large");
    const output: Output = {
      storagePath: `${scope.tenantId}/simwood/recordings/versions/${scope.recordingId}/${scope.runId}.wav`,
      sha256: await digest(audio.bytes),
      bytes: audio.bytes.byteLength,
    };
    const staged = await attempt(db, scope, "prepare", output);
    if (
      staged.error ||
      staged.data.state !== "prepared" ||
      !equivalent(staged.data.prepared, output)
    )
      return failure(staged.error ?? undefined);
    prepared = true;
    const bucket = db.storage.from("phone-recordings");
    // Never overwrite an old path, including a forced re-download.
    try {
      await bucket.upload(
        output.storagePath,
        new Blob([audio.bytes.slice().buffer], { type: "audio/wav" }),
        { contentType: "audio/wav", upsert: false },
      );
    } catch {
      /* Upload may have committed. Exact readback is the only next action. */
    }
    const stored = await bucket.download(output.storagePath);
    if (stored.error || !(stored.data instanceof Blob) || stored.data.size !== output.bytes)
      return await stop("storage_unconfirmed");
    if ((await digest(new Uint8Array(await stored.data.arrayBuffer()))) !== output.sha256)
      return await stop("download_integrity_unconfirmed");
    let completed = await attempt(db, scope, "complete", output);
    // The transaction writes its immutable receipt with the pointer and run. An exact
    // replay is safe after a lost response, and performs no new upload/provider work.
    if (completed.error === "phone_download_unconfirmed")
      completed = await attempt(db, scope, "complete", output);
    if (
      completed.error ||
      completed.data.state !== "succeeded" ||
      !equivalent(completed.data.prepared, output)
    )
      return failure(completed.error ?? undefined);
    return {
      ok: true as const,
      storagePath: output.storagePath,
      bytes: output.bytes,
      sha256: output.sha256,
    };
  } catch {
    return await stop(prepared ? "storage_unconfirmed" : "unexpected_failure");
  }
}

/** Reconcile only the journal's immutable file. Never fetch provider audio or upload. */
export async function reconcilePhoneRecordingVersion(db: Db, scope: Scope) {
  const inspected = await attempt(db, scope, "inspect", {});
  if (inspected.error) return failure(inspected.error);
  const output = inspected.data.prepared;
  if (
    !["prepared", "needs_review", "succeeded"].includes(inspected.data.state) ||
    !output ||
    Object.keys(output).length !== 3 ||
    output.storagePath !==
      `${scope.tenantId}/simwood/recordings/versions/${scope.recordingId}/${scope.runId}.wav` ||
    typeof output.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(output.sha256) ||
    !Number.isSafeInteger(output.bytes) ||
    output.bytes < 1 ||
    output.bytes > 64 * 1024 * 1024
  )
    return failure("phone_recording_processing_held", 409);
  try {
    const stored = await db.storage.from("phone-recordings").download(output.storagePath);
    if (
      stored.error ||
      !(stored.data instanceof Blob) ||
      stored.data.size !== output.bytes ||
      (await digest(new Uint8Array(await stored.data.arrayBuffer()))) !== output.sha256
    )
      return failure("phone_recording_processing_held", 409);
    let completed = await attempt(db, scope, "complete", output);
    if (completed.error === "phone_download_unconfirmed")
      completed = await attempt(db, scope, "complete", output);
    if (
      completed.error ||
      completed.data.state !== "succeeded" ||
      !equivalent(completed.data.prepared, output)
    )
      return failure(completed.error ?? undefined);
    return {
      ok: true as const,
      storagePath: output.storagePath as string,
      bytes: output.bytes as number,
      sha256: output.sha256 as string,
    };
  } catch {
    return failure();
  }
}
