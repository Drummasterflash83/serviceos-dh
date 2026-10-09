reset role;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';
set role authenticated;
do $$declare a jsonb;r jsonb;account uuid;begin
 a:=learn_slack_accounts_read(verify.id(901));
 assert a->>'version'='learn-slack-accounts/1';
 select (v->>'id')::uuid into account from jsonb_array_elements(a->'accounts')v where v->>'channelId'='CTHREAD';
 assert account is not null;
 r:=learn_slack_threads_read(verify.id(901),account);
 assert r->>'coverage'='observed_threads_only' and r->'canImport'='true'::jsonb;
 assert jsonb_array_length(r->'threads')=1,'Reply and root were not deduplicated';
 assert r->'threads'->0->>'parentTimestamp'='1767225700.000001';
 assert r->'threads'->0->>'excerpt'='Synthetic thread root','Reader did not prefer retained parent evidence';
 assert r->'threads'->0->'latestImport'->>'status'='succeeded';
 assert r->'threads'->0->'latestImport'->'complete'='true'::jsonb;
 assert r->'threads'->0->'latestImport'->'pages'='2'::jsonb;
 assert r->'nextCursor'='null'::jsonb;
 assert r::text not like '%secret_refs%' and r::text not like '%xoxb%' and r::text not like '%provider_payload%' and r::text not like '%last_error%';
 assert not has_table_privilege('authenticated','platform_jobs','SELECT'),'Read model broadened raw queue access';
 assert not has_function_privilege('anon','learn_slack_threads_read(uuid,uuid,text)','execute');
 begin perform learn_slack_threads_read(verify.id(902),account);raise exception 'Foreign tenant accepted';exception when insufficient_privilege then null;end;
 begin perform learn_slack_threads_read(verify.id(901),verify.id(9999));raise exception 'Foreign account accepted';exception when insufficient_privilege then null;end;
 begin perform learn_slack_threads_read(verify.id(901),account,'invalid');raise exception 'Malformed cursor accepted';exception when invalid_parameter_value then null;end;
end $$;
reset role;
-- Additional synthetic parent records for the reader's keyset pagination only.
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,thread_timestamp,message_text,provider_payload,source_version,source_updated_at)
 select verify.id(1100+n),verify.id(901),'TTEST:CTHREAD:'||(1767225800+n)::text||'.000001','TTEST','CTHREAD',(1767225800+n)::text||'.000001',null,'Synthetic pagination parent',jsonb_build_object('reply_count',1),repeat('a',64),1767225800+n from generate_series(1,20)n;
update connector_accounts set status='disabled' where id=(select account_id from verify.thread_history);
set role authenticated;
do $$declare r jsonb;s jsonb;account uuid;begin
 select account_id into account from verify.thread_history;
 r:=learn_slack_threads_read(verify.id(901),account);
 assert r->'canImport'='false'::jsonb and jsonb_array_length(r->'threads')=20;
 assert r->>'nextCursor' is not null;
 s:=learn_slack_threads_read(verify.id(901),account,r->>'nextCursor');
 assert jsonb_array_length(s->'threads')=1 and s->'nextCursor'='null'::jsonb;
 assert s->'threads'->0->>'parentTimestamp'='1767225700.000001';
 assert not exists(select 1 from jsonb_array_elements(r->'threads')x join jsonb_array_elements(s->'threads')y on x->>'parentTimestamp'=y->>'parentTimestamp');
end $$;
reset role;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000912';
set role authenticated;
do $$begin
 assert jsonb_array_length(learn_slack_accounts_read(verify.id(902))->'accounts')=0;
 begin perform learn_slack_accounts_read(verify.id(901));raise exception 'Foreign company enumeration accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Existing email changed';end $$;
