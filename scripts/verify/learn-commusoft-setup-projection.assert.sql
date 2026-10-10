-- Disposable catalog projection only. Actual extension encryption with a fake key.
insert into auth.users(id,email) values('99000000-0000-0000-0000-000000000010','operator@example.invalid');
insert into profiles(id,tenant_id,email,role) values('99000000-0000-0000-0000-000000000010','99000000-0000-0000-0000-000000000001','operator@example.invalid','owner');
insert into platform_authority_grants(profile_id,permission,granted_by) values('99000000-0000-0000-0000-000000000010','platform.controlplane.admin','synthetic');
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='99000000-0000-0000-0000-000000000010';set role authenticated;
do $$declare r jsonb;begin
 r:=public.learn_commusoft_configure('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000011','99000000-0000-0000-0000-000000000010',
  '{"kind":"configure_commusoft","reason":"Disposable encrypted setup","region":"uk","account_key":"synthetic-connection","expected_revision":null,"credential_mode":"replace","same_account_confirmed":true}',
  'apply','SYNTHETIC_ENCRYPTED_CONNECTION_KEY');
 if r->>'state'<>'recorded' or r->>'verification'<>'required' then raise exception 'Setup result differs';end if;
end$$;
reset role;
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='provider_secret:99000000-0000-0000-0000-000000000001:commusoft:api_key' and decrypted_secret='SYNTHETIC_ENCRYPTED_CONNECTION_KEY') then raise exception 'Encrypted Vault round trip failed';end if;
 if exists(select 1 from vault.secrets where secret='SYNTHETIC_ENCRYPTED_CONNECTION_KEY') then raise exception 'Vault persisted plaintext';end if;
end$$;
create function fixture_setup_reuse() returns jsonb language sql security definer as $$
 select jsonb_build_object('kind','configure_commusoft','reason','Disposable encrypted reuse','region','uk','account_key','synthetic-connection','expected_revision',updated_at,'credential_mode','reuse','same_account_confirmed',true)
 from public.provider_connections where tenant_id='99000000-0000-0000-0000-000000000001'$$;
set role authenticated;
do $$declare r jsonb;begin
 r:=public.learn_commusoft_configure('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000012','99000000-0000-0000-0000-000000000010',public.fixture_setup_reuse());
 if r->>'state'<>'recorded' then raise exception 'Stored credential reuse failed';end if;
end$$;
reset role;
create function fixture_setup_verify() returns jsonb language sql security definer as $$
 select jsonb_build_object('kind','verify_commusoft','reason','Disposable access check','connection_id',id,'revision',updated_at,'one_read_confirmed',true)
 from public.provider_connections where tenant_id='99000000-0000-0000-0000-000000000001'$$;
set role authenticated;
do $$begin
 if public.learn_commusoft_verify_request('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000013','99000000-0000-0000-0000-000000000010',public.fixture_setup_verify())->>'state'<>'approved' then raise exception 'Verification approval failed';end if;
end$$;
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$declare permit jsonb;receipt jsonb;begin
 permit:=public.learn_commusoft_verify_acquire('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000013');
 if permit->>'state' is distinct from 'ready' or permit->>'apiKey' is distinct from 'SYNTHETIC_ENCRYPTED_CONNECTION_KEY' then raise exception 'Vault permit release failed';end if;
 if not public.learn_commusoft_verify_authorized('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000013',(permit->>'permitId')::uuid) then raise exception 'Stored permit authority failed';end if;
 receipt:=public.learn_commusoft_verify_finish('99000000-0000-0000-0000-000000000001','99000000-0000-0000-0000-000000000013',(permit->>'permitId')::uuid,'access_verified');
 if receipt->>'code' is distinct from 'access_verified' then raise exception 'Verification finish failed';end if;
end$$;
reset role;
do $$begin
 if (select count(*) from provider_connection_events where tenant_id='99000000-0000-0000-0000-000000000001')<>3 then raise exception 'Retained audit differs';end if;
 if exists(select 1 from platform_jobs) or exists(select 1 from feature_flags) then raise exception 'Connection operation started capture';end if;
 if has_table_privilege('postgres','vault.secrets','update') or has_table_privilege('postgres','vault.secrets','insert') then raise exception 'Vault owner permissions broadened';end if;
end$$;
