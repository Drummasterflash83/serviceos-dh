-- A one-use, short-lived exact-job trial while the source import is active.
-- No permit or tenant flag is created by installation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.new_dawn_commusoft_job_trial_permits (
 request_id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 job_id uuid not null references public.jobs(id),
 actor_id uuid not null references public.profiles(id),
 connection_id uuid not null references public.provider_connections(id),
 source_version_id uuid not null references public.learn_business_input_versions(id),
 external_id text not null check(external_id ~ '^[1-9][0-9]{0,15}$'),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 armed_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 used_at timestamptz,
 revoked_at timestamptz,
 check(expires_at>armed_at and expires_at<=armed_at+interval '10 minutes')
);
alter table public.new_dawn_commusoft_job_trial_permits enable row level security;
revoke all on public.new_dawn_commusoft_job_trial_permits from public,anon,authenticated,service_role;

create function public.new_dawn_commusoft_job_trial_current(
 p_tenant uuid,p_job uuid,p_actor uuid,p_request uuid,p_version uuid,
 p_used boolean default false
) returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.new_dawn_commusoft_job_trial_permits p
  where p.request_id=p_request and p.tenant_id=p_tenant and p.job_id=p_job
   and p.actor_id=p_actor and (p_version is null or p.source_version_id=p_version)
   and p.expires_at>clock_timestamp() and p.revoked_at is null
   and not public.new_dawn_commusoft_coexistence_enabled(p_tenant)
   and not exists(select 1 from public.feature_flags f where f.tenant_id=p_tenant
    and f.flag='new_dawn.exact_job_detail' and f.value='true'::jsonb)
   and (not p_used or p.used_at is not null)
   and (p.used_at is null or exists(select 1 from public.new_dawn_commusoft_job_detail_reads r
    where r.id=p_request and r.tenant_id=p_tenant and r.job_id=p_job
     and r.actor_id=p_actor and r.source_version_id=p.source_version_id
     and r.connection_id=p.connection_id and r.external_id=p.external_id
     and r.state in('prepared','claimed'))));
$$;
revoke all on function public.new_dawn_commusoft_job_trial_current(uuid,uuid,uuid,uuid,uuid,boolean)
 from public,anon,authenticated,service_role;

-- Called only by the existing postgres management release session after the
-- exact reviewed scope and signed-in operator have been selected. This is not
-- a browser or service-role RPC; no synthetic JWT is needed to arm it.
create function public.new_dawn_commusoft_job_trial_arm(
 p_tenant uuid,p_job uuid,p_actor uuid,p_request uuid,p_version uuid,
 p_expires_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare cid uuid;vid uuid;external text;link_count integer;j public.jobs%rowtype;
 latest public.learn_business_input_versions%rowtype;
begin
 if session_user is distinct from 'postgres' or p_request is null or
  p_reason is null or length(btrim(p_reason)) not between 3 and 500 or
  p_expires_at is null or not isfinite(p_expires_at) or
  p_expires_at<=clock_timestamp()+interval '30 seconds' or
  p_expires_at>clock_timestamp()+interval '10 minutes' then
  raise exception 'job_trial_invalid' using errcode='22023';end if;
 if public.new_dawn_commusoft_coexistence_enabled(p_tenant) or
  exists(select 1 from public.feature_flags f where f.tenant_id=p_tenant
   and f.flag='new_dawn.exact_job_detail' and f.value='true'::jsonb) then
  raise exception 'job_trial_broad_flag_on' using errcode='55000';end if;
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,p_actor);
 select * into j from public.jobs where tenant_id=p_tenant and id=p_job for share;
 if not found then raise exception 'job_trial_scope_unverified' using errcode='42501';end if;
 select count(*)::integer,min(l.connection_id::text)::uuid,
  min(l.source_version_id::text)::uuid,min(l.external_id)
 into link_count,cid,vid,external from public.learn_business_input_current_links l
 where l.tenant_id=p_tenant and l.entity_id=p_job and l.entity_kind='job'
  and l.entity_table='jobs' and l.provider='commusoft' and l.collection='jobs';
 if link_count<>1 or vid is distinct from p_version or
  external !~ '^[1-9][0-9]{0,15}$' or external::numeric>9007199254740991 or
  j.metadata#>>'{learn_business_input,connection_id}' is distinct from cid::text or
  j.metadata#>>'{learn_business_input,source_version_id}' is distinct from vid::text or
  j.external_id is distinct from external or
  j.source_system is distinct from 'commusoft:connection:'||cid::text then
  raise exception 'job_trial_scope_unverified' using errcode='42501';end if;
 latest:=public.learn_business_input_latest(p_tenant,cid,'commusoft','jobs',external);
 if latest.id is distinct from vid or latest.payload->>'id' is distinct from external then
  raise exception 'job_trial_source_changed' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('new-dawn-job-trial:'||p_tenant::text,0));
 perform 1 from public.provider_connections c where c.id=cid and c.tenant_id=p_tenant
  and c.provider='commusoft' and c.status='configured' and c.auth_mode='private_api_key'
  and c.revoked_at is null and c.verified_at is not null for share;
 if not found or exists(select 1 from public.new_dawn_commusoft_job_trial_permits p
  where p.tenant_id=p_tenant and p.expires_at>clock_timestamp()
   and p.revoked_at is null) then
  raise exception 'job_trial_unavailable' using errcode='55000';end if;
 insert into public.new_dawn_commusoft_job_trial_permits
 (request_id,tenant_id,job_id,actor_id,connection_id,source_version_id,external_id,reason,expires_at)
 values(p_request,p_tenant,p_job,p_actor,cid,vid,external,btrim(p_reason),p_expires_at);
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(gen_random_uuid(),p_tenant,'postgres_release','client_jobs.provider_detail_trial_armed',
  'jobs',p_job::text,jsonb_build_object('request_id',p_request,'operator_id',p_actor,
   'connection_id',cid,'source_version_id',vid,'expires_at',p_expires_at),
  btrim(p_reason),p_request::text,false,'new-dawn-commusoft-job-trial');
 return jsonb_build_object('request_id',p_request,'state','armed','expires_at',p_expires_at);
