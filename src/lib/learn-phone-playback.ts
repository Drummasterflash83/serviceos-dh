import type { LearnCommunicationClient } from "./learn-card-communications.ts";
export type PhoneRecordingSource = "phone_calls" | "phone_recordings";
export type PhoneOperatorAccess = { actor: string; reason: string };
function operatorArgs(operator?: PhoneOperatorAccess) {
  if (operator === undefined) return {};
  if (
    !uuid(operator.actor) ||
    typeof operator.reason !== "string" ||
    operator.reason.trim().length < 3 ||
    operator.reason.trim().length > 500
  )
    throw Error("Operator recording access unavailable");
  return { p_reason: operator.reason.trim() };
}
export type RetainedRecording = {
  id: string;
  started_at: string | null;
  duration_seconds: number | null;
  audio_stored: boolean;
};
export type RecordingPage = {
  rows: RetainedRecording[];
  next_cursor: string | null;
  source_available: boolean;
};
export type PhonePlaybackClient = LearnCommunicationClient & {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: any; error: unknown }>;
  };
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export async function readRetainedRecordings(
  db: LearnCommunicationClient,
  tenant: string,
  table: PhoneRecordingSource,
  id: string,
  after: string | null = null,
  operator?: PhoneOperatorAccess,
): Promise<RecordingPage> {
  if (
    !uuid(tenant) ||
    !uuid(id) ||
    !["phone_calls", "phone_recordings"].includes(table) ||
    (after !== null && !uuid(after))
  )
    throw Error("Recording source unavailable");
  const reason = operatorArgs(operator);
  const { data: p, error } = (await db.rpc(
    operator ? "learn_operator_phone_recordings_read" : "learn_phone_recordings_read",
    {
      p_tenant: tenant,
      p_table: table,
      p_id: id,
      p_after: after,
      ...reason,
    },
  )) as { data: any; error: unknown };
  if (
    error ||
    (operator &&
      (p?.operator_mode !== true || p?.actor_id !== operator.actor || !uuid(p?.audit_id))) ||
    p?.version !== "learn-phone-recordings/1" ||
    p.tenant_id !== tenant ||
    p.table !== table ||
    p.id !== id ||
    typeof p.source_available !== "boolean" ||
    !Array.isArray(p.rows) ||
    p.rows.length > 30 ||
    (p.next_cursor !== null && !uuid(p.next_cursor))
  )
    throw Error("Recording list unavailable");
  if (
    p.rows.some(
      (r: any) =>
        !r ||
        !uuid(r.id) ||
        Object.keys(r).sort().join() !==
          ["id", "started_at", "duration_seconds", "audio_stored"].sort().join() ||
        typeof r.audio_stored !== "boolean" ||
        (r.started_at !== null &&
          (typeof r.started_at !== "string" || !Number.isFinite(Date.parse(r.started_at)))) ||
        (r.duration_seconds !== null &&
          (typeof r.duration_seconds !== "number" ||
            !Number.isFinite(r.duration_seconds) ||
            r.duration_seconds < 0)),
    ) ||
    new Set(p.rows.map((r: RetainedRecording) => r.id)).size !== p.rows.length ||
    (!p.source_available && (p.rows.length || p.next_cursor)) ||
    (p.next_cursor !== null && p.next_cursor !== p.rows.at(-1)?.id)
  )
    throw Error("Recording list could not be verified");
  return { rows: p.rows, next_cursor: p.next_cursor, source_available: p.source_available };
}
export async function openRetainedRecording(
  db: PhonePlaybackClient,
  tenant: string,
  recording: string,
  backend: string,
  now = Date.now,
  operator?: PhoneOperatorAccess,
): Promise<{ url: string; expiresAt: string }> {
  if (!uuid(tenant) || !uuid(recording)) throw Error("Recording unavailable");
  operatorArgs(operator);
  const { data: r, error } = await db.functions.invoke(
    operator ? "learn-operator-phone-playback" : "learn-phone-playback",
    {
      body: {
        tenant_id: tenant,
        recording_id: recording,
        ...(operator ? { reason: operator.reason.trim() } : {}),
      },
    },
  );
  if (
    error ||
    (operator && (r?.operator_mode !== true || r?.actor_id !== operator.actor)) ||
    r?.version !== "learn-phone-playback/1" ||
    r.tenant_id !== tenant ||
    r.recording_id !== recording ||
    !uuid(r.request_id) ||
    typeof r.url !== "string" ||
    typeof r.expires_at !== "string"
  )
    throw Error("Recording unavailable");
  const origin = new URL(backend),
    url = new URL(r.url),
    expires = Date.parse(r.expires_at),
    time = now();
  if (
    (origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && origin.hostname === "127.0.0.1")) ||
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.startsWith("/storage/v1/object/sign/phone-recordings/" + tenant + "/") ||
    !url.searchParams.get("token") ||
    [...url.searchParams.keys()].some((k) => k !== "token") ||
    !Number.isFinite(expires) ||
    expires - time < 5000 ||
    expires - time > 60000
  )
    throw Error("Recording link could not be verified");
  return { url: url.href, expiresAt: r.expires_at };
}
