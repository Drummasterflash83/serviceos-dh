/** Governed file imports. CSV contents stay in memory; no automatic write retries. */
export type ImportClient = {
  functions: {
    invoke: (
      name: string,
      args: { body: Record<string, unknown> },
    ) => PromiseLike<{ data: any; error: unknown }>;
  };
};
export type ImportEntity = "customers" | "sites" | "jobs";
export type GovernedProfile = {
  id: string;
  tenant_id: string | null;
  name: string;
  source_system: string;
  entity_type: ImportEntity;
  version: number;
  definition: { governed: true; columns: { canonical: string }[] };
};
export type GovernedPreview = {
  headers: string[];
  mapping: Record<string, number>;
  unmapped: string[];
  missing_required: string[];
  row_count: number;
  valid: number;
  invalid: number;
  will_create: number;
  will_update: number;
  will_conflict: number;
  will_hold: number;
  duplicate_upload: boolean;
  profile: { id: string; name: string; version: number };
  sealed: {
    profile: GovernedProfile;
    mapping: Record<string, number>;
    provenance_source: string;
    import_options: { source: string };
  };
};
export type GovernedRun = {
  id: string;
  source_system: string;
  entity_type: ImportEntity;
  original_filename: string | null;
  status: string;
  row_count: number;
  valid_rows: number;
  invalid_rows: number;
  created_records: number;
  updated_records: number;
  skipped_records: number;
  conflict_records: number;
  created_at: string;
  completed_at: string | null;
};
export type GovernedSavedRun = GovernedRun & {
  tenant_id: string;
  file_checksum: string;
  profile_id: string;
  preview: GovernedPreview;
};
export type GovernedOutcome = {
  row_number: number;
  outcome: string;
  reason: string | null;
  fields: string[];
  attempt: number;
  created_at: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const entities = ["customers", "sites", "jobs"],
  statuses = ["previewed", "importing", "completed", "failed", "needs_review"];
export const IMPORT_REQUEST_LIMIT = 16 * 1024 * 1024;
export async function importFileHash(csv: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(csv))),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function validGovernedProfile(p: any, tenant: string): p is GovernedProfile {
  return (
    !!p &&
    uuid(p.id) &&
    (p.tenant_id === null || p.tenant_id === tenant) &&
    entities.includes(p.entity_type) &&
    typeof p.source_system === "string" &&
    p.source_system.length > 0 &&
    typeof p.name === "string" &&
    count(p.version) &&
    p.version > 0 &&
    p.definition?.governed === true &&
    Array.isArray(p.definition.columns) &&
    p.definition.columns.length > 0 &&
    p.definition.columns.every((c: any) => typeof c.canonical === "string")
  );
}
function validRun(r: any): boolean {
  return (
    !!r &&
    uuid(r.id) &&
    entities.includes(r.entity_type) &&
    typeof r.source_system === "string" &&
    (r.original_filename === null || typeof r.original_filename === "string") &&
    statuses.includes(r.status) &&
    [
      "row_count",
      "valid_rows",
      "invalid_rows",
      "created_records",
      "updated_records",
      "skipped_records",
      "conflict_records",
    ].every((k) => count(r[k])) &&
    date(r.created_at) &&
    (r.completed_at === null || date(r.completed_at))
  );
}
export function validGovernedPreview(p: any, tenant: string): p is GovernedPreview {
  if (
    !p ||
    !strings(p.headers) ||
    !strings(p.unmapped) ||
    !strings(p.missing_required) ||
    ![
      "row_count",
      "valid",
      "invalid",
      "will_create",
      "will_update",
      "will_conflict",
      "will_hold",
    ].every((k) => count(p[k])) ||
    p.row_count > 5000 ||
    p.valid + p.invalid !== p.row_count ||
    p.will_create + p.will_update + p.will_conflict + p.will_hold !== p.valid ||
    typeof p.duplicate_upload !== "boolean" ||
    !validGovernedProfile(p.sealed?.profile, tenant)
  )
    return false;
  const profile = p.sealed.profile;
  return (
    p.profile?.id === profile.id &&
    p.profile.version === profile.version &&
    p.profile.name === profile.name &&
    p.sealed.provenance_source === profile.source_system &&
    p.sealed.import_options?.source === profile.source_system &&
    p.mapping !== null &&
    typeof p.mapping === "object" &&
    !Array.isArray(p.mapping) &&
    Object.entries(p.mapping).every(
      ([k, v]) =>
        profile.definition.columns.some((c: any) => c.canonical === k) &&
        count(v) &&
        v < p.headers.length,
    ) &&
    JSON.stringify(p.mapping) === JSON.stringify(p.sealed.mapping)
  );
}
async function call(db: ImportClient, tenant: string, body: Record<string, unknown>) {
  if (!uuid(tenant)) throw Error("Choose a company before importing.");
  const request = { ...body, tenant_id: tenant };
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > IMPORT_REQUEST_LIMIT)
    throw Error(
      "This request exceeds the 16 MiB limit. Split the source file and preview each part.",
    );
  let result;
  try {
    result = await db.functions.invoke("learn-data-import", { body: request });
  } catch {
    throw Error("Import response unavailable. Reload saved imports before trying again.");
  }
  if (result.error || result.data?.success !== true)
    throw Error(
      "Import request was not confirmed. Check company access and reload saved imports before trying again.",
    );
  return result.data;
}
export async function loadGovernedProfiles(db: ImportClient, tenant: string) {
  const d = await call(db, tenant, { action: "profiles" });
  if (
    !Array.isArray(d.profiles) ||
    d.profiles.some((p: any) => !validGovernedProfile(p, tenant)) ||
    new Set(d.profiles.map((p: any) => p.id)).size !== d.profiles.length
  )
    throw Error("Import profiles could not be verified.");
  return d.profiles as GovernedProfile[];
}
export async function loadGovernedImports(db: ImportClient, tenant: string) {
  const d = await call(db, tenant, { action: "imports", limit: 25 });
  if (
    !Array.isArray(d.imports) ||
    d.imports.length > 25 ||
    !d.imports.every(validRun) ||
    new Set(d.imports.map((r: any) => r.id)).size !== d.imports.length
  )
    throw Error("Saved imports could not be verified.");
  return d.imports as GovernedRun[];
}
export async function loadGovernedImport(db: ImportClient, tenant: string, id: string) {
  if (!uuid(id)) throw Error("Choose a saved import.");
  const d = await call(db, tenant, { action: "status", import_id: id }),
    r = d.import;
  if (
    !validRun(r) ||
    r.id !== id ||
    r.tenant_id !== tenant ||
    !validGovernedPreview(r.preview, tenant) ||
    r.profile_id !== r.preview.sealed.profile.id ||
    r.entity_type !== r.preview.sealed.profile.entity_type ||
    r.source_system !== r.preview.sealed.profile.source_system ||
    r.row_count !== r.preview.row_count ||
    !/^[a-f0-9]{64}$/.test(r.file_checksum)
  )
    throw Error("Saved import evidence could not be verified.");
  return r as GovernedSavedRun;
}
export async function previewGovernedImport(
  db: ImportClient,
  tenant: string,
  p: GovernedProfile,
  csv: string,
  filename: string,
) {
  if (!validGovernedProfile(p, tenant) || !csv)
    throw Error("Choose a prepared CSV and its import profile.");
  const d = await call(db, tenant, {
    action: "preview",
    entity_type: p.entity_type,
    source_system: p.source_system,
    profile_id: p.id,
    csv_text: csv,
    filename,
  });
  if (
    !uuid(d.import_id) ||
    !validGovernedPreview(d.preview, tenant) ||
    d.preview.sealed.profile.id !== p.id
  )
    throw Error("Preview response could not be verified. Reload saved imports.");
  const saved = await loadGovernedImport(db, tenant, d.import_id);
  if (saved.file_checksum !== (await importFileHash(csv)) || saved.profile_id !== p.id)
    throw Error("Saved preview differs from this file. Reload saved imports.");
  return saved;
}
export async function applyGovernedImport(
  db: ImportClient,
  tenant: string,
  r: GovernedSavedRun,
  csv: string,
) {
  if (
    r.tenant_id !== tenant ||
    !uuid(r.id) ||
    !validGovernedPreview(r.preview, tenant) ||
    r.file_checksum !== (await importFileHash(csv))
  )
    throw Error(
      "Select the exact file used for this saved preview. Changed files need a new preview.",
    );
  if (!["previewed", "importing", "failed", "needs_review"].includes(r.status))
    throw Error("This saved import cannot be applied again. Reload its results.");
  // Read a fresh saved contract first. The server checks authority/checksum and
  // row guards again; UI state alone never authorizes a write.
  const current = await loadGovernedImport(db, tenant, r.id);
  if (
    current.file_checksum !== r.file_checksum ||
    current.profile_id !== r.profile_id ||
    !["previewed", "importing", "failed", "needs_review"].includes(current.status)
  )
    throw Error("The saved import changed. Reload before continuing.");
  await call(db, tenant, { action: "apply", import_id: r.id, csv_text: csv });
  return loadGovernedImport(db, tenant, r.id);
}
export const IMPORT_OUTCOME_PAGE_SIZE = 100;
export async function loadGovernedOutcomes(
  db: ImportClient,
  tenant: string,
  id: string,
  afterRow = 1,
) {
  if (!uuid(id)) throw Error("Choose a saved import.");
  if (!Number.isSafeInteger(afterRow) || afterRow < 1 || afterRow > 5001)
    throw Error("Invalid row page.");
  const d = await call(db, tenant, {
    action: "row_results",
    import_id: id,
    after_row: afterRow,
    page_size: IMPORT_OUTCOME_PAGE_SIZE,
  });
  if (
    d.tenant_id !== tenant ||
    d.import_id !== id ||
    d.after_row !== afterRow ||
    d.page_size !== IMPORT_OUTCOME_PAGE_SIZE ||
    !Array.isArray(d.rows) ||
    d.rows.length > IMPORT_OUTCOME_PAGE_SIZE ||
    typeof d.truncated !== "boolean"
  )
    throw Error("Row results could not be verified.");
  let previous = afterRow;
  for (const r of d.rows) {
    if (
      !count(r.row_number) ||
      r.row_number <= previous ||
      r.row_number > 5001 ||
      ![
        "created",
        "linked",
        "updated",
        "conflict",
        "held",
        "invalid",
        "skipped",
        "failed",
      ].includes(r.outcome) ||
      (r.reason !== null && typeof r.reason !== "string") ||
      !strings(r.fields) ||
      !count(r.attempt) ||
      r.attempt < 1 ||
      !date(r.created_at)
    )
      throw Error("Row results could not be verified.");
    previous = r.row_number;
  }
  if (
    d.truncated
      ? d.rows.length !== IMPORT_OUTCOME_PAGE_SIZE || d.next_after_row !== previous
      : d.next_after_row !== null
  )
    throw Error("Row page continuation could not be verified.");
  return d as { rows: GovernedOutcome[]; truncated: boolean; next_after_row: number | null };
}
export function importProgress(r: GovernedRun) {
  if (r.status === "completed")
    return r.invalid_rows > 0 ? `Finished with ${r.invalid_rows} invalid rows` : "Finished";
  return (
    {
      previewed: "Preview saved — awaiting review",
      importing: "Partly processed — reload results",
      needs_review: "Needs review — inspect row outcomes",
      failed: "Stopped — inspect row outcomes",
    }[r.status] ?? "Unavailable"
  );
}
