/** Actual worker discovery adapter + real full-schema SQL; offline container only. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runVoicemailDiscoveryTick} from '../../supabase/functions/_shared/voicemail/discovery-tick.ts';
const container=process.argv[2];
assert.match(container,/^[a-zA-Z0-9_.-]+$/);
const sql=s=>execFileSync('/usr/local/bin/docker',['exec','-i',container,'psql','-h','127.0.0.1','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],{input:'set search_path=public,pg_catalog;'+s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const id=n=>'ce490001-aaaa-4000-8000-'+String(n).padStart(12,'0');
sql(`insert into tenants(id,slug,display_name,status) values('${id(1)}','candidate-worker-fixture','Synthetic candidate worker','active');
insert into auth.users(id,email,banned_until) values('${id(2)}','candidate-worker@example.invalid','infinity');
update profiles set tenant_id='${id(1)}',role='owner' where id='${id(2)}';
insert into email_accounts(id,tenant_id,provider,email_address,status) values('${id(3)}','${id(1)}','gmail','candidate-worker@example.invalid','active_dwd');
insert into receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension,owner_user_id)
 select ('ce490001-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','candidate-worker-'||n,'Synthetic mailbox',n::text,'${id(2)}' from generate_series(601,603)n;
insert into receptionist_voicemail_email_routes(id,tenant_id,mailbox_id,email_account_id,recipient_email,signing_domain,owner_user_id,access_mode,received_from,received_until,binding_evidence,verified_by,enabled)
 select ('ce490001-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}',('ce490001-aaaa-4000-8000-'||lpad((n+501)::text,12,'0'))::uuid,'${id(3)}','candidate-worker@example.invalid','birchills-net.20251104.gappssmtp.com','${id(2)}','owner','2026-01-01','2026-10-13','Synthetic worker candidate fixture','${id(2)}',true from generate_series(100,102)n;
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 select ('00000001-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','gmail','noise'||n,'synthetic@example.invalid','Ordinary mail','2026-10-12','inbound','{}' from generate_series(1,20000)n;
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 select ('ce490002-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','gmail',to_hex(n),'notifications@birchills.net','New message in mailbox 601 from Synthetic','2026-10-12','inbound',jsonb_build_object('provider_account_id','${id(3)}','label_ids','[]'::jsonb) from generate_series(1,550)n;
insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,subject,received_at,direction,raw_payload)
 select ('ce490003-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','gmail',to_hex(n),'notifications@birchills.net','New message in mailbox '||n||' from Synthetic','2026-10-12','inbound',jsonb_build_object('provider_account_id','${id(3)}') from generate_series(602,603)n;
analyze email_messages;`);
const sourceHash=sql(`select md5(string_agg(md5(to_jsonb(e)::text),'' order by id)) from email_messages e;`);
const plan=JSON.parse(sql(`explain(analyze,buffers,format json) select * from email_messages where tenant_id='${id(1)}' and provider='gmail'
 and lower(coalesce(from_email,''))~'^[^[:space:]@]+@birchills[.]net$'
 and substring(subject from '^New message in mailbox ([0-9]{3}) from .+$')='601'
 and (raw_payload->>'provider_account_id' is null or raw_payload->>'provider_account_id'='${id(3)}')
 and(received_at is null or not isfinite(received_at) or(received_at>='2026-01-01' and received_at<'2026-10-13')) order by id limit 100;`));
assert.match(JSON.stringify(plan),/email_messages_voicemail_candidate_idx/);
const db={async rpc(name,args){assert.equal(name,'voicemail_schedule_tick');assert.deepEqual(args,{});return {data:JSON.parse(sql('set role service_role;select voicemail_schedule_tick();')),error:null}}};
const first=await runVoicemailDiscoveryTick(db,['phone.voicemail_import']);
assert.equal(first.state,'completed');assert.equal(first.routesAttempted,2);assert.equal(first.rowsExamined,501);assert.equal(first.jobsEnqueued,501);assert.equal(first.pages,6);
const replay=await runVoicemailDiscoveryTick(db,['phone.voicemail_import']);assert.equal(replay.historicalReceipt,true);assert.equal(replay.jobsEnqueued,501);
// Advance only the isolated fixture's dispatch eligibility. No production clock or receipt changes.
sql(`truncate receptionist_voicemail_dispatch_receipts,receptionist_voicemail_scan_receipts;update receptionist_voicemail_scans set dispatch_next_at=null where route_id='${id(100)}';`);
const second=await runVoicemailDiscoveryTick(db,null);
assert.equal(second.state,'completed');assert.equal(second.routesAttempted,2);assert.equal(second.rowsExamined,51);assert.equal(second.jobsEnqueued,51);assert.equal(second.pages,2);
assert.equal(sql(`select count(*) from receptionist_voicemail_scans where tenant_id='${id(1)}' and completed_at is not null`),'3');
assert.equal(sql(`select count(*) from platform_jobs where tenant_id='${id(1)}' and job_type='phone.voicemail_import'`),'552');
const skipped=await runVoicemailDiscoveryTick({rpc(){throw Error('Wrong module must not invoke SQL')}},['slack.sync']);assert.equal(skipped.state,'skipped');
assert.equal(sql(`select md5(string_agg(md5(to_jsonb(e)::text),'' order by id)) from email_messages e;`),sourceHash);
assert.equal(first.coverageComplete,false);assert.equal(second.coverageComplete,false);
console.log(JSON.stringify({state:'passed',actualWorkerAdapter:true,actualFullSchemaSql:true,indexUsed:true,firstTickRows:501,secondTickRows:51,ordinaryRowsSkipped:20000,fairThreeRoutes:true,replayNoDuplicateJobs:true,sourceRowsUnchanged:true,productionWrites:0,providerRequests:0}));
