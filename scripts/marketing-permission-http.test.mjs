// ServiceOS — governed marketing-permission capture HTTP contract
// (marketing-contacts actions permission_record / permission_history /
// permission_bulk_preflight / permission_bulk_apply), exercised against a
// SERVED runtime with real GoTrue JWTs.
//
// Random-id synthetic tenants → re-runnable on any environment, including
// append-only remote projects (fixture leftovers never collide).
//
// Proves at the REAL boundary:
//   - a viewer cannot record; an owner can; the response carries the
//     authoritative eligibility;
//   - a subscribed decision without evidence/attestation is a stable 400
//     with a customer-safe message (no raw SQL);
//   - unknown keys, bad uuids and cross-tenant people are refused safely;
//   - identical replay converges (idempotent: true); changed reuse of the
//     request id is 409 REQUEST_MISMATCH;
//   - unsubscribe wins immediately; history shows the append-only rows;
//   - bulk preflight names eligible AND refused members; apply is bound to
//     the contract (409 on tamper) and reports the exact applied count;
//   - the browser CANNOT call the SQL RPCs directly (PostgREST 404/denied).
//
// Exits 3 NOT-RUN without a served runtime.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR || !ANON) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env");
  process.exit(2);
}
const FN = `${URL}/functions/v1/marketing-contacts`;
const admin = createClient(URL, SR, { auth: { persistSession: false } });

const TA = crypto.randomUUID();
const TB = crypto.randomUUID();
const OWNER = crypto.randomUUID();
const VIEWER = crypto.randomUUID();
const OWNER_B = crypto.randomUUID();
const RUN = TA.slice(0, 8);

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of [OWNER, VIEWER, OWNER_B]) await admin.auth.admin.deleteUser(id).catch(() => {});
  for (const t of [TA, TB]) {
    for (const table of [
      "marketing_permission_requests",
      "communication_preferences",
      "contact_points",
      "contact_relationships",
      "people",
      "marketing_settings_history",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "audit_logs",
      "platform_events",
    ]) {
      await admin.from(table).delete().eq("tenant_id", t);
    }
    await admin.from("tenants").delete().eq("id", t);
  }
}

const call = async (token, body) => {
  const resp = await fetch(FN, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json().catch(() => null) };
};

