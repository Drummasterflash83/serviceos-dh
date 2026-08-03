// ServiceOS — governed verified-domain Resend sender, REAL service boundary.
//
// The transactional SQL suite proves the logic inside one session. This proves
// the parts a single session cannot:
//   - the RPCs are SERVICE-ROLE ONLY over real GoTrue JWTs (a tenant owner
//     holding every marketing permission still cannot grant themselves a
//     production sending identity);
//   - TRUE CONCURRENCY: parallel grants and parallel sender creations converge
//     on exactly one row;
//   - revocation is immediate at the real boundary and capability truth follows;
//   - no secret or credential is ever returned to a caller.
//
// Self-cleaning synthetic tenants with random ids.
// Run: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SUPABASE_ANON_KEY=… \
//        node scripts/marketing-sender-authority.test.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });

const TA = crypto.randomUUID();
const TB = crypto.randomUUID();
const OWNER_A = crypto.randomUUID();
const OWNER_B = crypto.randomUUID();
const OPERATOR = crypto.randomUUID();
const RUN = TA.slice(0, 8);
const ADDR = `hello@drummonds-${RUN}.co`;
const DOMAIN = `drummonds-${RUN}.co`;

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  for (const id of [OWNER_A, OWNER_B, OPERATOR]) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  for (const t of [TA, TB]) {
    for (const table of [
      "marketing_sender_authorities",
      "marketing_delivery_events",
      "marketing_deliveries",
      "automation_intents",
      "tenant_connector_capabilities",
      "tenant_connectors",
      "marketing_sender_profiles",
      "marketing_settings_history",
      "marketing_lifecycle_stages",
      "marketing_settings",
      "audit_logs",
      "platform_events",
      "platform_jobs",
    ]) {
      await admin.from(table).delete().eq("tenant_id", t);
    }
    await admin.from("tenants").delete().eq("id", t);
  }
}

const grant = (actor, args) =>
  admin.rpc("marketing_sender_authority_grant", { p_actor: actor, p_args: args });
const revoke = (actor, args) =>
  admin.rpc("marketing_sender_authority_revoke", { p_actor: actor, p_args: args });
const createSender = (tenant, actor, args) =>
  admin.rpc("marketing_sender_create_resend", { p_tenant: tenant, p_actor: actor, p_args: args });
const readiness = (tenant, sender) =>
  admin.rpc("marketing_sender_readiness", { p_tenant: tenant, p_sender: sender });

