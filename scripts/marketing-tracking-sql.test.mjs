// ServiceOS — Marketing tracking CONCURRENCY proof (real PostgREST, real RPCs).
//
// The transactional SQL suite (supabase/tests/marketing_tracking.test.sql)
// proves the write-once bound inside ONE session. This script proves the part a
// single session cannot: that TRULY CONCURRENT duplicate events converge, and
// that a valid-token flood driven from many connections at once still leaves
// exactly one bounded row with no write amplification.
//
// Everything runs through the canonical service-role RPCs — no copied logic and
// no hand-built rows. Self-cleaning synthetic tenant.
//
// Run:  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/marketing-tracking-sql.test.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SR) {
  console.error("MISSING SUPABASE_SERVICE_ROLE_KEY env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });

const T = crypto.randomUUID();
const OWNER = crypto.randomUUID();
const RUN = T.slice(0, 8);

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};

async function cleanup() {
  await admin.auth.admin.deleteUser(OWNER).catch(() => {});
  // NOTE: marketing_email_tracking is deliberately NOT deleted here — the
  // service role holds no DELETE privilege on it (same discipline as
  // marketing_deliveries); its rows leave by tenant/delivery cascade.
  for (const table of [
    "marketing_delivery_events",
    "marketing_deliveries",
    "automation_execution_attempts",
    "automation_intents",
    "decision_log",
    "intelligence_objects",
    "tenant_connector_capabilities",
    "tenant_connectors",
    "marketing_sender_profiles",
    "marketing_settings_history",
    "marketing_lifecycle_stages",
    "marketing_settings",
    "audit_logs",
    "platform_events",
    "platform_jobs",
    "review_tasks",
  ]) {
    await admin.from(table).delete().eq("tenant_id", T);
  }
  await admin.from("tenants").delete().eq("id", T);
}

/** One governed test delivery through the canonical request RPC. */
async function newDelivery(requestId) {
  const r = await admin.rpc("marketing_test_send_request", {
    p_tenant: T,
    p_actor: OWNER,
    p_args: {
      sender_id: senderId,
      recipient_profile_id: OWNER,
      subject: "tracking concurrency proof",
      body_text: "Visit https://drummonds.example/quote",
      request_id: requestId,
    },
  });
  if (r.error) throw new Error(`delivery create failed: ${r.error.message}`);
  return r.data.delivery_id;
}

