// ServiceOS — Edge Function: marketing-contacts (TENANT-facing, governed, fail-closed).
//
// The Contacts vertical slice's authz boundary. A THIN shell: every projection
// and mutation lives in service-role-only SQL RPCs (migration 20260829120000),
// and permissions come from the CANONICAL resolver
// (`marketing_effective_permissions`) — never re-implemented here, never a
// caller-supplied profile id (the resolved JWT user is the only actor).
//
// Actions → required permission:
//   list / counts / detail / tags_list / owners_list / companies_list → marketing.view
//   create / classify / update                                        → marketing.contacts.manage
//   tag_create / tag_assign / tag_remove                              → marketing.tags.manage
//
// INPUT VALIDATION happens here (and again inside the RPCs): uuids, enums,
// limits, sort/dir, cursor shape, date strings, idempotency keys and
// expected_version are checked before any database call; malformed input is a
// stable 400 INVALID_REQUEST.
//
// ERROR CONTRACT: database outcomes map to stable API codes — INVALID_REQUEST,
// NOT_FOUND, FORBIDDEN, AMBIGUOUS_IDENTITY (in-band result), VERSION_CONFLICT
// (409), IDEMPOTENCY_CONFLICT (409), DUPLICATE (409), INTERNAL (500). Raw
// database messages, constraint names and SQL never reach the browser.
//
// Deploy with verify_jwt=false (auth enforced via requireTenantUser).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";

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
  json({ ok: false, error: { code, message } }, s);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));
// STRICT SHAPE: arrays and scalars never satisfy an object contract.
const isPlainObject = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isOptionalBool = (v: unknown): boolean => v === undefined || typeof v === "boolean";

const SORTS = new Set(["name", "created", "last_contact"]);
const DIRS = new Set(["asc", "desc"]);
const ELIGIBILITIES = new Set([
  "subscribed",
  "unsubscribed",
  "suppressed",
  "unknown",
  "invalid",
  "no_contact_point",
]);
const REL_STATUSES = new Set(["active", "inactive", "archived"]);
const CHANNELS = new Set(["email", "phone", "sms", "whatsapp", "social", "other"]);
const TONES = new Set(["neutral", "info", "positive", "attention", "negative"]);

const PERMISSION_BY_ACTION: Record<string, string> = {
  list: "marketing.view",
  counts: "marketing.view",
  detail: "marketing.view",
  tags_list: "marketing.view",
  owners_list: "marketing.view",
  companies_list: "marketing.view",
  create: "marketing.contacts.manage",
  classify: "marketing.contacts.manage",
  update: "marketing.contacts.manage",
  tag_create: "marketing.tags.manage",
  tag_assign: "marketing.tags.manage",
  tag_remove: "marketing.tags.manage",
};

/** Map a database error to the stable, safe API contract. Never leaks internals. */
function mapDbError(err: { code?: string; message?: string } | null): Response {
  const state = err?.code ?? "";
  switch (state) {
    case "MK409":
      return fail("VERSION_CONFLICT", "The record changed elsewhere — reload and retry", 409);
    case "MK403":
      return fail(
        "PROTECTED_FIELD",
        "This value is source-authoritative and cannot be edited",
        409,
      );
    case "22023":
    case "22P02":
      return fail("INVALID_REQUEST", "A supplied value is invalid", 400);
    case "P0002":
      return fail("NOT_FOUND", "Record not found", 404);
    case "55000":
      return fail("IDEMPOTENCY_CONFLICT", "This request key was used for a different action", 409);
    case "23505":
      return fail("DUPLICATE", "This value already exists", 409);
    case "23000":
    case "23503":
    case "23514":
      return fail("INVALID_REQUEST", "The change violates a data rule", 400);
    default:
      return fail("INTERNAL", "The operation failed", 500);
  }
}

