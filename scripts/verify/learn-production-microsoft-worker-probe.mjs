// Production variant: token rotation changes granted scopes, exercising existing marketing capability triggers.
/** Append after existing Microsoft discovery/card probes, inside ROLLBACK only. */
import {readMicrosoftMailPage} from "../../supabase/functions/_shared/microsoft_mail_page.ts";
const uid=n=>`eb190660-aaaa-4000-8000-${String(n).padStart(12,"0")}`;
const q=v=>"'"+String(v).replaceAll("'","''")+"'",json=v=>q(JSON.stringify(v))+"::jsonb",id=n=>q(uid(n))+"::uuid";
const t=id(1),a=id(2),m=id(3),b=id(4),client=id(804);
const folder="WorkerRehearsalFolder";
const scope={tenantId:uid(1),accountId:uid(2),mailboxId:uid(3),folderId:folder};
const before={contract:"microsoft-message-checkpoint/1",scope,pageSize:25,continuation:null,visitedRequests:[]};
const page=await readMicrosoftMailPage("SYNTHETIC",{...scope,pageSize:25,continuation:null},async()=>Response.json({
 value:[{id:"WorkerRehearsalMessage",changeKey:"WorkerV1",conversationId:"WorkerRehearsalConversation",subject:"Synthetic recovery rehearsal",
  body:{contentType:"text",content:"Synthetic worker recovery content"},bodyPreview:"Synthetic worker recovery preview",
  from:{emailAddress:{address:"worker-recovery@example.invalid"}},toRecipients:[{emailAddress:{address:"synthetic@example.invalid"}}],ccRecipients:[],
  sentDateTime:"2026-10-12T01:00:00Z",receivedDateTime:"2026-10-12T01:00:01Z",lastModifiedDateTime:"2026-10-12T01:01:00Z",isDraft:false,hasAttachments:false}],
 "@odata.deltaLink":`https://graph.microsoft.com/v1.0/users/${scope.mailboxId}/mailFolders/${folder}/messages/delta?$deltatoken=SYNTHETIC-WORKER`,
}));
const after={...before,continuation:page.continuation};
const args=(job,kindFolder=folder)=>`${t},${a},${m},${b},'messages',${q(kindFolder)},${id(job)},'microsoft-worker-rehearsal',1,${client}`;
function job(n,f){return `insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,claimed_by,attempt_count,max_attempts,lease_expires_at)
 values(${id(n)},${t},'microsoft-365','communications.email','email.microsoft_sync',${q("email.microsoft_sync:"+uid(4)+":"+f)},'running',${json({email_account_id:uid(2),mailbox_id:uid(3),binding_id:uid(4),kind:"messages",folder_id:f})},'microsoft-worker-rehearsal',1,5,clock_timestamp()+interval '10 minutes');`;}
