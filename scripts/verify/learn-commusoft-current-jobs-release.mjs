/** Exact-target, journaled Commusoft-only SQL release. Never reads provider secrets.
 * inspect -> rehearse (rollback) -> apply -> activate -> readback.
 * Account activation is separate from installation and inherits existing consent.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
const [mode, environment] = process.argv.slice(2);
if (
  process.argv.length !== 4 ||
  ![
    "inspect",
    "rehearse",
    "apply",
    "activate",
    "pause",
    "readback",
    "probe",
    "rehearse-idle",
    "apply-idle",
  ].includes(mode) ||
  !["test", "live"].includes(environment)
)
  throw Error("Exact mode and test/live target required");
const project = environment === "live" ? "tgbnakbxwcqjeimygroz" : "saatxzwxvdvqevbnskxy";
const tenant =
  environment === "live"
    ? "00000000-0000-0000-0000-000000000001"
    : "f8c114fa-fee7-4983-8970-f6e7f5fd3129";
const root = ".verification-results/commusoft-current-jobs-20261016";
mkdirSync(root, { recursive: true, mode: 0o700 });
const idle = mode.endsWith("-idle"),
  operation = mode.replace("-idle", "");
const sourcePath = idle
  ? "supabase/migrations/20261103310000_learn_commusoft_current_jobs_idle.sql"
  : "supabase/migrations/20261103300000_learn_commusoft_current_jobs.sql";
const source = readFileSync(sourcePath, "utf8");
const hash = (x) => createHash("sha256").update(x).digest("hex");
const digest = hash(source);
const quote = (x) => "'" + x.replaceAll("'", "''") + "'";
const token = savedCliToken();
const save = (name, value) => {
  const fd = openSync(`${root}/${name}.json`, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
async function q(query, readOnly = true) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!r.ok) {
    writeFileSync(`${root}/${environment}-${mode}-private-error.txt`, await r.text(), {
      mode: 0o600,
    });
    throw Error(`Commusoft ${environment} ${mode} HTTP ${r.status}; private diagnostics retained`);
  }
  return r.json();
}
const names = [
  "learn_commusoft_claim_jobs",
  "learn_commusoft_recurring_page_allowed",
  "learn_commusoft_recurring_start",
  "learn_commusoft_schedule_recurring",
  "learn_commusoft_current_jobs_suspended",
  "learn_commusoft_current_jobs_start",
  "learn_commusoft_schedule_full",
  "learn_commusoft_schedule_current_jobs",
];
const catalog = `select p.proname name,pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,p.proacl::text acl,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${names.map(quote).join(",")}) order by p.proname`;
const readCatalog = () => q(catalog);
const normalize = (rows) => JSON.stringify(rows.map(({ owner, ...r }) => r));
const before = await readCatalog();
if (mode === "inspect") {
  save(`${environment}-functions`, before);
  console.log(JSON.stringify({ environment, project, functions: before.length }));
  process.exit(0);
}
if (["rehearse", "apply"].includes(operation)) {
  const baseline = idle
    ? JSON.parse(readFileSync(`${root}/${environment}-apply-result.json`)).expected
    : JSON.parse(readFileSync(`${root}/${environment}-functions.json`));
  if (before.length !== (idle ? 8 : 4) || normalize(before) !== normalize(baseline))
    throw Error("Exact Commusoft baseline changed");
  const log = readFileSync(`${root}/local-tests.log`, "utf8");
  if (
    !log.includes("Current jobs interleaved through real writer") ||
    !log.includes("Actual operator overview passes") ||
    log.includes("Traceback")
  )
    throw Error("Successful isolated SQL acceptance required");
  const rehearsal =
    operation === "apply"
      ? JSON.parse(
          readFileSync(`${root}/${environment}-rehearse${idle ? "-idle" : ""}-result.json`),
        )
      : null;
  if (
    rehearsal &&
    (rehearsal.sourceSha256 !== digest ||
      rehearsal.state !== "rehearsed_rolled_back" ||
      Date.now() - Date.parse(rehearsal.observedAt) > 3600000)
  )
    throw Error("Fresh exact rollback rehearsal required");
  const guard = baseline
    .map(
      (f) =>
        `if pg_get_functiondef(${quote("public." + f.name)}::regproc) is distinct from ${quote(f.definition)} or (select proacl::text from pg_proc where oid=${quote("public." + f.name)}::regproc) is distinct from ${f.acl === null ? "null" : quote(f.acl)} then raise exception 'Commusoft baseline changed';end if;`,
    )
    .join("\n");
  const body = source.replace(/^begin;$/m, "").replace(/^commit;$/m, "");
  const preserved = `select jsonb_build_object('pages',(select count(*) from public.learn_business_input_pages where tenant_id='${tenant}' and provider='commusoft'),'versions',(select count(*) from public.learn_business_input_versions where tenant_id='${tenant}' and provider='commusoft'),'links',(select count(*) from public.learn_business_input_links where tenant_id='${tenant}' and provider='commusoft'),'accounts',(select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.id),'')) from public.connector_accounts a join public.tenant_connectors c on c.id=a.tenant_connector_id where c.connector_id='commusoft'),'recurring',(select md5(coalesce(string_agg(to_jsonb(s)::text,'' order by account_id),'')) from public.learn_commusoft_recurring s)) value`;
  const assertions = `do $$begin
 ${idle ? "" : "if exists(select 1 from public.learn_commusoft_current_jobs) or exists(select 1 from public.learn_commusoft_current_job_receipts) then raise exception 'Installation activated capture';end if;"}
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_commusoft_current_jobs_suspended','learn_commusoft_current_jobs_start','learn_commusoft_schedule_full','learn_commusoft_schedule_current_jobs') and (not p.prosecdef or pg_get_userbyid(p.proowner)<>'postgres' or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))) then raise exception 'Private helper authority changed';end if;
 if (select value from commusoft_preserved) is distinct from (${preserved}) then raise exception 'Commusoft retained state changed';end if;
 end$$;`;
  const ledger =
    environment === "test"
      ? `insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values('${digest}','learn_commusoft_current_jobs${idle ? "_idle" : ""}_v1','${project}');`
      : `insert into supabase_migrations.schema_migrations(version,name,statements) values('${idle ? "20261103310000" : "20261103300000"}','learn_commusoft_current_jobs${idle ? "_idle" : ""}',array[${quote(source)}]);`;
  const sql = `begin isolation level repeatable read;set local lock_timeout='3s';set local statement_timeout='45s';set local search_path=public,pg_catalog;
 do $$begin ${guard} end$$;
 create temporary table commusoft_preserved on commit drop as ${preserved};
 ${body}\n${assertions}\n${ledger}\n${catalog};\n${operation === "rehearse" ? "rollback" : "commit"};`;
  save(`${environment}-${mode}-journal`, {
    project,
    sourceSha256: digest,
    startedAt: new Date().toISOString(),
    before,
    sqlSha256: hash(sql),
  });
  writeFileSync(
    `${root}/${environment}-rollback-${mode}.sql`,
    baseline.find(
      (r) =>
        r.name ===
        (idle ? "learn_commusoft_schedule_current_jobs" : "learn_commusoft_schedule_recurring"),
    ).definition,
    { mode: 0o600 },
  );
  let expected;
  try {
    expected = await q(sql, false);
  } catch (error) {
    save(`${environment}-${mode}-uncertain`, {
      message: error.message,
      readback: await readCatalog(),
    });
    throw error;
  }
  const after = await readCatalog();
  const valid =
    operation === "rehearse"
      ? normalize(after) === normalize(before) && expected.length === 8
      : normalize(after) === normalize(rehearsal.expected) && after.length === 8;
  if (!valid) throw Error("Post-release function readback differs; inspect journal");
  const result = {
    state: operation === "rehearse" ? "rehearsed_rolled_back" : "installed_verified",
    environment,
    project,
    sourceSha256: digest,
    observedAt: new Date().toISOString(),
    expected,
    baselineUnrelatedFunctionsPreserved: before
      .filter(
        (r) =>
          r.name !==
          (idle ? "learn_commusoft_schedule_current_jobs" : "learn_commusoft_schedule_recurring"),
      )
      .every((r) => expected.some((e) => normalize([e]) === normalize([r]))),
  };
  if (!result.baselineUnrelatedFunctionsPreserved) throw Error("Existing Commusoft guards changed");
  save(`${environment}-${mode}-result`, result);
  console.log(JSON.stringify({ ...result, expected: undefined }));
  process.exit(0);
}
if (mode === "probe") {
  if (environment !== "test") throw Error("Synthetic rollback probe is TEST-only");
  const applied = JSON.parse(
    readFileSync(
      `${root}/test-apply${existsSync(`${root}/test-apply-idle-result.json`) ? "-idle" : ""}-result.json`,
    ),
  );
  if (
    (applied.sourceSha256 !== digest &&
      applied.sourceSha256 !==
        hash(
          readFileSync("supabase/migrations/20261103310000_learn_commusoft_current_jobs_idle.sql"),
        )) ||
    normalize(before) !== normalize(applied.expected)
  )
    throw Error("Exact installed TEST release required");
  const fixture = readFileSync(
    "scripts/verify/learn-commusoft-current-jobs-hosted.assert.sql",
    "utf8",
  );
  const unchangedQuery = `select (select count(*) from public.learn_business_input_pages) pages,(select count(*) from public.learn_business_input_versions) versions,(select count(*) from public.learn_commusoft_current_job_receipts) receipts,(select count(*) from public.tenants where slug like 'commusoft-current-jobs-%') synthetic_tenants,(select count(*) from public.platform_authority_grants where granted_by='synthetic-current-jobs-rollback-probe') synthetic_grants`;
  const initial = await q(unchangedQuery);
  const receipt = await q(
    "begin;set local lock_timeout='3s';set local statement_timeout='45s';set local search_path=public,pg_catalog;" +
      fixture +
      "\nrollback;",
    false,
  );
  const after = await q(unchangedQuery);
  if (
    JSON.stringify(initial) !== JSON.stringify(after) ||
    receipt.length !== 1 ||
    receipt[0].marker !== "hosted_test_current_jobs_interleave_restore_and_source_history_verified"
  )
    throw Error("TEST probe preservation or receipt differs");
  const result = {
    environment,
    project,
    sourceSha256: digest,
    installedFollowupSha256: applied.sourceSha256,
    fixtureSha256: hash(fixture),
    observedAt: new Date().toISOString(),
    receipt,
    rolledBack: true,
    preservationPassed: true,
    providerRequests: 0,
  };
  save("test-hosted-probe", result);
  console.log(JSON.stringify(result));
  process.exit(0);
}
if (["activate", "pause"].includes(mode)) {
  const applied = JSON.parse(
    readFileSync(
      `${root}/${environment}-apply${existsSync(`${root}/${environment}-apply-idle-result.json`) ? "-idle" : ""}-result.json`,
    ),
  );
  if (
    (applied.sourceSha256 !== digest &&
      applied.sourceSha256 !==
        hash(
          readFileSync("supabase/migrations/20261103310000_learn_commusoft_current_jobs_idle.sql"),
        )) ||
    normalize(before) !== normalize(applied.expected)
  )
    throw Error("Exact installed release required");
  const enabled = mode === "activate";
  const sql = `begin;set local lock_timeout='3s';set local statement_timeout='15s';
 select pg_advisory_xact_lock(hashtextextended('learn-input-setup:${tenant}',0));
 ${
   enabled
     ? `do $$begin if (select count(*) from public.learn_commusoft_recurring s join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id where s.tenant_id='${tenant}' and s.enabled and c.status='configured' and c.revoked_at is null and c.updated_at=s.connection_revision and public.learn_commusoft_recurring_actor(s.approved_by))<>1 then raise exception 'One approved Drummonds account required';end if;end$$;
 insert into public.learn_commusoft_current_jobs(account_id,tenant_id,enabled)
 select account_id,tenant_id,true from public.learn_commusoft_recurring where tenant_id='${tenant}' and enabled
 on conflict(account_id) do update set enabled=true,next_check_at=clock_timestamp(),updated_at=clock_timestamp();`
     : `update public.learn_commusoft_current_jobs set enabled=false,next_check_at=clock_timestamp(),updated_at=clock_timestamp() where tenant_id='${tenant}';`
 }
 select enabled,last_state from public.learn_commusoft_current_jobs where tenant_id='${tenant}';commit;`;
  save(`${environment}-${mode}-journal`, {
    project,
    tenant,
    sourceSha256: digest,
    startedAt: new Date().toISOString(),
    sqlSha256: hash(sql),
    existingRecurringConsentRequired: true,
  });
  const receipt = await q(sql, false);
  save(`${environment}-${mode}-result`, { receipt, observedAt: new Date().toISOString() });
  console.log(JSON.stringify({ environment, project, mode, receipt }));
  process.exit(0);
}
const installed = JSON.parse(readFileSync(`${root}/${environment}-apply-idle-result.json`));
if (normalize(before) !== normalize(installed.expected))
  throw Error("Installed Commusoft functions differ from verified release");
const ledger = await q(
  environment === "live"
    ? "select version,encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex') sha256 from supabase_migrations.schema_migrations where version in ('20261103300000','20261103310000') order by version"
    : "select migration_name version,source_sha256 sha256 from of_test_deploy.migrations where migration_name in ('learn_commusoft_current_jobs_v1','learn_commusoft_current_jobs_idle_v1') order by migration_name",
);
const sourceHashes = [
  hash(readFileSync("supabase/migrations/20261103300000_learn_commusoft_current_jobs.sql")),
  hash(readFileSync("supabase/migrations/20261103310000_learn_commusoft_current_jobs_idle.sql")),
].sort();
if (JSON.stringify(ledger.map((x) => x.sha256).sort()) !== JSON.stringify(sourceHashes))
  throw Error("Installed Commusoft migration ledger differs from source");
const rows =
  await q(`select f.enabled,f.last_state,f.watermark,f.next_check_at,f.current_request is not null active_jobs_window,
 s.phase,s.last_state recurring_state,s.watermark full_cycle_watermark,a.settings->'commusoft_import'->>'resource' resource,
 (a.sync_cursor->>'propertiesCompleted')::int contact_properties_completed,
 (select count(*)::int from public.learn_commusoft_current_job_receipts r where r.account_id=f.account_id and r.stage='completed') completed_windows,
 (select count(*)::int from public.learn_commusoft_current_job_receipts r where r.account_id=f.account_id and r.stage='incomplete') incomplete_windows,
 (select max(committed_at) from public.learn_business_input_pages p where p.tenant_id=f.tenant_id and p.provider='commusoft' and p.collection='jobs') newest_job_page
 from public.learn_commusoft_current_jobs f join public.learn_commusoft_recurring s using(account_id,tenant_id)
 join public.connector_accounts a on a.id=f.account_id and a.tenant_id=f.tenant_id where f.tenant_id='${tenant}'`);
const report = {
  environment,
  project,
  observedAt: new Date().toISOString(),
  sourceSha256: digest,
  idleSourceSha256: hash(
    readFileSync("supabase/migrations/20261103310000_learn_commusoft_current_jobs_idle.sql"),
  ),
  rows,
  installedFunctionsAndLedgerVerified: true,
  providerSettingsChanged: false,
  customerContentReturned: false,
};
save(`${environment}-readback`, report);
console.log(JSON.stringify(report));