const trackingRow = async (deliveryId) => {
  const r = await admin
    .from("marketing_email_tracking")
    .select(
      "id, tenant_id, delivery_id, opened_at, first_open_at, open_count, clicked_at, first_click_at, click_count, first_click_url",
    )
    .eq("delivery_id", deliveryId)
    .maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

let senderId;

async function main() {
  await cleanup();
  await admin
    .from("tenants")
    .insert({ id: T, slug: `trk-proof-${RUN}`, display_name: "Tracking Proof" });
  const c = await admin.auth.admin.createUser({
    id: OWNER,
    email: `owner-${RUN}@trk-proof.test`,
    password: "Proof-Passw0rd!",
    email_confirm: true,
  });
  if (c.error) {
    console.error("user create failed", c.error.message);
    process.exit(1);
  }
  await admin.from("profiles").update({ tenant_id: T, role: "owner" }).eq("id", OWNER);
  await admin.rpc("marketing_materialise_defaults", { p_tenant: T, p_actor: OWNER });

  // the ONLY permitted Resend identity — the sandbox
  const s = await admin.rpc("marketing_sender_create_resend", {
    p_tenant: T,
    p_actor: OWNER,
    p_args: { from_address: "onboarding@resend.dev", from_name: "Trk Proof" },
  });
  if (s.error) {
    console.error("sender create failed", s.error.message);
    await cleanup();
    process.exit(1);
  }
  senderId = s.data.id;
  ok(
    "sandbox sender is created UNVERIFIED and self-declares its limits",
    s.data.send_scope_state === "unknown" &&
      s.data.sandbox === true &&
      s.data.test_to_self_only === true &&
      s.data.provider_submission_verified === false,
    JSON.stringify(s.data),
  );

  // ── (1) CONCURRENT duplicate opens converge on ONE bounded row ───────────
  const d1 = await newDelivery(`trk-conc-${RUN}-01`);
  const opens = await Promise.all(
    Array.from({ length: 24 }, () =>
      admin.rpc("marketing_track_record", { p_delivery: d1, p_kind: "open", p_url: null }),
    ),
  );
  const openErrors = opens.filter((r) => r.error);
  ok(
    "concurrency: 24 parallel opens all complete without error",
    openErrors.length === 0,
    openErrors[0]?.error?.message,
  );
  ok(
    "concurrency: EXACTLY ONE parallel open reports a write",
    opens.filter((r) => r.data === true).length === 1,
    `${opens.filter((r) => r.data === true).length} writers`,
  );
  const rows1 = await admin
    .from("marketing_email_tracking")
    .select("id", { count: "exact", head: true })
    .eq("delivery_id", d1);
  ok("concurrency: exactly one tracking row exists", rows1.count === 1, rows1.count);
  const r1 = await trackingRow(d1);
  ok(
    "concurrency: the bounded counter is 1 and the first-open timestamp is set once",
    r1.open_count === 1 && r1.first_open_at !== null && r1.opened_at === r1.first_open_at,
    JSON.stringify(r1),
  );
  ok(
    "concurrency: no click evidence was invented",
    r1.click_count === 0 && r1.first_click_at === null,
  );
  ok("tenant safety: the row is bound to this tenant", r1.tenant_id === T);

  // ── (2) CONCURRENT duplicate clicks converge; destination written once ───
  const clicks = await Promise.all(
    Array.from({ length: 24 }, (_, i) =>
      admin.rpc("marketing_track_record", {
        p_delivery: d1,
        p_kind: "click",
        // every racer proposes a DIFFERENT destination; exactly one may win and
        // it must be immutable afterwards
        p_url: `https://drummonds.example/quote?racer=${i}`,
      }),
    ),
  );
  ok(
    "concurrency: EXACTLY ONE parallel click reports a write",
    clicks.filter((r) => r.data === true).length === 1,
    `${clicks.filter((r) => r.data === true).length} writers`,
  );
  const r2 = await trackingRow(d1);
  ok(
    "concurrency: click evidence is bounded and the destination is write-once",
    r2.click_count === 1 &&
      r2.first_click_at !== null &&
      /^https:\/\/drummonds\.example\/quote\?racer=\d+$/.test(r2.first_click_url ?? ""),
    JSON.stringify(r2),
  );

  // ── (3) valid-token FLOOD: no write amplification, no drift ──────────────
  const before = await trackingRow(d1);
  const flood = await Promise.all(
    Array.from({ length: 120 }, (_, i) =>
      admin.rpc("marketing_track_record", {
        p_delivery: d1,
        p_kind: i % 2 === 0 ? "open" : "click",
        p_url: "https://evil.example/later",
      }),
    ),
  );
  ok(
    "flood: 120 valid-token requests report ZERO writes",
    flood.every((r) => !r.error && r.data === false),
    flood.find((r) => r.error)?.error?.message ??
      `${flood.filter((r) => r.data === true).length} writes`,
  );
  const after = await trackingRow(d1);
  ok(
    "flood: every stored value is byte-identical afterwards",
    JSON.stringify(before) === JSON.stringify(after),
    JSON.stringify(after),
  );
  const rowsAfter = await admin
    .from("marketing_email_tracking")
    .select("id", { count: "exact", head: true })
    .eq("delivery_id", d1);
  ok("flood: still exactly one tracking row", rowsAfter.count === 1, rowsAfter.count);

  // ── (4) a fresh delivery is unaffected (bound is per delivery) ───────────
  const d2 = await newDelivery(`trk-conc-${RUN}-02`);
  const fresh = await admin.rpc("marketing_track_record", {
    p_delivery: d2,
    p_kind: "open",
    p_url: null,
  });
  ok("bound is per delivery: a NEW delivery records its own first open", fresh.data === true);

  // ── (5) unknown delivery: nothing recorded, nothing disclosed ────────────
  const alien = await admin.rpc("marketing_track_record", {
    p_delivery: crypto.randomUUID(),
    p_kind: "open",
    p_url: null,
  });
  ok("unknown delivery records nothing", alien.data === false, JSON.stringify(alien.data));
  const total = await admin
    .from("marketing_email_tracking")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("exactly two tracking rows for two tracked deliveries", total.count === 2, total.count);

  // ── (6) over-counting is unrepresentable even for the service role ───────
  const over = await admin
    .from("marketing_email_tracking")
    .update({ open_count: 2 })
    .eq("delivery_id", d1);
  ok(
    "CHECK constraint refuses an over-counted row even for service_role",
    Boolean(over.error),
    over.error?.code ?? "accepted",
  );

  await cleanup();
  console.log(failed === 0 ? "\nALL PASS (real concurrency exercised)" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  process.exit(1);
});
