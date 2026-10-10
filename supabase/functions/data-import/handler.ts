// ServiceOS — Edge Function: data-import (universal, source-neutral, preview-first).
//
// Actions (owner/admin write; owner/admin/ops read):
//   profiles         — list import profiles for a source_system/entity_type
//   preview          — parse CSV, map via profile, validate, MATCH (dry-run) → counts + sample.
//                      Persists a data_imports row (status 'previewed') + checksum. No canonical writes.
//   apply            — create/update canonical entities (people/companies/jobs) + provenance,
//                      idempotently, from a previewed import. Never overwrites verified canonical data.
//   status | imports — read an import / list recent imports.
//
// Preview-first by design: uploading never imports. Tenant-scoped; every row keeps provenance.

import { parse as parseCsv } from "jsr:@std/csv@1/parse";
import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { requireTenantUser, assertSameTenant } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  resolveColumnMapping,
  mapRow,
  chooseImportProfile,
  type ImportProfileDef,
  type ImportProfileRowMeta,
} from "../_shared/imports/profile.ts";
import { maskSampleRecord } from "../_shared/imports/redact.ts";
import {
  decideMatch,
  writableFields,
  CUSTOMER_MATCH_PRIORITY,
  JOB_MATCH_PRIORITY,
  STAFF_MATCH_PRIORITY,
  type StrategyHit,
} from "../_shared/imports/matching.ts";
import { normalizeJobNumber } from "../_shared/imports/job_number.ts";
import { IMPORT_BATCH_SIZE, checkedImportBatch, type ImportBatchRow, type ImportBatchResult } from "../_shared/imports/batches.ts";
import { classifyRowApplyFailure } from "../_shared/imports/row_failure.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "content-type": "application/json" },
  });
const fail = (code: string, message: string, s: number) =>
  json({ success: false, error: { code, message } }, s);

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// Known import entities: unknown entity strings are rejected, never routed to
// a default apply path (an unrecognised entity must not fall through to the
// person importer).
const KNOWN_ENTITIES = ["contacts", "customers", "sites", "jobs", "staff", "assets"];
// Entities the GOVERNED engine (sealed contract + durable row ledger + per-row
// RPCs) supports. A profile opts in with `definition.governed === true`;
// legacy profiles and their behaviour are untouched.
const GOVERNED_ENTITIES = ["customers", "sites", "jobs"];
const GOVERNED_ROW_RPC: Record<string, string> = {
  customers: "import_customer_row",
  sites: "import_site_row",
  jobs: "import_job_row",
};
const GOVERNED_MATCH_RPC: Record<string, string> = {
  customers: "import_match_customer",
  sites: "import_match_site",
  jobs: "import_match_job",
};
const isGovernedDef = (def: unknown): boolean =>
  isPlainObject(def) && (def as { governed?: unknown }).governed === true;

// Per-action top-level key allowlists: unknown keys are rejected, never ignored.
const ACTION_KEYS: Record<string, string[]> = {
  profiles: ["action", "tenant_id", "source_system", "entity_type"],
  imports: ["action", "tenant_id", "limit"],
  status: ["action", "tenant_id", "import_id"],
  row_results: ["action", "tenant_id", "import_id", "outcomes", "after_row", "page_size"],
  preview: [
    "action",
    "tenant_id",
    "source_system",
    "entity_type",
    "csv_text",
    "filename",
    "profile_id",
    "contact_options",
    "mapping_overrides",
  ],
  apply: ["action", "tenant_id", "import_id", "csv_text"],
};

