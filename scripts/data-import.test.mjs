// ServiceOS — Universal data-import proof (preview-first, matching, provenance, idempotency).
// Runs over the deployed-locally data-import function with a real owner JWT on a synthetic tenant.
// Requires the functions server. Self-cleaning.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL,
  SR = process.env.SUPABASE_SERVICE_ROLE_KEY,
  ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !SR || !ANON) {
  console.error("MISSING env");
  process.exit(2);
}
const admin = createClient(URL, SR, { auth: { persistSession: false } });
const FN = `${URL}/functions/v1/data-import`;
const T = "12207700-0000-4000-8000-0000000012ab";
const stamp = process.env.STAMP || "imp1";

let failed = 0;
const ok = (l, c, x) => {
  console.log(`${c ? "PASS" : "FAIL"}  ${l}${x !== undefined ? `  [${x}]` : ""}`);
  if (!c) failed++;
};
let user = null;
async function mkOwner() {
  const email = `importtest+${stamp}@example.com`;
  const { data: list } = await admin.auth.admin.listUsers();
  const prior = list?.users?.find((u) => u.email === email);
  if (prior) await admin.auth.admin.deleteUser(prior.id);
  const { data: c } = await admin.auth.admin.createUser({
    email,
    password: "Test-Passw0rd!",
    email_confirm: true,
  });
  await admin.from("profiles").upsert({ id: c.user.id, tenant_id: T, role: "owner", email });
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: si } = await anon.auth.signInWithPassword({ email, password: "Test-Passw0rd!" });
  user = { id: c.user.id, token: si.session.access_token };
}
async function call(body) {
  const r = await fetch(FN, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${user.token}` },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, text, json };
}
async function cleanup() {
  for (const tbl of [
    "import_row_provenance",
    "data_imports",
    "job_number_aliases",
    "jobs",
    "people",
    "companies",
  ]) {
    await admin.from(tbl).delete().eq("tenant_id", T);
  }
  if (user) await admin.auth.admin.deleteUser(user.id);
}

const CUSTOMERS_CSV = `Customer ID,Company Name,First Name,Surname,Telephone,Email,Post Code,Active
C-100,Acme Plumbing,Jane,Doe,07700 900100,jane@acme.co.uk,SW1A 1AA,Yes
C-101,,Bob,Smith,0161 496 0001,BOB@example.com,M1 1AA,Yes
C-102,Beta Ltd,No,Phone,,nope,BAD,Yes`;

const JOBS_CSV = `Job ID,Job Number,Customer ID,Description,Status,Engineer,Value
J-1,123456,C-100,Boiler service,open,Tom Jones,£150.00
J-2,#84721,C-101,Leak repair,completed,,499.99`;

async function main() {
  await cleanup();
  await mkOwner();

  // profiles
  const profs = await call({
    action: "profiles",
    source_system: "commusoft",
    entity_type: "customers",
  });
  ok(
    "profiles returns Commusoft customers profile",
    profs.json?.profiles?.some((p) => p.name === "Commusoft Customers"),
  );

  // preview customers (dry-run) — 2 valid, 1 invalid (no phone/bad email)
  const pv = await call({
    action: "preview",
    source_system: "commusoft",
    entity_type: "customers",
    csv_text: CUSTOMERS_CSV,
    filename: "customers.csv",
  });
  ok(
    "preview: 2 valid, 1 invalid, 2 will_create",
    pv.json?.preview?.valid === 2 &&
      pv.json?.preview?.invalid === 1 &&
      pv.json?.preview?.will_create === 2,
  );
  ok(
    "preview redacts phone/email in sample",
    JSON.stringify(pv.json?.preview?.sample ?? []).includes("…0100") &&
      !pv.text.includes("jane@acme.co.uk"),
  );
  ok("preview created a data_imports row (dry-run, no canonical writes yet)", !!pv.json?.import_id);
  const custImport = pv.json.import_id;
  const { count: peopleAfterPreview } = await admin
    .from("people")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("preview wrote NO people (preview-first)", (peopleAfterPreview ?? 0) === 0);

  // apply customers
  const ap = await call({ action: "apply", import_id: custImport, csv_text: CUSTOMERS_CSV });
  ok("apply customers: 2 created", ap.json?.created === 2);
  const { data: jane } = await admin
    .from("people")
    .select("primary_phone,company_id")
    .eq("tenant_id", T)
    .eq("primary_email", "jane@acme.co.uk")
    .maybeSingle();
  ok("phone normalized to +447700900100", jane?.primary_phone === "+447700900100");
  const { count: companies } = await admin
    .from("companies")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("1 company created (Acme; Bob had none)", companies === 1);
  ok("Jane linked to company", !!jane?.company_id);
  const { count: prov } = await admin
    .from("import_row_provenance")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", T)
    .eq("entity_table", "people");
  ok("provenance recorded per created person", (prov ?? 0) === 2);

  // idempotency: re-preview same CSV → matched via external_id → will_update
  const pv2 = await call({
    action: "preview",
    source_system: "commusoft",
    entity_type: "customers",
    csv_text: CUSTOMERS_CSV,
    filename: "customers.csv",
  });
  ok("re-preview: duplicate_upload flagged", pv2.json?.preview?.duplicate_upload === true);
  ok(
    "re-preview: 2 will_update (idempotent match by external_id)",
    pv2.json?.preview?.will_update === 2,
  );
  const ap2 = await call({
    action: "apply",
    import_id: pv2.json.import_id,
    csv_text: CUSTOMERS_CSV,
  });
  ok(
    "re-apply: 0 created, 2 updated (no duplicates)",
    ap2.json?.created === 0 && ap2.json?.updated === 2,
  );
  const { count: peopleTotal } = await admin
    .from("people")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", T);
  ok("still exactly 2 people (idempotent)", peopleTotal === 2);

  // jobs import — links to customer C-100, creates aliases
  const jpv = await call({
    action: "preview",
    source_system: "commusoft",
    entity_type: "jobs",
    csv_text: JOBS_CSV,
    filename: "jobs.csv",
  });
  ok("jobs preview: 2 will_create", jpv.json?.preview?.will_create === 2);
  const jap = await call({ action: "apply", import_id: jpv.json.import_id, csv_text: JOBS_CSV });
  ok("jobs apply: 2 created", jap.json?.created === 2);
  const { data: job1 } = await admin
    .from("jobs")
    .select("id,job_number,customer_person_id,value_pennies")
    .eq("tenant_id", T)
    .eq("job_number", "123456")
    .maybeSingle();
  ok("job 123456 created, value £150 → 15000 pennies", job1?.value_pennies === 15000);
  const { data: janeRow } = await admin
    .from("people")
    .select("id")
    .eq("tenant_id", T)
    .eq("primary_email", "jane@acme.co.uk")
    .maybeSingle();
  ok(
    "job 123456 linked to customer C-100's person",
    !!job1?.customer_person_id && job1.customer_person_id === janeRow?.id,
  );
  const { data: alias } = await admin
    .from("job_number_aliases")
    .select("normalized")
    .eq("tenant_id", T)
    .order("normalized");
  ok(
    "job-number aliases normalized (#84721→84721, 123456)",
    JSON.stringify((alias ?? []).map((a) => a.normalized)) === JSON.stringify(["123456", "84721"]),
  );

  // tenant isolation: another tenant sees none of this
  const { count: otherTenant } = await admin
    .from("jobs")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", "00000000-0000-4000-8000-000000000999");
  ok("tenant isolation: jobs scoped to importing tenant", (otherTenant ?? 0) === 0);
}
main()
  .catch((e) => {
    console.error("IMPORT TEST ERROR:", e?.message ?? e);
    failed++;
  })
  .finally(async () => {
    await cleanup();
    console.log(failed === 0 ? "\nDATA IMPORT: ALL PASSED ✅" : `\nDATA IMPORT: ${failed} FAIL ❌`);
    process.exit(failed === 0 ? 0 : 1);
  });
