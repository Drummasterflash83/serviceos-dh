/** Read-only runtime binding for a bounded Workspace fetch retry candidate. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-read-only", "--test-read-only", "--test-candidate-read-only"].includes(mode))
  throw Error("Exact read-only mode required");
const project = mode === "--live-read-only" ? "tgbnakbxwcqjeimygroz" : TEST_PROJECT;
const query = `select jsonb_build_object(
  'definitionMd5',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
  'securityDefiner',p.prosecdef,
  'oldBlockMatch',strpos(pg_get_functiondef(p.oid),
    'c.state:=''blocked''; c.owner_attempt_id:=null; c.block_code:=p_payload->>''error_code'';')>0,
  'boundedRetryMatch',strpos(pg_get_functiondef(p.oid),
    'p_payload#>>''{attempt_evidence,persistence}''=''confirmed''')>0,
  'functionCount',(select count(*) from pg_proc q where q.pronamespace=p.pronamespace
    and q.proname='email_ingestion_transition_v2'),
  'syntheticFixtureAbsent',not exists(select 1 from public.tenants
    where id='ec390000-cccc-4000-8000-000000000001'),
  'observedAt',clock_timestamp()) as binding
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.oid=
  'public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST",
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
});
if (!response.ok) throw Error(`Retry preflight failed (HTTP ${response.status})`);
const rows = await response.json();
const binding = rows?.[0]?.binding;
if (!Array.isArray(rows) || rows.length !== 1 ||
  !/^[a-f0-9]{32}$/.test(binding?.definitionMd5 ?? "") ||
  (mode === "--test-candidate-read-only" ?
    binding?.definitionMd5 !== "c0f6296f051aada999af147773066cac" ||
      binding?.oldBlockMatch !== false || binding?.boundedRetryMatch !== true :
    binding?.definitionMd5 !== "45a140fffe35e7e3de3597eb848cfbc2" ||
      binding?.oldBlockMatch !== true || binding?.boundedRetryMatch !== false) ||
  binding?.functionCount !== 1 ||
  binding?.securityDefiner !== true || binding?.syntheticFixtureAbsent !== true)
  throw Error("Retry function binding changed");
console.log(JSON.stringify({ project, ...binding, productionDataWrites: false,
  customerRowsRead: false, credentialsPrinted: false }));
