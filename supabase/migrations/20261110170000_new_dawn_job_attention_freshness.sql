-- Bounded, append-only same-day provider checks after saved Jobs advance.
-- Installation makes no provider request and alters no flags or schedules;
-- the existing scheduled worker can make at most eight checks per London day,
-- at least an hour apart after a saved source advance or partial result.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.new_dawn_commusoft_freshness_runs
 add column run_number integer not null default 1 check(run_number between 1 and 8);
alter table public.new_dawn_commusoft_freshness_runs
 drop constraint new_dawn_commusoft_freshness_runs_tenant_id_check_day_key;
alter table public.new_dawn_commusoft_freshness_runs
 add constraint new_dawn_commusoft_freshness_runs_tenant_day_number_key
 unique(tenant_id,check_day,run_number);
create index new_dawn_commusoft_freshness_runs_latest_idx
 on public.new_dawn_commusoft_freshness_runs(tenant_id,check_day desc,run_number desc);

create or replace function public.new_dawn_commusoft_freshness_read(
 p_tenant uuid,p_operator_reason text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();operator_read boolean:=p_operator_reason is not null;
 r public.new_dawn_commusoft_freshness_runs%rowtype;as_of timestamptz:=clock_timestamp();
 audit uuid:=gen_random_uuid(); current_saved text;
begin
 if auth.role() is distinct from 'authenticated' or actor is null or p_tenant is null then
  raise exception 'freshness_read_forbidden' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=as_of) for share;
 if not found then raise exception 'freshness_read_forbidden' using errcode='42501';end if;
 if operator_read then
  if length(btrim(p_operator_reason)) not between 3 and 500 then
   raise exception 'freshness_read_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,actor,true);
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
    where v.actor_user_id=actor and v.ended_at is null
     and (v.expires_at is null or v.expires_at>as_of))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor and g.permission in(
     'platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=as_of
     and coalesce(g.effective_to,'infinity')>as_of) then
   raise exception 'freshness_read_forbidden' using errcode='42501';end if;
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=case when operator_read then 'new_dawn.learn_daily_stats.operator_preview'
   else 'new_dawn.learn_daily_stats' end and value='true'::jsonb for share;
 if not found then raise exception 'freshness_read_disabled' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.commusoft_freshness' and value='true'::jsonb for share;
 if not found then raise exception 'freshness_read_disabled' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_freshness_runs
  where tenant_id=p_tenant order by check_day desc,run_number desc limit 1;
 if found then
  select v.external_id into current_saved from public.learn_business_input_versions v
   where v.tenant_id=p_tenant and v.connection_id=r.connection_id
    and v.provider='commusoft' and v.collection='jobs'
    and v.external_id~'^[1-9][0-9]{0,15}$'
    and v.payload->>'createdOnDateTime'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   order by v.payload->>'createdOnDateTime' desc,v.external_id::numeric desc limit 1;
 end if;
 if operator_read then perform public.learn_operator_input_access(p_tenant,actor,true);end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'learn.commusoft_freshness_read','commusoft_jobs',
  p_tenant::text,jsonb_build_object('run_id',r.id,'as_of',as_of),
  case when operator_read then btrim(p_operator_reason)
   else 'Client Commusoft freshness summary' end,audit::text,false,
  'new-dawn-commusoft-freshness');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-commusoft-freshness/1',
  'tenant_id',p_tenant,'actor_id',actor,'audit_id',audit,'observed_at',as_of,
  'state',case when r.id is null then 'not_checked'
   when r.state='complete' and r.saved_id is distinct from current_saved then 'saved_advanced'
   when r.state='complete' and (r.check_day<>(as_of at time zone 'Europe/London')::date
    or r.checked_at<as_of-interval '24 hours') then 'stale'
   else r.state end,
  'saved_job_id',r.saved_id,'provider_newest_job_id',r.newest_id,
  'provider_checked_at',r.checked_at,
  'jobs_behind',case when r.state='complete' and
   r.saved_id is not distinct from current_saved and
   r.check_day=(as_of at time zone 'Europe/London')::date and
   r.checked_at>=as_of-interval '24 hours' then r.behind_count else null end,
  'at_least_behind',case when r.state='partial' then r.behind_count else null end,
  'scope','provider_jobs_created_descending');