export async function handleDataImport(
  req: Request,
  options: { governedOnly?: boolean; batched?: boolean; paginatedOutcomes?: boolean } = {},
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);
  const db = createSupabaseAdmin();
  if (!db) return fail("config_error", "Service role not configured", 500);

  let body: Record<string, unknown> = {};
  try {
    const parsed = (await req.json()) as unknown;
    if (!isPlainObject(parsed)) {
      return fail("invalid_json", "Body must be a JSON object", 400);
    }
    body = parsed;
  } catch {
    return fail("invalid_json", "Body must be JSON", 400);
  }
  if (body.action !== undefined && typeof body.action !== "string") {
    return fail("invalid_request", "action must be a string", 400);
  }
  const action = (body.action as string | undefined) ?? "profiles";
  const allowedKeys = ACTION_KEYS[action];
  if (!allowedKeys) return fail("unknown_action", `Unknown action '${action}'`, 400);
  for (const k of Object.keys(body)) {
    if (!allowedKeys.includes(k)) {
      return fail("invalid_request", `unknown key '${k}' for action '${action}'`, 400);
    }
  }
  const readOnly = action === "profiles" || action === "status" || action === "imports";
  // Writes: ops is allowed through the outer gate so CONTACTS imports can be
  // authorised by the canonical Marketing resolver (marketing.contacts.import);
  // every non-contacts write entity still requires owner/admin below —
  // pre-existing importer authorisation behaviour is preserved exactly.
  const auth = await requireTenantUser(
    req,
    db,
    (readOnly ? ["owner", "admin", "ops"] : ["owner", "admin", "ops"]) as never,
  );
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const actorId = auth.ctx.userId === "service" ? null : auth.ctx.userId;

  if (options.governedOnly) {
    // LEARN approvals belong to a signed-in person, never an internal service
    // identity. The original endpoint retains its separate legacy contract.
    if (!actorId) return fail("forbidden", "A signed-in company user is required", 403);
    const company = await db.from("tenants").select("status").eq("id", tenantId).maybeSingle();
    if (company.error) return fail("unavailable", "Could not verify company access", 503);
    if (company.data?.status !== "active") return fail("forbidden", "Company access is unavailable", 403);
    if (action === "preview" || action === "apply") {
      const previewContext = await db.from("view_as_context").select("id")
        .eq("actor_user_id", actorId).is("ended_at", null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).limit(1).maybeSingle();
      if (previewContext.error) return fail("unavailable", "Could not verify import authority", 503);
      if (previewContext.data) return fail("preview_read_only", "Exit View As before importing", 403);
    }
    if ((action === "preview" || action === "profiles") && body.entity_type !== undefined &&
        !GOVERNED_ENTITIES.includes(String(body.entity_type)))
      return fail("unsupported_entity", "LEARN imports support customers, sites and jobs", 400);
    if (action === "preview" && !isUuid(body.profile_id))
      return fail("profile_selection_required", "Choose a governed import profile", 400);
  }

  /** Per-entity write authority: contacts → effective marketing.contacts.import
   *  via the canonical resolver; everything else → owner/admin role (unchanged). */
  async function entityWriteDenied(entity: string): Promise<Response | null> {
    if (readOnly) return null;
    if (entity === "contacts") {
      const r = await db!.rpc("marketing_effective_permissions", {
        p_profile_id: actorId,
      });
      const perms: string[] = Array.isArray(r.data?.permissions) ? r.data.permissions : [];
      if (r.error || r.data?.enabled !== true || !perms.includes("marketing.contacts.import")) {
        return fail("forbidden", "Contact imports require marketing.contacts.import", 403);
      }
      return null;
    }
    if (auth.ok && !["owner", "admin"].includes(auth.ctx.role)) {
      return fail("forbidden", "Imports for this entity require owner/admin", 403);
    }
    return null;
  }

  // ── profiles ────────────────────────────────────────────────────────────────
  if (action === "profiles") {
    if (body.source_system !== undefined && typeof body.source_system !== "string")
      return fail("invalid_request", "source_system must be a string", 400);
    if (body.entity_type !== undefined && typeof body.entity_type !== "string")
      return fail("invalid_request", "entity_type must be a string", 400);
    const source = body.source_system ? String(body.source_system) : null;
    const entity = body.entity_type ? String(body.entity_type) : null;
    let q = db
      .from("import_profiles")
      .select("id,tenant_id,source_system,entity_type,name,definition,active,version")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq("active", true);
    if (source) q = q.eq("source_system", source);
    if (entity) q = q.eq("entity_type", entity);
    if (options.governedOnly) q = q.in("entity_type", GOVERNED_ENTITIES).eq("definition->>governed", "true");
    const { data, error } = await q;
    if (error) return fail("unavailable", "Could not load import profiles", 503);
    return json({ success: true, profiles: data ?? [] });
  }

  if (action === "imports") {
    if (
      body.limit !== undefined &&
      (typeof body.limit !== "number" || !Number.isInteger(body.limit))
    )
      return fail("invalid_request", "limit must be an integer", 400);
    const limit = Math.min(Math.max(Number(body.limit ?? 25), 1), 100);
    let q = db
      .from("data_imports")
      .select(
        "id,source_system,entity_type,original_filename,status,row_count,valid_rows,invalid_rows,created_records,updated_records,skipped_records,duplicate_records,conflict_records,failure,created_at,completed_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (options.governedOnly) q = q.in("entity_type", GOVERNED_ENTITIES).eq("preview->sealed->profile->definition->>governed", "true");
    const { data, error } = await q;
    if (error) return fail("unavailable", "Could not load imports", 503);
    return json({ success: true, imports: data ?? [] });
  }

  if (action === "status") {
    if (!isUuid(body.import_id)) return fail("invalid_request", "import_id required", 400);
    const id = String(body.import_id ?? "");
    const { data: imp, error: importError } = await db
      .from("data_imports")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (importError) return fail("unavailable", "Could not load import", 503);
    if (!imp || (options.governedOnly && (!GOVERNED_ENTITIES.includes(imp.entity_type) ||
        !isGovernedDef(imp.preview?.sealed?.profile?.definition))))
      return fail("not_found", "Import not found", 404);
    const { data: prov, error: provenanceError } = await db
      .from("import_row_provenance")
      .select("entity_table,action,match_strategy,confidence,source_row_number,conflicts")
      .eq("tenant_id", tenantId)
      .eq("import_id", id)
      .limit(500);
    if (provenanceError) return fail("unavailable", "Could not load import provenance", 503);
    return json({ success: true, import: imp, provenance: prov ?? [] });
  }

  type ProfileRow = ImportProfileRowMeta;
  const PROFILE_COLS = "id,tenant_id,source_system,entity_type,name,version,active,definition";

  // Resolve the ACTUAL import-profile row (id + version + definition +
  // ownership) — never just a definition. Explicit ids are TENANT-CHECKED
  // (platform null-tenant or own-tenant only).
  async function loadProfileRow(
    profileId: string | null,
    source: string,
    entity: string,
  ): Promise<ProfileRow | null> {
    if (profileId) {
      const { data } = await db!
        .from("import_profiles")
        .select(PROFILE_COLS)
        .eq("id", profileId)
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
        .maybeSingle();
      return (data as ProfileRow | null) ?? null;
    }
    const { data } = await db!
      .from("import_profiles")
      .select(PROFILE_COLS)
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq("source_system", source)
      .eq("entity_type", entity)
      .eq("active", true)
      .order("tenant_id", { ascending: false, nullsFirst: false })
      .limit(10);
    // automatic resolution NEVER picks a governed profile — governed imports
    // require an explicit profile selection, so seeding a governed profile can
    // never change what a legacy no-profile-id import resolves to
    const eligible = ((data ?? []) as ProfileRow[]).filter((p) => !isGovernedDef(p.definition));
    return eligible[0] ?? null;
  }
  // Back-compat shim for the UNCHANGED non-contacts paths.
  async function loadProfileDef(
    profileId: string | null,
    source: string,
    entity: string,
  ): Promise<ImportProfileDef | null> {
    return (await loadProfileRow(profileId, source, entity))?.definition ?? null;
  }

  // ── preview (dry-run) ─────────────────────────────────────────────────────────
  if (action === "preview") {
    if (body.source_system !== undefined && typeof body.source_system !== "string")
      return fail("invalid_request", "source_system must be a string", 400);
    if (body.entity_type !== undefined && typeof body.entity_type !== "string")
      return fail("invalid_request", "entity_type must be a string", 400);
    if (body.filename !== undefined && typeof body.filename !== "string")
      return fail("invalid_request", "filename must be a string", 400);
    const source = String(body.source_system ?? "commusoft");
    const entity = String(body.entity_type ?? "customers");
    if (!KNOWN_ENTITIES.includes(entity))
      return fail("unknown_entity", `Unknown import entity '${entity}'`, 400);
    const denied = await entityWriteDenied(entity);
    if (denied) return denied;
    if (body.csv_text !== undefined && typeof body.csv_text !== "string")
      return fail("invalid_request", "csv_text must be a string", 400);
    const csvText = String(body.csv_text ?? "");
    if (!csvText) return fail("no_file", "csv_text is required", 400);

    // Contact imports SEAL their options at preview time: the exact source,
    // tag and defaults previewed are the ONLY inputs apply may use.
    let contactOptions: Record<string, unknown> | null = null;
    if (entity === "contacts") {
      const o = (body.contact_options ?? {}) as Record<string, unknown>;
      if (!isPlainObject(o))
        return fail("invalid_options", "contact_options must be an object", 400);
      for (const k of Object.keys(o)) {
        if (!["source", "tag_id", "lifecycle_stage_key", "relationship_type"].includes(k))
          return fail("invalid_options", `unknown contact_options key '${k}'`, 400);
      }
      if (typeof o.source !== "string")
        return fail("invalid_options", "contact_options.source must be a string", 400);
      const src = o.source.trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,40}$/.test(src))
        return fail("invalid_options", "contact_options.source must be a short slug", 400);
      contactOptions = { source: src };
      if (o.tag_id !== undefined && o.tag_id !== null) {
        if (!isUuid(o.tag_id)) return fail("invalid_options", "invalid import tag", 400);
        // the sealed import tag must be ACTIVE: sealing a deactivated tag
        // would silently resurrect retired vocabulary at apply time
        const t = await db
          .from("marketing_tags")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("id", o.tag_id)
          .eq("active", true)
          .maybeSingle();
        if (!t.data) return fail("invalid_options", "unknown or inactive import tag", 400);
        contactOptions.tag_id = t.data.id;
      }
      if (o.lifecycle_stage_key !== undefined && o.lifecycle_stage_key !== null) {
        if (typeof o.lifecycle_stage_key !== "string")
          return fail("invalid_options", "lifecycle_stage_key must be a string", 400);
        const s = await db
          .from("marketing_lifecycle_stages")
          .select("stage_key")
          .eq("tenant_id", tenantId)
          .eq("stage_key", o.lifecycle_stage_key)
          .eq("active", true)
          .maybeSingle();
        if (!s.data)
          return fail("invalid_options", "default lifecycle must be an active tenant stage", 400);
        contactOptions.lifecycle_stage_key = s.data.stage_key;
      }
      if (o.relationship_type !== undefined && o.relationship_type !== null) {
        if (typeof o.relationship_type !== "string")
          return fail("invalid_options", "relationship_type must be a string", 400);
        const rt = String(o.relationship_type);
        if (
          ![
            "lead",
            "prospect",
            "customer",
            "former_customer",
            "supplier",
            "partner",
            "commercial",
            "other",
          ].includes(rt)
        )
          return fail("invalid_options", "invalid default relationship type", 400);
        contactOptions.relationship_type = rt;
      }
      // SEAL THE ACTUAL DEFAULTS: when the operator left "Default" selected,
      // resolve the EFFECTIVE lifecycle stage and relationship type from
      // tenant settings NOW and seal them explicitly — apply and the row RPC
      // use only the sealed values, so changing tenant defaults after preview
      // can never alter what apply does.
      if (!contactOptions.lifecycle_stage_key || !contactOptions.relationship_type) {
        const st = await db
          .from("marketing_settings")
          .select("default_lifecycle_stage_key,default_relationship_type")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (!st.data)
          return fail(
            "not_initialised",
            "Marketing defaults are not initialised for this tenant — open Marketing once as an owner/admin first",
            400,
          );
        if (!contactOptions.lifecycle_stage_key) {
          const stage = await db
            .from("marketing_lifecycle_stages")
            .select("stage_key")
            .eq("tenant_id", tenantId)
            .eq("stage_key", st.data.default_lifecycle_stage_key)
            .eq("active", true)
            .maybeSingle();
          if (!stage.data)
            return fail(
              "invalid_options",
              "The tenant default lifecycle stage is not an active stage — fix Marketing settings first",
              400,
            );
          contactOptions.lifecycle_stage_key = stage.data.stage_key;
        }
        if (!contactOptions.relationship_type)
          contactOptions.relationship_type = st.data.default_relationship_type;
      }
    }

    if (body.profile_id !== undefined && !isUuid(body.profile_id))
      return fail("invalid_request", "invalid profile_id", 400);
    let profile: ProfileRow | null = null;
    if (entity === "contacts") {
      // DETERMINISTIC profile choice (pure chooseImportProfile): an explicit
      // id must be active and match the requested source/entity; automatic
      // resolution happens only when unambiguous (one tenant profile wins over
      // the platform fallback); several eligible candidates require an
      // EXPLICIT selection — never an under-specified limit(1).
      const requestedSource = String(body.source_system ?? "generic");
      const explicitId = body.profile_id ? String(body.profile_id) : null;
      let candidates: ProfileRow[] = [];
      if (explicitId) {
        const { data } = await db
          .from("import_profiles")
          .select(PROFILE_COLS)
          .eq("id", explicitId)
          .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
        candidates = (data ?? []) as ProfileRow[];
      } else {
        const { data } = await db
          .from("import_profiles")
          .select(PROFILE_COLS)
          .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
          .eq("entity_type", entity)
          .eq("source_system", requestedSource)
          .eq("active", true)
          .limit(50);
        candidates = (data ?? []) as ProfileRow[];
      }
      const choice = chooseImportProfile(candidates, {
        source: requestedSource,
        entity,
        explicitId,
      });
      if (choice.kind === "mismatch")
        return fail(
          "profile_mismatch",
          `The selected profile cannot serve this import: ${choice.reason}`,
          400,
        );
      if (choice.kind === "ambiguous")
        return json(
          {
            success: false,
            error: {
              code: "profile_selection_required",
              message: "Several eligible import profiles exist — choose one explicitly",
            },
            eligible_profiles: choice.eligible.map((p) => ({
              id: p.id,
              name: p.name,
              version: p.version,
              source_system: p.source_system,
              tenant_owned: p.tenant_id !== null,
            })),
          },
          409,
        );
      if (choice.kind === "none")
        return fail("no_profile", `No import profile for ${requestedSource}/${entity}`, 400);
      profile = choice.profile;
    } else if (body.profile_id) {
      // explicit selection: tenant-checked load (governed or legacy)
      const { data, error: profileError } = await db
        .from("import_profiles")
        .select(PROFILE_COLS)
        .eq("id", String(body.profile_id))
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
        .maybeSingle();
      if (profileError) return fail("unavailable", "Could not load the selected profile", 503);
      profile = (data as ProfileRow | null) ?? null;
      if (!profile || !profile.active)
        return fail("no_profile", `No import profile for ${source}/${entity}`, 400);
      if (profile.source_system !== source || profile.entity_type !== entity)
        return fail(
          "profile_mismatch",
          "The selected profile does not serve this source/entity",
          400,
        );
    } else {
      // sites have NO legacy path and governed profiles require explicit
      // selection — auto-resolution can never serve a sites import
      if (entity === "sites")
        return fail("unsupported_entity", "Site imports require a governed import profile", 400);
      // non-contacts automatic resolution: legacy behaviour preserved
      // (governed profiles are excluded — they require explicit selection)
      profile = await loadProfileRow(null, source, entity);
      if (!profile) return fail("no_profile", `No import profile for ${source}/${entity}`, 400);
    }
    const def = profile.definition;
    const governed = entity !== "contacts" && isGovernedDef(def);
    if (options.governedOnly && !governed)
      return fail("profile_mismatch", "Choose a governed import profile", 400);
    if (governed && !GOVERNED_ENTITIES.includes(entity))
      return fail("unsupported_entity", `Governed imports do not support '${entity}'`, 400);
    if (!governed && entity === "sites")
      // sites have NO legacy apply path — routing them through the person
      // importer would silently write site rows into people
      return fail("unsupported_entity", "Site imports require a governed import profile", 400);

    let records: string[][];
    try {
      records = parseCsv(csvText, { skipFirstRow: false, trimLeadingSpace: true }) as string[][];
    } catch {
      return fail("parse_error", "CSV could not be parsed", 400);
    }
    if (!records.length) return fail("empty_file", "No rows found", 400);
    if ((entity === "contacts" || governed) && records.length > 5001)
      return fail("too_large", "Governed imports are bounded to 5000 rows per file", 400);
    const headers = records[0];
    const dataRows = records.slice(1);
    const cm = resolveColumnMapping(headers, def);

    // Reviewed mapping overrides (contacts): canonical → header index (or null
    // to unmap). Validated against the profile's canonical columns and the
    // actual file headers; no column may serve two canonical fields. The
    // FINAL mapping is sealed below — apply never re-derives it.
    let mappingOverrides: Record<string, number | null> | null = null;
    if ((entity === "contacts" || governed) && body.mapping_overrides !== undefined) {
      if (!isPlainObject(body.mapping_overrides))
        return fail("invalid_request", "mapping_overrides must be an object", 400);
      const canonicals = new Set(def.columns.map((c) => c.canonical));
      mappingOverrides = {};
      for (const [k, v] of Object.entries(body.mapping_overrides)) {
        if (!canonicals.has(k)) return fail("invalid_request", `unknown mapping field '${k}'`, 400);
        if (v === null) {
          mappingOverrides[k] = null;
          continue;
        }
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= headers.length)
          return fail("invalid_request", `mapping for '${k}' must be a header index`, 400);
        mappingOverrides[k] = v;
      }
      for (const [k, v] of Object.entries(mappingOverrides)) {
        if (v === null) delete cm.mapping[k];
        else cm.mapping[k] = v;
      }
      const used = new Map<number, string>();
      for (const [k, v] of Object.entries(cm.mapping)) {
        const prior = used.get(v);
        if (prior !== undefined)
          return fail(
            "invalid_request",
            `column ${v} cannot be mapped to both '${prior}' and '${k}'`,
            400,
          );
        used.set(v, k);
      }
      cm.unmapped = headers.filter((_, i) => !used.has(i));
      cm.missingRequired = def.columns
        .filter((c) => c.required && !(c.canonical in cm.mapping))
        .map((c) => c.canonical);
    } else if (body.mapping_overrides !== undefined) {
      // HONEST contract: overrides on a legacy non-contacts import were
      // previously accepted and silently discarded — reject them instead
      return fail(
        "invalid_request",
        "mapping_overrides require a contacts or governed import profile",
        400,
      );
    }
    const checksum = await sha256Hex(csvText);

    // duplicate-upload detection (failed/importing runs surface too — the
    // right route for those is RETRY on the existing import, not a re-preview)
    const { data: dup, error: duplicateError } = await db
      .from("data_imports")
      .select("id,status")
      .eq("tenant_id", tenantId)
      .eq("file_checksum", checksum)
      .in("status", ["previewed", "importing", "completed", "failed", "needs_review"])
      .limit(1)
      .maybeSingle();
    if (duplicateError) return fail("unavailable", "Could not check previous imports", 503);

    let valid = 0,
      invalid = 0,
      willCreate = 0,
      willUpdate = 0,
      willConflict = 0,
      willHold = 0;
    const sample: Array<Record<string, unknown>> = [];
    const mapped = dataRows.map((cells, i) => mapRow(cells, def, cm.mapping, i + 2));
    const batchMatches = new Map<number, ImportBatchResult>();
    if (options.batched && governed) {
      const validRows = mapped.filter(m => !m.errors.length);
      for (let offset = 0; offset < validRows.length; offset += IMPORT_BATCH_SIZE) {
        const batch = validRows.slice(offset, offset + IMPORT_BATCH_SIZE).map(m => ({ row_number: m.rowNumber, record: m.record }));
        const r = await db.rpc("learn_import_match_batch", { p_tenant: tenantId, p_actor: actorId, p_source: source, p_entity: entity, p_rows: batch });
        if (r.error) return fail(r.error.code === "42501" ? "forbidden" : "unavailable", "Could not validate the import preview", r.error.code === "42501" ? 403 : 503);
        try { for (const [n, result] of checkedImportBatch(r.data, batch, "match")) batchMatches.set(n, result); }
        catch { return fail("unavailable", "Incomplete preview batch; no preview was saved", 503); }
      }
    }
    for (const m of mapped) {
      if (m.errors.length) {
        invalid++;
        continue;
      }
      valid++;
      let outcome: { action: string; strategy: string; confidence: number };
      if (entity === "contacts") {
        // canonical marketing matcher (normalised email/phone + provenance
        // external ids; name-only NEVER matches). ZERO canonical writes.
        const r = await db.rpc("marketing_import_match_contact", {
          p_tenant: tenantId,
          p_record: { ...m.record, __source: contactOptions?.source },
        });
        if (r.error) {
          return fail("unavailable", "Could not validate the import preview", 503);
        }
        outcome = r.data as never;
      } else if (governed && options.batched) {
        outcome = batchMatches.get(m.rowNumber) as never;
      } else if (governed) {
        // the SAME validation + resolution decisions the row RPCs apply —
        // read-only, candidate COUNTS only, ZERO canonical writes
        const r = await db.rpc(GOVERNED_MATCH_RPC[entity], {
          p_tenant: tenantId,
          p_source: source,
          p_record: m.record,
        });
        if (r.error) {
          return fail("unavailable", "Could not validate the import preview", 503);
        }
        if (!isPlainObject(r.data) || !["new", "matched", "probable", "invalid", "held"].includes(String(r.data.action)))
          return fail("unavailable", "Import matcher returned an incomplete result", 503);
        outcome = r.data as never;
      } else {
        outcome = await matchEntity(db, tenantId, entity, m.record);
      }
      if (outcome.action === "invalid") {
        // the matcher applies the SAME row validation apply uses (e.g. an
        // unknown lifecycle stage) — an honest invalid, never a silent default
        invalid++;
        valid--;
      } else if (outcome.action === "matched") willUpdate++;
      else if (outcome.action === "probable") willConflict++;
      else if (outcome.action === "held") willHold++;
      else willCreate++;
      if (sample.length < 8) {
        sample.push({
          row: m.rowNumber,
          action: outcome.action,
          strategy: outcome.strategy,
          confidence: outcome.confidence,
          preview: maskSampleRecord(m.record),
        });
      }
    }

    // SEALED PREVIEW CONTRACT (contacts): the EXACT resolved profile (id +
    // version + immutable definition snapshot + cryptographic definition
    // hash), the final reviewed column mapping, any mapping overrides, the
    // validated contact options and the provenance source are sealed with the
    // stored preview. Apply uses ONLY this contract — it never re-resolves a
    // possibly changed live profile. The CSV itself is sealed by file_checksum.
    const definitionSha = await sha256Hex(JSON.stringify(def));
    const sealedProfile = {
      id: profile.id,
      tenant_id: profile.tenant_id,
      source_system: profile.source_system,
      entity_type: profile.entity_type,
      name: profile.name,
      version: profile.version,
      definition: def,
      definition_sha256: definitionSha,
    };
    const sealed =
      entity === "contacts"
        ? {
            profile: sealedProfile,
            mapping: cm.mapping,
            mapping_overrides: mappingOverrides,
            contact_options: contactOptions,
            provenance_source: String(contactOptions?.source ?? ""),
          }
        : governed
          ? {
              profile: sealedProfile,
              mapping: cm.mapping,
              mapping_overrides: mappingOverrides,
              import_options: { source },
              provenance_source: source,
            }
          : null;
    const preview = {
      headers,
      mapping: cm.mapping,
      unmapped: cm.unmapped,
      missing_required: cm.missingRequired,
      row_count: dataRows.length,
      valid,
      invalid,
      will_create: willCreate,
      will_update: willUpdate,
      will_conflict: willConflict,
      will_hold: willHold,
      duplicate_upload: !!dup,
      sample,
      profile: {
        id: profile.id,
        name: profile.name,
        version: profile.version,
        source_system: profile.source_system,
        tenant_owned: profile.tenant_id !== null,
        fields: def.columns.map((c) => c.canonical),
      },
      ...(contactOptions ? { contact_options: contactOptions } : {}),
      ...(sealed ? { sealed } : {}),
    };
    const { data: imp, error: previewError } = await db
      .from("data_imports")
      .insert({
        tenant_id: tenantId,
        // provenance source (e.g. csv_upload) is import LINEAGE — the profile
        // is bound separately via profile_id, never re-derived from this field
        source_system: entity === "contacts" ? String(contactOptions?.source ?? source) : source,
        // the RESOLVED profile id is persisted even when the client supplied
        // none — apply loads the profile by id (and uses the sealed snapshot)
        profile_id: entity === "contacts" || governed ? profile.id : (body.profile_id ?? null),
        entity_type: entity,
        original_filename: body.filename ?? null,
        file_checksum: checksum,
        file_size: csvText.length,
        status: "previewed",
        row_count: dataRows.length,
        valid_rows: valid,
        invalid_rows: invalid,
        conflict_records: willConflict,
        preview,
        uploaded_by: actorId,
      })
      .select("id")
      .maybeSingle();

    if (previewError || !imp?.id) return fail("unavailable", "Could not save the import preview", 503);

    if (governed && imp?.id) {
      await writeAudit(db, {
        tenantId,
        actor: auth.ctx.email ?? actorId ?? "service",
        action: "import.previewed",
        resourceType: "data_import",
        resourceId: imp.id,
        status: "ok",
        detail: {
          entity,
          source,
          rows: dataRows.length,
          valid,
          invalid,
          will_create: willCreate,
          will_update: willUpdate,
          will_conflict: willConflict,
          will_hold: willHold,
          duplicate_upload: !!dup,
        },
      });
    }
    if (entity === "contacts" && imp?.id) {
      await writeAudit(db, {
        tenantId,
        actor: auth.ctx.email ?? actorId ?? "service",
        action: "marketing.import.previewed",
        resourceType: "data_import",
        resourceId: imp.id,
        status: "ok",
        detail: {
          rows: dataRows.length,
          valid,
          invalid,
          will_create: willCreate,
          will_update: willUpdate,
          will_conflict: willConflict,
          duplicate_upload: !!dup,
        },
      });
      await db.rpc("marketing_event_append", {
        p_tenant: tenantId,
        p_type: "marketing.import.previewed",
        p_subject_type: "data_import",
        p_subject: imp.id,
        p_source: "data-import",
        p_entry: {
          k: `previewed:${imp.id}`,
          rows: dataRows.length,
          will_create: willCreate,
          will_conflict: willConflict,
          at: new Date().toISOString(),
        },
      });
    }
    return json({ success: true, import_id: imp?.id, preview });
  }

  // ── row_results (contacts): bounded downloadable invalid/conflict/failed
  //    outcomes — row number + outcome + reason + FIELD NAMES only, never raw
  //    row values, foreign-tenant evidence or unnecessary PII ──────────────────
  if (action === "row_results") {
    if (!isUuid(body.import_id)) return fail("invalid_request", "import_id required", 400);
    const { data: imp, error: importError } = await db
      .from("data_imports")
      .select("id,entity_type,preview")
      .eq("tenant_id", tenantId)
      .eq("id", body.import_id)
      .maybeSingle();
    if (importError) return fail("unavailable", "Could not load import", 503);
    if (options.governedOnly && imp && (!GOVERNED_ENTITIES.includes(imp.entity_type) ||
        !isGovernedDef(imp.preview?.sealed?.profile?.definition)))
      return fail("not_found", "Governed import not found", 404);
    const governedRun =
      !!imp && isPlainObject(imp.preview?.sealed) && isPlainObject(imp.preview.sealed.import_options);
    if (!imp || (imp.entity_type !== "contacts" && !governedRun))
      return fail("not_found", "Governed import not found", 404);
    const denied = await entityWriteDenied(imp.entity_type);
    if (denied) return denied;
    const table = imp.entity_type === "contacts" ? "marketing_import_row_results" : "import_row_results";
    const outcomeVocab =
      imp.entity_type === "contacts"
        ? ["created", "updated", "conflict", "invalid", "failed"]
        : ["created", "linked", "updated", "conflict", "held", "invalid", "skipped", "failed"];
    const paged = options.paginatedOutcomes === true;
    const after = body.after_row === undefined ? 1 : body.after_row, size = body.page_size === undefined ? 100 : body.page_size;
    if ((!paged && (body.after_row !== undefined || body.page_size !== undefined)) ||
        (paged && (!Number.isSafeInteger(after) || (after as number) < 1 || (after as number) > 5001 ||
          !Number.isSafeInteger(size) || (size as number) < 1 || (size as number) > 200)))
      return fail("invalid_request", "Invalid row page cursor or size", 400);
    let q = db
      .from(table)
      .select("row_number,outcome,reason,fields,attempt,created_at")
      .eq("tenant_id", tenantId)
      .eq("import_id", body.import_id)
      .order("row_number")
      .limit(paged ? (size as number) + 1 : 1000);
    if (paged) q = q.gt("row_number", after);
    if (body.outcomes !== undefined) {
      if (
        !Array.isArray(body.outcomes) ||
        body.outcomes.length < 1 ||
        body.outcomes.length > 8 ||
        !body.outcomes.every((o) => typeof o === "string" && outcomeVocab.includes(o))
      )
        return fail("invalid_request", "invalid outcomes filter", 400);
      q = q.in("outcome", body.outcomes as string[]);
    }
    const { data, error } = await q;
    if (error) return fail("internal", "Could not load row results", 500);
    if (!paged) return json({ success: true, rows: data ?? [], truncated: (data ?? []).length === 1000 });
    const rows = (data ?? []).slice(0, size as number), more = (data ?? []).length > (size as number);
    return json({ success: true, tenant_id: tenantId, import_id: imp.id, after_row: after,
      page_size: size, rows, truncated: more, next_after_row: more ? rows[rows.length - 1].row_number : null });
  }

  // ── apply ─────────────────────────────────────────────────────────────────────
  if (action === "apply") {
    if (!isUuid(body.import_id)) return fail("invalid_request", "import_id required", 400);
    if (body.csv_text !== undefined && typeof body.csv_text !== "string")
      return fail("invalid_request", "csv_text must be a string", 400);
    const importId = String(body.import_id ?? "");
    const csvText = String(body.csv_text ?? "");
    const { data: imp, error: importError } = await db
      .from("data_imports")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", importId)
      .maybeSingle();
    if (importError) return fail("unavailable", "Could not load import", 503);
    if (!imp) return fail("not_found", "Import not found (preview first)", 404);
    if (options.governedOnly && (!GOVERNED_ENTITIES.includes(imp.entity_type) ||
        !isGovernedDef(imp.preview?.sealed?.profile?.definition)))
      return fail("invalid_preview", "A governed preview is required", 409);
    const deniedApply = await entityWriteDenied(imp.entity_type);
    if (deniedApply) return deniedApply;
    if (options.governedOnly && (!csvText || (await sha256Hex(csvText)) !== imp.file_checksum))
      return fail("checksum_mismatch", "File differs from preview", 409);
    if (imp.status === "completed") {
      // FULL STABLE CONTRACT even for an already-completed import: the UI
      // always receives the cumulative totals and the import row, never a
      // bare `already` flag with undefined counts.
      return json({
        success: true,
        already: true,
        import: imp,
        created: imp.created_records,
        updated: imp.updated_records,
        conflicts: imp.conflict_records,
        invalid: imp.invalid_rows,
        failed: 0,
        skipped: imp.skipped_records,
        this_run: { created: 0, updated: 0, conflicts: 0, invalid: 0, failed: 0, already: 0 },
        failures: [],
      });
    }
    if (!csvText) return fail("no_file", "csv_text required for apply", 400);
    if ((await sha256Hex(csvText)) !== imp.file_checksum)
      return fail("checksum_mismatch", "File differs from preview", 409);

    // ── CONTACTS: sealed-contract, durable-outcome, retryable state machine ──
    if (imp.entity_type === "contacts") {
      // apply is legal ONLY from previewed (first run), importing (crashed
      // run) or failed (retry) — anything else needs a new preview
      if (!["previewed", "importing", "failed"].includes(imp.status))
        return fail(
          "invalid_status",
          `Import status '${imp.status}' does not allow apply — preview again`,
          409,
        );
      // the sealed contract is the ONLY source of profile/mapping/options
      const sealed = (imp.preview?.sealed ?? null) as {
        profile?: {
          id?: string;
          version?: number;
          definition?: ImportProfileDef;
          definition_sha256?: string;
        };
        mapping?: Record<string, number>;
        contact_options?: Record<string, unknown>;
      } | null;
      const sealedDef = sealed?.profile?.definition;
      const sealedMapping = sealed?.mapping;
      const sealedOptions = sealed?.contact_options ?? null;
      if (
        !sealed ||
        !sealedDef ||
        !sealedMapping ||
        !sealedOptions ||
        !sealedOptions.source ||
        !sealed.profile?.id ||
        sealed.profile.id !== imp.profile_id
      ) {
        return fail(
          "invalid_preview",
          "Import is missing its sealed profile/mapping contract — preview again",
          409,
        );
      }
      // integrity: the sealed definition must hash to its sealed fingerprint
      if ((await sha256Hex(JSON.stringify(sealedDef))) !== sealed.profile.definition_sha256) {
        return fail(
          "invalid_preview",
          "Sealed profile definition failed its integrity check — preview again",
          409,
        );
      }
      // SEALED-CONTRACT PREFLIGHT: every sealed reference must still be
      // honourable BEFORE any status change, row processing or failed-outcome
      // write — a retired stage or deactivated tag requires a NEW preview,
      // never a retryable row failure.
      const so = sealedOptions as Record<string, unknown>;
      if (typeof so.lifecycle_stage_key !== "string" || typeof so.relationship_type !== "string")
        return fail(
          "invalid_preview",
          "Sealed lifecycle/relationship defaults are missing — preview again",
          409,
        );
      const stageOk = await db
        .from("marketing_lifecycle_stages")
        .select("stage_key")
        .eq("tenant_id", tenantId)
        .eq("stage_key", so.lifecycle_stage_key)
        .eq("active", true)
        .maybeSingle();
      if (!stageOk.data)
        return fail(
          "invalid_preview",
          "The sealed lifecycle stage is no longer an active tenant stage — preview again",
          409,
        );
      if (so.tag_id !== undefined && so.tag_id !== null) {
        const tagOk = await db
          .from("marketing_tags")
          .select("id")
          .eq("tenant_id", tenantId)
          .eq("id", so.tag_id)
          .eq("active", true)
          .maybeSingle();
        if (!tagOk.data)
          return fail(
            "invalid_preview",
            "The sealed import tag is no longer an active tenant tag — preview again",
            409,
          );
      }
      const records = parseCsv(csvText, {
        skipFirstRow: false,
        trimLeadingSpace: true,
      }) as string[][];
      await db
        .from("data_imports")
        .update({ status: "importing", started_at: imp.started_at ?? new Date().toISOString() })
        .eq("id", importId);

      // durable outcomes already recorded (terminal rows are never re-applied;
      // failed rows are exactly what a retry processes)
      const { data: priorRows } = await db
        .from("marketing_import_row_results")
        .select("row_number,outcome")
        .eq("tenant_id", tenantId)
        .eq("import_id", importId);
      const terminal = new Map<number, string>();
      for (const r of priorRows ?? []) {
        if (r.outcome !== "failed") terminal.set(r.row_number as number, r.outcome as string);
      }

      const run = { created: 0, updated: 0, conflicts: 0, invalid: 0, failed: 0, already: 0 };
      const failures: Array<{ row: number; reason: string }> = [];
      for (let i = 1; i < records.length; i++) {
        const rowNumber = i + 1;
        if (terminal.has(rowNumber)) {
          run.already++;
          continue;
        }
        const m = mapRow(records[i], sealedDef, sealedMapping, rowNumber);
        if (m.errors.length) {
          // durable reviewed outcome (deterministic mapping failure → terminal
          // invalid) through the GOVERNED recorder: same per-row lock, never
          // downgrades a terminal outcome another worker already wrote
          const rec = await db.rpc("marketing_import_row_outcome", {
            p_tenant: tenantId,
            p_import: importId,
            p_row_number: rowNumber,
            p_outcome: "invalid",
            p_reason: "row failed column validation",
            p_fields: m.errors.map((e) => e.field).slice(0, 20),
          });
          if (!rec.error && (rec.data as Record<string, unknown> | null)?.already) run.already++;
          else run.invalid++;
          continue;
        }
        // ATOMIC per-row RPC: per-(import,row) idempotency + sealed-options
        // check + evidence-converged identity inside.
        const r = await db.rpc("marketing_import_contact_row", {
          p_tenant: tenantId,
          p_import: importId,
          p_actor: actorId,
          p_row_number: rowNumber,
          p_record: m.record,
          p_options: sealedOptions,
        });
        if (r.error) {
          // Durable outcome through the GOVERNED recorder — when a concurrent
          // worker completed this row, its TERMINAL outcome is authoritative and
          // is never overwritten with `failed`. The reason is CLASSIFIED from the
          // SQLSTATE (11N): a deterministic defect is never called transient.
          const cls = classifyRowApplyFailure((r.error as { code?: unknown } | null)?.code);
          const rec = await db.rpc("marketing_import_row_outcome", {
            p_tenant: tenantId,
            p_import: importId,
            p_row_number: rowNumber,
            p_outcome: "failed",
            p_reason: cls.reason,
          });
          if (!rec.error && (rec.data as Record<string, unknown> | null)?.already) {
            run.already++;
          } else {
            run.failed++;
            if (failures.length < 20) failures.push({ row: rowNumber, reason: cls.reason });
          }
          continue;
        }
        const act = (r.data as Record<string, unknown> | null)?.action;
        if (act === "created") run.created++;
        else if (act === "updated") run.updated++;
        else if (act === "conflict") run.conflicts++;
        else if (act === "invalid") run.invalid++;
        else run.already++; // already_applied (idempotent under concurrency)
      }

      // CONCURRENCY-SAFE finalisation: cumulative totals from the DURABLE
      // row outcomes under the locked import row — never from this invocation
      const fin = await db.rpc("marketing_import_finalize", {
        p_tenant: tenantId,
        p_import: importId,
      });
      if (fin.error) return fail("internal", "Import finalisation failed", 500);
      const totals = fin.data as Record<string, unknown>;
      const finalStatus = String(totals.status ?? "failed");
      await writeAudit(db, {
        tenantId,
        actor: auth.ctx.email ?? actorId ?? "service",
        action:
          finalStatus === "completed" ? "marketing.import.applied" : "marketing.import.failed",
        resourceType: "data_import",
        resourceId: importId,
        status: finalStatus === "completed" ? "ok" : "error",
        detail: {
          created: totals.created,
          updated: totals.updated,
          conflicts: totals.conflicts,
          invalid: totals.invalid,
          failed: totals.failed,
        },
      });
      await db.rpc("marketing_event_append", {
        p_tenant: tenantId,
        p_type:
          finalStatus === "completed" ? "marketing.import.applied" : "marketing.import.failed",
        p_subject_type: "data_import",
        p_subject: importId,
        p_source: "data-import",
        p_entry: {
          k: `applied:${importId}:${finalStatus}:${totals.failed ?? 0}`,
          created: totals.created,
          updated: totals.updated,
          conflicts: totals.conflicts,
          failed: totals.failed,
          at: new Date().toISOString(),
        },
      });
      return json({
        success: true,
        import: totals.import,
        // CUMULATIVE durable totals (survive partial retries)
        created: totals.created,
        updated: totals.updated,
        conflicts: totals.conflicts,
        invalid: totals.invalid,
        failed: totals.failed,
        skipped: totals.unprocessed,
        this_run: run,
        failures,
      });
    }

    // ── GOVERNED customers/sites/jobs: sealed-contract, durable-outcome,
    //    retryable state machine mirroring the contacts path, with per-row
    //    atomic RPCs (import_customer_row / import_site_row / import_job_row) ──
    const govSealed = (imp.preview?.sealed ?? null) as {
      profile?: {
        id?: string;
        version?: number;
        definition?: ImportProfileDef;
        definition_sha256?: string;
      };
      mapping?: Record<string, number>;
      import_options?: Record<string, unknown>;
      provenance_source?: string;
    } | null;
    if (
      GOVERNED_ENTITIES.includes(imp.entity_type) &&
      (isGovernedDef(govSealed?.profile?.definition) ||
        govSealed?.import_options !== undefined || imp.entity_type === "sites")
    ) {
      if (!["previewed", "importing", "failed", "needs_review"].includes(imp.status))
        return fail(
          "invalid_status",
          `Import status '${imp.status}' does not allow apply — preview again`,
          409,
        );
      const sealedDef = govSealed?.profile?.definition;
      const sealedMapping = govSealed?.mapping;
      if (
        !govSealed ||
        !isPlainObject(govSealed.import_options) ||
        !isGovernedDef(sealedDef) ||
        !sealedDef ||
        !sealedMapping ||
        !govSealed.provenance_source ||
        !govSealed.profile?.id ||
        govSealed.profile.id !== imp.profile_id
      ) {
        return fail(
          "invalid_preview",
          "Import is missing its sealed profile/mapping contract — preview again",
          409,
        );
      }
      if ((await sha256Hex(JSON.stringify(sealedDef))) !== govSealed.profile.definition_sha256) {
        return fail(
          "invalid_preview",
          "Sealed profile definition failed its integrity check — preview again",
          409,
        );
      }
      const rowRpc = GOVERNED_ROW_RPC[imp.entity_type];
      const records = parseCsv(csvText, {
        skipFirstRow: false,
        trimLeadingSpace: true,
      }) as string[][];
      const started = await db
        .from("data_imports")
        .update({ status: "importing", started_at: imp.started_at ?? new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("id", importId);
      if (started.error) return fail("unavailable", "Could not start the saved import", 503);

      // durable outcomes already recorded: terminal rows are never re-applied;
      // failed AND held rows are exactly what a retry processes (a held row
      // becomes appliable once its customer conflict is resolved)
      const { data: priorRows, error: priorError } = await db
        .from("import_row_results")
        .select("row_number,outcome")
        .eq("tenant_id", tenantId)
        .eq("import_id", importId);
      if (priorError) return fail("unavailable", "Could not load previous row outcomes", 503);
      const terminal = new Map<number, string>();
      for (const r of priorRows ?? []) {
        if (!["failed", "held"].includes(r.outcome as string))
          terminal.set(r.row_number as number, r.outcome as string);
      }

      const run = {
        created: 0,
        linked: 0,
        updated: 0,
        conflicts: 0,
        held: 0,
        invalid: 0,
        failed: 0,
        already: 0,
      };
      const failures: Array<{ row: number; reason: string }> = [];
      let batchResults = new Map<number, ImportBatchResult>();
      for (let i = 1; i < records.length; i++) {
        const rowNumber = i + 1;
        if (terminal.has(rowNumber)) {
          run.already++;
          continue;
        }
        if (options.batched && !batchResults.has(rowNumber)) {
          const batch: ImportBatchRow[] = [];
          for (let j = i; j < Math.min(records.length, i + IMPORT_BATCH_SIZE); j++) {
            if (terminal.has(j + 1)) continue;
            const mapped = mapRow(records[j], sealedDef, sealedMapping, j + 1);
            batch.push({ row_number: j + 1, record: mapped.record, ...(mapped.errors.length ? { invalid_fields: mapped.errors.map(e => e.field).slice(0,20) } : {}) });
          }
          const response = await db.rpc("learn_import_apply_batch", { p_tenant: tenantId, p_import: importId, p_actor: actorId, p_entity: imp.entity_type, p_options: govSealed.import_options, p_rows: batch });
          if (response.error) return fail(response.error.code === "42501" ? "forbidden" : "unavailable", "Import batch could not finish; reload its saved outcomes before continuing", response.error.code === "42501" ? 403 : 503);
          try { batchResults = checkedImportBatch(response.data, batch, "apply"); }
          catch { return fail("unavailable", "Incomplete batch result; reload saved outcomes before continuing", 503); }
        }
        const m = mapRow(records[i], sealedDef, sealedMapping, rowNumber);
        if (m.errors.length && !options.batched) {
          const rec = await db.rpc("import_row_outcome", {
            p_tenant: tenantId,
            p_import: importId,
            p_row_number: rowNumber,
            p_outcome: "invalid",
            p_reason: "row failed column validation",
            p_fields: m.errors.map((e) => e.field).slice(0, 20),
          });
          if (rec.error) return fail("unavailable", "Could not retain the row outcome; reload import status", 503);
          if ((rec.data as Record<string, unknown> | null)?.already) run.already++;
          else run.invalid++;
          continue;
        }
        const batchResult = batchResults.get(rowNumber);
        const r = options.batched
          ? { data: batchResult, error: batchResult?.error_code ? { code: batchResult.error_code } : null }
          : await db.rpc(rowRpc, {
          p_tenant: tenantId,
          p_import: importId,
          p_actor: actorId,
          p_row_number: rowNumber,
          p_record: m.record,
          p_options: govSealed.import_options,
        });
        if (r.error) {
          if (r.error.code === "42501") return fail("forbidden", "Import authority changed; reload before continuing", 403);
          // CLASSIFIED from the SQLSTATE (11N) — a deterministic constraint
          // violation must never be recorded as "transient", which is what hid
          // the Phase 11M contact-point defect behind 262 apparent retries.
          const cls = classifyRowApplyFailure((r.error as { code?: unknown } | null)?.code);
          const rec = await db.rpc("import_row_outcome", {
            p_tenant: tenantId,
            p_import: importId,
            p_row_number: rowNumber,
            p_outcome: "failed",
            p_reason: cls.reason,
          });
          if (rec.error) return fail("unavailable", "Could not retain the row outcome; reload import status", 503);
          if ((rec.data as Record<string, unknown> | null)?.already) {
            run.already++;
          } else {
            run.failed++;
            if (failures.length < 20) failures.push({ row: rowNumber, reason: cls.reason });
          }
          continue;
        }
        const act = (r.data as Record<string, unknown> | null)?.action;
        if (act === "created") run.created++;
        else if (act === "linked") run.linked++;
        else if (act === "updated") run.updated++;
        else if (act === "conflict") run.conflicts++;
        else if (act === "held") run.held++;
        else if (act === "invalid") run.invalid++;
        else if (act === "already_applied") run.already++;
        else return fail("unavailable", "Incomplete row result; reload import status before retrying", 503);
      }

      const fin = await db.rpc("import_run_finalize", {
        p_tenant: tenantId,
        p_import: importId,
      });
      if (fin.error) return fail("internal", "Import finalisation failed", 500);
      const totals = fin.data as Record<string, unknown>;
      const finalStatus = String(totals.status ?? "failed");
      await writeAudit(db, {
        tenantId,
        actor: auth.ctx.email ?? actorId ?? "service",
        action:
          finalStatus === "completed"
            ? "import.applied"
            : finalStatus === "needs_review"
              ? "import.needs_review"
              : "import.failed",
        resourceType: "data_import",
        resourceId: importId,
        status: finalStatus === "failed" ? "error" : "ok",
        detail: {
          entity: imp.entity_type,
          created: totals.created,
          linked: totals.linked,
          updated: totals.updated,
          conflicts: totals.conflicts,
          held: totals.held,
          invalid: totals.invalid,
          failed: totals.failed,
        },
      });
      return json({
        success: true,
        import: totals.import,
        status: finalStatus,
        // CUMULATIVE durable totals (survive partial retries)
        created: totals.created,
        linked: totals.linked,
        updated: totals.updated,
        conflicts: totals.conflicts,
        held: totals.held,
        invalid: totals.invalid,
        failed: totals.failed,
        skipped: totals.skipped,
        unprocessed: totals.unprocessed,
        this_run: run,
        failures,
      });
    }

    // ── NON-CONTACTS: pre-existing importer behaviour, unchanged ──
    if (imp.entity_type === "sites")
      // belt and braces: a sites import can NEVER reach the legacy person path
      return fail("unsupported_entity", "Site imports require a governed import profile", 400);
    if (!KNOWN_ENTITIES.includes(imp.entity_type))
      return fail("unknown_entity", `Unknown import entity '${imp.entity_type}'`, 400);
    const def = await loadProfileDef(imp.profile_id, imp.source_system, imp.entity_type);
    if (!def) return fail("no_profile", "Profile missing", 400);
    if (isGovernedDef(def))
      return fail(
        "invalid_preview",
        "Governed import is missing its sealed contract — preview again",
        409,
      );
    const records = parseCsv(csvText, {
      skipFirstRow: false,
      trimLeadingSpace: true,
    }) as string[][];
    const headers = records[0];
    const cm = resolveColumnMapping(headers, def);
    await db
      .from("data_imports")
      .update({ status: "importing", started_at: new Date().toISOString() })
      .eq("id", importId);

    let created = 0,
      updated = 0,
      skipped = 0,
      conflicts = 0,
      invalid = 0;
    for (let i = 1; i < records.length; i++) {
      const m = mapRow(records[i], def, cm.mapping, i + 1);
      if (m.errors.length) {
        invalid++;
        skipped++;
        continue;
      }
      const res = await applyEntity(
        db,
        tenantId,
        imp.source_system,
        imp.entity_type,
        m.record,
        importId,
        m.rowNumber,
      );
      if (res.action === "created") created++;
      else if (res.action === "updated") updated++;
      else if (res.action === "conflict") conflicts++;
      else skipped++;
    }
    const { data: done } = await db
      .from("data_imports")
      .update({
        status: "completed",
        created_records: created,
        updated_records: updated,
        skipped_records: skipped,
        conflict_records: conflicts,
        invalid_rows: invalid,
        failure: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .select("*")
      .maybeSingle();
    return json({
      success: true,
      import: done,
      created,
      updated,
      skipped,
      conflicts,
      failed: 0,
      failures: [],
    });
  }

  return fail("unknown_action", `Unknown action '${action}'`, 400);
}

// Sample masking is the EXPLICIT deny-by-default policy in
// _shared/imports/redact.ts — every identifying field (emails, phones, owner
// email, names, address/postcode, external/source refs) is masked; unknown
// fields are fully masked, never passed through.

// ── matching (per-strategy DB lookups feeding the pure decideMatch) ──────────────
type DB = ReturnType<typeof createSupabaseAdmin>;
async function matchEntity(db: DB, tenantId: string, entity: string, rec: Record<string, unknown>) {
  if (entity === "jobs") return matchJob(db, tenantId, rec);
  if (entity === "staff") return matchPerson(db, tenantId, rec, STAFF_MATCH_PRIORITY, "people");
  return matchPerson(db, tenantId, rec, CUSTOMER_MATCH_PRIORITY, "people");
}

async function externalIdHits(
  db: DB,
  tenantId: string,
  table: string,
  source: string,
  extId: string,
): Promise<string[]> {
  const { data } = await db!
    .from("import_row_provenance")
    .select("entity_id")
    .eq("tenant_id", tenantId)
    .eq("entity_table", table)
    .eq("source_system", source)
    .eq("external_id", extId);
  return [...new Set((data ?? []).map((r) => r.entity_id as string))];
}

async function matchPerson(
  db: DB,
  tenantId: string,
  rec: Record<string, unknown>,
  order: readonly string[],
  _t: string,
) {
  const hits: StrategyHit[] = [];
  const source = String(rec.__source ?? "");
  if (rec.external_id)
    hits.push({
      strategy: "external_id",
      entityIds: await externalIdHits(db, tenantId, "people", source, String(rec.external_id)),
      confidence: 1,
    });
  if (rec.primary_email) {
    const { data } = await db!
      .from("people")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("primary_email", rec.primary_email);
    hits.push({
      strategy: "email",
      entityIds: (data ?? []).map((r) => r.id as string),
      confidence: 0.95,
    });
  }
  if (rec.primary_phone) {
    const { data } = await db!
      .from("people")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("primary_phone", rec.primary_phone);
    hits.push({
      strategy: "phone",
      entityIds: (data ?? []).map((r) => r.id as string),
      confidence: 0.92,
    });
  }
  return decideMatch(order, hits);
}

async function matchJob(db: DB, tenantId: string, rec: Record<string, unknown>) {
  const hits: StrategyHit[] = [];
  const source = String(rec.__source ?? "");
  if (rec.external_id) {
    const { data } = await db!
      .from("jobs")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("source_system", source)
      .eq("external_id", rec.external_id);
    hits.push({
      strategy: "external_id",
      entityIds: (data ?? []).map((r) => r.id as string),
      confidence: 1,
    });
  }
  const jn = rec.job_number ? normalizeJobNumber(String(rec.job_number)) : null;
  if (jn) {
    const { data } = await db!
      .from("job_number_aliases")
      .select("job_id")
      .eq("tenant_id", tenantId)
      .eq("normalized", jn);
    hits.push({
      strategy: "job_number",
      entityIds: [...new Set((data ?? []).map((r) => r.job_id as string))],
      confidence: 0.98,
    });
  }
  return decideMatch(JOB_MATCH_PRIORITY, hits);
}

// ── apply (create/update canonical entities + provenance) ────────────────────────
async function recordProvenance(
  db: DB,
  tenantId: string,
  importId: string,
  table: string,
  entityId: string,
  source: string,
  rec: Record<string, unknown>,
  decision: { action: string; strategy: string; confidence: number; conflicts: string[] },
  rowNumber: number,
) {
  await db!.from("import_row_provenance").insert({
    tenant_id: tenantId,
    import_id: importId,
    entity_table: table,
    entity_id: entityId,
    source_system: source,
    source_row_number: rowNumber,
    external_id: rec.external_id ?? null,
    imported_fields: Object.keys(rec).filter((k) => !k.startsWith("__")),
    match_strategy: decision.strategy,
    confidence: decision.confidence,
    action: decision.action,
    conflicts: decision.conflicts.length ? decision.conflicts.map((c) => ({ candidate: c })) : [],
  });
}

async function applyEntity(
  db: DB,
  tenantId: string,
  source: string,
  entity: string,
  rec: Record<string, unknown>,
  importId: string,
  rowNumber: number,
) {
  rec.__source = source;
  if (entity === "jobs") return applyJob(db, tenantId, source, rec, importId, rowNumber);
  return applyPerson(db, tenantId, source, entity, rec, importId, rowNumber);
}

async function applyPerson(
  db: DB,
  tenantId: string,
  source: string,
  entity: string,
  rec: Record<string, unknown>,
  importId: string,
  rowNumber: number,
) {
  const order = entity === "staff" ? STAFF_MATCH_PRIORITY : CUSTOMER_MATCH_PRIORITY;
  const decision = await matchPerson(db, tenantId, rec, order, "people");

  // company (customers only)
  let companyId: string | null = null;
  if (entity === "customers" && rec.company_name) {
    const { data: existing } = await db!
      .from("companies")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", rec.company_name)
      .maybeSingle();
    if (existing) companyId = existing.id as string;
    else {
      const { data: c } = await db!
        .from("companies")
        .insert({
          tenant_id: tenantId,
          name: rec.company_name,
          postcode: rec.postcode ?? null,
          address_text: rec.address_text ?? null,
          created_source: `import:${source}`,
          metadata: { import: { source, external_id: rec.external_id ?? null } },
        })
        .select("id")
        .maybeSingle();
      companyId = c?.id ?? null;
    }
  }

  const display =
    rec.display_name ?? ([rec.first_name, rec.last_name].filter(Boolean).join(" ") || null);
  const fields: Record<string, unknown> = {
    display_name: display,
    first_name: rec.first_name ?? null,
    last_name: rec.last_name ?? null,
    primary_email: rec.primary_email ?? null,
    primary_phone: rec.primary_phone ?? null,
    postcode: rec.postcode ?? null,
    address_text: rec.address_text ?? null,
    company_id: companyId,
  };
  const roleMeta =
    entity === "staff"
      ? {
          role: rec.role ?? null,
          team: rec.team ?? null,
          department: rec.department ?? null,
          engineer_ref: rec.engineer_ref ?? null,
        }
      : {};

  if (decision.action === "matched" && decision.entityId) {
    const { data: cur } = await db!
      .from("people")
      .select("*")
      .eq("id", decision.entityId)
      .maybeSingle();
    const { fields: writable, conflicts } = writableFields(fields, cur ?? {}, !!cur?.verified);
    if (Object.keys(writable).length)
      await db!.from("people").update(writable).eq("id", decision.entityId);
    await recordProvenance(
      db,
      tenantId,
      importId,
      "people",
      decision.entityId,
      source,
      rec,
      {
        ...decision,
        action: conflicts.length ? "conflict" : "updated",
        conflicts: [...decision.conflicts, ...conflicts],
      },
      rowNumber,
    );
    return { action: conflicts.length ? "conflict" : "updated", entityId: decision.entityId };
  }
  if (decision.action === "probable") {
    // ambiguous → do not merge; record a conflict row referencing candidates
    await recordProvenance(
      db,
      tenantId,
      importId,
      "people",
      decision.conflicts[0] ?? "00000000-0000-0000-0000-000000000000",
      source,
      rec,
      decision,
      rowNumber,
    );
    return { action: "conflict", entityId: null };
  }
  // new
  const { data: p } = await db!
    .from("people")
    .insert({
      tenant_id: tenantId,
      ...fields,
      verified: false,
      created_source: `import:${entity}:${source}`,
      metadata: { import: { source, external_id: rec.external_id ?? null }, ...roleMeta },
    })
    .select("id")
    .maybeSingle();
  if (p?.id)
    await recordProvenance(
      db,
      tenantId,
      importId,
      "people",
      p.id,
      source,
      rec,
      { ...decision, action: "created" },
      rowNumber,
    );
  return { action: "created", entityId: p?.id ?? null };
}

async function applyJob(
  db: DB,
  tenantId: string,
  source: string,
  rec: Record<string, unknown>,
  importId: string,
  rowNumber: number,
) {
  const decision = await matchJob(db, tenantId, rec);
  const jn = rec.job_number ? normalizeJobNumber(String(rec.job_number)) : null;

  // resolve customer person by external id (from a prior customers import) or name
  let customerPersonId: string | null = null;
  if (rec.customer_external_id) {
    const ids = await externalIdHits(
      db,
      tenantId,
      "people",
      source,
      String(rec.customer_external_id),
    );
    customerPersonId = ids[0] ?? null;
  }
  // resolve engineer person by name (staff imported earlier)
  let engineerPersonId: string | null = null;
  if (rec.engineer) {
    const { data } = await db!
      .from("people")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("display_name", rec.engineer)
      .limit(1)
      .maybeSingle();
    engineerPersonId = data?.id ?? null;
  }

  const fields: Record<string, unknown> = {
    job_number: rec.job_number ?? null,
    title: rec.description ?? null,
    description: rec.description ?? null,
    job_type: rec.job_type ?? null,
    status: rec.status ?? null,
    priority: rec.priority ?? null,
    invoice_status: rec.invoice_status ?? null,
    quote_status: rec.quote_status ?? null,
    value_pennies: rec.value ?? null,
    created_date: rec.created_date ?? null,
    booked_date: rec.booked_date ?? null,
    completed_date: rec.completed_date ?? null,
    customer_person_id: customerPersonId,
    engineer_person_id: engineerPersonId,
  };

  let jobId: string | null = null;
  let action = "created";
  if (decision.action === "matched" && decision.entityId) {
    jobId = decision.entityId;
    action = "updated";
    const { data: cur } = await db!.from("jobs").select("*").eq("id", jobId).maybeSingle();
    const { fields: writable } = writableFields(fields, cur ?? {}, !!cur?.verified);
    if (Object.keys(writable).length) await db!.from("jobs").update(writable).eq("id", jobId);
  } else {
    const { data: j, error } = await db!
      .from("jobs")
      .insert({
        tenant_id: tenantId,
        source_system: source,
        external_id: rec.external_id ?? null,
        ...fields,
        created_source: `import:${source}`,
        verified: false,
        metadata: {
          site: rec.site ?? null,
          postcode: rec.postcode ?? null,
          engineer_name: rec.engineer ?? null,
        },
      })
      .select("id")
      .maybeSingle();
    if (error) return { action: "skipped", entityId: null }; // honest: failed insert is not "created"
    jobId = j?.id ?? null;
  }
  // job-number alias (idempotent)
  if (jobId && jn) {
    await db!.from("job_number_aliases").upsert(
      {
        tenant_id: tenantId,
        job_id: jobId,
        alias: String(rec.job_number),
        normalized: jn,
        source: "import",
      },
      { onConflict: "tenant_id,normalized", ignoreDuplicates: true },
    );
  }
  if (jobId)
    await recordProvenance(
      db,
      tenantId,
      importId,
      "jobs",
      jobId,
      source,
      rec,
      { ...decision, action },
      rowNumber,
    );
  return { action, entityId: jobId };
}