console.log(`
delete from feature_flags where tenant_id=${t} and flag='learn.inputs.email.enabled';
${job(800,folder)}
${job(801,"WorkerPauseFolder")}
${job(802,"WorkerRetryFolder")}
insert into email_oauth_tokens(id,tenant_id,email_account_id,provider,access_token,refresh_token,expires_at,scope,token_type,raw_payload)
 values(${id(803)},${t},${a},'microsoft_365','SYNTHETIC-OLD','SYNTHETIC-REFRESH',clock_timestamp()-interval '1 second','Mail.Read','Bearer',${json({learnMicrosoft:{contract:"microsoft-delegated-credential/1",microsoftTenantId:uid(5),mailboxId:uid(3),bindingId:uid(4),clientId:uid(804)}})});
set local role service_role;
do $$declare credential jsonb;r jsonb;begin
 credential:=learn_microsoft_credential_read(${args(800)});
 assert credential->>'accessToken'='SYNTHETIC-OLD' and credential->>'clientId'=${q(uid(804))};
 r:=learn_microsoft_credential_refresh(${args(800)},${id(803)},(credential->>'updatedAt')::timestamptz,'SYNTHETIC-REFRESH','SYNTHETIC-NEW','SYNTHETIC-ROTATED',clock_timestamp()+interval '1 hour','Mail.Read offline_access');
 assert r->>'state'='saved';
 r:=learn_microsoft_credential_refresh(${args(800)},${id(803)},(credential->>'updatedAt')::timestamptz,'SYNTHETIC-REFRESH','SYNTHETIC-STALE','SYNTHETIC-STALE',clock_timestamp()+interval '1 hour','Mail.Read offline_access');
 assert r->>'state'='changed';
 credential:=learn_microsoft_credential_read(${args(800)});
 assert credential->>'accessToken'='SYNTHETIC-NEW' and credential->>'refreshToken'='SYNTHETIC-ROTATED';
 begin perform learn_microsoft_credential_read(${t},${a},${m},${b},'messages',${q(folder)},${id(800)},'microsoft-worker-rehearsal',1,${id(899)});raise exception 'foreign app credential accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_microsoft_job_stop(${t},${id(802)},'foreign-worker',1,'throttled',120);raise exception 'foreign worker accepted';exception when sqlstate 'PT409' then null;end;
 r:=learn_microsoft_job_stop(${t},${id(802)},'microsoft-worker-rehearsal',1,'throttled',120);
 assert r->>'state'='retrying' and r->>'attemptCount'='1' and (r->>'availableAt')::timestamptz>=clock_timestamp()+interval '119 seconds';
 assert learn_microsoft_job_stop(${t},${id(802)},'microsoft-worker-rehearsal',1,'throttled',120)=r||'{"historicalReceipt":true}'::jsonb;
end$$;reset role;
-- A tenant may already use Gmail Marketing while adding Microsoft intake.
-- Exercise both ready and missing-scope branches through the existing trigger.
insert into email_accounts(id,tenant_id,provider,email_address,status,auth_state)
 values(${id(850)},${t},'gmail','marketing@example.invalid','active','ok');
insert into email_oauth_tokens(id,tenant_id,email_account_id,provider,access_token,scope)
 values(${id(851)},${t},${id(850)},'gmail','SYNTHETIC-GMAIL','https://www.googleapis.com/auth/gmail.send');
insert into marketing_sender_profiles(id,tenant_id,source_kind,email_account_id,mailbox_address,enabled)
 values(${id(852)},${t},'gmail_oauth',${id(850)},'marketing@example.invalid',true);
set local role service_role;
do $$declare credential jsonb;r jsonb;begin
 credential:=public.learn_microsoft_credential_read(${args(800)});
 r:=public.learn_microsoft_credential_refresh(${args(800)},${id(803)},(credential->>'updatedAt')::timestamptz,'SYNTHETIC-ROTATED','SYNTHETIC-NEWER','SYNTHETIC-ROTATED-AGAIN',clock_timestamp()+interval '1 hour','Mail.Read');
 assert r->>'state'='saved';
end$$;reset role;
do $$begin
 assert exists(select 1 from tenant_connector_capabilities where tenant_id=${t} and connector_id='google-gmail' and capability_key='email.send_marketing' and enabled);
 assert exists(select 1 from tenant_connectors where tenant_id=${t} and connector_id='google-gmail' and enabled and health_status='healthy');
end$$;
set local search_path=pg_catalog;
update public.email_oauth_tokens set scope='https://www.googleapis.com/auth/gmail.readonly' where id=${id(851)};
do $$begin
 assert exists(select 1 from public.tenant_connector_capabilities where tenant_id=${t} and connector_id='google-gmail' and capability_key='email.send_marketing' and not enabled);
 assert public.marketing_sender_readiness(${t},${id(852)})->>'state'='send_scope_missing';
end$$;
set local search_path=public,pg_catalog;
insert into feature_flags(tenant_id,flag,value) values(${t},'learn.inputs.email.enabled','false');
set local role service_role;
do $$declare r jsonb;begin
 begin perform learn_microsoft_credential_read(${args(801,"WorkerPauseFolder")});raise exception 'paused credentials accepted';exception when sqlstate 'PT409' then assert sqlerrm='learn_microsoft_capture_paused';end;
 r:=learn_microsoft_job_stop(${t},${id(801)},'microsoft-worker-rehearsal',1,'capture_unconfirmed',null);
 assert r->>'state'='waiting' and r->>'attemptCount'='0';
 assert not learn_microsoft_job_claimable(${t},'email.microsoft_sync',${id(801)});
 assert learn_microsoft_job_stop(${t},${id(801)},'microsoft-worker-rehearsal',1,'capture_unconfirmed',null)=r||'{"historicalReceipt":true}'::jsonb;
end$$;reset role;
delete from feature_flags where tenant_id=${t} and flag='learn.inputs.email.enabled';
update platform_jobs set status='running',claimed_by='microsoft-worker-rehearsal',attempt_count=1,lease_expires_at=clock_timestamp()+interval '10 minutes' where id=${id(801)};
set local role service_role;
do $$declare r jsonb;s jsonb;begin
 r:=learn_microsoft_job_stop(${t},${id(801)},'microsoft-worker-rehearsal',1,'auth_required',null);
 assert r->>'state'='failed' and r->>'code'='auth_required';
 s:=learn_microsoft_journal_open(${t},${a},${m},${b},'messages',${q(folder)},${json(before)},${id(800)},'microsoft-worker-rehearsal',1);
 perform learn_microsoft_journal_commit(${t},(s->>'streamId')::uuid,${id(810)},0,${json(before)},${json(page)},${json(after)},${id(800)},'microsoft-worker-rehearsal',1);
 r:=learn_microsoft_job_stop(${t},${id(800)},'microsoft-worker-rehearsal',1,'fetch_failed',null);
 assert r->>'state'='recover';
end$$;reset role;
insert into feature_flags(tenant_id,flag,value) values(${t},'learn.inputs.email.enabled','false');
update email_accounts set auth_state='revoked' where id=${a};
set local role service_role;
do $$declare r jsonb;begin
 assert learn_microsoft_job_claimable(${t},'email.microsoft_sync',${id(800)});
 r:=learn_microsoft_job_settle(${t},${id(800)},'microsoft-worker-rehearsal',1,true);
 assert r->>'state'='completed' and r->>'observationsStored'='1' and r->>'mailboxCoverage'='unverified';
 assert learn_microsoft_job_settle(${t},${id(800)},'microsoft-worker-rehearsal',1,true)=r;
 begin perform learn_microsoft_job_stop(${t},${id(800)},'microsoft-worker-rehearsal',1,'fetch_failed',null);raise exception 'completed source overwritten';exception when sqlstate 'PT409' then null;end;
 begin perform 1 from learn_microsoft_job_stops;raise exception 'raw stop receipts exposed';exception when insufficient_privilege then null;end;
end$$;reset role;
do $$begin
 assert (select count(*) from learn_microsoft_job_stops where tenant_id=${t})=3;
 assert (select count(*) from learn_microsoft_source_pages where job_id=${id(800)})=1;
 assert exists(select 1 from email_messages where tenant_id=${t} and provider='microsoft_365' and provider_message_id=${q(uid(5)+":"+uid(3)+":WorkerRehearsalMessage")} and body_text='Synthetic worker recovery content');
 assert exists(select 1 from platform_jobs where id=${id(801)} and status='dead_letter');
 assert exists(select 1 from platform_jobs where id=${id(802)} and status='retrying' and claimed_by is null);
 begin delete from learn_microsoft_job_stops where tenant_id=${t};raise exception 'stop evidence modified';exception when insufficient_privilege then null;end;
end$$;
set local role authenticated;
do $$begin
 begin perform learn_microsoft_credential_read(${args(800)});raise exception 'human credential access accepted';exception when insufficient_privilege then null;end;
 begin perform learn_microsoft_job_stop(${t},${id(802)},'microsoft-worker-rehearsal',1,'throttled',120);raise exception 'human stop access accepted';exception when insufficient_privilege then null;end;
end$$;reset role;
set local role anon;
do $$begin begin perform learn_microsoft_credential_read(${args(800)});raise exception 'anonymous credential access accepted';exception when insufficient_privilege then null;end;end$$;reset role;
`);