async function main() {
  try {
    const probe = await fetch(FN, { method: "POST", headers: { apikey: ANON } });
    if (probe.status === 404 || probe.status === 503) throw new Error("not served");
  } catch {
    console.error("NOT-RUN: marketing-contacts is not served at " + FN);
    process.exit(3);
  }

  await cleanup();
  await admin.from("tenants").insert([
    { id: TA, slug: `pm-a-${RUN}`, display_name: "Permission A" },
    { id: TB, slug: `pm-b-${RUN}`, display_name: "Permission B" },
  ]);
  for (const [id, tenant, role, tag] of [
    [OWNER, TA, "owner", "owner"],
    [VIEWER, TA, "viewer", "viewer"],
    [OWNER_B, TB, "owner", "ownerb"],
  ]) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${tag}-${RUN}@pm-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) {
      console.error("user create failed", c.error.message);
      process.exit(1);
    }
    await admin.from("profiles").update({ tenant_id: tenant, role }).eq("id", id);
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TA, p_actor: OWNER });
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TB, p_actor: OWNER_B });

  const tokens = {};
  for (const [key, tag] of [
    ["owner", "owner"],
    ["viewer", "viewer"],
    ["ownerb", "ownerb"],
  ]) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anon.auth.signInWithPassword({
      email: `${tag}-${RUN}@pm-proof.test`,
      password: "Proof-Passw0rd!",
    });
    tokens[key] = si.data.session?.access_token;
  }

  // contacts through the REAL create action
  const mk = async (name, email) => {
    const r = await call(tokens.owner, {
      action: "create",
      details: { display_name: name, ...(email ? { email } : {}) },
      idempotency_key: crypto.randomUUID(),
    });
    return r.body?.data?.person_id;
  };
  const p1 = await mk("Pat One", `pat1-${RUN}@pm-proof.test`);
  const p2 = await mk("Pat Two", `pat2-${RUN}@pm-proof.test`);
  const p3 = await mk("No Email", undefined);
  ok("fixture contacts created", Boolean(p1 && p2 && p3), `${p1} ${p2} ${p3}`);

  // the browser cannot call the SQL RPC directly
  const direct = await fetch(`${URL}/rest/v1/rpc/marketing_permission_record`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${tokens.owner}`,
    },
    body: JSON.stringify({ p_tenant: TA, p_actor: OWNER, p_args: {} }),
  });
  ok("browser JWT cannot execute the RPC directly", direct.status >= 400, direct.status);

  // viewer denied
  let r = await call(tokens.viewer, {
    action: "permission_record",
    person_id: p1,
    decision: "subscribed",
    basis: "explicit_opt_in",
    evidence_method: "Signup form",
    evidence_reference: "ref-1",
    attestation: true,
    request_id: `pm-${RUN}-v1`,
  });
  ok("a viewer cannot record permission", r.status === 403, r.status);

  // evidence enforcement at the boundary (safe message, no raw SQL)
  r = await call(tokens.owner, {
    action: "permission_record",
    person_id: p1,
    decision: "subscribed",
    request_id: `pm-${RUN}-e1`,
  });
  ok(
    "subscribed without evidence is a precise 400",
    r.status === 400 && /evidence basis/.test(r.body?.error?.message ?? ""),
    `${r.status} ${r.body?.error?.message}`,
  );
  r = await call(tokens.owner, {
    action: "permission_record",
    person_id: p1,
    decision: "subscribed",
    basis: "explicit_opt_in",
    evidence_method: "Signup form",
    evidence_reference: "ref-1",
    attestation: true,
    request_id: `pm-${RUN}-e2`,
    sneaky: true,
  });
  ok("an unknown key is refused", r.status === 400, r.status);
  r = await call(tokens.owner, {
    action: "permission_record",
    person_id: "not-a-uuid",
    decision: "unsubscribed",
    request_id: `pm-${RUN}-e3`,
  });
  ok("a malformed person id is refused", r.status === 400, r.status);
  r = await call(tokens.ownerb, {
    action: "permission_record",
    person_id: p1,
    decision: "unsubscribed",
    request_id: `pm-${RUN}-e4`,
  });
  ok("a cross-tenant person is NOT_FOUND (non-enumerating)", r.status === 404, r.status);

  // owner records the real decision
  const args = {
    action: "permission_record",
    person_id: p1,
    decision: "subscribed",
    basis: "explicit_opt_in",
    evidence_method: "Signup form on drummonds.co",
    evidence_reference: `Form submission ${RUN}`,
    attestation: true,
    request_id: `pm-${RUN}-s1`,
  };
  r = await call(tokens.owner, args);
  ok(
    "the owner records a genuine subscribed decision",
    r.status === 200 &&
      r.body?.data?.eligibility === "subscribed" &&
      r.body?.data?.idempotent === false,
    JSON.stringify(r.body?.data ?? r.body?.error),
  );
  const prefId = r.body?.data?.preference_id;

  // identical replay converges; changed reuse refused
  r = await call(tokens.owner, args);
  ok(
    "identical replay converges on the stored receipt",
    r.status === 200 && r.body?.data?.idempotent === true && r.body?.data?.preference_id === prefId,
    JSON.stringify(r.body?.data),
  );
  r = await call(tokens.owner, { ...args, evidence_reference: "a different claim" });
  ok(
    "changed reuse of the request id is REQUEST_MISMATCH",
    r.status === 409 && r.body?.error?.code === "REQUEST_MISMATCH",
    `${r.status} ${r.body?.error?.code}`,
  );

  // history shows the append-only rows
  r = await call(tokens.owner, { action: "permission_history", person_id: p1 });
  ok(
    "history returns the append-only trail + authoritative eligibility",
    r.status === 200 &&
      r.body?.data?.eligibility === "subscribed" &&
      Array.isArray(r.body?.data?.history) &&
      r.body.data.history.length === 1,
    JSON.stringify(r.body?.data?.history?.length),
  );

  // unsubscribe wins immediately
  r = await call(tokens.owner, {
    action: "permission_record",
    person_id: p1,
    decision: "unsubscribed",
    note: "Asked to stop",
    request_id: `pm-${RUN}-u1`,
  });
  ok(
    "an unsubscribe records immediately and wins",
    r.status === 200 && r.body?.data?.eligibility === "unsubscribed",
    JSON.stringify(r.body?.data ?? r.body?.error),
  );

  // bulk: preflight truth → contract-bound apply
  // preflight mirrors the UI: selection + decision only, NO evidence yet
  r = await call(tokens.owner, {
    action: "permission_bulk_preflight",
    person_ids: [p1, p2, p3],
    decision: "subscribed",
  });
  ok(
    "bulk preflight names eligible and refused members",
    r.status === 200 &&
      r.body?.data?.eligible_count === 2 &&
      r.body?.data?.refused_count === 1 &&
      r.body?.data?.refused?.[0]?.reason === "no_usable_email",
    JSON.stringify(r.body?.data ?? r.body?.error),
  );
  const contract = r.body?.data?.contract;

  r = await call(tokens.owner, {
    action: "permission_bulk_apply",
    person_ids: [p1, p2, p3],
    decision: "subscribed",
    basis: "existing_customer_documented",
    evidence_method: "Service contract on file",
    note: "Contracts cover marketing permission",
    attestation: true,
    request_id: `pm-${RUN}-b1`,
    contract: "0".repeat(32),
  });
  ok("a tampered bulk contract is refused", r.status === 409, r.status);

  r = await call(tokens.owner, {
    action: "permission_bulk_apply",
    person_ids: [p1, p2, p3],
    decision: "subscribed",
    basis: "existing_customer_documented",
    evidence_method: "Service contract on file",
    note: "Contracts cover marketing permission",
    attestation: true,
    request_id: `pm-${RUN}-b1`,
    contract,
  });
  ok(
    "bulk apply records exactly the confirmed selection",
    r.status === 200 && r.body?.data?.applied === 2 && r.body?.data?.refused_count === 1,
    JSON.stringify(r.body?.data ?? r.body?.error),
  );
  const elig = await admin.rpc("marketing_contact_eligibility", {
    p_tenant: TA,
    p_person: p2,
    p_channel: "email",
  });
  ok("a bulk member is now genuinely subscribed", elig.data === "subscribed", elig.data);

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real HTTP boundary exercised)" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
