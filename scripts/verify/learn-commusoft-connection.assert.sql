set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';set role authenticated;
do $$begin begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(181),fixture_connection_definition(),'apply','SYNTHETIC_KEY_A');raise exception 'Tenant owner configured connection';exception when insufficient_privilege then null;end;end$$;
reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;
do $$begin begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(182),fixture_connection_definition(),'apply','SYNTHETIC_KEY_A');raise exception 'Platform viewer configured connection';exception when insufficient_privilege then null;end;end$$;
reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
do $$declare r jsonb;begin
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(181),fixture_connection_definition(),'apply','SYNTHETIC_KEY_A');raise exception 'Wrong actor accepted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition()||'{"api_key":"must-not-be-persisted"}','cancel');raise exception 'Secret-bearing definition retained';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'check','SYNTHETIC_KEY_A');raise exception 'Receipt check accepted a secret';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition('reuse'));raise exception 'Missing stored credential accepted';exception when object_not_in_prerequisite_state then null;end;
 r:=learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'apply','SYNTHETIC_KEY_A');
 if r->>'state'<>'recorded' or r->>'verification'<>'required' or r::text like '%SYNTHETIC_KEY%' then raise exception 'Initial receipt differs';end if;
 if r is distinct from learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'check')
  or r is distinct from learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'apply','SYNTHETIC_KEY_A') then raise exception 'Receipt replay differs';end if;
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'apply','SYNTHETIC_KEY_B');raise exception 'Changed credential replay accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_commusoft_configure(fixture_id(301),fixture_id(310),fixture_id(180),fixture_connection_definition(),'check');raise exception 'Foreign tenant receipt accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(311),fixture_id(180),fixture_connection_definition(),'apply','SYNTHETIC_KEY_B');raise exception 'Missing revision accepted';exception when sqlstate 'PT409' then null;end;
 begin perform * from learn_commusoft_connection_requests;raise exception 'Raw connection history readable';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$declare c provider_connections%rowtype;begin
 select * into c from provider_connections where tenant_id=fixture_id(300);
 if c.verified_at is not null or c.last_test->>'state'<>'not_verified' or c.status<>'configured' then raise exception 'Configuration fabricated verification';end if;
 if (select count(*) from provider_connection_events where tenant_id=fixture_id(300))<>1 then raise exception 'Replay duplicated audit';end if;
 if exists(select 1 from feature_flags where tenant_id=fixture_id(300)) or exists(select 1 from platform_jobs where tenant_id=fixture_id(300)) then raise exception 'Setup enabled or started work';end if;
 if (select decrypted_secret from vault.decrypted_secrets where name='provider_secret:'||fixture_id(300)||':commusoft:api_key')<>'SYNTHETIC_KEY_A' then raise exception 'Vault value differs';end if;
 if exists(select 1 from learn_commusoft_connection_requests where to_jsonb(learn_commusoft_connection_requests)::text like '%SYNTHETIC_KEY%')
  or exists(select 1 from provider_connection_events where to_jsonb(provider_connection_events)::text like '%SYNTHETIC_KEY%')
  or to_jsonb(c)::text like '%SYNTHETIC_KEY%' then raise exception 'Credential leaked outside Vault';end if;
 if has_function_privilege('service_role','learn_commusoft_configure(uuid,uuid,uuid,jsonb,text,text)','EXECUTE')
  or has_function_privilege('anon','learn_commusoft_configure(uuid,uuid,uuid,jsonb,text,text)','EXECUTE')
  or has_function_privilege('authenticated','provider_secret_read(uuid,text,text)','EXECUTE') then raise exception 'Connection authority broadened';end if;
end$$;
-- Definitions remain stable through cancellation and revocation; secrets are never
-- needed to check or cancel the stored intent.
insert into fixture_input_definitions values('connection-reuse',(select fixture_connection_definition('reuse',updated_at) from provider_connections where tenant_id=fixture_id(300)));
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_commusoft_configure(fixture_id(300),fixture_id(312),fixture_id(180),fixture_definition('connection-reuse'),'cancel');
 if r->>'state'<>'cancelled' or r is distinct from learn_commusoft_configure(fixture_id(300),fixture_id(312),fixture_id(180),fixture_definition('connection-reuse')) then raise exception 'Cancelled configuration applied late';end if;
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(313),fixture_id(180),fixture_definition('connection-reuse')||'{"account_key":"different-account"}');raise exception 'Source identity rebound';exception when sqlstate 'PT409' then null;end;
 begin perform learn_commusoft_configure(fixture_id(300),fixture_id(313),fixture_id(180),fixture_definition('connection-reuse')||'{"region":"us"}');raise exception 'Source region rebound';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
