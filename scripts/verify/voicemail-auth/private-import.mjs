/** Node import coordinator; no automatic scheduling, credentials or activation.
 * Supply a service-role client, bounded provider loader and full audio decoder.
 * Route admission precedes the provider read. Publication follows immutable
 * upload + byte-for-byte readback of the original message and decoded audio.
 */
import { createHash } from "node:crypto";
import { extractSignedVoicemail, signingDomain } from "./signed-voicemail.mjs";
import { decodeVoicemailAudio } from "./decode-audio.mjs";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
async function rpc(client, name, args) {
  let response;
  try {
    response = await client.rpc(name, args);
  } catch {
    fail("voicemail_" + name.replace("voicemail_intake_", "") + "_unconfirmed");
  }
  if (response?.error || response?.data == null)
    fail("voicemail_" + name.replace("voicemail_intake_", "") + "_unconfirmed");
  return response.data;
}
async function putVerified(client, bucket, path, bytes, mime, digest) {
  // Never overwrite an object. An unknown write result is resolved by readback;
  // an existing equal object is a retry, different bytes require operator review.
  try {
    await client.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false });
  } catch {}
  let downloaded;
  try {
    downloaded = await client.storage.from(bucket).download(path);
  } catch {
    fail("voicemail_storage_readback_unconfirmed");
  }
  if (downloaded?.error || !(downloaded?.data instanceof Blob))
    fail("voicemail_storage_readback_unconfirmed");
  if (downloaded.data.size !== bytes.length) fail("voicemail_storage_content_conflict");
  const actual = new Uint8Array(await downloaded.data.arrayBuffer());
  try {
    if (hash(actual) !== digest) fail("voicemail_storage_content_conflict");
  } finally {
    actual.fill(0);
  }
}
export async function importPrivateVoicemail({
  client,
  tenantId,
  routeId,
  source,
  loadRaw,
  decodeAudio = decodeVoicemailAudio,
  resolver,
}) {
  if (
    !uuid.test(tenantId ?? "") ||
    !uuid.test(routeId ?? "") ||
    !uuid.test(source?.accountId ?? "") ||
    !/^[a-f0-9]{1,64}$/.test(source?.id ?? "") ||
    typeof source?.internalDate !== "string" ||
    !/^\d{1,15}$/.test(source.internalDate) ||
    !Number.isSafeInteger(Number(source.internalDate)) ||
    Number(source.internalDate) > 8640000000000000 ||
    typeof loadRaw !== "function" ||
    typeof decodeAudio !== "function" ||
    typeof resolver !== "function"
  )
    fail("voicemail_import_input_invalid");
  const receivedAt = new Date(Number(source.internalDate)).toISOString();
  const admission = async () => {
    let r = await rpc(client, "voicemail_intake_route", {
      p_tenant: tenantId,
      p_route: routeId,
      p_received: receivedAt,
    });
    if (Array.isArray(r)) {
      if (r.length !== 1) fail("voicemail_route_response_invalid");
      r = r[0];
    }
    if (
      r.id !== routeId ||
      r.tenant_id !== tenantId ||
      r.email_account_id !== source.accountId ||
      r.enabled !== true ||
      r.signing_domain !== signingDomain ||
      !uuid.test(r.mailbox_id ?? "") ||
      typeof r.recipient_email !== "string"
    )
      fail("voicemail_route_response_invalid");
    return r;
  };
  const route = await admission();
  let loaded;
  try {
    loaded = await loadRaw({ accountId: source.accountId, id: source.id });
  } catch {
    fail("voicemail_provider_read_unconfirmed");
  }
  if (
    loaded?.id !== source.id ||
    loaded?.internalDate !== source.internalDate ||
    !(loaded?.raw instanceof Uint8Array) ||
    loaded.raw.byteLength === 0 ||
    loaded.raw.byteLength > 1048576
  )
    fail("voicemail_provider_source_changed");
  const raw = Buffer.from(loaded.raw);
  let extracted;
  try {
    extracted = await extractSignedVoicemail(raw, {
      internalDate: source.internalDate,
      expectedMailbox: route.recipient_email,
      resolver,
    });
    let decoded;
    try {
      decoded = await decodeAudio(extracted.audio);
    } catch {
      fail("voicemail_audio_decode_unconfirmed");
    }
    if (
      decoded?.state !== "decoded" ||
      !Number.isSafeInteger(decoded.frames) ||
      decoded.frames <= 0 ||
      !Number.isFinite(decoded.durationSeconds) ||
      decoded.durationSeconds <= 0 ||
      decoded.durationSeconds > 7202 ||
      Math.abs(decoded.durationSeconds - extracted.candidate.reportedDurationSeconds) > 2
    )
      fail("voicemail_audio_decode_unconfirmed");
    // A decoder must not mutate bytes between signature verification and upload.
    if (hash(extracted.audio) !== extracted.audioSha256 || hash(raw) !== extracted.rawSha256)
      fail("voicemail_source_mutated");
    const c = extracted.candidate;
    const candidate = {
      version: c.version,
      system_reference: c.systemReference,
      extension: c.extension,
      caller_number: c.callerNumber,
      caller_name: c.callerName,
      duration_seconds: c.reportedDurationSeconds,
      transcript: c.providerTranscript,
    };
    const sourceEvidence = {
      email_id: source.id,
      received_at: c.emailReceivedAt,
      raw_sha256: extracted.rawSha256,
      raw_bytes: raw.length,
      content_sha256: extracted.contentFingerprint,
      audio_sha256: extracted.audioSha256,
      audio_bytes: extracted.audio.length,
      signing_domain: signingDomain,
    };
    const receipt = await rpc(client, "voicemail_intake_prepare", {
      p_tenant: tenantId,
      p_route: routeId,
      p_source: sourceEvidence,
      p_candidate: candidate,
    });
    if (
      !uuid.test(receipt.intake_id ?? "") ||
      !uuid.test(receipt.source_id ?? "") ||
      !["prepared", "published"].includes(receipt.state) ||
      receipt.audio_path !== `${tenantId}/${route.mailbox_id}/${receipt.intake_id}` ||
      receipt.source_path !== `${tenantId}/${receipt.intake_id}/${receipt.source_id}.eml`
    )
      fail("voicemail_prepare_response_invalid");
    await admission();
    await putVerified(
      client,
      "learn-voicemail-sources",
      receipt.source_path,
      raw,
      "message/rfc822",
      extracted.rawSha256,
    );
    await putVerified(
      client,
      "receptionist-voicemails",
      receipt.audio_path,
      extracted.audio,
      "audio/mpeg",
      extracted.audioSha256,
    );
    const published = await rpc(client, "voicemail_intake_publish", {
      p_tenant: tenantId,
      p_intake: receipt.intake_id,
      p_source: receipt.source_id,
      p_raw_sha256: extracted.rawSha256,
      p_audio_sha256: extracted.audioSha256,
    });
    if (published.state !== "published" || published.message_id !== receipt.intake_id)
      fail("voicemail_publish_unconfirmed");
    return {
      state: "published",
      messageId: published.message_id,
      sourceId: receipt.source_id,
      rawSha256: extracted.rawSha256,
      audioSha256: extracted.audioSha256,
      audioBytes: extracted.audio.length,
      decodedDurationSeconds: decoded.durationSeconds,
      storedBytesReadBack: true,
    };
  } finally {
    raw.fill(0);
    extracted?.audio.fill(0);
  }
}
