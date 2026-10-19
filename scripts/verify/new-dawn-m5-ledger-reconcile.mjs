/** Exact receipt for the already-installed M5 opportunity probe migration.
 * LIVE write mode changes only one Supabase migration-ledger row. It never
 * installs schema, enables a flag, reads a provider, or retries an unknown write.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { testRollbackSql } from "./new-dawn-m2-exact-sql-release.mjs";

export const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
export const VERSION = "20261106130000";
export const NAME = "new_dawn_commusoft_opportunities_probe";
export const SOURCE_SHA256 = "b69d9e46e89554f1497291f9e72a24aa4338090d4bf37559d23503d8e69a3708";
export const SCHEMA_SHA256 = "e1a19063cb918e66ae60fe1252616625c1e7c28ef9d7e4410acd1c2d9249abfc";
export const SQL_SCHEMA_SHA256 = "01bfa31820179437bb6d787dc03e905f0e984507de26edf63b04184dfde2a4ad";
export const FUNCTION_HASHES = Object.freeze({
  "new_dawn_commusoft_opportunity_probe_acquire(uuid)":
    "024964e8ebd026bb12488f1c749f87437fa48ab0b7c9298a063be8cb880e600a",
  "new_dawn_commusoft_opportunity_probe_authority(new_dawn_commusoft_opportunity_probes)":
    "dea2308254825e0ac7eac436f880df802e77bbeee0b56595cfc3e0474d0d2b13",
  "new_dawn_commusoft_opportunity_probe_current(uuid, uuid)":
    "9f969e599bf01792cccb42d1ee445b740c1352cbe4f35b8a8f082def3664d35e",
  "new_dawn_commusoft_opportunity_probe_fail(uuid, text)":
    "01bae60e0b42fdc9ee1221da0143951f8d5dafa3e7a552b8cf1e045341465347",
  "new_dawn_commusoft_opportunity_probe_fail(uuid, text, timestamp with time zone)":
    "cbd01801fea6727dd67576e4e0d262c53d36c5fe3e35e6bf72e6bc2d73f0517f",
  "new_dawn_commusoft_opportunity_probe_finish(uuid, uuid, text)":
    "d487833bf0db3cc0d1730ea0570f26e99eba704c817dd937215a6e6de926a950",
  "new_dawn_commusoft_opportunity_probe_guard()":
    "882f23f674ae81b3a82faa5e683ff20519e7abcfa808016bd6d873b6095936d1",
  "new_dawn_commusoft_opportunity_probe_result(uuid)":
    "6b294eefdc6c451e0d7645aef9a9994ce0098e86a9d3dfe52f6b5a1a5ad7055e",
  "new_dawn_commusoft_opportunity_probe_start(uuid, uuid, uuid, text)":
    "ab97b5e24efbab0e234d705ca886b1bedddbedee230f8eed6a434fdbc2a94b26",
  "new_dawn_commusoft_opportunity_probe_summarize(text)":
    "c76fb2117996dea01a7c344db604d555307095293b0ca06a91871806a471a0ef",
});

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const sha = (value) => createHash("sha256").update(value).digest("hex");

export function source() {
  const text = readFileSync(
    new URL(`../../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url),
    "utf8",
  );
  if (
    sha(text) !== SOURCE_SHA256 ||
    !/^\s*(?:--[^\n]*\n)*begin;\s*$/im.test(text) ||
    !/\ncommit;\s*$/i.test(text)
  )
    throw Error("m5_reviewed_migration_source_changed");
  return text;
}

// Captures structural properties only. No raw opportunity, tenant, or Vault data.
export const catalogSql = `select jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object(
  'signature',p.proname||'('||oidvectortypes(p.proargtypes)||')',
  'sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
  'definer',p.prosecdef,'config',p.proconfig,
  'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
  'service',has_function_privilege('service_role',p.oid,'EXECUTE'))
  order by p.proname,oidvectortypes(p.proargtypes)),'[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'new_dawn_commusoft_opportunity_probe_%'),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object(
  'name',c.relname,'rls',c.relrowsecurity,
  'anon',has_table_privilege('anon',c.oid,'SELECT'),
  'authenticated',has_table_privilege('authenticated',c.oid,'SELECT'),
  'service',has_table_privilege('service_role',c.oid,'SELECT'),
  'columns',(select coalesce(jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
   pg_get_expr(d.adbin,d.adrelid)) order by a.attnum),'[]'::jsonb)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid,true)) order by k.conname),'[]'::jsonb)
   from pg_constraint k where k.conrelid=c.oid),
  'indexes',(select coalesce(jsonb_agg(jsonb_build_array(i.relname,pg_get_indexdef(x.indexrelid)) order by i.relname),'[]'::jsonb)
   from pg_index x join pg_class i on i.oid=x.indexrelid where x.indrelid=c.oid),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,true)) order by t.tgname),'[]'::jsonb)
   from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname),'[]'::jsonb)
  from pg_class c where c.oid in
   (to_regclass('public.new_dawn_commusoft_opportunity_probes'),
    to_regclass('public.new_dawn_commusoft_opportunity_probe_events'))),
 'ledger',(select coalesce(jsonb_agg(version::text order by version::text),'[]'::jsonb)
   from supabase_migrations.schema_migrations where version::text in
   ('20261106130000','20261106150000','20261106160000','20261106180000')),
 'flag_count',(select count(*) from public.feature_flags
   where flag='new_dawn.m5_opportunities_probe' and value='true'::jsonb),
 'receipt_count',(select count(*) from public.new_dawn_commusoft_opportunity_probes)
) as catalog`;

export function assessCatalog(catalog, { requireMissing = true } = {}) {
  if (
    !catalog ||
    !Array.isArray(catalog.functions) ||
    !Array.isArray(catalog.tables) ||
    catalog.functions.length !== 10 ||
    catalog.tables.length !== 2 ||
    Number(catalog.flag_count) !== 0 ||
    Number(catalog.receipt_count) !== 0
  )
    throw Error("m5_catalog_scope_changed");
  const actual = Object.fromEntries(catalog.functions.map((row) => [row.signature, row.sha256]));
  if (JSON.stringify(actual) !== JSON.stringify(FUNCTION_HASHES))
    throw Error("m5_function_hashes_changed");
  for (const row of catalog.functions) {
    const expectedAuth =
      row.signature.endsWith("_start(uuid, uuid, uuid, text)") ||
      row.signature.endsWith("_result(uuid)");
    const expectedService = [
      "_acquire(uuid)",
      "_current(uuid, uuid)",
      "_fail(uuid, text)",
      "_fail(uuid, text, timestamp with time zone)",
      "_finish(uuid, uuid, text)",
      "_summarize(text)",
    ].some((suffix) => row.signature.endsWith(suffix));
    if (
      row.anon !== false ||
      row.authenticated !== expectedAuth ||
      row.service !== expectedService ||
      row.config?.length !== 1 ||
      row.config[0] !== "search_path=pg_catalog" ||
      row.definer !== (row.signature.includes("_summarize(") ? false : true)
    )
      throw Error("m5_function_grants_changed");
  }
  if (
    catalog.tables.some(
      (row) =>
        row.rls !== true ||
        row.anon !== false ||
        row.authenticated !== false ||
        row.service !== false,
    )
  )
    throw Error("m5_table_grants_changed");
  const ledger = catalog.ledger;
  if (
    !Array.isArray(ledger) ||
    (requireMissing
      ? JSON.stringify(ledger) !==
        JSON.stringify(["20261106150000", "20261106160000", "20261106180000"])
      : JSON.stringify(ledger) !==
        JSON.stringify([VERSION, "20261106150000", "20261106160000", "20261106180000"]))
  )
    throw Error("m5_ledger_stage_changed");
  const schemaHash = sha(JSON.stringify(catalog.tables));
  if (schemaHash !== SCHEMA_SHA256) throw Error("m5_schema_hash_changed");
  return { schemaHash, functions: actual };
}

export const LEDGER_SQL = `select version::text,name,statements from supabase_migrations.schema_migrations
 where version::text='${VERSION}'`;
export function exactLedger(rows, text = source()) {
  return (
    Array.isArray(rows) &&
    rows.length === 1 &&
    rows[0]?.version === VERSION &&
    rows[0]?.name === NAME &&
    Array.isArray(rows[0]?.statements) &&
    rows[0].statements.length === 1 &&
    rows[0].statements[0] === text
  );
}

export function reconciliationSql(text = source(), rollback = false) {
  if (sha(text) !== SOURCE_SHA256) throw Error("m5_source_changed");
  const hashes = Object.entries(FUNCTION_HASHES)
    .map(([signature, digest]) => `('${signature}', '${digest}')`)
    .join(",\n   ");
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
lock table public.new_dawn_commusoft_opportunity_probes,
 public.new_dawn_commusoft_opportunity_probe_events in access share mode;
do $m5_gate$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version::text='${VERSION}')
  or not exists(select 1 from supabase_migrations.schema_migrations where version::text='20261106150000')
  or not exists(select 1 from supabase_migrations.schema_migrations where version::text='20261106160000')
  or not exists(select 1 from supabase_migrations.schema_migrations where version::text='20261106180000')
  or exists(select 1 from public.feature_flags where flag='new_dawn.m5_opportunities_probe' and value='true'::jsonb)
  or exists(select 1 from public.new_dawn_commusoft_opportunity_probes)
  or (select encode(sha256(convert_to((catalog->'tables')::text,'UTF8')),'hex')
      from (${catalogSql}) m5_catalog) is distinct from '${SQL_SCHEMA_SHA256}'
  or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'new_dawn_commusoft_opportunity_probe_%')<>10
  or exists(select 1 from (values ${hashes}) expected(signature,digest)
   left join pg_proc p on p.proname||'('||oidvectortypes(p.proargtypes)||')'=expected.signature
    and p.pronamespace='public'::regnamespace
   where encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')
     is distinct from expected.digest)
 then raise exception 'm5_installed_catalog_or_ledger_changed'; end if;
end $m5_gate$;
insert into supabase_migrations.schema_migrations(version,name,statements)
 values(${quote(VERSION)},${quote(NAME)},array[${quote(text)}]);
select 'new-dawn-m5-ledger-reconciled/1' as marker;
${rollback ? "rollback" : "commit"};`;
}

async function query(project, token, sql, readOnly = true, fetcher = fetch) {
  const response = await fetcher(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(90000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
    },
  );
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const code =
      typeof problem?.code === "string" && /^[A-Z0-9]{5}$/.test(problem.code)
        ? problem.code
        : "unknown";
    throw Error(
      `m5_ledger_${readOnly ? "read" : "transaction"}_http_${response.status}_sqlstate_${code}`,
    );
  }
  return response.json();
}

export async function readCatalog(
  project = LIVE_PROJECT,
  token = savedCliToken(),
  fetcher = fetch,
) {
  const rows = await query(project, token, catalogSql, true, fetcher);
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.catalog)
    throw Error("m5_catalog_read_shape_invalid");
  return rows[0].catalog;
}

export async function readLive(token = savedCliToken(), fetcher = fetch) {
  const catalog = await readCatalog(LIVE_PROJECT, token, fetcher);
  return {
    catalog,
    assessment: assessCatalog(catalog),
    ledger: await query(LIVE_PROJECT, token, LEDGER_SQL, true, fetcher),
  };
}

export async function reconcileLive({
  token = savedCliToken(),
  fetcher = fetch,
  writer,
  readBefore = readLive,
  assessAfter = assessCatalog,
  readAfter = async (currentToken, currentFetcher) => ({
    catalog: await readCatalog(LIVE_PROJECT, currentToken, currentFetcher),
    ledger: await query(LIVE_PROJECT, currentToken, LEDGER_SQL, true, currentFetcher),
  }),
} = {}) {
  const before = await readBefore(token, fetcher);
  if (before.ledger.length !== 0) throw Error("m5_ledger_preflight_changed");
  let acknowledged = false;
  try {
    const rows = await (writer ?? ((sql) => query(LIVE_PROJECT, token, sql, false, fetcher)))(
      reconciliationSql(),
    );
    acknowledged =
      rows?.some?.((row) => row?.marker === "new-dawn-m5-ledger-reconciled/1") === true;
  } catch {
    /* Unknown write outcome: read back once and never replay automatically. */
  }
  const { catalog, ledger } = await readAfter(token, fetcher);
  try {
    const after = assessAfter(catalog, { requireMissing: false });
    if (after.schemaHash !== before.assessment.schemaHash || !exactLedger(ledger))
      throw Error("m5_postwrite_changed");
  } catch {
    throw Error("m5_ledger_outcome_unverified_no_replay");
  }
  return {
    state: "exact_ledger_reconciled",
    project: LIVE_PROJECT,
    version: VERSION,
    sourceSha256: SOURCE_SHA256,
    schemaSha256: before.assessment.schemaHash,
    acknowledged,
    flagsEnabled: false,
    providerRequests: 0,
  };
}

