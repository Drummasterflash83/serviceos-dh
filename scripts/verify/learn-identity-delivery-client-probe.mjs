/** Actual handler -> offline PostgreSQL, with a lost commit acknowledgement. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {handleIdentityResolve} from '../../supabase/functions/_shared/worker_handlers/identity_resolve.ts';
const name=process.argv[2];if(!/^serviceos-identity-delivery-[a-f0-9]{8}$/.test(name??''))throw Error('Offline synthetic container only');
globalThis.Deno={env:{get:()=>undefined}};
const id=n=>`b671cd32-bbbb-4000-8000-${String(n).padStart(12,'0')}`;
const sql=query=>execFileSync('/usr/local/bin/docker',['exec','-i',name,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:30000}).trim();
sql(`insert into tenants(id) values('${id(3)}');insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,phone_from,summary,processing_status) values('${id(30)}','${id(3)}','simwood','phone','phone_calls','${id(1030)}','phone_call','inbound','2026-10-11T10:00:00Z','+441632960030','Synthetic actual handler summary','ready');`);
const phases=[];
const admin={from(){throw Error('Direct client writes forbidden');},async rpc(name,args){
 if(name==='learn_identity_pending')return{data:JSON.parse(sql(`set role service_role;select coalesce(json_agg(x),'[]') from learn_identity_pending('${id(3)}',20) x;`)),error:null};
 assert.equal(name,'learn_identity_deliver');phases.push(args.p_phase);assert.equal(args.p_tenant,id(3));assert.equal(args.p_interaction,id(30));assert.match(args.p_request,/^[a-f0-9-]{36}$/);assert.match(args.p_revision,/^[a-f0-9]{64}$/);assert.ok(['publish','inspect'].includes(args.p_phase));
 const data=JSON.parse(sql(`set role service_role;select learn_identity_deliver('${args.p_tenant}','${args.p_request}','${args.p_interaction}','${args.p_revision}','${args.p_phase}');`));
 if(args.p_phase==='publish')throw Error('Synthetic response loss after DB commit');return{data,error:null};
}};
const result=await handleIdentityResolve({supabaseAdmin:admin,tenantId:id(3),jobId:null,payload:{}});
assert.equal(result.success,true);assert.equal(result.result.cards_enriched,1);assert.deepEqual(phases,['publish','inspect']);
assert.equal(sql(`select count(*) from customer_cards where tenant_id='${id(3)}'`),'1');
assert.equal(sql(`select count(*) from learn_identity_delivery_receipts where tenant_id='${id(3)}'`),'1');
console.log('PASS: actual identity handler recovers committed card delivery from PostgreSQL without republishing');
