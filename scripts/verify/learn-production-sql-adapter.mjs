/** Pinned production SQL/schedule adapter. Read-only unless the separate current
 * release authorization gate and a write-enabled exact-statement transport agree.
 * No retries, generic SQL execution, secret handling or approval creation.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const project='tgbnakbxwcqjeimygroz';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashObject=o=>sha(JSON.stringify(o));
const check=(v,m)=>{if(!v)throw Error(m);};
export const SQL_OBSERVATIONS={
  ledger:"begin transaction read only;select to_regclass('of_learn_deploy.migrations') is not null as ledger_present;commit;",
  receipts:"begin transaction read only;select migration_name,source_sha256,project_ref from of_learn_deploy.migrations order by migration_name;commit;",
  schedules:"begin transaction read only;select jobid,jobname,schedule,active,md5(command) as command_hash,md5((to_jsonb(j)-'active')::text) as other_fields_hash from cron.job j order by jobid;commit;",
};

export function createProductionSqlAdapter({candidate,operations,scheduleBaseline,query,read=readFileSync,
  allowWrite=false,assertApprovedRelease}) {
  candidate=structuredClone(candidate);operations=structuredClone(operations);scheduleBaseline=structuredClone(scheduleBaseline);
  check(candidate.projectRef===project&&candidate.database.length===22&&operations.projectRef===project&&typeof query==='function',
    'Reviewed production SQL scope required');
  const selected=operations.operations.filter(o=>['database','schedule'].includes(o.kind));
  check(selected.length===24&&selected.filter(o=>o.kind==='database').length===22&&
    selected.every(o=>o.pinSha256===hashObject(o.contract)), 'SQL operation pins differ');
  check(scheduleBaseline.schedules.length===9&&new Set(scheduleBaseline.schedules.map(s=>s.jobid)).size===9,
    'Exact schedule scope required');
  const writes=new Map(),expected=[];
  for(const [i,d] of candidate.database.entries()) {
    const op=selected.find(o=>o.id==='database-'+String(i+1).padStart(3,'0'));
    check(op?.kind==='database'&&JSON.stringify(op.contract)===JSON.stringify(d),'Database order differs');
    const sql=String(read(d.path));check(sha(sql)===d.sha256,'Database package bytes changed');
    const names=[...sql.matchAll(/insert into of_learn_deploy\.migrations\s+values\s*\(\s*'([a-z0-9_]+)'/g)].map(m=>m[1]);
    check(names.length===1,'Exact package receipt name required');
    expected.push({migration_name:names[0],source_sha256:d.sha256,project_ref:project});
    writes.set(op.id,`set role postgres;set serviceos.release_target='${project}';set serviceos.release_source_sha256='${d.sha256}';\n`+sql);
  }
  for(const mode of ['pause','restore']) {
    const id=mode==='pause'?'pause-existing-schedules':'restore-existing-schedules';
    const op=selected.find(o=>o.id===id);
    check(op?.kind==='schedule'&&op.contract.mode===mode,'Schedule operation differs');
    const sql=String(read(op.contract.path));check(sha(sql)===op.contract.sha256,'Schedule SQL bytes changed');
    writes.set(id,`set role postgres;set serviceos.release_project='${project}';set serviceos.release_manifest_sha256='${candidate.manifestSha256}';set serviceos.release_schedule_action='${mode}';\n`+sql);
  }
  check(/^[a-f0-9]{64}$/.test(candidate.manifestSha256??''),'Exact runtime manifest pin required');
  async function receipts() {
    const exists=await query(SQL_OBSERVATIONS.ledger,{readOnly:true});
    check(Array.isArray(exists)&&exists.length===1&&typeof exists[0].ledger_present==='boolean','Receipt existence read failed');
    if(!exists[0].ledger_present)return [];
    const rows=await query(SQL_OBSERVATIONS.receipts,{readOnly:true});
    check(Array.isArray(rows),'Receipt inventory unavailable');return rows;
  }
  function receiptState(rows,index) {
    const prefix=expected.slice(0,rows.length);
    if(rows.length>expected.length || new Set(rows.map(r=>r.migration_name)).size!==rows.length ||
      prefix.some(e=>rows.filter(r=>r.migration_name===e.migration_name&&r.source_sha256===e.source_sha256&&r.project_ref===project).length!==1))return 'drift';
    return rows.length===index?'ready':rows.length===index+1?'applied':'drift';
  }
  function operation(step) {
    const op=selected.find(o=>o.id===step.id);
    check(op&&op.kind===step.kind&&op.pinSha256===step.pinSha256,'SQL step pin differs');return op;
  }
  async function scheduleState(mode) {
    const rows=await query(SQL_OBSERVATIONS.schedules,{readOnly:true});
    check(Array.isArray(rows)&&new Set(rows.map(r=>r.jobid)).size===rows.length,'Schedule inventory unavailable');
    const targets=scheduleBaseline.schedules.map(e=>rows.find(r=>r.jobid===e.jobid));
    const matches=targets.every((r,i)=>r&&r.jobname===scheduleBaseline.schedules[i].jobname&&
      r.schedule===scheduleBaseline.schedules[i].schedule&&r.command_hash===scheduleBaseline.schedules[i].command_hash);
    let state='drift';
    if(matches) {
      const original=targets.every((r,i)=>r.active===scheduleBaseline.schedules[i].active);
      const paused=targets.every(r=>r.active===false);
      state=mode==='pause'?(original?'ready':paused?'applied':'drift'):(paused?'ready':original?'applied':'drift');
    }
    return {state,rows};
  }
  async function observe(step) {
    const op=operation(step);
    if(op.kind==='database') {
      const rows=await receipts(),state=receiptState(rows,Number(step.id.slice(-3))-1);
      return {state,evidenceSha256:hashObject(rows)};
    }
    const result=await scheduleState(op.contract.mode);
    return {state:result.state,evidenceSha256:hashObject(result.rows)};
  }
  return {
    // Exposed only to build an exact SQL allowlist in the management transport.
    writeStatements:[...writes.values()],
    observe,
    async inspect() {
      const rows=await receipts(),schedules=await scheduleState('pause');
      const firstMissing=rows.length;
      return {project,state:'read_only_sql_preflight',receiptCount:rows.length,
        receiptPrefixValid:firstMissing<=expected.length&&receiptState(rows,Math.min(firstMissing,expected.length-1))!=='drift',
        schedules:schedules.state,scheduleCount:schedules.rows.length,productionChanges:0,executionApproved:false};
    },
    async apply(step) {
      check(allowWrite&&typeof assertApprovedRelease==='function','Production SQL adapter is read-only');
      const op=operation(step),approval=await assertApprovedRelease(step);
      check(approval?.projectRef===project&&approval.stepPinSha256===step.pinSha256&&
        /^[a-f0-9]{64}$/.test(approval.approvalEvidenceSha256??''),'Current scoped release authorization required');
      const before=await observe(step);check(before.state==='ready','SQL receipt or schedule precondition changed');
      // Re-read immutable bytes just before submission; never send an arbitrary
      // new statement after an operator reviewed the recorded package hash.
      check(sha(read(op.contract.path))===op.contract.sha256,'SQL bytes changed before submission');
      await query(writes.get(op.id),{readOnly:false});
    },
  };
}

export function productionSqlTransport(token,{fetcher=fetch,allowWrite=false,writeStatements=[]}={}) {
  check(typeof token==='string'&&token.length>20,'Existing management login required');
  const reads=new Set(Object.values(SQL_OBSERVATIONS)),writes=new Set(writeStatements);
  return async (query,{readOnly})=>{
    check(readOnly?reads.has(query):allowWrite&&writes.has(query),'SQL request outside exact release allowlist');
    const response=await fetcher(`https://api.supabase.com/v1/projects/${project}/database/query`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),
    });
    if(![200,201].includes(response.status))throw Error('SQL management outcome unconfirmed ('+response.status+')');
    return response.json();
  };
}

export function loadSqlAdapter(query,options={}) {
  const root='supabase/release/learn-production/',bytes=readFileSync(root+'runtime-candidate.manifest.json');
  const candidate=JSON.parse(bytes),operations=JSON.parse(readFileSync(root+'release-operations.manifest.json'));
  const plan=JSON.parse(readFileSync(root+'release-sequence.plan.json'));
  check(plan.candidateSha256===sha(bytes)&&operations.planSha256===hashObject(plan)&&
    JSON.stringify(plan.steps)===JSON.stringify(operations.operations.map(({id,kind,pinSha256})=>({id,kind,pinSha256}))),
    'Release plan binding differs');
  return createProductionSqlAdapter({candidate:{...candidate,manifestSha256:sha(bytes)},operations,
    scheduleBaseline:JSON.parse(readFileSync(root+'scheduled-callers.manifest.json')),query,...options});
}
