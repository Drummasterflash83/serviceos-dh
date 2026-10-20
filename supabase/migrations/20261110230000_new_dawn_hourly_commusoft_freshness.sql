-- Recheck Commusoft's newest-created job at least hourly even if LEARN's
-- saved boundary has not advanced. An unchanged source can become newly stale
-- when the provider creates a job. Keep each comparison immutable and bounded;
-- 26 slots cover a 25-hour Europe/London DST day without a busy loop.
-- Installation starts no provider request and changes no tenant flag.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.new_dawn_commusoft_freshness_runs
 drop constraint new_dawn_commusoft_freshness_runs_run_number_check;
alter table public.new_dawn_commusoft_freshness_runs
 add constraint new_dawn_commusoft_freshness_runs_run_number_check
 check(run_number between 1 and 26);

create or replace function public.new_dawn_commusoft_freshness_claim()
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.provider_connections%rowtype;r public.new_dawn_commusoft_freshness_runs%rowtype;
 today date:=(clock_timestamp() at time zone 'Europe/London')::date;
 next_run integer;
 latest_id text;latest_created text;secret text;fingerprint text;lease jsonb;
 owner text;claim uuid;
begin
 if auth.role() is distinct from 'service_role'
  or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'freshness_forbidden' using errcode='42501';end if;
 for c in select pc.* from public.provider_connections pc join public.tenants t
  on t.id=pc.tenant_id and t.status='active'
 where pc.provider='commusoft' and pc.status='configured'
  and pc.auth_mode='private_api_key' and pc.revoked_at is null and pc.verified_at is not null
  and pc.non_secret_config->>'region' in('uk','us')
  and coalesce(pc.secret_refs->>'api_key','')~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  and exists(select 1 from public.feature_flags f where f.tenant_id=pc.tenant_id
   and f.flag='new_dawn.commusoft_freshness' and f.value='true'::jsonb)
  and exists(select 1 from public.feature_flags f where f.tenant_id=pc.tenant_id
   and f.flag='learn.enabled' and f.value='true'::jsonb)
  and exists(select 1 from public.feature_flags f where f.tenant_id=pc.tenant_id
   and f.flag='learn.inputs.commusoft.enabled' and f.value='true'::jsonb)
  and pc.id=(select pick.id from public.provider_connections pick
   where pick.tenant_id=pc.tenant_id and pick.provider='commusoft'
    and pick.status='configured' and pick.auth_mode='private_api_key'
    and pick.revoked_at is null and pick.verified_at is not null
    and pick.non_secret_config->>'region' in('uk','us')
    and coalesce(pick.secret_refs->>'api_key','')~
     '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   order by pick.id limit 1)
 order by pc.tenant_id for share of pc loop
 -- The input tick can invoke this worker more than once a minute. Serialize
 -- claims per tenant before considering a second immutable comparison receipt.
 perform pg_advisory_xact_lock(hashtextextended(c.tenant_id::text, 4901));
 select * into r from public.new_dawn_commusoft_freshness_runs
  where tenant_id=c.tenant_id and check_day=today
  order by run_number desc limit 1 for update;
 if not found or r.state in ('complete','partial') then
  if found and (r.run_number>=26 or coalesce(r.checked_at,r.updated_at)>clock_timestamp()-interval '1 hour') then
   continue;end if;
  select v.external_id,v.payload->>'createdOnDateTime'
   into latest_id,latest_created
   from public.learn_business_input_versions v
   where v.tenant_id=c.tenant_id and v.connection_id=c.id and v.provider='commusoft'
    and v.collection='jobs' and v.external_id~'^[1-9][0-9]{0,15}$'
    and v.payload->>'createdOnDateTime'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   order by v.payload->>'createdOnDateTime' desc,v.external_id::numeric desc limit 1;
  next_run:=coalesce(r.run_number,0)+1;
  insert into public.new_dawn_commusoft_freshness_runs
   (tenant_id,check_day,run_number,connection_id,connection_revision,
    secret_id,saved_id,saved_created_at)
   values(c.tenant_id,today,next_run,c.id,c.updated_at,
    (c.secret_refs->>'api_key')::uuid,latest_id,latest_created)
   returning * into r;
 end if;
 if r.state<>'collecting' then continue;end if;
 if r.connection_id is distinct from c.id or r.connection_revision is distinct from c.updated_at
  or r.secret_id::text is distinct from c.secret_refs->>'api_key' then
  return jsonb_build_object('state','held');end if;
 if r.failure_count>=8 then return jsonb_build_object('state','held');end if;
 if r.claimed_at>clock_timestamp()-interval '40 seconds'
  or r.next_attempt_at>clock_timestamp() then
  return jsonb_build_object('state','waiting');end if;
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=r.secret_id and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key';
 if secret is null or length(secret) not between 1 and 4096 or secret!~'^[!-~]+$' then
  return jsonb_build_object('state','held');end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 owner:=r.id::text||':'||r.page_count::text;
 lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'verification',owner);
 if lease->>'state'='wait' then return jsonb_build_object('state','waiting');end if;
 if lease->>'state'<>'ready' then return jsonb_build_object('state','held');end if;
 claim:=gen_random_uuid();
 update public.new_dawn_commusoft_freshness_runs set claim_token=claim,
  claimed_at=clock_timestamp(),updated_at=clock_timestamp(),next_attempt_at=null
  where id=r.id;
 if not public.new_dawn_commusoft_freshness_current(r.id,claim) then
  raise exception 'freshness_scope_changed' using errcode='42501';end if;
 return jsonb_build_object('state','ready','run_id',r.id,'claim_token',claim,
  'tenant_id',r.tenant_id,'after',r.cursor_id,'region',c.non_secret_config->>'region',
  'api_key',secret,'send_before',ceil(extract(epoch from clock_timestamp()+interval '5 seconds')*1000)::bigint);
 end loop;
 return jsonb_build_object('state','idle');
end $$;

commit;
