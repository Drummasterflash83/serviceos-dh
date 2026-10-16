/** Exact TEST-first card association release with rollback and source equality. */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const project = mode === "--test" ? TEST_PROJECT : mode === "--live" ? LIVE_PROJECT : null;
if (!project || (project === TEST_PROJECT ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== project)
  throw Error("Exact TEST or LIVE union release required");
const label = project === TEST_PROJECT ? "test" : "live";
const prefix = `.verification-results/build01-card-union-${label}`;
if (existsSync(`${prefix}-journal.json`) || existsSync(`${prefix}-result.json`))
  throw Error("Prior card union release requires inspection");
const sha = (v) => createHash("sha256").update(v).digest("hex");
const migration = readFileSync(
  "supabase/migrations/20261104215500_learn_card_union_association.sql", "utf8");
const migrationSha256 = sha(migration);
const token = savedCliToken();
async function query(sql, readOnly = false, target = project, timeout = 45000) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target}/database/query${readOnly ? "/read-only" : ""}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
    });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const safe = typeof detail.message === "string" ? detail.message
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
      .replace(/'[^']*'/g, "'<redacted>'").slice(0, 200) : "unclassified";
    throw Error(`Card union query HTTP ${response.status} (${safe})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Card union response changed");
  return rows;
}
const catalog = `select pg_get_functiondef(p.oid) definition,r.rolname owner,
 p.prosecdef security_definer,p.proconfig settings,p.proacl acl,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 (select i.indisvalid and i.indisready from pg_index i join pg_class x on x.oid=i.indexrelid
   where x.relname='learn_card_company_cover_idx'
     and x.relnamespace='public'::regnamespace) cover_index_ready
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 join pg_roles r on r.oid=p.proowner
 where n.nspname='public' and p.proname='learn_card_projection_inputs'
 and pg_get_function_identity_arguments(p.oid)='p_tenant uuid, p_card uuid'`;
async function state(target = project) {
  const rows = await query(catalog, true, target);
  if (rows.length !== 1 || typeof rows[0]?.definition !== "string")
    throw Error("Card union catalog changed");
  return rows[0];
}
const before = await state();
const expectedSource = "a52902eec22ac17ce18b0999bdfa86dc1de30a62003da6a35453112e94673044";
if (sha(before.definition) !== expectedSource || before.owner !== "postgres" ||
  before.security_definer !== true || before.service_execute !== true ||
  before.authenticated_execute !== false || before.cover_index_ready !== true ||
  JSON.stringify(before.settings) !== JSON.stringify(
    ["search_path=pg_catalog", "enable_bitmapscan=off"]))
  throw Error("Exact card union baseline or covering index changed");
if (label === "live") {
  const tested = JSON.parse(readFileSync(
    ".verification-results/build01-card-union-test-result.json", "utf8"));
  const testNow = await state(TEST_PROJECT);
  if (tested.state !== "card_union_released" ||
    tested.migrationSha256 !== migrationSha256 ||
    sha(testNow.definition) !== tested.afterSha256)
    throw Error("Exact TEST card union acceptance changed");
}
writeFileSync(`${prefix}-rollback.sql`, before.definition,
  { flag: "wx", mode: 0o600 });
writeFileSync(`${prefix}-journal.json`, JSON.stringify({ state: "prepared", project,
  baselineSha256: expectedSource, migrationSha256,
  rollbackSourceSaved: true }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
await query(`begin; ${migration} rollback;`);
const rehearsed = await state();
if (sha(rehearsed.definition) !== expectedSource ||
  JSON.stringify(rehearsed.settings) !== JSON.stringify(before.settings))
  throw Error("Card union rollback rehearsal failed");

const fixturePrefix = randomBytes(3).toString("hex");
const tenant = `${fixturePrefix}00-aaaa-4000-8000-000000000001`;
const card = `${fixturePrefix}00-aaaa-4000-8000-000000000003`;
let equalityPassed = false;
if (label === "test") {
  const fixture = readFileSync("scripts/verify/learn-production-card-draft.assert.sql", "utf8")
    .split("set local role service_role;")[0]
    .replaceAll("ed3900", fixturePrefix)
    .replaceAll("card-draft-rehearsal", `card-draft-rehearsal-${fixturePrefix}`)
    .replaceAll("card-draft-other", `card-draft-other-${fixturePrefix}`);
  if (!fixture.includes("insert into customer_cards") ||
    !fixture.includes("generate_series(1,110)"))
    throw Error("TEST card fixture changed");
  const overlap = `insert into public.companies(id,tenant_id,name) values
   ('ed390000-aaaa-4000-8000-000000000004','${tenant}','Synthetic company'),
   ('ed390000-aaaa-4000-8000-000000000005','${tenant}','Synthetic other company');
   update public.customer_cards set company_id='ed390000-aaaa-4000-8000-000000000004'
   where tenant_id='${tenant}' and id='${card}';
   insert into public.interactions(id,tenant_id,source_connector_id,source_type,
     source_table,source_id,interaction_type,direction,occurred_at,related_person_id,related_company_id)
   values
   ('ed390005-aaaa-4000-8000-000000000001','${tenant}','phone','phone',
     'phone_calls',gen_random_uuid(),'phone_call','inbound',statement_timestamp()-interval '2 hours',
     'ed390000-aaaa-4000-8000-000000000002','ed390000-aaaa-4000-8000-000000000004'),
   ('ed390005-aaaa-4000-8000-000000000002','${tenant}','phone','phone',
     'phone_calls',gen_random_uuid(),'phone_call','inbound',statement_timestamp()-interval '2 hours',
     null,'ed390000-aaaa-4000-8000-000000000004'),
   ('ed390005-aaaa-4000-8000-000000000003','${tenant}','phone','phone',
     'phone_calls',gen_random_uuid(),'phone_call','inbound',statement_timestamp()-interval '2 hours',
     'ed390000-aaaa-4000-8000-000000000002','ed390000-aaaa-4000-8000-000000000005'),
   ('ed390005-aaaa-4000-8000-000000000004','${tenant}','phone','phone',
     'phone_calls',gen_random_uuid(),'phone_call','inbound',statement_timestamp()-interval '2 hours',
     'ed390000-aaaa-4000-8000-000000000002',null);`.replaceAll("ed3900", fixturePrefix);
  const fixtureQuery = `begin; ${fixture} ${overlap}
    create temporary table card_union_before as
      select public.learn_card_projection_inputs('${tenant}','${card}') - 'capturedAt' answer;
    ${migration}
    do $$declare new_answer jsonb;begin
      new_answer:=public.learn_card_projection_inputs('${tenant}','${card}') - 'capturedAt';
      assert new_answer=(select answer from card_union_before);
      assert new_answer#>>'{coverage,eligibleInteractions}'='109';
      assert new_answer#>>'{coverage,excludedDraftInteractions}'='110';
      assert jsonb_array_length(new_answer->'interactions')=100;
      assert new_answer#>>'{coverage,eligibleRecommendations}'='51';
    end$$;
    select true equality_passed; rollback;`;
  const rows = await query(fixtureQuery, false, project, 90000);
  equalityPassed = rows.length === 1 && rows[0]?.equality_passed === true;
  if (!equalityPassed) throw Error("TEST overlapping card fixture changed");
}
await query(migration);
const after = await state();
const passed = after.owner === before.owner &&
  after.security_definer === before.security_definer &&
  after.service_execute === before.service_execute &&
  after.authenticated_execute === before.authenticated_execute &&
  JSON.stringify(after.settings) === JSON.stringify(before.settings) &&
  JSON.stringify(after.acl) === JSON.stringify(before.acl) &&
  after.definition.includes("union all") &&
  after.definition.includes("c.company_id is null or i.related_company_id is distinct from c.company_id") &&
  sha(after.definition) !== expectedSource &&
  (label === "test" || sha(after.definition) === JSON.parse(readFileSync(
    ".verification-results/build01-card-union-test-result.json", "utf8")).afterSha256);
const result = { state: passed ? "card_union_released" : "requires_inspection",
  project, baselineSha256: expectedSource, afterSha256: sha(after.definition),
  migrationSha256, rollbackRehearsed: true,
  testOverlappingSourcesEqual: label === "test" ? equalityPassed : true,
  ownerGrantsAndSettingsPreserved: passed, sourceRowsChanged: false };
writeFileSync(`${prefix}-result.json`, JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
if (!passed) process.exitCode = 1;
