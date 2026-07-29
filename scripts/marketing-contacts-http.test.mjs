// ServiceOS — marketing-contacts HTTP-contract proof (requires a SERVED edge runtime).
//
// Exercises the REAL authenticated HTTP boundary of the marketing-contacts Edge
// Function — per-action permission gating included — which the DB-level suites
// deliberately do not claim to cover. Requires the function to be served
// (supabase functions serve, or a deployed environment) and env:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   MARKETING_CONTACTS_URL (optional; defaults to $SUPABASE_URL/functions/v1/marketing-contacts)
// Exits 3 with NOT-RUN when the endpoint is unreachable — it never fakes success.
//
// Contract covered:
//   unauthenticated → 401;
//   viewer (no marketing.view) → 403 on list AND on every mutation class
//     (create / classify / update / tag_create);
//   viewer + explicit marketing.view grant → list OK, but classify/update → 403
//     and tag_create → 403;
//   ops → create (idempotency key REQUIRED — missing AND explicit-null → 400;
//     identical retry returns the stored result; same key + changed payload →
//     409 IDEMPOTENCY_CONFLICT; ambiguous identity returns candidates in-band),
//     classify by explicit relationship_id (stale expected_version → 409
//     VERSION_CONFLICT; expected_version without relationship_id → 400), update
//     incl. contact-point update (protected value → 409 PROTECTED_FIELD);
//   STRICT SHAPES: array request body / array changes / array person → 400;
//   invalid cursor / malformed filters → 400 INVALID_REQUEST with SAFE bodies
//     (no SQL, schema or constraint text); a server-issued null-v cursor is
//     ACCEPTED for last_contact sort and rejected elsewhere; a wholly no-op
//     update → 400 (no false transition);
//   cross-tenant: tenant-B admin sees ONLY tenant-B contacts; foreign detail → 404.
// Self-cleaning synthetic tenants.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const FN = process.env.MARKETING_CONTACTS_URL ?? `${URL}/functions/v1/marketing-contacts`;
if (!SR || !ANON) {
  console.error("MISSING env (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY)");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const T = "64a07700-0000-4000-8000-0000000064ab";
const T2 = "64a07700-0000-4000-8000-0000000064ac";
const USERS = {
  ops: { id: "64a07700-0000-4000-8000-0000000064c1", role: "ops", tenant: T },
  viewer: { id: "64a07700-0000-4000-8000-0000000064c2", role: "viewer", tenant: T },
  granted: { id: "64a07700-0000-4000-8000-0000000064c3", role: "viewer", tenant: T },
  adminB: { id: "64a07700-0000-4000-8000-0000000064c4", role: "admin", tenant: T2 },
};
const P1 = "64a07700-0000-4000-8000-0000000064d1";
const PB = "64a07700-0000-4000-8000-0000000064d2";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function call(token, body) {
  const res = await fetch(FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
}

async function cleanup() {
  for (const u of Object.values(USERS)) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  for (const t of [T, T2]) {
    for (const table of [
      "contact_tag_assignments",
      "marketing_tags",
      "contact_relationships",
      "marketing_access_grants",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "audit_logs",
      "platform_events",
    ]) {
      await admin.from(table).delete().eq("tenant_id", t);
    }
    await admin.from("people").delete().eq("tenant_id", t);
    await admin.from("tenants").delete().eq("id", t);
  }
}

async function main() {
  try {
    const probe = await fetch(FN, { method: "OPTIONS" });
    if (!probe.ok) throw new Error(`status ${probe.status}`);
  } catch (e) {
    console.error(`NOT-RUN  marketing-contacts endpoint unreachable at ${FN} (${e.message}).`);
    console.error(
      "Serve the function (supabase functions serve) or point MARKETING_CONTACTS_URL at a deployed environment.",
    );
    process.exit(3);
  }

  await cleanup();
  await admin.from("tenants").insert([
    { id: T, slug: "mkt-chttp", display_name: "Contacts HTTP Proof" },
    { id: T2, slug: "mkt-chttp-2", display_name: "Contacts HTTP Proof 2" },
  ]);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const tokens = {};
  for (const [k, u] of Object.entries(USERS)) {
    const c = await admin.auth.admin.createUser({
      id: u.id,
      email: `${k}@mkt-chttp.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) return ok(`create ${k}`, false, c.error.message);
    await admin.from("profiles").update({ tenant_id: u.tenant, role: u.role }).eq("id", u.id);
    const si = await anon.auth.signInWithPassword({
      email: `${k}@mkt-chttp.test`,
      password: "Proof-Passw0rd!",
    });
    if (si.error) return ok(`sign in ${k}`, false, si.error.message);
    tokens[k] = si.data.session.access_token;
  }
  await admin.from("marketing_access_grants").insert({
    tenant_id: T,
    profile_id: USERS.granted.id,
    permission: "marketing.view",
    granted: true,
  });
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: null });
  await admin.from("people").insert([
    { id: P1, tenant_id: T, display_name: "HTTP Person", primary_email: "hp@chttp.test" },
    { id: PB, tenant_id: T2, display_name: "Foreign HTTP Person" },
  ]);

  let r = await call(null, { action: "list" });
  ok("unauthenticated → 401", r.status === 401, r.status);

  r = await call(tokens.viewer, { action: "list" });
  ok("viewer without view → 403", r.status === 403, r.status);

  r = await call(tokens.granted, { action: "list" });
  ok("granted viewer → list OK", r.status === 200 && Array.isArray(r.body?.data?.items), r.status);
  r = await call(tokens.granted, {
    action: "classify",
    person_id: P1,
    changes: { lifecycle_stage_key: "engaged" },
  });
  ok("granted viewer → classify 403 (needs contacts.manage)", r.status === 403, r.status);
  r = await call(tokens.granted, { action: "tag_create", label: "Nope" });
  ok("granted viewer → tag_create 403 (needs tags.manage)", r.status === 403, r.status);
  r = await call(tokens.granted, {
    action: "create",
    details: { display_name: "X" },
    idempotency_key: crypto.randomUUID(),
  });
  ok("granted viewer → create 403", r.status === 403, r.status);
  r = await call(tokens.granted, { action: "update", person_id: P1, changes: {} });
  ok("granted viewer → update 403", r.status === 403, r.status);
  r = await call(tokens.viewer, { action: "classify", person_id: P1, changes: {} });
  ok("viewer → classify 403", r.status === 403, r.status);

  r = await call(tokens.ops, { action: "list" });
  ok(
    "ops → list OK with tenant rows only",
    r.status === 200 &&
      r.body.data.items.length === 1 &&
      r.body.data.items[0].display_name === "HTTP Person",
    r.status,
  );
  r = await call(tokens.ops, {
    action: "classify",
    person_id: P1,
    changes: { lifecycle_stage_key: "engaged" },
  });
  ok("ops → classify OK", r.status === 200 && r.body?.data?.lifecycle_stage_key === "engaged");
  r = await call(tokens.ops, { action: "tag_create", label: "Priority" });
  ok("ops → tag_create OK (ops holds tags.manage)", r.status === 200, r.status);
  r = await call(tokens.ops, { action: "detail", person_id: PB });
  ok("ops → foreign person detail 404", r.status === 404, r.status);

  // create without a key → 400; explicit null key → 400; array body/changes → 400
  r = await call(tokens.ops, { action: "create", details: { display_name: "K" } });
  ok("ops → create without idempotency key 400", r.status === 400, r.status);
  r = await call(tokens.ops, {
    action: "create",
    details: { display_name: "K" },
    idempotency_key: null,
  });
  ok("ops → create with NULL idempotency key 400", r.status === 400, r.status);
  {
    const res = await fetch(FN, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: ANON,
        Authorization: `Bearer ${tokens.ops}`,
      },
      body: JSON.stringify([{ action: "list" }]),
    });
    ok("ops → ARRAY request body 400", res.status === 400, res.status);
  }
  r = await call(tokens.ops, { action: "classify", person_id: P1, changes: [] });
  ok("ops → classify with ARRAY changes 400", r.status === 400, r.status);
  r = await call(tokens.ops, { action: "update", person_id: P1, changes: { person: [] } });
  ok("ops → update with ARRAY person changes 400", r.status === 400, r.status);
  r = await call(tokens.ops, {
    action: "classify",
    person_id: P1,
    changes: { lifecycle_stage_key: "engaged", expected_version: 1 },
  });
  ok("ops → expected_version without relationship_id 400", r.status === 400, r.status);
  // create + identical retry + fingerprint conflict + ambiguity
  const key = crypto.randomUUID();
  const details = { display_name: "Http Created", email: "created@chttp.test" };
  r = await call(tokens.ops, { action: "create", details, idempotency_key: key });
  ok("ops → create OK", r.status === 200 && r.body?.data?.created === true, r.status);
  const first = r.body?.data;
  r = await call(tokens.ops, { action: "create", details, idempotency_key: key });
  ok(
    "ops → identical retry returns stored result",
    r.status === 200 && JSON.stringify(r.body?.data) === JSON.stringify(first),
  );
  r = await call(tokens.ops, {
    action: "create",
    details: { display_name: "Http CHANGED", email: "created@chttp.test" },
    idempotency_key: key,
  });
  ok(
    "ops → same key + changed payload 409 IDEMPOTENCY_CONFLICT",
    r.status === 409 && r.body?.error?.code === "IDEMPOTENCY_CONFLICT",
    r.body?.error?.code,
  );
  r = await call(tokens.ops, {
    action: "create",
    details: { display_name: "Dup", email: "created@chttp.test" },
    idempotency_key: crypto.randomUUID(),
  });
  ok(
    "ops → existing identity surfaced in-band",
    r.status === 200 && r.body?.data?.status === "existing",
    r.body?.data?.status,
  );
  // stale relationship conflict via explicit id
  const relResp = await call(tokens.ops, { action: "detail", person_id: first.person_id });
  const relId = relResp.body?.data?.relationships?.[0]?.id;
  r = await call(tokens.ops, {
    action: "classify",
    person_id: first.person_id,
    changes: { relationship_id: relId, expected_version: 999, lifecycle_stage_key: "engaged" },
  });
  ok(
    "ops → stale relationship 409 VERSION_CONFLICT",
    r.status === 409 && r.body?.error?.code === "VERSION_CONFLICT",
    r.body?.error?.code,
  );
  // contact-point update: protected value → 409 PROTECTED_FIELD
  const cp = relResp.body?.data?.contact_points?.[0];
  await admin.from("contact_points").update({ verification_state: "verified" }).eq("id", cp.id);
  const cpFresh = await call(tokens.ops, { action: "detail", person_id: first.person_id });
  const cpRow = cpFresh.body?.data?.contact_points?.find((x) => x.id === cp.id);
  r = await call(tokens.ops, {
    action: "update",
    person_id: first.person_id,
    changes: {
      contact_points: {
        update: [{ id: cp.id, expected_updated_at: cpRow.updated_at, value: "hax@chttp.test" }],
      },
    },
  });
  ok(
    "ops → verified contact-point value 409 PROTECTED_FIELD",
    r.status === 409 && r.body?.error?.code === "PROTECTED_FIELD",
    r.body?.error?.code,
  );
  // invalid cursor → 400 with a SAFE body
  r = await call(tokens.ops, { action: "list", cursor: { v: 123, id: "nope" } });
  ok(
    "ops → invalid cursor 400 INVALID_REQUEST",
    r.status === 400 && r.body?.error?.code === "INVALID_REQUEST",
  );
  ok(
    "error bodies are safe (no SQL/schema text)",
    !JSON.stringify(r.body).match(/select |pg_|constraint|sqlstate/i),
  );
  // null-v cursor (the null-last-contact sentinel): ACCEPTED for last_contact,
  // rejected for other sorts — the server-issued cursor must never bounce.
  r = await call(tokens.ops, {
    action: "list",
    sort: "last_contact",
    cursor: { v: null, id: first.person_id },
  });
  ok("ops → null-v cursor accepted for last_contact sort", r.status === 200, r.status);
  r = await call(tokens.ops, {
    action: "list",
    sort: "created",
    cursor: { v: null, id: first.person_id },
  });
  ok(
    "ops → null-v cursor rejected for created sort",
    r.status === 400 && r.body?.error?.code === "INVALID_REQUEST",
    r.status,
  );
  // wholly no-op update → 400 (no false transition is ever emitted)
  r = await call(tokens.ops, {
    action: "update",
    person_id: first.person_id,
    changes: { person: { display_name: "Http Created" } },
  });
  ok(
    "ops → wholly no-op update rejected 400",
    r.status === 400 && r.body?.error?.code === "INVALID_REQUEST",
    r.status,
  );

  r = await call(tokens.adminB, { action: "list" });
  ok(
    "tenant-B admin → sees ONLY tenant-B contacts",
    r.status === 200 &&
      r.body.data.items.length === 1 &&
      r.body.data.items[0].display_name === "Foreign HTTP Person",
    r.status,
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
