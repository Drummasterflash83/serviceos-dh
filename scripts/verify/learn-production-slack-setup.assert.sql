-- Full production schema in a disposable offline clone. Real Auth, authority and encrypted Vault.
set search_path=public,pg_catalog;
begin;
create schema verify;
grant usage on schema verify to authenticated,service_role;
create function verify.id(n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function verify.id(integer) to authenticated,anon,service_role;
create table verify.setup(definition jsonb,receipt jsonb);
grant select,update on verify.setup to authenticated;
insert into tenants(id,slug,display_name,status) values(verify.id(200),'slack-operator-probe','Synthetic Slack','active'),(verify.id(201),'slack-operator-other','Synthetic Other','active');
insert into auth.users(id,banned_until) values(verify.id(210),'infinity'),(verify.id(211),'infinity'),(verify.id(212),'infinity'),(verify.id(213),'infinity');
update profiles set tenant_id=verify.id(200),role='owner' where id=verify.id(210);
update profiles set tenant_id=verify.id(200),role='viewer' where id=verify.id(211);
update profiles set tenant_id=verify.id(201),role='viewer' where id in(verify.id(212),verify.id(213));
insert into platform_authority_grants(profile_id,permission,granted_by) values(verify.id(212),'platform.controlplane.admin','offline synthetic fixture'),(verify.id(213),'platform.controlplane.view','offline synthetic fixture');
insert into verify.setup values('{"kind":"configure_slack","reason":"Synthetic authorised channel import","team_id":"TOPERATOR","authorized_user_id":"UOPERATOR","expected_revision":null,"credential_mode":"replace","same_account_confirmed":true}',null);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000212';set request.jwt.claim.role='authenticated';set role authenticated;
do $$declare r jsonb;d jsonb;begin
 select definition into d from verify.setup;
 r:=learn_slack_configure(verify.id(200),verify.id(220),verify.id(212),d,'apply','xoxp-synthetic-only');
 if r->>'verification'<>'required' or r->>'state'<>'recorded' then raise exception 'Setup receipt differs';end if;
 if r<>learn_slack_configure(verify.id(200),verify.id(220),verify.id(212),d,'apply','xoxp-synthetic-only') then raise exception 'Retry changed receipt';end if;
 if r<>learn_slack_configure(verify.id(200),verify.id(220),verify.id(212),d,'check') then raise exception 'Lost response lookup failed';end if;
 update verify.setup set receipt=r;
 begin perform learn_slack_configure(verify.id(200),verify.id(220),verify.id(212),d,'apply','xoxp-other');raise exception 'Changed secret accepted';exception when sqlstate 'PT409' then null;end;
 r:=learn_slack_configure(verify.id(200),verify.id(221),verify.id(212),d,'cancel');
 if r->>'state'<>'cancelled' or r<>learn_slack_configure(verify.id(200),verify.id(221),verify.id(212),d,'apply','xoxp-other') then raise exception 'Late apply bypassed cancellation';end if;
end$$;
reset role;
do $$begin
 if (select count(*) from vault.secrets where name='provider_secret:'||verify.id(200)||':slack:user_token')<>1 or (select count(*) from provider_connections where tenant_id=verify.id(200))<>1
  or exists(select 1 from platform_jobs where tenant_id=verify.id(200)) or exists(select 1 from tenant_connectors where tenant_id=verify.id(200))
  or exists(select 1 from feature_flags where tenant_id=verify.id(200)) then raise exception 'Setup activated capture or duplicated credentials';end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='provider_secret:'||verify.id(200)||':slack:user_token') is distinct from 'xoxp-synthetic-only' then raise exception 'Encrypted Vault round trip failed';end if;
 if exists(select 1 from provider_connections where tenant_id=verify.id(200) and (non_secret_config->>'credential_kind'<>'user' or configured_fields<>array['user_token'] or verified_at is not null))
  or (select jsonb_agg(to_jsonb(s))::text from provider_connections s where tenant_id=verify.id(200)) like '%xoxp-%'
  or (select jsonb_agg(to_jsonb(s))::text from learn_slack_connection_requests s where tenant_id=verify.id(200)) like '%xoxp-%'
  or (select jsonb_agg(to_jsonb(s))::text from provider_connection_events s where tenant_id=verify.id(200)) like '%xoxp-%' then raise exception 'Unsafe secret metadata';end if;
end$$;
set role authenticated;
do $$declare d jsonb;r jsonb;begin
 select definition||jsonb_build_object('expected_revision',receipt->>'revision','credential_mode','reuse') into d from verify.setup;
 r:=learn_slack_configure(verify.id(200),verify.id(222),verify.id(212),d,'apply');
 update verify.setup set receipt=r;
 begin perform learn_slack_configure(verify.id(200),verify.id(223),verify.id(212),d||'{"authorized_user_id":"UOTHER"}','apply');raise exception 'Identity switch accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_slack_configure(verify.id(200),verify.id(224),verify.id(210),d,'apply');raise exception 'Actor spoof accepted';exception when insufficient_privilege then null;end;
 r:=learn_slack_connections_read(verify.id(200));
 if jsonb_array_length(r)<>1 or r::text like '%secret_refs%' or r::text like '%xoxp-%' then raise exception 'Metadata read invalid';end if;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000213';
do $$begin
 if jsonb_array_length(learn_slack_connections_read(verify.id(200)))<>1 then raise exception 'View operator cannot read';end if;
 begin perform learn_slack_configure(verify.id(200),verify.id(225),verify.id(213),(select definition from verify.setup),'apply','xoxp-synthetic-only');raise exception 'View operator configured';exception when insufficient_privilege then null;end;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000210';
