// Regression test — direction-aware identity attribution (externalIdentifiers).
//
// Proves the fix in supabase/functions/_shared/identity.ts: the SENDER display
// name (from_name) is attributed to the external customer ONLY on inbound. On
// outbound the sender is the tenant, so the customer name must NOT become the
// tenant company (the "Drummond Heating on every outbound card" bug); on internal
// neither side is an external customer.
//
// Runs end-to-end through the real identity.resolve handler via a served
// platform-worker. Against the LOCAL stack:
//   supabase functions serve platform-worker --env-file <env with WORKER_SECRET> --no-verify-jwt
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local sr> \
//   WORKER_SECRET=local-test-worker-secret node scripts/identity-attribution.test.mjs
//
// Exit 0 = attribution correct. Exit 1 = a mislabel regressed.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const WORKER_SECRET = process.env.WORKER_SECRET || "local-test-worker-secret";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const T = "00000000-0000-0000-0000-0000000000fa";
const TENANT_NAME = "Drummond Heating";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

async function cleanup() {
  for (const t of ["recommendations", "customer_cards", "people", "companies", "interactions", "platform_jobs"])
    await db.from(t).delete().eq("tenant_id", T);
  await db.from("tenants").delete().eq("id", T);
}
const mk = (o) => ({
  tenant_id: T, source_connector_id: "google-workspace", source_type: "email",
  source_table: "email_messages", source_id: crypto.randomUUID(), interaction_type: "email_message",
  occurred_at: new Date().toISOString(), processing_status: "pending", ...o,
});

try {
  await cleanup();
  await db.from("tenants").insert({ id: T, slug: "id-attr", display_name: TENANT_NAME, status: "active" });
  const { data: seeded } = await db.from("interactions").insert([
    mk({ direction: "outbound", from_name: TENANT_NAME, from_address: "office@drummondheating.co.uk", to_addresses: ["accounts@bramshaw.co.uk"] }),
    mk({ direction: "inbound", from_name: "Jane Bramshaw", from_address: "jane@laurelcarehome.co.uk", to_addresses: ["office@drummondheating.co.uk"] }),
    mk({ direction: "internal", from_name: TENANT_NAME, from_address: "a@drummondheating.co.uk", to_addresses: ["b@drummondheating.co.uk"] }),
  ]).select("id,direction");
  const byDir = Object.fromEntries(seeded.map((r) => [r.direction, r.id]));

  await db.from("platform_jobs").insert({
    tenant_id: T, connector_id: "openfolk-core", module_id: "core.identity", job_type: "identity.resolve",
    job_key: `identity.resolve:${T}`, status: "queued", priority: 50, max_attempts: 5,
    available_at: new Date().toISOString(), payload: { limit: 10 },
  });

  // drive the served worker until the queue is empty (readiness-tolerant)
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${URL}/functions/v1/platform-worker`, {
      method: "POST", headers: { "content-type": "application/json", "x-schedule-secret": WORKER_SECRET },
      body: JSON.stringify({ batch_size: 3, job_types: ["identity.resolve"] }),
    }).catch(() => ({ status: 0 }));
    if (res.status === 200) {
      const { count } = await db.from("platform_jobs").select("*", { count: "exact", head: true })
        .eq("tenant_id", T).eq("job_type", "identity.resolve").in("status", ["queued", "running", "retrying"]);
      if (!count) break;
    } else await new Promise((r) => setTimeout(r, 1500));
    await new Promise((r) => setTimeout(r, 400));
  }

  async function personFor(interactionId) {
    const { data: it } = await db.from("interactions").select("related_person_id,related_company_id").eq("id", interactionId).single();
    if (!it?.related_person_id) return { person: null, company: null };
    const { data: p } = await db.from("people").select("display_name,primary_email").eq("id", it.related_person_id).single();
    const { data: c } = it.related_company_id ? await db.from("companies").select("name,domain").eq("id", it.related_company_id).single() : { data: null };
    return { person: p, company: c };
  }

  console.log("\n--- assertions ---");
  const out = await personFor(byDir.outbound);
  ok(out.person && out.person.display_name !== TENANT_NAME,
    `OUTBOUND: customer name is NOT the tenant ("${out.person?.display_name}")`);
  ok(!out.person?.display_name,
    `OUTBOUND: name left unresolved (null) rather than mislabelled (got "${out.person?.display_name}")`);
  ok(out.person?.primary_email === "accounts@bramshaw.co.uk",
    `OUTBOUND: keyed to the RECIPIENT email (${out.person?.primary_email})`);
  ok(out.company?.domain === "bramshaw.co.uk",
    `OUTBOUND: company is the recipient domain (${out.company?.domain})`);

  const inb = await personFor(byDir.inbound);
  ok(inb.person?.display_name === "Jane Bramshaw",
    `INBOUND: customer name IS the external sender ("${inb.person?.display_name}")`);

  const intl = await personFor(byDir.internal);
  ok(intl.person?.display_name !== TENANT_NAME,
    `INTERNAL: not mislabelled as tenant ("${intl.person?.display_name}")`);
} catch (e) {
  console.error("ERROR:", e.message); fail++;
} finally {
  await cleanup();
  console.log(fail === 0 ? "\n✅ IDENTITY ATTRIBUTION TEST PASSED" : `\n❌ ${fail} assertion(s) failed`);
  process.exit(fail === 0 ? 0 : 1);
}
