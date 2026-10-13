/** Exact-artifact runtime adapter for the reviewed production release journal.
 * Defaults to read-only. Writes require a separate current approval/drain gate;
 * this module never infers those gates from an empty queue or a passing test.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configurationRuntimeRefresh } from './learn-production-configuration-adapter.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashObject=o=>sha(JSON.stringify(o));
const project='tgbnakbxwcqjeimygroz';
const meta=f=>({name:f.slug,id:f.id,version:f.version,hash:f.ezbr_sha256,jwt:f.verify_jwt,status:f.status});
const fields=['name','id','version','hash','jwt','status'];
const same=(a,b)=>a&&b&&fields.every(k=>a[k]===b[k]);
const check=(v,message)=>{if(!v)throw Error(message);};

export function createProductionRuntimeAdapter({candidate,operations,readBody,api,allowWrite=false,assertApprovedAndDrained,configurationRefresh}) {
  candidate=structuredClone(candidate);operations=structuredClone(operations);
  if(configurationRefresh) {
    const receipt=structuredClone(configurationRefresh),setup=operations.operations.find(o=>o.id==='matching-server-configuration');
    const original=[...candidate.endpoints.flatMap(e=>e.beforeProduction?[e.beforeProduction]:[]),...candidate.productionEndpointsOutsideCandidate];
    const ordered=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name));
    check(/^[a-f0-9]{64}$/.test(candidate.manifestSha256??'')&&receipt.projectRef===project&&receipt.candidateSha256===candidate.manifestSha256&&
      receipt.stepId===setup?.id&&receipt.stepPinSha256===setup.pinSha256&&
      hashObject(ordered(receipt.before))===hashObject(ordered(original))&&
      configurationRuntimeRefresh(receipt.before,receipt.after),'Configuration refresh receipt differs');
    // Only exact code/identity/auth-preserving configuration refreshes may adjust
    // the version baseline. The outer journal binds this to the applied step.
    for(const e of candidate.endpoints)if(e.beforeProduction)e.beforeProduction=receipt.after.find(r=>r.name===e.name);
    candidate.productionEndpointsOutsideCandidate=candidate.productionEndpointsOutsideCandidate.map(e=>receipt.after.find(r=>r.name===e.name));
  }
  const endpoints=candidate.endpoints;
  check(candidate.projectRef===project && endpoints.length===37 && new Set(endpoints.map(e=>e.name)).size===37 &&
    operations.projectRef===project && typeof readBody==='function' && typeof api==='function','Invalid production runtime scope');
  const targets=new Map(endpoints.map(e=>[e.name,e]));
  const runtimeOperations=operations.operations.filter(o=>o.kind==='runtime'&&o.id!=='publish-runtime-metadata');
  const publication=operations.operations.find(o=>o.id==='publish-runtime-metadata');
  check(runtimeOperations.length===37 && runtimeOperations.every(o=>o.id==='runtime-'+o.contract.name &&
    targets.has(o.contract.name) && o.pinSha256===hashObject(o.contract)), 'Unreviewed runtime operations');
  check(publication?.kind==='runtime' && publication.pinSha256===hashObject(publication.contract) &&
    publication.contract.action==='publish_metadata' && publication.contract.method==='PUT' &&
    publication.contract.path===`/v1/projects/${project}/functions` &&
    JSON.stringify(publication.contract.targets)===JSON.stringify(endpoints.map(e=>({name:e.name,verifyJwt:e.verifyJwt,
      ezbrSha256:runtimeOperations.find(o=>o.contract.name===e.name).contract.ezbrSha256}))), 'Unreviewed runtime publication');
  function operation(step) {
    if(step.id===publication.id) {
      check(step.kind==='runtime'&&step.pinSha256===publication.pinSha256,'Runtime publication pin differs');
      return publication;
    }
    const op=runtimeOperations.find(o=>o.id===step.id);
    check(op && step.kind===op.kind && step.pinSha256===op.pinSha256,'Runtime step pin differs');
    const e=targets.get(op.contract.name),w=op.contract,params=new URLSearchParams({
      verify_jwt:String(e.verifyJwt),entrypoint_path:`file:///work/supabase/functions/${e.name}/index.ts`,ezbr_sha256:w.ezbrSha256});
    if(!e.beforeProduction){params.set('slug',e.name);params.set('name',e.name);}
    check(w.verifyJwt===e.verifyJwt && w.request.method===(e.beforeProduction?'PATCH':'POST') &&
      w.request.path===`/v1/projects/${project}/functions${e.beforeProduction?'/'+e.name:''}?${params}` &&
      w.request.bodyFile===e.name+'.ezbr' && w.request.contentType==='application/vnd.denoland.eszip',
      'Runtime request destination or metadata differs');
    return op;
  }
  async function inventory() {
    const rows=await api({method:'GET',path:`/v1/projects/${project}/functions`});
    check(Array.isArray(rows) && new Set(rows.map(r=>r.slug)).size===rows.length,'Ambiguous runtime inventory');
    return rows;
  }
  function state(e,row) {
    if(!row) return e.beforeProduction?'drift':'ready';
    const m=meta(row),op=runtimeOperations.find(o=>o.contract.name===e.name),w=op.contract;
    if(e.beforeProduction && same(m,e.beforeProduction))return 'ready';
    const expectedVersion=e.beforeProduction?e.beforeProduction.version+1:1;
    if(m.status==='ACTIVE' && m.version===expectedVersion && m.hash===w.ezbrSha256 &&
       m.jwt===e.verifyJwt && (!e.beforeProduction||m.id===e.beforeProduction.id) &&
       typeof m.id==='string' && m.id.length>0 &&
       row.entrypoint_path===`file:///work/supabase/functions/${e.name}/index.ts` &&
       row.import_map===false && !row.import_map_path) return 'applied';
    return 'drift';
  }
  function review(rows) {
    const remaining=rows.filter(r=>!targets.has(r.slug));
    const outside=candidate.productionEndpointsOutsideCandidate;
    const unrelated=remaining.length===outside.length && outside.every(e=>same(meta(remaining.find(r=>r.slug===e.name)??{}),e));
    const observations=endpoints.map(e=>({name:e.name,state:state(e,rows.find(r=>r.slug===e.name))}));
    return {unrelated,observations};
  }
  async function prerequisites() {
    const existing=await api({method:'POST',path:`/v1/projects/${project}/database/query`,readOnly:true,
      json:{query:"begin transaction read only;select to_regclass('of_learn_deploy.migrations') is not null as ledger_present;commit;"}});
    check(Array.isArray(existing)&&existing.length===1&&typeof existing[0].ledger_present==='boolean','Database receipt inventory unavailable');
    if(!existing[0].ledger_present)return {databaseReady:false,receiptCount:0};
    const receipts=await api({method:'POST',path:`/v1/projects/${project}/database/query`,readOnly:true,
      json:{query:"begin transaction read only;select migration_name,source_sha256,project_ref from of_learn_deploy.migrations order by migration_name;commit;"}});
    const expected=candidate.database.map(d=>d.sha256);
    const databaseReady=Array.isArray(receipts) && receipts.length===expected.length &&
      new Set(receipts.map(r=>r.migration_name)).size===expected.length &&
      expected.every(h=>receipts.filter(r=>r.source_sha256===h && r.project_ref===project).length===1);
    return {databaseReady,receiptCount:receipts.length};
  }
  async function observe(step,phase='before') {
    const op=operation(step),rows=await inventory(),reviewed=review(rows),db=await prerequisites();
    const result=reviewed.observations.find(e=>e.name===op.contract.name);
    const valid=reviewed.unrelated && !reviewed.observations.some(e=>e.state==='drift') && db.databaseReady;
    const publishing=op.id===publication.id;
    const observed=publishing ? (reviewed.observations.every(e=>e.state==='applied')?(phase==='before'?'ready':'applied'):'drift') : result.state;
    return {state:valid?observed:'drift',evidenceSha256:hashObject({rows:rows.map(meta),reviewed,db})};
  }
  return {
    async inspect() {
      const rows=await inventory(),reviewed=review(rows),db=await prerequisites();
      return {project,state:'read_only_runtime_preflight',...db,unrelatedEndpointsUnchanged:reviewed.unrelated,
        endpoints:reviewed.observations,productionChanges:0,
        publicationReady:false,reason:'Runtime metadata and receipts do not establish approval, drain, configuration or caller acceptance.'};
    },
    observe,
    async apply(step) {
      check(allowWrite && typeof assertApprovedAndDrained==='function','Production runtime adapter is read-only');
      const op=operation(step);
      // Caller revalidates the approved plan, paused schedules, in-flight work,
      // journal position and configuration. No boolean default can open this gate.
      const authorization=await assertApprovedAndDrained(step);
      check(authorization?.projectRef===project && authorization.stepPinSha256===step.pinSha256 &&
        /^[a-f0-9]{64}$/.test(authorization.approvalEvidenceSha256??''),'Current scoped release authorization required');
      const before=await observe(step);
      check(before.state==='ready','Runtime precondition changed before upload');
      if(op.id===publication.id) {
        const rows=await inventory(),reviewed=review(rows);
        check(reviewed.unrelated&&reviewed.observations.every(e=>e.state==='applied'),'Runtime changed before publication');
        const json=endpoints.map(e=>{
          const row=rows.find(r=>r.slug===e.name);
          return Object.fromEntries(['id','name','slug','version','entrypoint_path','import_map','import_map_path',
            'verify_jwt','status','created_at','ezbr_sha256'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
        });
        await api({method:'PUT',path:op.contract.path,json,expectedStatus:200});
        return;
      }
      const body=await readBody(op.contract.request.bodyFile);
      check(Buffer.isBuffer(body) && body.subarray(0,4).toString()==='EZBR' && sha(body)===op.contract.ezbrSha256,
        'Runtime upload bytes changed');
      // Exactly one upload. Any timeout/non-success remains uncertain in the
      // outer journal; never switch POST to PATCH or retry a changed version.
      await api({method:op.contract.request.method,path:op.contract.request.path,
        contentType:op.contract.request.contentType,body,expectedStatus:op.contract.before?200:201});
    },
  };
}

/** Fixed-origin transport. No redirect, retry, secret creation or provider call.
 * read-only mode permits GET inventory and the two exact receipt queries only.
 */
