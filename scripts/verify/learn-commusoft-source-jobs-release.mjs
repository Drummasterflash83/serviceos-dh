/** Exact additive source-job reader release; no provider request or projection. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
const [mode, environment] = process.argv.slice(2);
if (process.argv.length !== 4 || !["rehearse", "apply", "readback"].includes(mode) || !["test", "live"].includes(environment)) throw Error("Exact mode and environment required");
const project = environment === "test" ? "saatxzwxvdvqevbnskxy" : "tgbnakbxwcqjeimygroz";
const tenant = environment === "test" ? "f8c114fa-fee7-4983-8970-f6e7f5fd3129" : "00000000-0000-0000-0000-000000000001";
const root = ".verification-results/commusoft-source-jobs-20261016";
mkdirSync(root, { recursive: true, mode: 0o700 });
const source = readFileSync("supabase/migrations/20261104150000_learn_commusoft_source_job_cards.sql", "utf8");
const hash = x => createHash("sha256").update(x).digest("hex");
const digest = hash(source), token = savedCliToken();
const quote = x => "'" + x.replaceAll("'", "''") + "'";
const save = (name, data) => writeFileSync(`${root}/${environment}-${name}.json`, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
const read = name => JSON.parse(readFileSync(`${root}/${environment}-${name}.json`, "utf8"));
async function q(query, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) { writeFileSync(`${root}/${environment}-${mode}-private-error.txt`, await r.text(), { mode: 0o600 }); throw Error(`Source jobs ${mode} HTTP ${r.status}; private diagnostics retained`); }
  return r.json();
}
const catalog = `select p.proname name,pg_get_functiondef(p.oid) definition,p.proacl::text acl,pg_get_userbyid(p.proowner) owner
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('learn_commusoft_source_job_rows','learn_commusoft_source_job_cards','openfolk_business_review') order by p.proname`;
const coverage = `with rows as materialized(select s.* from public.provider_connections c
 cross join lateral public.learn_commusoft_source_job_rows(c.tenant_id,c.id) s
 where c.tenant_id='${tenant}' and c.provider='commusoft')
 select jsonb_build_object('retained_jobs',count(*),'open_jobs',count(*) filter(where source_status in ('Open','ongoing','pending','on_hold')),
 'reviewed_jobs',count(reviewed_job_id),'source_job_conflicts',count(*) filter(where relationship_state='job_source_conflict'),
 'open_source_relationship_gaps',count(*) filter(where source_status in ('Open','ongoing','pending','on_hold') and relationship_state not in ('customer_source_retained','site_customer_source_retained')),
 'open_unreviewed_customer_identities',count(*) filter(where source_status in ('Open','ongoing','pending','on_hold') and customer_identity_state<>'reviewed'),
 'relationships',(select jsonb_agg(to_jsonb(g)) from(select relationship_state,count(*) jobs,count(*) filter(where source_status in ('Open','ongoing','pending','on_hold')) open_jobs from rows group by relationship_state order by relationship_state)g)) report from rows`;
const ledger = environment === "test"
  ? `select source_sha256 digest from of_test_deploy.migrations where migration_name='learn_commusoft_source_job_cards_v1'`
  : `select encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex') digest from supabase_migrations.schema_migrations where version='20261104150000'`;
const before = await q(catalog);
if (mode === "readback") {
  const installed = read("apply-result"), hashes = await q(ledger);
  let expected = installed.expected;
  if (existsSync(`${root}/${environment}-plan-apply-result.json`)) {
    const plan = read("plan-apply-result");
    const planDigest = hash(readFileSync("supabase/migrations/20261104151000_learn_commusoft_source_job_plan.sql", "utf8"));
    const planHashes = await q(environment === "test"
      ? "select source_sha256 digest from of_test_deploy.migrations where migration_name='learn_commusoft_source_job_plan_v1'"
      : "select encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex') digest from supabase_migrations.schema_migrations where version='20261104151000'");
    if (plan.state !== "installed_verified" || plan.sourceSha256 !== planDigest || planHashes.length !== 1 || planHashes[0].digest !== planDigest) throw Error("Reader plan patch differs");
    expected = plan.expected;
  }
  // The later reviewed attention-filter migration changed only the public
  // cards reader. Preserve the exact original helper/dispatcher, privileges
  // and owner checks, then accept only its pinned post-patch function hash.
  const attentionReview = JSON.parse(readFileSync(
    "docs/operations/evidence/learn-build01-job-source-attention-2026-10-17.json", "utf8"));
  const attentionMigration = "supabase/migrations/20261104223200_learn_commusoft_source_attention_filters.sql";
  const attentionFunctionSha256 = "9c58f7efa51158baeac5bd0183cf36191b4ee6703f8eaf172e1bf37fe8eab0ef";
  const attentionSourceMatches = attentionReview.migration === attentionMigration &&
    attentionReview.migrationSha256 === hash(readFileSync(attentionMigration, "utf8"));
  const attentionCardsMatch = attentionSourceMatches && before.length === expected.length &&
    before.every((entry, index) => entry.name === expected[index].name &&
      (entry.name === "learn_commusoft_source_job_cards"
        ? entry.acl === expected[index].acl && entry.owner === expected[index].owner &&
          hash(entry.definition) === attentionFunctionSha256 &&
          createHash("md5").update(entry.definition).digest("hex") ===
            attentionReview.installedFunctionMd5OnTestAndLive
        : JSON.stringify(entry) === JSON.stringify(expected[index])));
  if (installed.sourceSha256 !== digest ||
      !(JSON.stringify(before) === JSON.stringify(expected) || attentionCardsMatch) ||
      hashes.length !== 1 || hashes[0].digest !== digest)
    throw Error("Installed source jobs contract differs; inspect before continuing");
  // The private helper intentionally has no EXECUTE grant for the management
  // read-only role. Use the owner endpoint inside an enforced read-only transaction.
  const result = { environment, project, observedAt: new Date().toISOString(), sourceSha256: digest, installedVerified: true, coverage: await q(`begin read only;set local statement_timeout=45000;set local enable_nestloop=off;${coverage};commit;`, false), providerRequests: 0, canonicalWrites: 0 };
  save("readback", result); console.log(JSON.stringify(result)); process.exit(0);
}
if (before.length !== 1 || before[0].name !== "openfolk_business_review") throw Error("Source job reader already exists or operator dispatcher unavailable");
const baseline = before[0];
const rehearsal = mode === "apply" ? read("rehearse-result") : null;
if (rehearsal && (rehearsal.sourceSha256 !== digest || rehearsal.state !== "rehearsed_rolled_back" ||
    Date.now() - Date.parse(rehearsal.observedAt) > 3600000 || JSON.stringify(before) !== JSON.stringify(rehearsal.baseline))) throw Error("Fresh exact rehearsal required");
if (mode === "apply") {
  const log = readFileSync(`${root}/local-tests.log`, "utf8");
  if (!log.includes("source preservation passed") || !log.includes("Actual SQL response passes the UI parser") || log.includes("Traceback")) throw Error("Successful isolated reader tests required");
  if (environment === "live") {
    const test = JSON.parse(readFileSync(`${root}/test-apply-result.json`, "utf8"));
    if (test.sourceSha256 !== digest || test.state !== "installed_verified") throw Error("Exact TEST installation required first");
  }
}
const guard = `do $$begin
 if pg_get_functiondef('public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure) is distinct from ${quote(baseline.definition)}
 or (select proacl::text from pg_proc where oid='public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure) is distinct from ${baseline.acl === null ? "null" : quote(baseline.acl)}
 then raise exception 'Commusoft operator baseline changed';end if;end$$;`;
const receipt = environment === "test"
  ? `insert into of_test_deploy.migrations(migration_name,source_sha256,project_ref) values('learn_commusoft_source_job_cards_v1','${digest}','${project}');`
  : `insert into supabase_migrations.schema_migrations(version,name,statements) values('20261104150000','learn_commusoft_source_job_cards',array[${quote(source)}]);`;
const body = source.replace(/^begin;$/m, "").replace(/^commit;$/m, "");
const assertPrivileges = `do $$begin
 if not has_function_privilege('authenticated','public.learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text)','EXECUTE')
 or has_function_privilege('anon','public.learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text)','EXECUTE')
 or has_function_privilege('service_role','public.learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text)','EXECUTE')
 or has_function_privilege('authenticated','public.learn_commusoft_source_job_rows(uuid,uuid)','EXECUTE') then raise exception 'Source jobs privilege mismatch';end if;end$$;`;
const sql = `begin;set local statement_timeout=45000;set local enable_nestloop=off;
 select pg_advisory_xact_lock(hashtextextended('commusoft-source-job-reader-release',0));
 ${guard}\n${body}\n${assertPrivileges}\n${receipt}\n${catalog};\n${mode === "rehearse" ? "rollback" : "commit"};`;
save(`${mode}-journal`, { environment, project, observedAt: new Date().toISOString(), sourceSha256: digest, baseline: before, sqlSha256: hash(sql) });
writeFileSync(`${root}/${environment}-rollback.sql`, `begin;\n${baseline.definition};\ndrop function public.learn_commusoft_source_job_cards(uuid,uuid,text,boolean,text);\ndrop function public.learn_commusoft_source_job_rows(uuid,uuid);\ncommit;\n`, { mode: 0o600 });
let expected;
try { expected = await q(sql, false); } catch (e) { save(`${mode}-uncertain`, { message: e.message, current: await q(catalog) }); throw e; }
const after = await q(catalog);
if (expected.length !== 3 || JSON.stringify(after) !== JSON.stringify(mode === "rehearse" ? before : rehearsal.expected) ||
    (mode === "apply" && JSON.stringify(expected) !== JSON.stringify(rehearsal.expected))) throw Error("Post-release readback differs; inspect journal");
const result = { state: mode === "rehearse" ? "rehearsed_rolled_back" : "installed_verified", environment, project, sourceSha256: digest, observedAt: new Date().toISOString(), baseline: before, expected };
save(`${mode}-result`, result);
console.log(JSON.stringify({ ...result, baseline: undefined, expected: undefined, providerRequests: 0, canonicalWrites: 0 }));