end $$;


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
  if found and (r.run_number>=8 or r.checked_at>clock_timestamp()-interval '1 hour') then
   continue;end if;
  select v.external_id,v.payload->>'createdOnDateTime'
   into latest_id,latest_created
   from public.learn_business_input_versions v
   where v.tenant_id=c.tenant_id and v.connection_id=c.id and v.provider='commusoft'
    and v.collection='jobs' and v.external_id~'^[1-9][0-9]{0,15}$'
    and v.payload->>'createdOnDateTime'~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
   order by v.payload->>'createdOnDateTime' desc,v.external_id::numeric desc limit 1;
  if r.id is not null and r.saved_id is not distinct from latest_id
   and r.connection_revision=c.updated_at and r.state='complete' then
   continue;end if;
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

-- Keep the tested tenant/actor/audit/keyset implementation as the base, then
-- append source-observation evidence only to rows it already authorized.
alter function public.new_dawn_open_job_page(uuid,text,text,text,integer)
 rename to new_dawn_open_job_page_base;
revoke all on function public.new_dawn_open_job_page_base(uuid,text,text,text,integer)
 from public,anon,authenticated,service_role;

create function public.new_dawn_open_job_page(
 p_tenant uuid,p_reason text default null,p_cursor text default null,
 p_status text default null,p_page_size integer default 40
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='15s' as $$
declare result jsonb; item jsonb; rows jsonb:='[]'::jsonb;
 last_different timestamptz; first_same timestamptz;
 same_checks integer; latest timestamptz;
begin
 result:=public.new_dawn_open_job_page_base(
  p_tenant,p_reason,p_cursor,p_status,p_page_size);
 for item in select value from jsonb_array_elements(result->'rows') loop
  latest:=(item->>'source_observed_at')::timestamptz;
  select max(pg.committed_at) into last_different
   from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
    and pg.provider='commusoft' and pg.collection='jobs'
   where v.tenant_id=p_tenant and v.connection_id=(item->>'connection_id')::uuid
    and v.provider='commusoft' and v.collection='jobs'
    and v.external_id=item->>'external_id' and pg.committed_at<latest
    and (case v.payload->>'status' when 'Open' then 'open'
      when 'ongoing' then 'open' when 'pending' then 'pending'
      when 'on_hold' then 'on_hold' end) is distinct from item->>'status';
  select min(pg.committed_at),count(distinct pg.id)
   into first_same,same_checks
   from public.learn_business_input_versions v
   join public.learn_business_input_observations o on o.version_id=v.id
   join public.learn_business_input_pages pg on pg.id=o.page_id
    and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
    and pg.provider='commusoft' and pg.collection='jobs'
   where v.tenant_id=p_tenant and v.connection_id=(item->>'connection_id')::uuid
    and v.provider='commusoft' and v.collection='jobs'
    and v.external_id=item->>'external_id' and pg.committed_at<=latest
    and pg.committed_at>coalesce(last_different,'-infinity'::timestamptz)
    and (case v.payload->>'status' when 'Open' then 'open'
      when 'ongoing' then 'open' when 'pending' then 'pending'
      when 'on_hold' then 'on_hold' end)=item->>'status';
  rows:=rows||jsonb_build_array(item||jsonb_build_object(
   'status_first_saved_at',coalesce(first_same,latest),
   'status_evidence',case when same_checks>=2
     and latest-first_same>=interval '24 hours' then 'repeat_saved_checks'
     else 'timing_unknown' end));
 end loop;
 return jsonb_set(jsonb_set(result,'{rows}',rows),'{version}',
  '"new-dawn-open-job-page/2"'::jsonb);
end $$;
revoke all on function public.new_dawn_open_job_page(uuid,text,text,text,integer)
 from public,anon,service_role;
grant execute on function public.new_dawn_open_job_page(uuid,text,text,text,integer)
 to authenticated;

commit;
