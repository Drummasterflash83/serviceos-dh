// ServiceOS — Evidence Layer V1 · GATE 0: canonical Evidence model (PURE, read-only).
//
// Evidence is a foundational platform primitive, not a feature: the immutable, hashed record of a
// raw source signal, with provenance, timestamps, source metadata, parser/extractor version and
// extraction lineage. Every downstream object (Observation, Recommendation, Learning, Knowledge)
// must ultimately trace to Evidence.
//
// GATE 0 defines the model and PROVES every existing signal can be represented by it WITHOUT LOSS
// and REVERSIBLY. It writes nothing, deploys nothing, touches no pipeline and changes no parser.
// The store, additive parser capture, and adapters come in later gates. Losslessness here is
// guaranteed BY CONSTRUCTION: `raw` is the COMPLETE source row; typed fields are derived projections
// for indexing, never the source of truth. `reconstructSource(evidence)` returns `raw` unchanged.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type EvidenceKind =
  | "email"
  | "email_attachment"
  | "email_ai_insight"
  | "phone_call"
  | "phone_recording"
  | "phone_transcript"
  | "phone_ai_insight"
  | "commusoft_import"
  | "slack_message" // future
  | "calendar_event" // future
  | "file" // future
  | "webhook" // future
  | "api_response"; // future

export interface EvidenceRef {
  kind: string;
  ref: string; // an external/provider id or a source PK — resolves the provenance chain
}

export interface Evidence {
  evidenceKind: EvidenceKind;
  tenantId: string;
  sourceSystem: string; // gmail | sipcentric/simwood | transcription | ai | commusoft | ...
  sourceTable: string; // system-of-record table
  sourceId: string; // PK in sourceTable
  sourceExternalId: string | null; // provider id, when the source carries one
  occurredAt: string | null; // when the real-world event happened
  capturedAt: string | null; // when ServiceOS ingested it
  parserVersion: string | null; // parser/extractor version that produced the stored form (null = not captured yet — a Gate 1 gap)
  extractionHistory: { version: string; at: string | null; note?: string }[];
  derivedFrom: EvidenceRef[]; // upstream evidence this was derived from (transcript←recording←call)
  contentHash: string | null; // sha256 of `canonical` — set by a runtime with crypto (edge/node)
  canonical: string; // deterministic serialization of `raw` (the hash preimage)
  raw: Row; // the COMPLETE source row — nothing dropped (losslessness anchor)
}

// ── Adapter configuration (provider-neutral; extend by adding an entry) ──────
interface AdapterCfg {
  kind: EvidenceKind;
  system: string | ((r: Row) => string); // constant or derived from the row (e.g. r.provider)
  externalIdKey?: string;
  occurredKeys: string[]; // first present, non-null wins
  capturedKeys: string[];
  parserVersionKey?: string;
  derivedFrom?: (r: Row) => EvidenceRef[];
}

