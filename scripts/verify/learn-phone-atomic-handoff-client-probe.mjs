/** Actual TypeScript finaliser -> actual PostgreSQL RPC, synthetic offline only. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {finalizeInteractionForRecording} from '../../supabase/functions/_shared/phone_enrich.ts';
const container=process.argv[2];
if(!/^serviceos-phone-handoff-[a-f0-9]{8}$/.test(container??''))throw Error('Isolated handoff container required');
const id=n=>`e36f129a-aaaa-4000-8000-${String(n).padStart(12,'0')}`;
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const sql=s=>execFileSync('/usr/local/bin/docker',['exec','-i',container,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const phases=[];
const admin={async rpc(name,a){assert.equal(name,'learn_phone_handoff');phases.push(a.p_phase);
 const data=JSON.parse(sql(`set role service_role;select public.learn_phone_handoff(${[a.p_tenant,a.p_run,a.p_recording,a.p_transcript,a.p_insight,a.p_phase].map(q).join(',')});`));
 if(a.p_phase==='publish')throw Error('Synthetic lost acknowledgement after COMMIT');return {data,error:null};},from(){throw Error('Direct writes forbidden');}};
const result=await finalizeInteractionForRecording({admin,tenantId:id(1),runId:id(113),recordingId:id(3),transcriptId:id(4),insightId:id(5)});
assert.equal(result.ok,true);assert.deepEqual(phases,['publish','inspect']);
assert.equal(sql(`select count(*) from learn_phone_handoff_receipts where run_id=${q(id(113))}`),'1');
assert.equal(result.receipt.runId,id(113));
console.log('PASS: actual TypeScript finaliser recovers a committed PostgreSQL receipt without republishing');