do $$begin
 if jsonb_array_length(learn_slack_connections_read(verify.id(200)))<>1 then raise exception 'Own client read lost';end if;
 begin perform learn_slack_connections_read(verify.id(201));raise exception 'Cross client read accepted';exception when insufficient_privilege then null;end;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000212';
do $$declare r jsonb;c jsonb;begin
 select receipt into c from verify.setup;
 r:=learn_slack_start_import(verify.id(200),verify.id(230),(c->>'connection_id')::uuid,c->>'revision','COPERATOR','2026-01-01','2026-01-02',2,'Operator channel acceptance');
 if r->>'reused'<>'false' then raise exception 'Operator import not created';end if;
 if learn_slack_accounts_read(verify.id(200))->'accounts'->0->>'id'<>r->>'accountId' then raise exception 'Operator account read differs';end if;
 if learn_slack_history_read(verify.id(200),(r->>'accountId')::uuid)->>'accountId'<>r->>'accountId' then raise exception 'Operator history read differs';end if;
 begin perform learn_slack_configure(verify.id(200),verify.id(231),verify.id(212),(select definition||jsonb_build_object('expected_revision',receipt->>'revision') from verify.setup),'apply','xoxp-rotation');raise exception 'Active capture credential rotated';exception when sqlstate '55000' then null;end;
end$$;
reset role;
-- Exercise the reference trigger directly under the real logged actor. The
-- API role has no direct write grant; these owner-side probes test defence in depth.
do $$begin
 begin
  insert into slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition)
   select verify.id(250),tenant_id,account_id,job_id,verify.id(213),definition from slack_history_imports where id=verify.id(230);
  raise exception 'Foreign approver impersonation accepted';
 exception when insufficient_privilege then null;end;
 begin
  insert into slack_history_imports(id,tenant_id,account_id,job_id,approved_by,definition)
   select verify.id(251),verify.id(201),account_id,job_id,verify.id(212),definition from slack_history_imports where id=verify.id(230);
  raise exception 'Foreign account/job reference accepted';
 exception when check_violation then null;end;
end$$;
insert into slack_messages(id,tenant_id,source_external_id,team_id,channel_id,provider_timestamp,message_text,provider_payload,source_version,source_updated_at)
 values(verify.id(240),verify.id(200),'synthetic-operator-root','TOPERATOR','COPERATOR','1767225600.000001','Synthetic root','{"reply_count":1}',repeat('a',64),1767225600.000001);
set role authenticated;
do $$declare a uuid;c jsonb;r jsonb;begin
 select receipt into c from verify.setup;
 a:=(learn_slack_accounts_read(verify.id(200))->'accounts'->0->>'id')::uuid;
 if jsonb_array_length(learn_slack_threads_read(verify.id(200),a)->'threads')<>1 then raise exception 'Operator thread read missing';end if;
 r:=learn_slack_start_thread_import(verify.id(200),verify.id(241),a,verify.id(240),repeat('a',64),(c->>'revision')::timestamptz,'2026-01-01','2026-01-02',2,'Operator reply acceptance');
 if r->>'reused'<>'false' or learn_slack_thread_recovery_read(verify.id(200),verify.id(241))->>'importId'<>verify.id(241)::text then raise exception 'Operator thread approval/recovery read missing';end if;
end$$;
reset role;
update platform_jobs set status='failed' where tenant_id=verify.id(200);
set role authenticated;
do $$declare a uuid;r jsonb;begin
 a:=(learn_slack_accounts_read(verify.id(200))->'accounts'->0->>'id')::uuid;
 r:=learn_slack_resume_history(verify.id(200),verify.id(242),a,learn_slack_history_read(verify.id(200),a)->>'stateVersion','restart',2,'Retain and restart history');
 if r->>'reused'<>'false' then raise exception 'Operator history recovery missing';end if;
 r:=learn_slack_resume_thread(verify.id(200),verify.id(243),verify.id(241),learn_slack_thread_recovery_read(verify.id(200),verify.id(241))->>'stateVersion','restart',2,'Retain and restart replies');
 if r->>'reused'<>'false' then raise exception 'Operator thread recovery missing';end if;
end$$;
reset role;
do $$begin
 if not exists(select 1 from slack_history_imports where approved_by=verify.id(212) and tenant_id=verify.id(200))
 or not exists(select 1 from provider_connection_events where actor_id=verify.id(212) and tenant_id=verify.id(200) and detail->>'action'='start_history') then raise exception 'Operator attribution missing';end if;
 if (select tenant_id from profiles where id=verify.id(212))<>verify.id(201) then raise exception 'Operator profile moved';end if;
end$$;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(verify.id(200),verify.id(212),'role','viewer','offline preview fixture');
set role authenticated;
do $$begin
 begin perform learn_slack_connections_read(verify.id(200));raise exception 'Preview operator accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id=verify.id(212);
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=verify.id(212);
set role authenticated;
do $$begin
 begin perform learn_slack_connections_read(verify.id(200));raise exception 'Expired authority accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 if has_function_privilege('anon','learn_slack_configure(uuid,uuid,uuid,jsonb,text,text)','execute')
 or has_function_privilege('service_role','learn_slack_configure(uuid,uuid,uuid,jsonb,text,text)','execute')
 or has_table_privilege('authenticated','learn_slack_connection_requests','select') then raise exception 'Unexpected grant';end if;
end$$;
rollback;
select 'PASS: operator configuration/recovery, cancellation, secret isolation, identity/revision fencing, logged cross-client import and revoked/preview/tenant access';
