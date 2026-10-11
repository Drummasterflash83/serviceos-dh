import type { LearnCommunicationClient } from "./learn-card-communications.ts";
export type ResultFreshness = "source_matched" | "stale" | "unverified";
export type SavedPhoneResults = {
  source_available: boolean;
  checked_at: string;
  transcript: null | {
    id: string;
    status: string;
    text: string;
    offset: number;
    next_offset: number | null;
    total_characters: number;
    sha256: string;
    freshness: ResultFreshness;
    updated_at: string;
  };
  analysis: null | {
    id: string;
    summary: string;
    summary_truncated: boolean;
    source_transcript_id: string | null;
    freshness: ResultFreshness;
    updated_at: string;
  };
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const freshness = (v: unknown) => ["source_matched", "stale", "unverified"].includes(v as string);
const keys = (v: any, allowed: string) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === allowed.split(",").sort().join(",");
export async function readSavedPhoneResults(
  db: LearnCommunicationClient,
  tenant: string,
  recording: string,
  cursor?: { offset: number; sha256: string },
): Promise<SavedPhoneResults> {
  if (
    !uuid(tenant) ||
    !uuid(recording) ||
    (cursor &&
      (!Number.isSafeInteger(cursor.offset) ||
        cursor.offset <= 0 ||
        cursor.offset > 1048576 ||
        cursor.offset % 12000 !== 0 ||
        !hash(cursor.sha256)))
  )
    throw Error("Invalid saved-result scope");
  const { data, error } = await db.rpc("learn_phone_saved_results_read", {
    p_tenant: tenant,
    p_recording: recording,
    p_offset: cursor?.offset ?? 0,
    p_transcript_sha256: cursor?.sha256 ?? null,
  });
  const p = data as any,
    t = p?.transcript,
    a = p?.analysis;
  if (
    error ||
    !keys(p, "version,tenant_id,recording_id,checked_at,source_available,transcript,analysis") ||
    p.version !== "learn-phone-saved-results/1" ||
    p.tenant_id !== tenant ||
    p.recording_id !== recording ||
    !date(p.checked_at) ||
    typeof p.source_available !== "boolean" ||
    (!p.source_available && (t !== null || a !== null)) ||
    (cursor && p.source_available && t === null) ||
    (t !== null &&
      (!keys(t, "id,status,text,offset,next_offset,total_characters,sha256,freshness,updated_at") ||
        !uuid(t.id) ||
        !["pending", "processing", "completed", "failed"].includes(t.status) ||
        typeof t.text !== "string" ||
        !Number.isSafeInteger(t.total_characters) ||
        t.total_characters < 0 ||
        t.total_characters > 1048576 ||
        t.offset !== (cursor?.offset ?? 0) ||
        (t.offset > 0 && t.offset >= t.total_characters) ||
        !hash(t.sha256) ||
        (cursor && t.sha256 !== cursor.sha256) ||
        !freshness(t.freshness) ||
        !date(t.updated_at) ||
        Array.from(t.text).length !== Math.min(12000, Math.max(0, t.total_characters - t.offset)) ||
        t.next_offset !== (t.offset + 12000 < t.total_characters ? t.offset + 12000 : null) ||
        (t.freshness === "source_matched" && (t.status !== "completed" || !t.total_characters)))) ||
    (a !== null &&
      (!keys(a, "id,summary,summary_truncated,source_transcript_id,freshness,updated_at") ||
        !uuid(a.id) ||
        typeof a.summary !== "string" ||
        Array.from(a.summary).length > 20000 ||
        typeof a.summary_truncated !== "boolean" ||
        (a.summary_truncated && Array.from(a.summary).length !== 20000) ||
        (a.source_transcript_id !== null && !uuid(a.source_transcript_id)) ||
        !freshness(a.freshness) ||
        !date(a.updated_at) ||
        (a.freshness === "source_matched" &&
          (!t || t.freshness !== "source_matched" || a.source_transcript_id !== t.id))))
  )
    throw Error("Saved results are unavailable or changed; refresh the recording");
  return {
    source_available: p.source_available,
    checked_at: p.checked_at,
    transcript: t,
    analysis: a,
  };
}
export const phoneResultFreshnessText: Record<ResultFreshness, string> = {
  source_matched: "Matches the retained source references. Accuracy still needs review.",
  stale: "The retained source has changed. This older result needs review before use.",
  unverified:
    "The link to the current recording has not been verified. Treat this as historical evidence.",
};
