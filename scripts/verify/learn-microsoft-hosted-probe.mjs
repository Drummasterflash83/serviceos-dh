/** Synthetic full-schema transaction fixture. Caller MUST wrap and roll back. */
import { execFileSync } from "node:child_process";
const f = JSON.parse(
  execFileSync(process.execPath, ["scripts/verify/learn-microsoft-journal-fixtures.mjs"], {
    encoding: "utf8",
  }).replaceAll("00000000-0000-4000-8000-", "eb190660-aaaa-4000-8000-"),
);
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const json = (v) => q(JSON.stringify(v)) + "::jsonb";
const id = (n) => q(`eb190660-aaaa-4000-8000-${String(n).padStart(12, "0")}`) + "::uuid";
const t = id(1),
  a = id(2),
  m = id(3),
  b = id(4),
  job = id(10);
const payload = {
  email_account_id: f.scope.accountId,
  mailbox_id: f.scope.mailboxId,
  binding_id: "eb190660-aaaa-4000-8000-000000000004",
  kind: "folders",
  folder_id: "",
};
console.log(`
do $$begin assert not exists(select 1 from tenants where id=${t});end$$;
insert into tenants(id,slug,display_name,status) values(${t},'microsoft-rollback-only','Synthetic Microsoft rollback','active');
insert into email_accounts(id,tenant_id,provider,email_address,status,auth_state) values(${a},${t},'microsoft_365','synthetic@example.invalid','active','ok');
insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${b},${t},${a},${id(5)},${m},true);
insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at)
 values(${job},${t},'microsoft-365','communications.email','email.microsoft_discovery','email.microsoft_discovery:eb190660-aaaa-4000-8000-000000000004:','running',${json(payload)},'microsoft-rollback',1,clock_timestamp()+interval '10 minutes');
set local role service_role;
do $$declare s jsonb;r jsonb;done jsonb;begin
 s:=public.learn_microsoft_journal_open(${t},${a},${m},${b},'folders','',${json(f.folders[0].before)},${job},'microsoft-rollback',1);
 r:=public.learn_microsoft_journal_commit(${t},(s->>'streamId')::uuid,${id(20)},0,${json(f.folders[0].before)},${json(f.folders[0].page)},${json(f.folders[0].after)},${job},'microsoft-rollback',1);
 done:=public.learn_microsoft_job_settle(${t},${job},'microsoft-rollback',1,true);
 assert done->'folderDispatch'->>'newJobs'='1' and done->>'continuationKind'='page';
 assert public.learn_microsoft_job_settle(${t},${job},'microsoft-rollback',1,true)=done;
end$$;reset role;
select set_config('learn.microsoft_child',(select message_job_id::text from learn_microsoft_folder_dispatches where tenant_id=${t} and folder_id='Folder1'),true);
update platform_jobs set status='running',claimed_by='microsoft-rollback',attempt_count=1,lease_expires_at=clock_timestamp()+interval '10 minutes' where id=current_setting('learn.microsoft_child')::uuid;
set local role service_role;
do $$declare s jsonb;r jsonb;done jsonb;j uuid:=current_setting('learn.microsoft_child')::uuid;begin
 s:=public.learn_microsoft_journal_open(${t},${a},${m},${b},'messages','Folder1',${json(f.messages.before)},j,'microsoft-rollback',1);
 r:=public.learn_microsoft_journal_commit(${t},(s->>'streamId')::uuid,${id(21)},0,${json(f.messages.before)},${json(f.messages.page)},${json(f.messages.after)},j,'microsoft-rollback',1);
 done:=public.learn_microsoft_job_settle(${t},j,'microsoft-rollback',1,true);
 assert done->>'continuationKind'='incremental' and (done->>'nextCheckAt')::timestamptz>=clock_timestamp()+interval '299 seconds';
 assert done->>'observationsStored'='3' and done->>'mailboxCoverage'='unverified';
 assert public.learn_microsoft_job_settle(${t},j,'microsoft-rollback',1,true)=done;
 perform set_config('learn.microsoft_due',done->>'successorId',true);
 begin perform public.learn_microsoft_journal_job(${id(99)},j,'microsoft-rollback',1);raise exception 'foreign tenant accepted';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
do $$begin
 assert (select count(*) from learn_microsoft_source_pages where tenant_id=${t})=2;
 assert (select source_page from learn_microsoft_source_pages where id=${id(21)})=${json(f.messages.page)};
 assert exists(select 1 from platform_jobs where id=current_setting('learn.microsoft_due')::uuid and status='queued' and available_at>clock_timestamp()+interval '299 seconds');
 assert not exists(select 1 from public.platform_jobs_claim('microsoft-probe-no-match',1,30,array['synthetic.never']) where tenant_id=${t});
end$$;
insert into feature_flags(tenant_id,flag,value) values(${t},'learn.inputs.email.enabled','false');
update platform_jobs set status='running',claimed_by='microsoft-rollback',attempt_count=1,lease_expires_at=clock_timestamp()+interval '10 minutes' where id=current_setting('learn.microsoft_due')::uuid;
set local role service_role;
do $$begin
 begin perform public.learn_microsoft_journal_open(${t},${a},${m},${b},'messages','Folder1',${json(f.messages.before)},current_setting('learn.microsoft_due')::uuid,'microsoft-rollback',1);raise exception 'paused capture accepted';exception when sqlstate 'PT409' then assert sqlerrm='learn_microsoft_capture_paused';end;
 begin perform 1 from public.learn_microsoft_source_pages;raise exception 'direct source access accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
set local role authenticated;
do $$begin
 begin perform public.learn_microsoft_job_settle(${t},${job},'microsoft-rollback',1,true);raise exception 'human queue settlement accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
`);