export function testRehearsalSql() {
  const base = testRollbackSql();
  if (!base.startsWith("begin;\n") || !base.endsWith("\nrollback;"))
    throw Error("m5_test_baseline_changed");
  const body = base.slice(0, -"rollback;".length);
  return (
    body +
    reconciliationSql(source(), true)
      .replace(/^begin;\n/, "")
      .replace(/rollback;\s*$/, "") +
    `select 'new-dawn-m5-ledger-test/1' as test_marker,
     (select catalog from (${catalogSql}) m5_catalog) as catalog;\nrollback;`
  );
}

export async function rehearseTest({ token = savedCliToken(), fetcher = fetch } = {}) {
  const before = await query(
    TEST_PROJECT,
    token,
    `select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent,
     to_regclass('public.new_dawn_commusoft_opportunity_probes') is null as probe_absent`,
    true,
    fetcher,
  );
  if (before.length !== 1 || before[0]?.ledger_absent !== true || before[0]?.probe_absent !== true)
    throw Error("m5_test_baseline_not_empty");
  let rows, failure;
  try {
    rows = await query(TEST_PROJECT, token, testRehearsalSql(), false, fetcher);
  } catch (error) {
    failure = error;
  }
  const after = await query(
    TEST_PROJECT,
    token,
    `select to_regclass('supabase_migrations.schema_migrations') is null as ledger_absent,
     to_regclass('public.new_dawn_commusoft_opportunity_probes') is null as probe_absent`,
    true,
    fetcher,
  );
  if (JSON.stringify(after) !== JSON.stringify(before)) throw Error("m5_test_rollback_unverified");
  if (failure) throw failure;
  const receipt = rows?.find?.((row) => row.test_marker === "new-dawn-m5-ledger-test/1");
  if (!receipt) throw Error("m5_test_rehearsal_marker_missing");
  assessCatalog(receipt.catalog, { requireMissing: false });
  return {
    state: "passed_rolled_back",
    project: TEST_PROJECT,
    version: VERSION,
    sourceSha256: SOURCE_SHA256,
    providerRequests: 0,
    featureEnabled: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv.slice(2).join(" ");
  try {
    if (mode === "--live-read-only") {
      const result = await readLive();
      console.log(
        JSON.stringify({
          state: "ledger_missing",
          project: LIVE_PROJECT,
          version: VERSION,
          sourceSha256: SOURCE_SHA256,
          schemaSha256: result.assessment.schemaHash,
          ledgerRows: result.ledger.length,
          flagsEnabled: false,
          providerRequests: 0,
        }),
      );
    } else if (mode === "--test-rollback-only") console.log(JSON.stringify(await rehearseTest()));
    else if (
      mode === `--live-reconcile --source-sha ${SOURCE_SHA256}` &&
      process.env.NEW_DAWN_M5_LEDGER_PROJECT === LIVE_PROJECT
    )
      console.log(JSON.stringify(await reconcileLive()));
    else throw Error("m5_exact_mode_and_project_required");
  } catch (error) {
    console.error(
      JSON.stringify({
        state: "stopped",
        code: error.message,
        retryAllowed: false,
        providerRequests: 0,
      }),
    );
    process.exitCode = 1;
  }
}
