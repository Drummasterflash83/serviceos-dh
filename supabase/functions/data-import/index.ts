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
import { resolveColumnMapping, mapRow, type ImportProfileDef } from "../_shared/imports/profile.ts";
import {
  decideMatch,
  writableFields,
  CUSTOMER_MATCH_PRIORITY,
  JOB_MATCH_PRIORITY,
  STAFF_MATCH_PRIORITY,
  type StrategyHit,
} from "../_shared/imports/matching.ts";
import { normalizeJobNumber } from "../_shared/imports/job_number.ts";

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
const maskPhone = (p: unknown) =>
  typeof p === "string" && p.length > 4 ? "…" + p.slice(-4) : null;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);
  const db = createSupabaseAdmin();
  if (!db) return fail("config_error", "Service role not configured", 500);

  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return fail("invalid_json", "Body must be JSON", 400);
  }
  const action = String(body.action ?? "profiles");
  const readOnly = action === "profiles" || action === "status" || action === "imports";
  const auth = await requireTenantUser(
    req,
    db,
    (readOnly ? ["owner", "admin", "ops"] : ["owner", "admin"]) as never,
  );
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const actorId = auth.ctx.userId === "service" ? null : auth.ctx.userId;

  // ── profiles ────────────────────────────────────────────────────────────────
  if (action === "profiles") {
    const source = body.source_system ? String(body.source_system) : null;
    const entity = body.entity_type ? String(body.entity_type) : null;
    let q = db
      .from("import_profiles")
      .select("id,tenant_id,source_system,entity_type,name,definition,active,version")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq("active", true);
    if (source) q = q.eq("source_system", source);
    if (entity) q = q.eq("entity_type", entity);
    const { data } = await q;
    return json({ success: true, profiles: data ?? [] });
  }

  if (action === "imports") {
    const { data } = await db
      .from("data_imports")
      .select(
        "id,source_system,entity_type,original_filename,status,row_count,valid_rows,invalid_rows,created_records,updated_records,duplicate_records,conflict_records,created_at,completed_at",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(Number(body.limit ?? 25));
    return json({ success: true, imports: data ?? [] });
  }

  if (action === "status") {
    const id = String(body.import_id ?? "");
    const { data: imp } = await db
      .from("data_imports")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (!imp) return fail("not_found", "Import not found", 404);
    const { data: prov } = await db
      .from("import_row_provenance")
      .select("entity_table,action,match_strategy,confidence,source_row_number,conflicts")
      .eq("tenant_id", tenantId)
      .eq("import_id", id)
      .limit(500);
    return json({ success: true, import: imp, provenance: prov ?? [] });
  }

  // Load the profile + CSV for preview/apply.
  async function loadProfileDef(
    profileId: string | null,
    source: string,
    entity: string,
  ): Promise<ImportProfileDef | null> {
    let row: { definition: ImportProfileDef } | null = null;
    if (profileId) {
      const { data } = await db
        .from("import_profiles")
        .select("definition")
        .eq("id", profileId)
        .maybeSingle();
      row = data as never;
    } else {
      const { data } = await db
        .from("import_profiles")
        .select("definition")
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
        .eq("source_system", source)
        .eq("entity_type", entity)
        .eq("active", true)
        .order("tenant_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      row = data as never;
    }
    return row?.definition ?? null;
  }

  // ── preview (dry-run) ─────────────────────────────────────────────────────────
  if (action === "preview") {
    const source = String(body.source_system ?? "commusoft");
    const entity = String(body.entity_type ?? "customers");
    const csvText = String(body.csv_text ?? "");
    if (!csvText) return fail("no_file", "csv_text is required", 400);
    const def = await loadProfileDef(
      body.profile_id ? String(body.profile_id) : null,
      source,
      entity,
    );
    if (!def) return fail("no_profile", `No import profile for ${source}/${entity}`, 400);

    let records: string[][];
    try {
      records = parseCsv(csvText, { skipFirstRow: false, trimLeadingSpace: true }) as string[][];
    } catch (e) {
      return fail("parse_error", `CSV parse failed: ${(e as Error).message}`, 400);
    }
    if (!records.length) return fail("empty_file", "No rows found", 400);
    const headers = records[0];
    const dataRows = records.slice(1);
    const cm = resolveColumnMapping(headers, def);
    const checksum = await sha256Hex(csvText);

    // duplicate-upload detection
    const { data: dup } = await db
      .from("data_imports")
      .select("id,status")
      .eq("tenant_id", tenantId)
      .eq("file_checksum", checksum)
      .in("status", ["previewed", "completed"])
      .limit(1)
      .maybeSingle();

    let valid = 0,
      invalid = 0,
      willCreate = 0,
      willUpdate = 0,
      willConflict = 0;
    const sample: Array<Record<string, unknown>> = [];
    const mapped = dataRows.map((cells, i) => mapRow(cells, def, cm.mapping, i + 2));
    for (const m of mapped) {
      if (m.errors.length) {
        invalid++;
        continue;
      }
      valid++;
      const outcome = await matchEntity(db, tenantId, entity, m.record);
      if (outcome.action === "matched") willUpdate++;
      else if (outcome.action === "probable") willConflict++;
      else willCreate++;
      if (sample.length < 8) {
        sample.push({
          row: m.rowNumber,
          action: outcome.action,
          strategy: outcome.strategy,
          confidence: outcome.confidence,
          preview: redact(m.record),
        });
      }
    }

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
      duplicate_upload: !!dup,
      sample,
    };
    const { data: imp } = await db
      .from("data_imports")
      .insert({
        tenant_id: tenantId,
        source_system: source,
        profile_id: body.profile_id ?? null,
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

    return json({ success: true, import_id: imp?.id, preview });
  }

  // ── apply ─────────────────────────────────────────────────────────────────────
  if (action === "apply") {
    const importId = String(body.import_id ?? "");
    const csvText = String(body.csv_text ?? "");
    const { data: imp } = await db
      .from("data_imports")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", importId)
      .maybeSingle();
    if (!imp) return fail("not_found", "Import not found (preview first)", 404);
    if (imp.status === "completed") return json({ success: true, already: true, import: imp });
    if (!csvText) return fail("no_file", "csv_text required for apply", 400);
    if ((await sha256Hex(csvText)) !== imp.file_checksum)
      return fail("checksum_mismatch", "File differs from preview", 409);

    const def = await loadProfileDef(imp.profile_id, imp.source_system, imp.entity_type);
    if (!def) return fail("no_profile", "Profile missing", 400);
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
        completed_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .select("*")
      .maybeSingle();
    return json({ success: true, import: done, created, updated, skipped, conflicts });
  }

  return fail("unknown_action", `Unknown action '${action}'`, 400);
});

function redact(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rec };
  if (out.primary_phone) out.primary_phone = maskPhone(out.primary_phone);
  if (out.secondary_phone) out.secondary_phone = maskPhone(out.secondary_phone);
  if (out.primary_email)
    out.primary_email = String(out.primary_email).replace(/(.).*(@.*)/, "$1***$2");
  return out;
}

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
