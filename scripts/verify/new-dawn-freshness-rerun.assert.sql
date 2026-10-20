-- Run after the isolated open-job-page bootstrap, base migration, 170000
-- migration and synthetic fixture. This adds only local provider stubs.
alter table public.provider_connections
 add column tenant_id uuid,
 add column provider text,
 add column status text,
 add column auth_mode text,
 add column revoked_at timestamptz,
 add column verified_at timestamptz,
 add column non_secret_config jsonb,
 add column secret_refs jsonb,
 add column updated_at timestamptz;
alter table public.new_dawn_commusoft_freshness_runs
 add column connection_id uuid,
 add column connection_revision timestamptz,
 add column secret_id uuid,
 add column saved_id text,
 add column saved_created_at text,
 add column state text default 'collecting',
 add column checked_at timestamptz,
 add column failure_count integer default 0,
 add column claimed_at timestamptz,
 add column next_attempt_at timestamptz,
 add column page_count integer default 0,
 add column cursor_id bigint,
 add column claim_token uuid,
 add column updated_at timestamptz;
alter table public.new_dawn_commusoft_freshness_runs
 alter column id set default gen_random_uuid();
create table vault.decrypted_secrets(id uuid,name text,decrypted_secret text);
create function public.learn_commusoft_shared_lease_acquire(text,text,text)
 returns jsonb language sql as $$select '{"state":"ready"}'::jsonb$$;
create function public.new_dawn_commusoft_freshness_current(uuid,uuid)
 returns boolean language sql as $$select true$$;
insert into public.provider_connections
 (id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config,secret_refs,updated_at)
 values('22222222-2222-4222-8222-222222222222',
 '11111111-1111-4111-8111-111111111111','commusoft','configured',
 'private_api_key',clock_timestamp(),'{"region":"uk"}',
 '{"api_key":"77777777-7777-4777-8777-777777777777"}',clock_timestamp());
insert into public.feature_flags(tenant_id,flag,value) values
 ('11111111-1111-4111-8111-111111111111','new_dawn.commusoft_freshness','true'),
 ('11111111-1111-4111-8111-111111111111','learn.enabled','true'),
 ('11111111-1111-4111-8111-111111111111','learn.inputs.commusoft.enabled','true');
insert into vault.decrypted_secrets values
 ('77777777-7777-4777-8777-777777777777',
  'provider_secret:11111111-1111-4111-8111-111111111111:commusoft:api_key',
  'synthetic-local-key');
update public.learn_business_input_versions
 set payload=payload||'{"createdOnDateTime":"2026-10-18T09:00:00Z"}'::jsonb
 where external_id='20' and collection='jobs';
set test.role='service_role';
do $$
declare result jsonb; first_run uuid; second_run uuid;
begin
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'ready' then raise exception 'daily claim missing';end if;
 select id into first_run from public.new_dawn_commusoft_freshness_runs
  where run_number=1;
 if first_run is null then raise exception 'first receipt missing';end if;
 update public.new_dawn_commusoft_freshness_runs
  set state='complete',checked_at=clock_timestamp()-interval '2 hours',claim_token=null
  where id=first_run;
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'idle' or
   (select count(*) from public.new_dawn_commusoft_freshness_runs)<>1 then
  raise exception 'unchanged source generated duplicate receipt';end if;
 update public.learn_business_input_versions
  set payload=payload||'{"createdOnDateTime":"2026-10-19T09:00:00Z"}'::jsonb
  where external_id='40' and collection='jobs' and payload->>'status'='on_hold';
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'ready' then raise exception 'advanced source rerun missing';end if;
 select id into second_run from public.new_dawn_commusoft_freshness_runs
  where run_number=2 and saved_id='40';
 if second_run is null then raise exception 'second immutable receipt missing';end if;
 update public.new_dawn_commusoft_freshness_runs
  set state='complete',checked_at=clock_timestamp(),claim_token=null
  where id=second_run;
 update public.learn_business_input_versions
  set payload=payload||'{"createdOnDateTime":"2026-10-20T08:00:00Z"}'::jsonb
  where external_id='20' and collection='jobs';
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'idle' or
   (select count(*) from public.new_dawn_commusoft_freshness_runs)<>2 then
  raise exception 'one-hour cooldown failed';end if;
 update public.new_dawn_commusoft_freshness_runs
  set checked_at=clock_timestamp()-interval '2 hours' where id=second_run;
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'ready' or
   (select count(*) from public.new_dawn_commusoft_freshness_runs)<>3 then
  raise exception 'bounded third receipt missing';end if;
end $$;