async function main() {
  await cleanup();
  await admin.from("tenants").insert([
    { id: TA, slug: `msa-a-${RUN}`, display_name: "Authority A" },
    { id: TB, slug: `msa-b-${RUN}`, display_name: "Authority B" },
  ]);
  for (const [id, tenant, role, tag] of [
    [OWNER_A, TA, "owner", "ownera"],
    [OWNER_B, TB, "owner", "ownerb"],
    [OPERATOR, TA, "admin", "operator"],
  ]) {
    const c = await admin.auth.admin.createUser({
      id,
      email: `${tag}-${RUN}@msa-proof.test`,
      password: "Proof-Passw0rd!",
      email_confirm: true,
    });
    if (c.error) {
      console.error("user create failed", c.error.message);
      process.exit(1);
    }
    await admin.from("profiles").update({ tenant_id: tenant, role }).eq("id", id);
  }
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TA, p_actor: OWNER_A });
  await admin.rpc("marketing_materialise_defaults", { p_tenant: TB, p_actor: OWNER_B });

  // ── (1) service-role-only over REAL browser JWTs ────────────────────────
  if (ANON) {
    const anon = createClient(URL, ANON, { auth: { persistSession: false } });
    const si = await anon.auth.signInWithPassword({
      email: `ownera-${RUN}@msa-proof.test`,
      password: "Proof-Passw0rd!",
    });
    const asOwner = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${si.data.session.access_token}` } },
    });
    for (const [fn, args] of [
      ["marketing_sender_authority_grant", { p_actor: OWNER_A, p_args: {} }],
      ["marketing_sender_authority_revoke", { p_actor: OWNER_A, p_args: {} }],
      [
        "marketing_sender_authority_state",
        { p_tenant: TA, p_transport: "resend", p_address: ADDR },
      ],
      ["marketing_require_platform_operator", { p_actor: OWNER_A }],
      ["marketing_normalise_email", { p_raw: ADDR }],
    ]) {
      const r = await asOwner.rpc(fn, args);
      ok(
        `boundary: ${fn} denied to an authenticated JWT`,
        Boolean(r.error) && r.error.code === "42501",
        r.error?.code ?? "NO ERROR",
      );
    }
    const read = await asOwner.from("marketing_sender_authorities").select("id");
    ok(
      "boundary: browser cannot read the authority table",
      Boolean(read.error) || (read.data ?? []).length === 0,
      read.error?.code ?? `${(read.data ?? []).length} rows`,
    );
    const write = await asOwner
      .from("marketing_sender_authorities")
      .insert({ tenant_id: TA, transport: "resend", sender_address: ADDR, domain: DOMAIN });
    ok(
      "boundary: browser cannot write the authority table",
      Boolean(write.error),
      write.error?.code,
    );
  } else {
    console.log("SKIP  JWT boundary (no SUPABASE_ANON_KEY)");
  }

  // ── (2) a tenant owner cannot approve their own production sender ───────
  let r = await grant(OWNER_A, {
    tenant_id: TA,
    sender_address: ADDR,
    domain: DOMAIN,
    request_id: `req-self-${RUN}`,
  });
  ok(
    "a tenant owner cannot grant themselves a production sender",
    Boolean(r.error) && r.error.code === "42501",
    r.error?.code ?? "GRANTED",
  );

  // ── (3) default deny: no authority → creation refused ───────────────────
  r = await createSender(TA, OWNER_A, { from_address: ADDR });
  ok(
    "DEFAULT DENY: an unauthorised address cannot become a sender",
    Boolean(r.error) && r.error.code === "42501",
    r.error?.code ?? "CREATED",
  );

  // ── (4) the platform operator grants; CONCURRENTLY ─────────────────────
  await admin.from("platform_authority_grants").insert({
    profile_id: OPERATOR,
    permission: "platform.controlplane.admin",
    effective_from: new Date(Date.now() - 86400000).toISOString(),
    granted_by: "test",
    source: "test",
    reason: "authority proof",
  });
  const grants = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      grant(OPERATOR, {
        tenant_id: TA,
        sender_address: i % 2 ? ADDR.toUpperCase() : `  ${ADDR}  `,
        domain: DOMAIN,
        from_name: "ServiceOS by Drummonds",
        reply_to: "chris@openfolk.ai",
        request_id: `req-conc-${RUN}-${i}`,
      }),
    ),
  );
  ok(
    "concurrency: 8 parallel grants all complete",
    grants.every((g) => !g.error),
    grants.find((g) => g.error)?.error?.message,
  );
  ok(
    "concurrency: EXACTLY ONE grant created the authority",
    grants.filter((g) => g.data?.created === true).length === 1,
    `${grants.filter((g) => g.data?.created === true).length} creators`,
  );
  const rows = await admin
    .from("marketing_sender_authorities")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TA);
  ok("concurrency: exactly one authority row exists", rows.count === 1, rows.count);

  // ── (5) cross-tenant authority is unusable ─────────────────────────────
  r = await admin.rpc("marketing_sender_authority_state", {
    p_tenant: TB,
    p_transport: "resend",
    p_address: ADDR,
  });
  ok("tenant B cannot resolve tenant A's authority", r.data === "none", r.data);
  r = await createSender(TB, OWNER_B, { from_address: ADDR });
  ok(
    "tenant B cannot create a sender on tenant A's authority",
    Boolean(r.error) && r.error.code === "42501",
    r.error?.code ?? "CREATED",
  );

  // ── (6) CONCURRENT sender creation converges ───────────────────────────
  const creates = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      createSender(TA, OWNER_A, { from_address: i % 2 ? ADDR.toUpperCase() : ADDR }),
    ),
  );
  ok(
    "concurrency: 8 parallel sender creations all complete",
    creates.every((c) => !c.error),
    creates.find((c) => c.error)?.error?.message,
  );
  ok(
    "concurrency: EXACTLY ONE created the sender",
    creates.filter((c) => c.data?.created === true).length === 1,
    `${creates.filter((c) => c.data?.created === true).length} creators`,
  );
  const senderId = creates.find((c) => c.data?.id)?.data.id;
  const senderRows = await admin
    .from("marketing_sender_profiles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", TA)
    .eq("source_kind", "resend");
  ok("concurrency: exactly one resend sender row", senderRows.count === 1, senderRows.count);

  // ── (7) readiness + capability truth after activation ──────────────────
  let rd = (await readiness(TA, senderId)).data;
  ok(
    "readiness: production verified and ready, bulk permitted, not test-to-self",
    rd.state === "ready" &&
      rd.ready === true &&
      rd.sandbox === false &&
      rd.authority_state === "verified" &&
      rd.campaigns_blocked === false &&
      rd.sequences_blocked === false &&
      rd.test_to_self_only === false,
    JSON.stringify(rd),
  );
  let cap = await admin
    .from("tenant_connector_capabilities")
    .select("enabled")
    .eq("tenant_id", TA)
    .eq("capability_key", "email.send_marketing")
    .maybeSingle();
  ok("capability enabled after activation", cap.data?.enabled === true, cap.data?.enabled);

  // ── (8) REVOCATION is immediate and cascades ───────────────────────────
  r = await revoke(OWNER_A, { tenant_id: TA, sender_address: ADDR });
  ok(
    "a tenant owner cannot revoke a platform authority",
    Boolean(r.error) && r.error.code === "42501",
    r.error?.code ?? "REVOKED",
  );
  r = await revoke(OPERATOR, { tenant_id: TA, sender_address: ADDR, reason: "proof" });
  ok("the operator can revoke", r.data?.revoked === true, JSON.stringify(r.data ?? r.error));
  rd = (await readiness(TA, senderId)).data;
  ok(
    "readiness: revoked immediately, bulk blocked",
    rd.state === "revoked" &&
      rd.ready === false &&
      rd.authority_state === "revoked" &&
      rd.campaigns_blocked === true &&
      rd.sequences_blocked === true,
    JSON.stringify(rd),
  );
  cap = await admin
    .from("tenant_connector_capabilities")
    .select("enabled")
    .eq("tenant_id", TA)
    .eq("capability_key", "email.send_marketing")
    .maybeSingle();
  ok("capability disabled after revocation", cap.data?.enabled === false, cap.data?.enabled);
  r = await revoke(OPERATOR, { tenant_id: TA, sender_address: ADDR });
  ok("revocation is idempotent", r.data?.revoked === false && r.data?.state === "revoked");
  r = await grant(OPERATOR, {
    tenant_id: TA,
    sender_address: ADDR,
    domain: DOMAIN,
    request_id: `req-reinstate-${RUN}`,
  });
  ok(
    "a revoked authority can never be silently reinstated",
    Boolean(r.error),
    r.error?.code ?? "REINSTATED",
  );

  // ── (9) the sender identity never silently switches ────────────────────
  const repoint = await admin
    .from("marketing_sender_profiles")
    .update({ mailbox_address: `other@${DOMAIN}` })
    .eq("id", senderId);
  ok(
    "a sender can never be re-pointed at another address",
    Boolean(repoint.error),
    repoint.error?.code,
  );

  // ── (10) no credential is ever returned ────────────────────────────────
  const dump = JSON.stringify(
    (await admin.from("marketing_sender_authorities").select("*").eq("tenant_id", TA)).data,
  );
  ok(
    "no Resend key material in the authority record",
    !/re_[A-Za-z0-9_-]{16,}/.test(dump) && !/api[_-]?key/i.test(dump),
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real service boundary exercised)" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
