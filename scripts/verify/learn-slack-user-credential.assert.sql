reset role;
create schema vault;
create table vault.decrypted_secrets(id uuid primary key,name text,decrypted_secret text);
insert into vault.decrypted_secrets values
 ('00000000-0000-4000-8000-000000000021','provider_secret:00000000-0000-4000-8000-000000000010:slack:user_token','synthetic-user-token');
do $$declare cfg jsonb;begin
 if learn_slack_credential_field('{"team_id":"TSETUP"}') is distinct from 'bot_token'
 or learn_slack_credential_field('{"credential_kind":"bot"}') is distinct from 'bot_token'
 or learn_slack_credential_field('{"credential_kind":"user","authorized_user_id":"USETUP"}') is distinct from 'user_token' then
  raise exception 'Credential selection mismatch';end if;
 for cfg in select value from jsonb_array_elements('[null,[],{}, {"credential_kind":null},{"credential_kind":"other"},{"credential_kind":"user"},{"credential_kind":"user","authorized_user_id":"BSETUP"},{"credential_kind":"bot","authorized_user_id":"USETUP"}]') loop
  if cfg='{}'::jsonb then continue;end if;
  if learn_slack_credential_field(cfg) is not null then raise exception 'Invalid identity selected a credential';end if;
 end loop;
end $$;
-- Use a real claimed history job; leave the recurring fixture unchanged after
-- the broker checks so the full scheduler/thread suite runs on the user route.
begin;
update platform_jobs set status='running',claimed_by='synthetic-worker',attempt_count=1,lease_expires_at=clock_timestamp()+interval '5 minutes' where status='queued';
set test.role='service_role';
do $$declare j platform_jobs%rowtype;c provider_connections%rowtype;r text;begin
 select * into j from platform_jobs where status='running';select * into c from provider_connections;
 r:=learn_slack_read_credential(j.tenant_id,j.id,j.claimed_by,1,c.id,c.updated_at,'00000000-0000-4000-8000-000000000021');
 if r is distinct from 'synthetic-user-token' then raise exception 'User credential was not resolved';end if;
 insert into slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope)
  select '00000000-0000-4000-8000-000000000088',j.tenant_id,a.id,
   '00000000-0000-4000-8000-000000000050',j.id,'00000000-0000-4000-8000-000000000011','{}',
   (a.settings->'slack_history')||'{"parentTimestamp":"1767225600.000001"}'::jsonb
  from connector_accounts a where a.id=(j.payload->>'connector_account_id')::uuid;
 update platform_jobs set job_type='slack.thread_sync',payload=payload||'{"thread_import_id":"00000000-0000-4000-8000-000000000088"}'::jsonb where id=j.id;
 r:=learn_slack_read_thread_credential(j.tenant_id,j.id,j.claimed_by,1,c.id,c.updated_at,'00000000-0000-4000-8000-000000000021');
 if r is distinct from 'synthetic-user-token' then raise exception 'Thread user credential was not resolved';end if;
 update platform_jobs set job_type=j.job_type,payload=j.payload where id=j.id;
 if learn_slack_read_credential(j.tenant_id,j.id,'wrong-worker',1,c.id,c.updated_at,'00000000-0000-4000-8000-000000000021') is not null then raise exception 'Wrong claim resolved credential';end if;
 if learn_slack_read_credential('00000000-0000-4000-8000-000000000099',j.id,j.claimed_by,1,c.id,c.updated_at,'00000000-0000-4000-8000-000000000021') is not null then raise exception 'Wrong tenant resolved credential';end if;
 update vault.decrypted_secrets set name='provider_secret:'||j.tenant_id::text||':slack:bot_token';
 if learn_slack_read_credential(j.tenant_id,j.id,j.claimed_by,1,c.id,c.updated_at,'00000000-0000-4000-8000-000000000021') is not null then raise exception 'User route resolved bot namespace';end if;
 update vault.decrypted_secrets set name='provider_secret:'||j.tenant_id::text||':slack:user_token';
 update provider_connections set non_secret_config=non_secret_config-'authorized_user_id';
 if learn_slack_read_credential(j.tenant_id,j.id,j.claimed_by,1,c.id,c.updated_at,'00000000-0000-4000-8000-000000000021') is not null then raise exception 'Incomplete identity resolved credential';end if;
end $$;
rollback;
set test.role='authenticated';set role authenticated;
do $$declare denied boolean:=false;begin
 begin perform learn_slack_read_credential(null,null,null,null,null,null,null);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Browser can resolve credential';end if;
end $$;
reset role;
select 'PASS: user identity selects only its Vault namespace; claim, tenant, malformed identity and browser access are fenced';