insert into platform_jobs(id,tenant_id,job_type,status) values(fixture_id(320),fixture_id(300),'commusoft.source_sync','queued');
set role authenticated;
do $$begin begin perform learn_commusoft_configure(fixture_id(300),fixture_id(313),fixture_id(180),fixture_definition('connection-reuse'));raise exception 'Active import reconfigured';exception when object_not_in_prerequisite_state then null;end;end$$;
reset role;update platform_jobs set status='dead_letter' where id=fixture_id(320);
-- A late audit/receipt failure must roll the secret change back too.
create function fixture_connection_fail() returns trigger language plpgsql as $$begin if new.id=public.fixture_id(314) then raise exception 'Synthetic late failure' using errcode='P0002';end if;return new;end$$;
create trigger fixture_connection_fail before insert on learn_commusoft_connection_requests for each row execute function fixture_connection_fail();
set role authenticated;
do $$begin begin perform learn_commusoft_configure(fixture_id(300),fixture_id(314),fixture_id(180),fixture_definition('connection-reuse')||'{"credential_mode":"replace"}','apply','SYNTHETIC_KEY_B');raise exception 'Late failure absent';exception when no_data_found then null;end;end$$;
reset role;
do $$begin
 if (select decrypted_secret from vault.decrypted_secrets where name='provider_secret:'||fixture_id(300)||':commusoft:api_key')<>'SYNTHETIC_KEY_A'
  or (select count(*) from provider_connection_events where tenant_id=fixture_id(300))<>1
  or (select updated_at from provider_connections where tenant_id=fixture_id(300)) is distinct from (fixture_definition('connection-reuse')->>'expected_revision')::timestamptz then raise exception 'Late failure retained partial writes';end if;
end$$;
update provider_connections set verified_at=clock_timestamp(),last_test='{"state":"verified"}' where tenant_id=fixture_id(300);
update fixture_input_definitions set definition=(select fixture_connection_definition('replace',updated_at) from provider_connections where tenant_id=fixture_id(300)) where name='connection-reuse';
set role authenticated;
select learn_commusoft_configure(fixture_id(300),fixture_id(315),fixture_id(180),fixture_definition('connection-reuse'),'apply','SYNTHETIC_KEY_B')->>'verification';
reset role;
do $$begin
 if (select verified_at from provider_connections where tenant_id=fixture_id(300)) is not null
  or (select decrypted_secret from vault.decrypted_secrets where name='provider_secret:'||fixture_id(300)||':commusoft:api_key')<>'SYNTHETIC_KEY_B'
  or (select previous_state->>'verified_at' from learn_commusoft_connection_requests where id=fixture_id(315)) is null then raise exception 'Rotation did not invalidate verification and retain prior state';end if;
 if exists(select 1 from learn_commusoft_connection_requests where to_jsonb(learn_commusoft_connection_requests)::text like '%SYNTHETIC_KEY%') then raise exception 'Rotation leaked secret';end if;
end$$;
-- Orphaned but tenant-qualified stored keys can be reused on first setup.
select provider_secret_store(fixture_id(301),'commusoft','api_key','SYNTHETIC_OTHER_TENANT_KEY');
set role authenticated;
select learn_commusoft_configure(fixture_id(301),fixture_id(316),fixture_id(180),fixture_connection_definition('reuse'))->>'verification';
reset role;
insert into view_as_context values(fixture_id(180),clock_timestamp()+interval '1 hour',null);
set role authenticated;
do $$begin begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'check');raise exception 'View As checked connection';exception when insufficient_privilege then null;end;end$$;
reset role;delete from view_as_context;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(180);
set role authenticated;
do $$begin begin perform learn_commusoft_configure(fixture_id(300),fixture_id(310),fixture_id(180),fixture_connection_definition(),'check');raise exception 'Revoked operator checked connection';exception when insufficient_privilege then null;end;end$$;
reset role;update platform_authority_grants set effective_to=null where profile_id=fixture_id(180);
select 'Connection authority, atomic Vault/config/audit, replay, cancellation, identity protection and no-secret history passed';
