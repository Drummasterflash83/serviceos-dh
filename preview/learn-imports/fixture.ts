import {importFileHash} from '../../src/lib/learn-imports';
export const tenant='11111111-1111-4111-8111-111111111111';
const pid='44444444-4444-4444-8444-444444444444',id='33333333-3333-4333-8333-333333333333';
const csv='external_id\nSYNTHETIC\n';
const profile={id:pid,tenant_id:null,name:'Synthetic prepared customers',source_system:'commusoft',entity_type:'customers',version:1,definition:{governed:true,columns:[{canonical:'external_id'}]}};
const preview={headers:['external_id'],mapping:{external_id:0},unmapped:[],missing_required:[],row_count:1,valid:1,invalid:0,will_create:1,will_update:0,will_conflict:0,will_hold:0,duplicate_upload:false,profile:{id:pid,name:profile.name,version:1},sealed:{profile,mapping:{external_id:0},provenance_source:'commusoft',import_options:{source:'commusoft'}}};
const run={id,tenant_id:tenant,profile_id:pid,source_system:'commusoft',entity_type:'customers',original_filename:'SYNTHETIC.csv',status:'previewed',row_count:1,valid_rows:1,invalid_rows:0,created_records:0,updated_records:0,skipped_records:0,conflict_records:0,created_at:'2026-10-10T04:00:00Z',completed_at:null as string|null,file_checksum:'',preview};
export function getSupabaseClient(){return {functions:{async invoke(name:string,{body}:{body:any}){
 if(name!=='learn-data-import'||body.tenant_id!==tenant)throw Error('Synthetic scope differs');
 run.file_checksum=await importFileHash(csv);const scenario=new URLSearchParams(location.search).get('scenario');
 if(scenario==='unavailable')return {data:null,error:{message:'Synthetic unavailable'}};
 let data:any;
 if(body.action==='profiles')data={profiles:[profile]};
 else if(body.action==='imports')data={imports:[run]};
 else if(body.action==='status')data={import:run};
 else if(body.action==='row_results')data={rows:run.status==='completed'?[{row_number:2,outcome:'created',reason:null,fields:[],attempt:1,created_at:run.created_at}]:[],truncated:false};
 else if(body.action==='preview'){if(body.csv_text!==csv)return {data:null,error:{message:'Use the synthetic file'}};data={import_id:id,preview};}
 else if(body.action==='apply'){if(body.csv_text!==csv||body.import_id!==id)throw Error('Synthetic file mismatch');run.status='completed';run.created_records=1;run.completed_at=new Date().toISOString();if(scenario==='uncertain')return {data:null,error:{message:'Synthetic response lost after commit'}};data={import:run};}
 else throw Error('Synthetic action unavailable');
 return {data:structuredClone({success:true,...data}),error:null};
 }}};}