export function productionManagementTransport(token,{fetcher=fetch,allowWrite=false}={}) {
  check(typeof token==='string'&&token.length>20,'Existing management login required');
  return async request=>{
    const {method,path}=request;
    const inventory=method==='GET'&&path===`/v1/projects/${project}/functions`;
    const receiptQuery=method==='POST'&&path===`/v1/projects/${project}/database/query`&&request.readOnly===true&&
      ["begin transaction read only;select to_regclass('of_learn_deploy.migrations') is not null as ledger_present;commit;",
       "begin transaction read only;select migration_name,source_sha256,project_ref from of_learn_deploy.migrations order by migration_name;commit;"].includes(request.json?.query);
    const upload=allowWrite&&['PATCH','POST'].includes(method)&&
      new RegExp(`^/v1/projects/${project}/functions(?:/[a-z][a-z0-9-]+)?\\?`).test(path)&&Buffer.isBuffer(request.body);
    const publication=allowWrite&&method==='PUT'&&path===`/v1/projects/${project}/functions`&&
      Array.isArray(request.json)&&request.json.length===37;
    check(inventory||receiptQuery||upload||publication,'Management operation outside runtime adapter scope');
    const response=await fetcher('https://api.supabase.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(60000),
      headers:{Authorization:'Bearer '+token,...(request.body?{'Content-Type':request.contentType}:request.json?{'Content-Type':'application/json'}:{})},
      ...(request.body?{body:request.body}:request.json?{body:JSON.stringify(request.json)}:{})});
    const statuses=request.expectedStatus?[request.expectedStatus]:receiptQuery?[200,201]:[200];
    if(!statuses.includes(response.status))throw Error('Management response unconfirmed ('+response.status+')');
    // Return only parsed data to the observer. No raw error body is exposed.
    return response.json();
  };
}

export function loadRuntimeAdapter(api, options={}) {
  const root='supabase/release/learn-production/';
  const candidateBytes=readFileSync(root+'runtime-candidate.manifest.json');
  const operations=JSON.parse(readFileSync(root+'release-operations.manifest.json'));
  const plan=JSON.parse(readFileSync(root+'release-sequence.plan.json'));
  check(operations.planSha256===hashObject(plan) && plan.candidateSha256===sha(candidateBytes) &&
    JSON.stringify(plan.steps)===JSON.stringify(operations.operations.map(({id,kind,pinSha256})=>({id,kind,pinSha256}))),
    'Release plan, operations or candidate binding differs');
  return createProductionRuntimeAdapter({candidate:{...JSON.parse(candidateBytes),manifestSha256:sha(candidateBytes)},operations,
    readBody:name=>readFileSync(join('.verification-results/production-runtime-wire-20261013-relevance',name)),api,...options});
}
