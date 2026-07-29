/**
 * Contact imports client — the existing universal preview-first `data-import`
 * Edge Function driven for entity_type='contacts'. Preview never writes;
 * apply uses the sealed preview contract (checksum + stored contact options).
 */
import { callMarketingFn } from "./call";

export interface ImportProfileRow {
  id: string;
  tenant_id: string | null;
  source_system: string;
  entity_type: string;
  name: string;
  version: number;
}

export interface ImportPreview {
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
  duplicate_upload: boolean;
  sample: {
    row: number;
    action: string;
    strategy: string;
    confidence: number;
    preview: Record<string, unknown>;
  }[];
  /** The RESOLVED import profile the preview sealed (id + version shown to the
   *  reviewer; the immutable definition snapshot lives in the sealed contract). */
  profile: {
    id: string;
    name: string;
    version: number;
    source_system: string;
    tenant_owned: boolean;
    /** Canonical fields the profile can map — drives the mapping review. */
    fields: string[];
  };
  /** The SEALED options under review — including the EXPLICIT resolved
   *  lifecycle/relationship defaults (never a live-settings fallback). */
  contact_options?: {
    source: string;
    tag_id?: string | null;
    lifecycle_stage_key?: string;
    relationship_type?: string;
  };
}

export interface ImportRowResult {
  row_number: number;
  outcome: "created" | "updated" | "conflict" | "invalid" | "failed";
  reason: string | null;
  fields: string[];
  attempt: number;
  created_at: string;
}

export interface ImportRun {
  id: string;
  source_system: string;
  entity_type: string;
  original_filename: string | null;
  status: string;
  row_count: number;
  valid_rows: number;
  invalid_rows: number;
  created_records: number;
  updated_records: number;
  skipped_records: number;
  duplicate_records: number;
  conflict_records: number;
  failure: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ContactImportOptions {
  source: string;
  tag_id?: string | null;
  lifecycle_stage_key?: string | null;
  relationship_type?: string | null;
}

export const listImportProfiles = () =>
  callMarketingFn<{ success: boolean; profiles: ImportProfileRow[] }>("data-import", {
    action: "profiles",
    entity_type: "contacts",
  });

export const previewContactImport = (args: {
  csv_text: string;
  filename: string;
  /** Explicit profile choice — must be active and match source/entity; when
   *  several eligible profiles exist the server REQUIRES this
   *  (profile_selection_required). */
  profile_id?: string;
  /** Sent alongside an explicit profile so the request matches the profile's
   *  own source system (auto-resolution stays on 'generic'). */
  source_system?: string;
  contact_options: ContactImportOptions;
  /** Reviewed mapping overrides (canonical field → header index, null unmaps).
   *  Validated and SEALED server-side; changing the mapping requires a new
   *  preview — apply always uses the sealed contract. */
  mapping_overrides?: Record<string, number | null>;
}) =>
  callMarketingFn<{ success: boolean; import_id: string; preview: ImportPreview }>("data-import", {
    action: "preview",
    entity_type: "contacts",
    source_system: "generic",
    ...args,
  });

export const applyContactImport = (importId: string, csvText: string) =>
  callMarketingFn<{
    success: boolean;
    import: ImportRun;
    /** CUMULATIVE durable totals (survive partial retries). */
    created: number;
    updated: number;
    skipped: number;
    conflicts: number;
    invalid: number;
    failed: number;
    this_run: {
      created: number;
      updated: number;
      conflicts: number;
      invalid: number;
      failed: number;
      already: number;
    };
    failures: { row: number; reason: string }[];
  }>("data-import", { action: "apply", import_id: importId, csv_text: csvText });

export const listImports = () =>
  callMarketingFn<{ success: boolean; imports: ImportRun[] }>("data-import", {
    action: "imports",
    limit: 25,
  });

/** Bounded reviewed/invalid/failed row outcomes — row number, outcome, reason
 *  and FIELD NAMES only (no raw imported values, no foreign-tenant evidence). */
export const listImportRowResults = (importId: string, outcomes?: string[]) =>
  callMarketingFn<{ success: boolean; rows: ImportRowResult[]; truncated: boolean }>(
    "data-import",
    { action: "row_results", import_id: importId, ...(outcomes ? { outcomes } : {}) },
  );
