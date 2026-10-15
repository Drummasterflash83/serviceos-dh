/** Guarded TEST-first mailbox latest-run index for the operator health panel. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode = process.argv[2];
if (!['--rehearse-test', '--apply-test', '--rehearse-live', '--apply-live'].includes(mode)
  || process.argv.length !== 3) throw Error('Exact email-health index release mode required');
const project = mode.endsWith('test') ? TEST_PROJECT : 'tgbnakbxwcqjeimygroz';
const sql = await readFile('supabase/migrations/20261104050000_learn_email_health_latest_runs.sql', 'utf8');
const packageSha256 = createHash('sha256').update(sql).digest('hex');
const directory = '.verification-results/learn-build01-email-health-index';
await mkdir(directory, { recursive: true, mode: 0o700 });
const token = savedCliToken();
async function query(statement, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly ? '/read-only' : ''}`, {
    method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:statement}),
  });
  const rows = await response.json().catch(() => null);
  if (response.status !== 201 || !Array.isArray(rows))
    throw Error(`Email-health index query unconfirmed (HTTP ${response.status})`);
  return rows;
}
const catalogSql = `select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,
  'digest',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),
  'acl',p.proacl::text) order by p.proname) from pg_proc p
  where p.oid in ('public.learn_operator_capture_health(uuid,text)'::regprocedure,
   'public.learn_phone_account_evidence(uuid,uuid)'::regprocedure)),
 'index',(select jsonb_build_object('definition',pg_get_indexdef(c.oid),
  'valid',ix.indisvalid,'ready',ix.indisready)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  join pg_index ix on ix.indexrelid=c.oid
  where n.nspname='public' and c.relname='learn_email_health_latest_runs_idx')
 ) as audit`;
async function audit(){const rows=await query(catalogSql);
 if(rows.length!==1||!rows[0]?.audit)throw Error('Email-health catalog unavailable');
 return rows[0].audit;}
const before=await audit();
const expected=new Map([
 ['learn_operator_capture_health','7c52320c0d9f19a36af3909f51de0ff8'],
 ['learn_phone_account_evidence','1a5cac8bfce4f2a8721d470fab9e0df1'],
]);
if(before.index!==null||before.functions?.length!==2||before.functions.some(f=>
 expected.get(f.name)!==f.digest||f.owner!=='postgres'||
 !f.acl?.includes('postgres=X/postgres')))
 throw Error('Exact email-health index prerequisites changed');
async function recentVerified(receiptMode){for(const name of await readdir(directory)){
 if(!name.startsWith(`${receiptMode}-`)||!name.endsWith('.json'))continue;
 const receipt=JSON.parse(await readFile(`${directory}/${name}`,'utf8'));
 if(receipt.packageSha256===packageSha256 && receipt.state===
 (receiptMode.startsWith('rehearse')?'rehearsed_rolled_back':'installed_verified')
 && Date.now()-Date.parse(receipt.observedAt)<3600000)return true;
}return false;}
if(mode==='--apply-test'&&!(await recentVerified('rehearse-test')))
 throw Error('Fresh TEST rollback rehearsal required');
if(mode==='--rehearse-live'&&!(await recentVerified('apply-test')))
 throw Error('Verified TEST installation required');
if(mode==='--apply-live'&&(!(await recentVerified('apply-test'))||
 !(await recentVerified('rehearse-live'))))
 throw Error('Verified TEST and fresh LIVE rehearsal required');

const filename=`${directory}/${mode.slice(2)}-${Date.now()}.json`;
await writeFile(filename,JSON.stringify({state:'prepared_not_submitted',mode,project,
 packageSha256,before,startedAt:new Date().toISOString()},null,2)+'\n',
 {flag:'wx',mode:0o600});
let submitted=false;
try{await query(mode.startsWith('--rehearse')?
 sql.replace(/\ncommit;\s*$/i,'\nrollback;\n'):sql,false);submitted=true;}
catch{/* Reconcile an uncertain outcome from the catalog, never resubmit. */}
const after=await audit();
const authorityPreserved=JSON.stringify(before.functions)===JSON.stringify(after.functions);
const rehearsal=mode.startsWith('--rehearse');
const definition=after.index?.definition??'';
const installed=after.index?.valid===true&&after.index?.ready===true
 && definition.includes('ON public.email_sync_runs USING btree (tenant_id, ((metadata ->>')
 && definition.includes('sync_type, started_at DESC, id DESC)')
 && definition.includes("WHERE ((provider = 'gmail'::text)")
 && definition.includes("(status = ANY (ARRAY['success'::text, 'failed'::text]))");
const state=submitted&&authorityPreserved&&(rehearsal?after.index===null:installed)
 ?rehearsal?'rehearsed_rolled_back':'installed_verified':'requires_inspection';
const receipt={state,mode,project,packageSha256,authorityPreserved,
 indexPresentBefore:before.index!==null,indexPresentAfter:after.index!==null,
 indexValidAfter:after.index?.valid??null,indexReadyAfter:after.index?.ready??null,
 observedAt:new Date().toISOString(),providerRequests:0,sourceDataWrites:false};
await writeFile(filename,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(receipt));
if(state!=='installed_verified'&&state!=='rehearsed_rolled_back')process.exitCode=1;