export const SOURCE_ADAPTERS: Record<string, AdapterCfg> = {
  email_messages: {
    kind: "email",
    system: (r) => String(r.provider ?? "email"),
    externalIdKey: "provider_message_id",
    occurredKeys: ["received_at", "sent_at"],
    capturedKeys: ["created_at"],
  },
  email_attachments: {
    kind: "email_attachment",
    system: "email",
    externalIdKey: "provider_attachment_id",
    occurredKeys: ["created_at"],
    capturedKeys: ["created_at"],
    derivedFrom: (r) => (r.message_id ? [{ kind: "email", ref: String(r.message_id) }] : []),
  },
  email_ai_insights: {
    kind: "email_ai_insight",
    system: "ai",
    occurredKeys: ["created_at"],
    capturedKeys: ["created_at"],
    derivedFrom: (r) => (r.message_id ? [{ kind: "email", ref: String(r.message_id) }] : []),
  },
  phone_calls: {
    kind: "phone_call",
    system: (r) => String(r.provider ?? "telephony"),
    externalIdKey: "provider_call_id",
    occurredKeys: ["started_at"],
    capturedKeys: ["created_at"],
  },
  phone_recordings: {
    kind: "phone_recording",
    system: (r) => String(r.provider ?? "telephony"),
    externalIdKey: "provider_recording_id",
    occurredKeys: ["started_at", "created_at"],
    capturedKeys: ["created_at"],
    derivedFrom: (r) =>
      r.provider_call_id || r.linked_id
        ? [{ kind: "phone_call", ref: String(r.provider_call_id ?? r.linked_id) }]
        : [],
  },
  phone_transcripts: {
    kind: "phone_transcript",
    system: "transcription",
    occurredKeys: ["created_at"],
    capturedKeys: ["created_at"],
    parserVersionKey: "model", // the transcription model IS its extractor version
    derivedFrom: (r) =>
      r.recording_id ? [{ kind: "phone_recording", ref: String(r.recording_id) }] : [],
  },
  phone_ai_insights: {
    kind: "phone_ai_insight",
    system: "ai",
    occurredKeys: ["created_at"],
    capturedKeys: ["created_at"],
    derivedFrom: (r) => {
      const out: EvidenceRef[] = [];
      if (r.transcript_id) out.push({ kind: "phone_transcript", ref: String(r.transcript_id) });
      if (r.recording_id) out.push({ kind: "phone_recording", ref: String(r.recording_id) });
      if (r.call_id) out.push({ kind: "phone_call", ref: String(r.call_id) });
      return out;
    },
  },
  data_imports: {
    kind: "commusoft_import",
    system: "commusoft",
    externalIdKey: "external_ref",
    occurredKeys: ["created_at"],
    capturedKeys: ["created_at"],
  },
};

export function adapterForTable(sourceTable: string): AdapterCfg | null {
  return SOURCE_ADAPTERS[sourceTable] ?? null;
}

const firstPresent = (r: Row, keys: string[]): string | null => {
  for (const k of keys) if (r[k] != null && r[k] !== "") return String(r[k]);
  return null;
};

/** Represent a source row as Evidence. LOSSLESS: `raw` is the complete row; typed fields are
 * derived projections. Throws only for an unknown source table (a coverage gap to surface). */
export function toEvidence(sourceTable: string, row: Row): Evidence {
  const cfg = adapterForTable(sourceTable);
  if (!cfg) throw new Error(`no Evidence adapter for source table '${sourceTable}'`);
  const raw: Row = { ...row };
  return {
    evidenceKind: cfg.kind,
    tenantId: String(row.tenant_id ?? ""),
    sourceSystem: typeof cfg.system === "function" ? cfg.system(row) : cfg.system,
    sourceTable,
    sourceId: String(row.id ?? ""),
    sourceExternalId: cfg.externalIdKey ? (row[cfg.externalIdKey] ?? null) : null,
    occurredAt: firstPresent(row, cfg.occurredKeys),
    capturedAt: firstPresent(row, cfg.capturedKeys),
    parserVersion: cfg.parserVersionKey ? (row[cfg.parserVersionKey] ?? null) : null,
    extractionHistory: [],
    derivedFrom: cfg.derivedFrom ? cfg.derivedFrom(row) : [],
    contentHash: null,
    canonical: canonicalize(raw),
    raw,
  };
}

/** Deterministic serialization (sorted keys, stable across key order) — the content-hash preimage. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Row;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

/** Prove no loss: every key/value in the source row is present in `evidence.raw`. */
export function verifyLossless(
  row: Row,
  evidence: Evidence,
): { lossless: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const k of Object.keys(row)) if (!deepEqual(row[k], evidence.raw[k])) missing.push(k);
  return { lossless: missing.length === 0, missing };
}

/** Reverse the representation: reconstruct the original source row from Evidence. */
export function reconstructSource(evidence: Evidence): Row {
  return { ...evidence.raw };
}