end $$;

create function public.new_dawn_commusoft_job_trial_disarm(p_request uuid,p_reason text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare p public.new_dawn_commusoft_job_trial_permits%rowtype;
begin
 if session_user is distinct from 'postgres' or p_reason is null or
  length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'job_trial_invalid' using errcode='22023';end if;
 select * into p from public.new_dawn_commusoft_job_trial_permits
  where request_id=p_request for update;
 if not found or p.revoked_at is not null then return;end if;
 update public.new_dawn_commusoft_job_trial_permits set revoked_at=clock_timestamp()
  where request_id=p_request;
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(gen_random_uuid(),p.tenant_id,'postgres_release','client_jobs.provider_detail_trial_disarmed',
  'jobs',p.job_id::text,jsonb_build_object('request_id',p_request),btrim(p_reason),
  p_request::text,false,'new-dawn-commusoft-job-trial');
end $$;

-- Only the signed-in intended operator can discover the single live request
-- UUID in the job UI. No direct table SELECT grant, provider data or key.
create function public.new_dawn_commusoft_job_trial_offer(p_tenant uuid,p_job uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();p public.new_dawn_commusoft_job_trial_permits%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or actor is null or
  p_tenant is null or p_job is null then
  raise exception 'job_trial_forbidden' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 select * into p from public.new_dawn_commusoft_job_trial_permits t
  where t.tenant_id=p_tenant and t.job_id=p_job and t.actor_id=actor
   and public.new_dawn_commusoft_job_trial_current(t.tenant_id,t.job_id,t.actor_id,
    t.request_id,t.source_version_id,false)
  order by t.armed_at desc limit 1;
 if not found then return null;end if;
 return jsonb_build_object('request_id',p.request_id,'tenant_id',p.tenant_id,
  'job_id',p.job_id,'actor_id',p.actor_id,'source_version_id',p.source_version_id,
  'external_id',p.external_id,'expires_at',p.expires_at);
end $$;

-- Change only the exact-job queue guard; the opportunity and connection
-- verification guards still reject an active source import when the broad
-- coexistence flag is absent.
do $patch$ declare d text;old text;replacement text;begin
 d:=pg_get_functiondef('public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text)'::regprocedure);
 old:=$old$and not public.new_dawn_commusoft_coexistence_enabled(p_tenant) for share;$old$;
 replacement:=$new$and not public.new_dawn_commusoft_coexistence_enabled(p_tenant)
  and not public.new_dawn_commusoft_job_trial_current(p_tenant,p_job,actor,p_request,null,false) for share;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_trial_start_queue_contract_changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$ insert into public.new_dawn_commusoft_job_detail_reads
 (id,tenant_id,actor_id,job_id,connection_id,connection_revision,secret_id,source_version_id,external_id,reason)$old$;
 replacement:=$new$ if not public.new_dawn_commusoft_job_trial_current(p_tenant,p_job,actor,p_request,vid,false) then
  raise exception 'job_trial_not_armed' using errcode='42501';end if;
 insert into public.new_dawn_commusoft_job_detail_reads
 (id,tenant_id,actor_id,job_id,connection_id,connection_revision,secret_id,source_version_id,external_id,reason)$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_trial_start_permit_contract_changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$ insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_jobs.provider_detail_requested'$old$;
 replacement:=$new$ update public.new_dawn_commusoft_job_trial_permits set used_at=clock_timestamp()
 where request_id=p_request and used_at is null and expires_at>clock_timestamp()
  and revoked_at is null;
 if not found then raise exception 'job_trial_expired' using errcode='42501';end if;
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_jobs.provider_detail_requested'$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_trial_start_use_contract_changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.new_dawn_commusoft_job_detail_current(uuid)'::regprocedure);
 old:=$old$and not public.new_dawn_commusoft_coexistence_enabled(r.tenant_id) for share;$old$;
 replacement:=$new$and not public.new_dawn_commusoft_coexistence_enabled(r.tenant_id)
  and not public.new_dawn_commusoft_job_trial_current(r.tenant_id,r.job_id,r.actor_id,
   r.id,r.source_version_id,true) for share;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_trial_current_queue_contract_changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$ perform public.new_dawn_commusoft_job_actor_access(r.tenant_id,r.actor_id);$old$;
 replacement:=$new$ if not public.new_dawn_commusoft_job_trial_current(r.tenant_id,r.job_id,r.actor_id,
  r.id,r.source_version_id,true) then return false;end if;
 perform public.new_dawn_commusoft_job_actor_access(r.tenant_id,r.actor_id);$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then
  raise exception 'job_trial_current_permit_contract_changed';end if;
 execute replace(d,old,replacement);
end $patch$;

revoke all on function public.new_dawn_commusoft_job_trial_arm(uuid,uuid,uuid,uuid,uuid,timestamptz,text),
 public.new_dawn_commusoft_job_trial_disarm(uuid,text),
 public.new_dawn_commusoft_job_trial_offer(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_job_trial_offer(uuid,uuid) to authenticated;
commit;
