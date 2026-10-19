/** Drummonds-only M1 OpenFolk preview switch. Client source-home stays OFF.
 * The preview RPC separately checks real operator authority, reason and audit.
 */
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
import { migrationBodies } from './new-dawn-m1-source-home-release.mjs';

const PROJECT='tgbnakbxwcqjeimygroz';
const TENANT='00000000-0000-0000-0000-000000000001';
const CLIENT='new_dawn.source_job_home';
const OPERATOR='new_dawn.source_job_home.operator_preview';
const SIGNATURE='public.new_dawn_source_job_home(uuid,text)';
const statusSql=`select
 to_regprocedure('${SIGNATURE}') is not null as installed,
 position('${OPERATOR}' in coalesce(pg_get_functiondef(to_regprocedure('${SIGNATURE}')),''))>0 as separate_gate,
 (select count(*)::integer from public.feature_flags where flag='${CLIENT}' and value='true'::jsonb) as client_enabled,
 (select count(*)::integer from public.feature_flags where flag='${OPERATOR}' and value='true'::jsonb) as operator_enabled,
 (select count(*)::integer from public.feature_flags where tenant_id='${TENANT}'::uuid
  and flag='${OPERATOR}' and value='true'::jsonb) as drummonds_operator_enabled`;

export function flagSql(enable, rollback=false, tenant=TENANT) {
  if (typeof enable!=='boolean' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenant))
    throw Error('M1 preview flag operation invalid');
  const update=enable ? `update public.feature_flags set value='true'::jsonb
 where tenant_id='${tenant}'::uuid and flag='${OPERATOR}';
 if not found then insert into public.feature_flags(tenant_id,flag,value)
  values('${tenant}'::uuid,'${OPERATOR}','true'::jsonb);end if;` :
    `update public.feature_flags set value='false'::jsonb
 where tenant_id='${tenant}'::uuid and flag='${OPERATOR}';`;
  return `begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
lock table public.feature_flags in share row exclusive mode;
do $m1_preview_gate$ begin
 if to_regprocedure('${SIGNATURE}') is null
  or position('${OPERATOR}' in pg_get_functiondef('${SIGNATURE}'::regprocedure))=0
  or exists(select 1 from public.feature_flags where flag='${CLIENT}' and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${OPERATOR}' and value='true'::jsonb)<>${enable?0:1}
  or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
    and flag='${OPERATOR}' and value='true'::jsonb)<>${enable?0:1}
  then raise exception 'm1_operator_preview_preflight_changed';end if;
 ${update}
 if exists(select 1 from public.feature_flags where flag='${CLIENT}' and value='true'::jsonb)
  or (select count(*) from public.feature_flags where flag='${OPERATOR}' and value='true'::jsonb)<>${enable?1:0}
  or (select count(*) from public.feature_flags where tenant_id='${tenant}'::uuid
    and flag='${OPERATOR}' and value='true'::jsonb)<>${enable?1:0}
  then raise exception 'm1_operator_preview_scope_changed';end if;
end $m1_preview_gate$;
select '${enable?'new-dawn-m1-operator-preview-enabled/1':'new-dawn-m1-operator-preview-disabled/1'}' as marker;
${rollback?'rollback':'commit'};`;
}

async function query(token,project,sql,readOnly=true) {
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),
    redirect:'error',signal:AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const problem=await response.json().catch(()=>null);
    const embedded=typeof problem?.message==='string' ?
      problem.message.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] : null;
    const code=typeof problem?.code==='string' && /^[A-Z0-9]{5}$/.test(problem.code)
      ? problem.code : embedded ?? 'unknown';
    throw Error(`M1 preview ${readOnly?'read':'transaction'} failed (HTTP ${response.status}, SQLSTATE ${code})`);
  }
  return response.json();
}

export async function readLive() {
  const rows=await query(savedCliToken(),PROJECT,statusSql);
  if (!rows?.[0]) throw Error('M1 preview status missing');
  return rows[0];
}

export async function switchLive(enable) {
  const before=await readLive();
  if (!before.installed || !before.separate_gate || before.client_enabled!==0 ||
      before.operator_enabled!==(enable?0:1) ||
      before.drummonds_operator_enabled!==(enable?0:1))
    throw Error('M1 preview LIVE preflight changed; no flag write attempted');
  const token=savedCliToken();
  let acknowledged=false;
  try {
    const rows=await query(token,PROJECT,flagSql(enable),false);
    acknowledged=rows?.some?.(row=>row.marker===
      (enable?'new-dawn-m1-operator-preview-enabled/1':'new-dawn-m1-operator-preview-disabled/1'))===true;
  } catch { /* One exact readback; never automatically replay an uncertain write. */ }
  const after=await readLive();
  if (!after.installed || !after.separate_gate || after.client_enabled!==0 ||
      after.operator_enabled!==(enable?1:0) ||
      after.drummonds_operator_enabled!==(enable?1:0))
    throw Error('M1 preview flag outcome unverified; inspect and do not retry automatically');
  return {state:enable?'drummonds_operator_preview_only':'operator_preview_off',project:PROJECT,
    acknowledged,clientFlagEnabled:false,operatorFlagEnabled:enable,providerRequests:0};
}

export async function rehearseTest() {
  const token=savedCliToken();
  const before=(await query(token,TEST_PROJECT,statusSql))[0];
  if (!before || before.installed || before.client_enabled!==0 || before.operator_enabled!==0)
    throw Error('TEST M1 preview rehearsal preflight changed');
  const tenants=await query(token,TEST_PROJECT,
    `select id::text from public.tenants where status='active' order by id limit 1`);
  const testTenant=tenants?.[0]?.id;
  if (!testTenant) throw Error('TEST M1 preview rehearsal tenant missing');
  const [base,gate]=migrationBodies();
  const sql=`begin;\n${base}\n${gate}\n`+
    flagSql(true,true,testTenant).replace(/^begin;\n/,'').replace(/rollback;\s*$/,'')+
    flagSql(false,true,testTenant).replace(/^begin;\n/,'').replace(/rollback;\s*$/,'')+
    `rollback;`;
  let rows,error;
  try { rows=await query(token,TEST_PROJECT,sql,false); }
  catch (cause) { error=cause; }
  const after=(await query(token,TEST_PROJECT,statusSql))[0];
  if (JSON.stringify(before)!==JSON.stringify(after))
    throw Error('TEST M1 preview rehearsal did not roll back');
  if (error) throw error;
  if (!rows?.some?.(row=>row.marker==='new-dawn-m1-operator-preview-disabled/1'))
    throw Error('TEST M1 preview rehearsal receipt missing');
  return {state:'passed_rolled_back',project:TEST_PROJECT,clientFlagEnabled:false,providerRequests:0};
}

if (process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href) {
  const mode=process.argv.slice(2).join(' ');
  if (!['--live-read-only','--test-rollback-only','--live-enable-drummonds-operator-preview',
    '--live-disable-drummonds-operator-preview'].includes(mode)) throw Error('Exact M1 preview mode required');
  try {
    const result=mode==='--live-read-only' ? await readLive() :
      mode==='--test-rollback-only' ? await rehearseTest() :
      await switchLive(mode==='--live-enable-drummonds-operator-preview');
    console.log(JSON.stringify(mode==='--live-read-only' ? {
      state:'read_only',project:PROJECT,installed:result.installed,separateGate:result.separate_gate,
      clientFlagEnabled:result.client_enabled,operatorFlagEnabled:result.operator_enabled,
      drummondsOperatorFlagEnabled:result.drummonds_operator_enabled,providerRequests:0,
    } : result));
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
