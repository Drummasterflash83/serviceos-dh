// Actual TypeScript handler/auth/pure helpers; synthetic DB/Auth I/O and CSV parser.
// No provider, filesystem source data or live credential access.
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {posix} from 'node:path';
import ts from 'typescript';
import {parseCsv} from './commusoft/lib/package-contract.mjs';
export const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',profileId='33333333-3333-4333-8333-333333333333',importId='44444444-4444-4444-8444-444444444444';
export const csv='external_id,record_kind,display_name\nsource-1,person,SYNTHETIC PRIVATE NAME\n';
export const definition={governed:true,columns:[{aliases:[],canonical:'external_id',type:'text',required:true},{aliases:[],canonical:'record_kind',type:'text',required:true},{aliases:[],canonical:'display_name',type:'text'}]};
const sha=s=>createHash('sha256').update(s).digest('hex');
export function harness(options={}){
 const calls=[],writes=[];
 const profile={id:profileId,tenant_id:null,source_system:'commusoft',entity_type:'customers',name:'Synthetic governed profile',active:true,version:1,definition:options.definition??definition};
 const imp={id:importId,tenant_id:tenant,profile_id:profileId,source_system:'commusoft',entity_type:'customers',status:options.status??'previewed',file_checksum:sha(options.csv??csv),row_count:1,preview:{sealed:{profile:{id:profileId,definition,definition_sha256:sha(JSON.stringify(definition))},mapping:{external_id:0,record_kind:1,display_name:2},import_options:{source:'commusoft'},provenance_source:'commusoft'}},...options.import};
 const privateError={code:'08006',message:'SYNTHETIC PRIVATE DATABASE DETAIL'};
 const db={
  auth:{getUser:async token=>token==='session'?{data:{user:{id:actor,email:'synthetic@example.invalid'}},error:null}:{data:{user:null},error:privateError}},
  from(table){let operation='read',selection='',single=false;const filters=[];
   const query={select(v){selection=v;return query;},eq(...v){filters.push(v);return query;},or(...v){filters.push(['or',...v]);return query;},in(...v){filters.push(['in',...v]);return query;},is(...v){filters.push(['is',...v]);return query;},order(){return query;},limit(){return query;},
    update(v){operation='update';writes.push({table,operation,value:v});return query;},insert(v){operation='insert';writes.push({table,operation,value:v});return query;},
    maybeSingle(){single=true;return result();},then(a,b){return result().then(a,b);}};
   async function result(){calls.push({table,operation,selection,filters});if(options.failTable===table&&(options.failOperation??'read')===operation)return {data:null,error:privateError};
    let data=table==='profiles'?{tenant_id:tenant,role:options.role??'owner',email:'synthetic@example.invalid'}:
     table==='tenants'?{status:options.companyStatus??'active'}:table==='view_as_context'?(options.viewAs?{id:'context'}:null):
     table==='import_profiles'?(single?profile:[profile]):table==='data_imports'?(operation==='insert'?{id:importId}:selection==='id,status'?null:single?imp:[imp]):
     table==='import_row_results'||table==='import_row_provenance'?[]:null;
    return {data,error:null};}
   return query;
  },
  async rpc(name,args){calls.push({rpc:name,args});if(!name.startsWith('import_match_')&&name!=='learn_import_match_batch')writes.push({rpc:name});
   if(options.failRpc===name||options.failRpcs?.includes(name))return {data:null,error:{...privateError,code:options.rpcCode??privateError.code}};
   if(name==='learn_import_match_batch'||name==='learn_import_apply_batch'){
    const index=calls.filter(c=>c.rpc===name).length;
    if(options.batchErrorAt===index)return {data:null,error:{...privateError,code:options.rpcCode??'08006'}};
    const result=args.p_rows.map(row=>({row_number:row.row_number,result:name==='learn_import_match_batch'?(options.matcher??{action:'new',strategy:'created',confidence:1}):(row.invalid_fields?{action:'invalid'}:options.rowResult??{action:'created'})}));
    return {data:options.batchReply?options.batchReply(result,index):result,error:null};
   }
   if(name.startsWith('import_match_'))return {data:options.matcher??{action:'new',strategy:'created',confidence:1},error:null};
   if(name==='import_customer_row')return {data:options.rowResult??{action:'created',entity_id:'synthetic'},error:null};
   if(name==='import_row_outcome')return {data:{already:false},error:null};
   if(name==='import_run_finalize')return {data:{status:'completed',created:1,linked:0,updated:0,conflicts:0,held:0,invalid:0,failed:0,skipped:0,unprocessed:0,import:{...imp,status:'completed'}},error:null};
   throw Error('Unexpected RPC');
  },
 };
 const context=createContext({Deno:{env:{get:()=> 'synthetic-service-key'},serve(){}},Response,Request,TextEncoder,TextDecoder,Uint8Array,crypto:webcrypto,console:{error(){throw Error('Unexpected raw logging');}}});
 const cache=new Map();
 function load(path){
  if(cache.has(path))return cache.get(path);
  const source=readFileSync(new URL('../supabase/functions/'+path,import.meta.url),'utf8');
  const c=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
  if(c.diagnostics.length)throw Error('TypeScript transpilation failed');
  const out={};cache.set(path,out);
  const req=target=>{if(target==='jsr:@std/csv@1/parse')return {parse:parseCsv};const normalized=posix.normalize(posix.join(posix.dirname(path),target));if(normalized==='_shared/simwood.ts')return {createSupabaseAdmin:()=>db};return load(normalized);};
  runInContext('(function(exports,require){'+c.outputText+'\n})',context)(out,req);return out;
 }
 const handler=load('data-import/handler.ts').handleDataImport;
 return {calls,writes,imp,profile,async request(body={action:'preview',entity_type:'customers',source_system:'commusoft',profile_id:profileId,csv_text:csv},opts={}){
  const r=await handler(new Request('https://test.invalid/import',{method:'POST',headers:{authorization:options.auth===false?'':`Bearer ${options.service?'synthetic-service-key':'session'}`,...(options.service?{'x-internal-tenant-id':tenant}:{}),'content-type':'application/json'},body:JSON.stringify(body)}),{governedOnly:true,...opts});return {status:r.status,body:await r.json()};},load};
}