/** Validate the list filter payload; returns clean RPC args or an error string. */
function buildListArgs(body: Row): { args: Row } | { error: string } {
  const args: Row = {};
  if (body.search !== undefined) {
    if (typeof body.search !== "string" || body.search.length > 200)
      return { error: "search must be a short string" };
    args.search = body.search;
  }
  for (const k of ["lifecycle", "relationship_type", "source"]) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "string" || body[k].length > 80) return { error: `invalid ${k}` };
      args[k] = body[k];
    }
  }
  if (body.relationship_status !== undefined) {
    if (!REL_STATUSES.has(body.relationship_status))
      return { error: "invalid relationship_status" };
    args.relationship_status = body.relationship_status;
  }
  for (const k of ["owner_id", "company_id"]) {
    if (body[k] !== undefined) {
      if (!isUuid(body[k])) return { error: `invalid ${k}` };
      args[k] = body[k];
    }
  }
  if (body.eligibility !== undefined) {
    if (!ELIGIBILITIES.has(body.eligibility)) return { error: "invalid eligibility" };
    args.eligibility = body.eligibility;
  }
  if (body.classified !== undefined) {
    if (typeof body.classified !== "boolean") return { error: "invalid classified flag" };
    args.classified = body.classified;
  }
  for (const k of ["tags_include", "tags_exclude"]) {
    if (body[k] !== undefined) {
      if (!Array.isArray(body[k]) || body[k].length > 20 || !body[k].every(isUuid))
        return { error: `invalid ${k}` };
      args[k] = body[k];
    }
  }
  for (const k of ["created_from", "created_to", "last_contact_from", "last_contact_to"]) {
    if (body[k] !== undefined) {
      if (!isIsoDate(body[k])) return { error: `invalid ${k}` };
      args[k] = body[k];
    }
  }
  if (body.sort !== undefined) {
    if (!SORTS.has(body.sort)) return { error: "invalid sort" };
    args.sort = body.sort;
  }
  if (body.dir !== undefined) {
    if (!DIRS.has(body.dir)) return { error: "invalid dir" };
    args.dir = body.dir;
  }
  if (body.limit !== undefined) {
    if (
      typeof body.limit !== "number" ||
      !Number.isInteger(body.limit) ||
      body.limit < 1 ||
      body.limit > 100
    )
      return { error: "limit must be an integer 1–100" };
    args.limit = body.limit;
  }
  if (body.cursor !== undefined && body.cursor !== null) {
    const c = body.cursor as Row;
    // Cursor contract {v, id}: v is a string for name/created sorts, and
    // string OR NULL for last_contact — the server-issued null-last-contact
    // sentinel must round-trip, never be rejected.
    const sortForCursor = (args.sort as string | undefined) ?? "name";
    const vOk =
      sortForCursor === "last_contact"
        ? c?.v === null || typeof c?.v === "string"
        : typeof c?.v === "string";
    if (typeof c !== "object" || Array.isArray(c) || !isUuid(c.id) || !vOk)
      return { error: "invalid cursor" };
    args.cursor = { v: c.v, id: c.id };
  }
  return { args };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("INVALID_REQUEST", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("INTERNAL", "Service is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId, email } = auth.ctx;
  if (userId === "service") {
    return fail("INVALID_REQUEST", "marketing-contacts is a user-facing endpoint", 400);
  }

  let body: Row = {};
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed !== null && parsed !== undefined && !isPlainObject(parsed)) {
      return fail("INVALID_REQUEST", "Request body must be a JSON object", 400);
    }
    body = (parsed ?? {}) as Row;
  } catch {
    body = {};
  }
  const action = String(body.action ?? "list");
  const required = PERMISSION_BY_ACTION[action];
  if (!required) return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);

  // ── Canonical permission resolution (fail-closed; never re-implemented). ──
  const resolved = await admin.rpc("marketing_effective_permissions", { p_profile_id: userId });
  if (resolved.error || !resolved.data || typeof resolved.data !== "object") {
    return fail("INTERNAL", "Could not resolve Marketing access", 500);
  }
  const verdict = resolved.data as Row;
  const permissions: string[] = Array.isArray(verdict.permissions) ? verdict.permissions : [];
  if (verdict.enabled !== true || !permissions.includes("marketing.view")) {
    return fail("FORBIDDEN", "Marketing access required", 403);
  }
  if (!permissions.includes(required)) {
    await writeAudit(admin, {
      tenantId,
      actor: email ?? userId,
      action: "marketing.contacts.denied",
      resourceType: "marketing_contacts",
      status: "denied",
      detail: { action, required },
    });
    return fail("FORBIDDEN", `Requires ${required}`, 403);
  }

  try {
    switch (action) {
      case "list": {
        const built = buildListArgs(body);
        if ("error" in built) return fail("INVALID_REQUEST", built.error, 400);
        const r = await admin.rpc("marketing_contacts_list", {
          p_tenant: tenantId,
          p_args: built.args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "counts": {
        const r = await admin.rpc("marketing_contacts_counts", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "detail": {
        if (!isUuid(body.person_id)) return fail("INVALID_REQUEST", "person_id required", 400);
        const r = await admin.rpc("marketing_contact_detail", {
          p_tenant: tenantId,
          p_person: body.person_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "create": {
        const d = body.details as Row;
        if (!isPlainObject(d) || typeof d.display_name !== "string")
          return fail("INVALID_REQUEST", "details must be an object with display_name", 400);
        if (d.email !== undefined && (typeof d.email !== "string" || d.email.length > 200))
          return fail("INVALID_REQUEST", "invalid email", 400);
        if (d.phone !== undefined && (typeof d.phone !== "string" || d.phone.length > 40))
          return fail("INVALID_REQUEST", "invalid phone", 400);
        if (d.company_id !== undefined && !isUuid(d.company_id))
          return fail("INVALID_REQUEST", "invalid company_id", 400);
        if (d.owner_id !== undefined && !isUuid(d.owner_id))
          return fail("INVALID_REQUEST", "invalid owner_id", 400);
        if (!isUuid(body.idempotency_key))
          return fail("INVALID_REQUEST", "a valid idempotency_key is required", 400);
        for (const k of ["display_name", "first_name", "last_name"]) {
          if (d[k] !== undefined && (typeof d[k] !== "string" || d[k].length > 200))
            return fail("INVALID_REQUEST", `invalid ${k}`, 400);
        }
        if (
          d.lifecycle_stage_key !== undefined &&
          (typeof d.lifecycle_stage_key !== "string" || d.lifecycle_stage_key.length > 80)
        )
          return fail("INVALID_REQUEST", "invalid lifecycle_stage_key", 400);
        if (
          d.relationship_type !== undefined &&
          (typeof d.relationship_type !== "string" || d.relationship_type.length > 80)
        )
          return fail("INVALID_REQUEST", "invalid relationship_type", 400);
        const r = await admin.rpc("marketing_create_contact", {
          p_tenant: tenantId,
          p_actor: userId,
          p_details: d,
          p_idempotency_key: body.idempotency_key,
        });
        if (r.error) return mapDbError(r.error);
        // ambiguous identity is an in-band, explicit result (not an exception)
        return json({ ok: true, data: r.data });
      }
      case "classify": {
        if (!isUuid(body.person_id)) return fail("INVALID_REQUEST", "person_id required", 400);
        const c = body.changes as Row;
        if (!isPlainObject(c)) return fail("INVALID_REQUEST", "changes must be an object", 400);
        if (c.owner_id !== undefined && c.owner_id !== null && !isUuid(c.owner_id))
          return fail("INVALID_REQUEST", "invalid owner_id", 400);
        if (c.expected_version !== undefined && !Number.isInteger(c.expected_version))
          return fail("INVALID_REQUEST", "invalid expected_version", 400);
        if (c.status !== undefined && !REL_STATUSES.has(c.status))
          return fail("INVALID_REQUEST", "invalid status", 400);
        if (c.relationship_id !== undefined && !isUuid(c.relationship_id))
          return fail("INVALID_REQUEST", "invalid relationship_id", 400);
        if (!isOptionalBool(c.allow_new) || !isOptionalBool(c.clear_owner))
          return fail("INVALID_REQUEST", "allow_new and clear_owner must be booleans", 400);
        // contract combinations mirrored from the SQL boundary
        if (c.expected_version !== undefined && c.relationship_id === undefined)
          return fail("INVALID_REQUEST", "expected_version requires relationship_id", 400);
        if (c.allow_new === true && c.relationship_id !== undefined)
          return fail("INVALID_REQUEST", "allow_new applies only to a new classification", 400);
        if (
          c.lifecycle_stage_key !== undefined &&
          (typeof c.lifecycle_stage_key !== "string" || c.lifecycle_stage_key.length > 80)
        )
          return fail("INVALID_REQUEST", "invalid lifecycle_stage_key", 400);
        if (
          c.relationship_type !== undefined &&
          (typeof c.relationship_type !== "string" || c.relationship_type.length > 80)
        )
          return fail("INVALID_REQUEST", "invalid relationship_type", 400);
        const r = await admin.rpc("marketing_classify_contact", {
          p_tenant: tenantId,
          p_person: body.person_id,
          p_actor: userId,
          p_changes: c,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "update": {
        if (!isUuid(body.person_id)) return fail("INVALID_REQUEST", "person_id required", 400);
        const c = body.changes as Row;
        if (!isPlainObject(c)) return fail("INVALID_REQUEST", "changes must be an object", 400);
        const person = c.person as Row | undefined;
        if (person !== undefined) {
          if (!isPlainObject(person)) return fail("INVALID_REQUEST", "invalid person changes", 400);
          for (const k of ["display_name", "first_name", "last_name"]) {
            if (
              person[k] !== undefined &&
              (typeof person[k] !== "string" || person[k].length > 200)
            )
              return fail("INVALID_REQUEST", `invalid ${k}`, 400);
          }
          if (person.company_id !== undefined && !isUuid(person.company_id))
            return fail("INVALID_REQUEST", "invalid company_id", 400);
          if (!isOptionalBool(person.clear_company))
            return fail("INVALID_REQUEST", "clear_company must be a boolean", 400);
        }
        const rel = c.relationship as Row | undefined;
        if (rel !== undefined && !isPlainObject(rel))
          return fail("INVALID_REQUEST", "invalid relationship changes", 400);
        if (rel?.owner_id !== undefined && rel.owner_id !== null && !isUuid(rel.owner_id))
          return fail("INVALID_REQUEST", "invalid owner_id", 400);
        if (rel?.expected_version !== undefined && !Number.isInteger(rel.expected_version))
          return fail("INVALID_REQUEST", "invalid expected_version", 400);
        if (rel?.relationship_id !== undefined && !isUuid(rel.relationship_id))
          return fail("INVALID_REQUEST", "invalid relationship_id", 400);
        if (rel && (!isOptionalBool(rel.allow_new) || !isOptionalBool(rel.clear_owner)))
          return fail("INVALID_REQUEST", "allow_new and clear_owner must be booleans", 400);
        if (rel && rel.expected_version !== undefined && rel.relationship_id === undefined)
          return fail("INVALID_REQUEST", "expected_version requires relationship_id", 400);
        if (rel && rel.allow_new === true && rel.relationship_id !== undefined)
          return fail("INVALID_REQUEST", "allow_new applies only to a new classification", 400);
        const cps = c.contact_points as Row | undefined;
        if (cps !== undefined && !isPlainObject(cps))
          return fail("INVALID_REQUEST", "invalid contact_points changes", 400);
        if (cps?.set_primary !== undefined)
          return fail(
            "INVALID_REQUEST",
            "set_primary was removed — use contact_points.update with make_primary",
            400,
          );
        const adds = cps?.add;
        if (adds !== undefined) {
          if (!Array.isArray(adds) || adds.length > 5)
            return fail("INVALID_REQUEST", "invalid contact_points.add", 400);
          for (const a of adds) {
            if (!isPlainObject(a) || !CHANNELS.has(a.channel))
              return fail("INVALID_REQUEST", "invalid contact point", 400);
            if (typeof a.value !== "string" || a.value.length > 200)
              return fail("INVALID_REQUEST", "invalid contact point", 400);
            if (!isOptionalBool(a.make_primary))
              return fail("INVALID_REQUEST", "make_primary must be a boolean", 400);
          }
        }
        const updates = cps?.update;
        if (updates !== undefined) {
          if (!Array.isArray(updates) || updates.length > 5)
            return fail("INVALID_REQUEST", "invalid contact_points.update", 400);
          for (const u of updates) {
            if (!isPlainObject(u) || !isUuid(u.id) || !isIsoDate(u.expected_updated_at))
              return fail(
                "INVALID_REQUEST",
                "contact point updates need id + expected_updated_at",
                400,
              );
            if (u.value !== undefined && (typeof u.value !== "string" || u.value.length > 200))
              return fail("INVALID_REQUEST", "invalid contact point value", 400);
            if (u.label !== undefined && (typeof u.label !== "string" || u.label.length > 60))
              return fail("INVALID_REQUEST", "invalid label", 400);
            if (!isOptionalBool(u.make_primary))
              return fail("INVALID_REQUEST", "make_primary must be a boolean", 400);
          }
        }
        const r = await admin.rpc("marketing_update_contact", {
          p_tenant: tenantId,
          p_person: body.person_id,
          p_actor: userId,
          p_changes: c,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "tags_list": {
        const r = await admin
          .from("marketing_tags")
          .select("id,key,label,tone,active")
          .eq("tenant_id", tenantId)
          .eq("active", true)
          .order("label");
        if (r.error) return fail("INTERNAL", "Could not load tags", 500);
        return json({ ok: true, data: { tags: r.data ?? [] } });
      }
      case "owners_list": {
        const r = await admin.rpc("marketing_owners_list", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: { owners: r.data ?? [] } });
      }
      case "companies_list": {
        const search = typeof body.search === "string" ? body.search.slice(0, 100) : "";
        let q = admin
          .from("companies")
          .select("id,name")
          .eq("tenant_id", tenantId)
          .order("name")
          .limit(20);
        if (search) q = q.ilike("name", `%${search}%`);
        const r = await q;
        if (r.error) return fail("INTERNAL", "Could not load companies", 500);
        return json({ ok: true, data: { companies: r.data ?? [] } });
      }
      case "tag_create": {
        if (typeof body.label !== "string" || !body.label.trim() || body.label.length > 60)
          return fail("INVALID_REQUEST", "label required", 400);
        if (body.tone !== undefined && !TONES.has(body.tone))
          return fail("INVALID_REQUEST", "invalid tone", 400);
        const r = await admin.rpc("marketing_tag_mutate", {
          p_tenant: tenantId,
          p_actor: userId,
          p_op: "create",
          p_args: { label: body.label.trim(), tone: body.tone ?? "neutral" },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "tag_assign":
      case "tag_remove": {
        if (!isUuid(body.person_id) || !isUuid(body.tag_id))
          return fail("INVALID_REQUEST", "person_id and tag_id required", 400);
        const r = await admin.rpc("marketing_tag_mutate", {
          p_tenant: tenantId,
          p_actor: userId,
          p_op: action === "tag_assign" ? "assign" : "remove",
          p_args: { person_id: body.person_id, tag_id: body.tag_id },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch {
    return fail("INTERNAL", "The operation failed", 500);
  }
});
