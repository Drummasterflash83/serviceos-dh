/** Exact additive replacement of the operator-only recent-source read. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const version = "20261107180000";
const name = "new_dawn_recent_unlinked_commusoft_jobs_bounded";
const signature = "public.new_dawn_recent_unlinked_commusoft_jobs(uuid,uuid,text)";
const migrationHash = "413b0567c78c1d53a05cecb8b0af7d80c3325180966fddef548ecbe9967a10d5";
const beforeHash = "9c9ab7596c4c77b0c4dc877a3cb04ad6";
const afterHash = "bf34a2ff69da6bb25b372c218e042718";
const quote = (text) => `'${text.replaceAll("'", "''")}'`;

const migration = readFileSync(
  new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url),
  "utf8",
);
if (
  createHash("sha256").update(migration).digest("hex") !== migrationHash ||
  !/^--[\s\S]*\nbegin;\n/.test(migration) ||
  !/\ncommit;\s*$/.test(migration)
)
  throw Error("Reviewed bounded recent-source migration changed");
const body = migration.replace(/^([\s\S]*?)\nbegin;\n/, "").replace(/\ncommit;\s*$/, "");

async function query(sql, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? "/read-only" : ""}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql, ...(readOnly ? {} : { read_only: false }) }),
      redirect: "error",
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const marker = String(failure?.message ?? failure?.code ?? "unknown")
      .match(/ERROR:\s+[A-Z0-9]{5}:\s+([a-z_]{3,80})/)?.[1] ?? "unknown";
    throw Error(`Bounded recent-source ${readOnly ? "read" : "release"} failed: HTTP ${response.status}, marker ${marker}`);
  }
  return response.json();
}

async function snapshot() {
  const [catalog] = await query(`select
 md5(pg_get_functiondef('${signature}'::regprocedure)) definition_hash,
 (select prosecdef from pg_proc where oid='${signature}'::regprocedure) security_definer,
 (select 'statement_timeout=15s'=any(proconfig) from pg_proc where oid='${signature}'::regprocedure) bounded_timeout,
 has_function_privilege('authenticated','${signature}','EXECUTE') authenticated_execute,
 has_function_privilege('anon','${signature}','EXECUTE') anon_execute,
 has_function_privilege('service_role','${signature}','EXECUTE') service_execute,
 (select count(*)::int from public.feature_flags where flag='new_dawn.source_job_home'
  and value='true'::jsonb) client_enabled`);
  const ledger = await query(`select version::text,name,statements from supabase_migrations.schema_migrations
    where version::text='${version}'`);
  return { catalog, ledger };
}

function assess(state, installed) {
  const c = state?.catalog;
  if (
    !c || c.definition_hash !== (installed ? afterHash : beforeHash) ||
    !c.security_definer || !c.bounded_timeout || !c.authenticated_execute ||
    c.anon_execute || c.service_execute || c.client_enabled !== 0 ||
    state.ledger.length !== (installed ? 1 : 0)
  )
    throw Error(`Bounded recent-source ${installed ? "postflight" : "preflight"} changed`);
  if (installed && (
    state.ledger[0].version !== version || state.ledger[0].name !== name ||
    state.ledger[0].statements?.length !== 1 ||
    state.ledger[0].statements[0] !== migration
  ))
    throw Error("Bounded recent-source exact ledger changed");
}

function releaseSql() {
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $preflight$ begin
 if md5(pg_get_functiondef('${signature}'::regprocedure))<>'${beforeHash}'
  or exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}')
  or exists(select 1 from public.feature_flags where flag='new_dawn.source_job_home'
   and value='true'::jsonb)
 then raise exception 'bounded_recent_source_preflight_changed';end if;
end $preflight$;
${body}
insert into supabase_migrations.schema_migrations(version,name,statements)
 values('${version}','${name}',array[${quote(migration)}]);
do $postflight$ begin
 if md5(pg_get_functiondef('${signature}'::regprocedure))<>'${afterHash}'
  or not has_function_privilege('authenticated','${signature}','EXECUTE')
  or has_function_privilege('anon','${signature}','EXECUTE')
  or has_function_privilege('service_role','${signature}','EXECUTE')
  or exists(select 1 from public.feature_flags where flag='new_dawn.source_job_home'
   and value='true'::jsonb)
 then raise exception 'bounded_recent_source_postflight_changed';end if;
end $postflight$;
select 'bounded-recent-source-installed/1' as marker;
commit;`;
}

const mode = process.argv.slice(2).join(" ");
if (!["--live-read-only", "--live-install-after-review"].includes(mode))
  throw Error("Exact bounded recent-source release mode required");
if (mode === "--live-read-only") {
  const state = await snapshot();
  assess(state, state.ledger.length === 1);
  console.log(JSON.stringify({ state: state.ledger.length ? "installed" : "prepared",
    version, definitionHash: state.catalog.definition_hash, clientFlagEnabled: false }));
} else {
  assess(await snapshot(), false);
  let acknowledged = false;
  try {
    const result = await query(releaseSql(), false);
    acknowledged = result?.some?.((row) => row.marker === "bounded-recent-source-installed/1") === true;
  } catch {
    // Inspect exact runtime state once; never replay an uncertain transaction.
  }
  const state = await snapshot();
  assess(state, true);
  console.log(JSON.stringify({ state: "installed", version, acknowledged,
    definitionHash: state.catalog.definition_hash, exactLedger: true,
    clientFlagEnabled: false, providerRequests: 0 }));
}
