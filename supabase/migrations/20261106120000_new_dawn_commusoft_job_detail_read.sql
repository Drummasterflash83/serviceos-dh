-- One-use, operator-only exact Commusoft job detail read. Installation makes no
-- provider request, starts no job, enables no login and changes no client flag.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create table public.new_dawn_commusoft_job_detail_reads (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 job_id uuid not null references public.jobs(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 secret_id uuid not null,
 source_version_id uuid not null references public.learn_business_input_versions(id),
 external_id text not null check(external_id ~ '^[1-9][0-9]{0,15}$'),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 state text not null default 'prepared' check(state in ('prepared','claimed','complete','failed')),
 claimed_at timestamptz,
 checked_at timestamptz,
 raw_sha256 text,
 result jsonb,
 failure_code text,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.new_dawn_commusoft_job_detail_reads enable row level security;
revoke all on public.new_dawn_commusoft_job_detail_reads from public,anon,authenticated,service_role;

-- In-flight requests must change state, but a completed source receipt is
-- append-only evidence. Also prevent deletion and table truncation.
create function public.new_dawn_commusoft_job_detail_immutable()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op in('DELETE','TRUNCATE') then
  raise exception 'job_detail_receipt_immutable' using errcode='55000';end if;
 if old.state='complete' then
  raise exception 'job_detail_receipt_immutable' using errcode='55000';end if;
 return new;
end $$;
create trigger new_dawn_commusoft_job_detail_immutable_row
 before update or delete on public.new_dawn_commusoft_job_detail_reads
 for each row execute function public.new_dawn_commusoft_job_detail_immutable();
create trigger new_dawn_commusoft_job_detail_immutable_truncate
 before truncate on public.new_dawn_commusoft_job_detail_reads
 for each statement execute function public.new_dawn_commusoft_job_detail_immutable();
revoke all on function public.new_dawn_commusoft_job_detail_immutable() from public,anon,authenticated,service_role;

-- The service-role continuation cannot inherit a browser JWT, so repeat the
-- effective-dated actor check without granting service_role operator access.
create function public.new_dawn_commusoft_job_actor_access(p_tenant uuid,p_actor uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
 if current_setting('transaction_isolation')<>'read committed' or p_tenant is null or p_actor is null then
  raise exception 'job_detail_forbidden' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'job_detail_forbidden' using errcode='42501';end if;
 perform 1 from public.profiles where id=p_actor for share;
 if not found then raise exception 'job_detail_forbidden' using errcode='42501';end if;
 perform 1 from auth.users where id=p_actor and deleted_at is null
  and (banned_until is null or banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'job_detail_forbidden' using errcode='42501';end if;
 perform 1 from public.platform_authority_grants where profile_id=p_actor
  and permission='platform.controlplane.admin'
  and coalesce(effective_from,'-infinity')<=clock_timestamp()
  and coalesce(effective_to,'infinity')>clock_timestamp() for share;
 if not found or exists(select 1 from public.view_as_context where actor_user_id=p_actor
  and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'job_detail_forbidden' using errcode='42501';end if;
end $$;

create function public.new_dawn_commusoft_job_detail_current(p_request uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_job_detail_reads%rowtype;c public.provider_connections%rowtype;
 j public.jobs%rowtype;v public.learn_business_input_versions%rowtype;
begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into r from public.new_dawn_commusoft_job_detail_reads where id=p_request
  and state='claimed' and claimed_at>clock_timestamp()-interval '90 seconds';
 if not found then return false;end if;
 perform public.new_dawn_commusoft_job_actor_access(r.tenant_id,r.actor_id);
 perform 1 from public.feature_flags where tenant_id=r.tenant_id and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 perform 1 from public.feature_flags where tenant_id=r.tenant_id and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then return false;end if;
 -- The import worker and this detail read share the Commusoft source. Recheck
 -- immediately before credential release and again after the provider GET.
 perform 1 from public.platform_jobs where tenant_id=r.tenant_id
  and job_type='commusoft.source_sync' and status in ('queued','running','retrying') for share;
 if found then return false;end if;
 select * into c from public.provider_connections where id=r.connection_id and tenant_id=r.tenant_id
  and provider='commusoft' and status='configured' and auth_mode='private_api_key'
  and revoked_at is null and verified_at is not null and updated_at=r.connection_revision
  and secret_refs->>'api_key'=r.secret_id::text for share;
 if not found then return false;end if;
 select * into j from public.jobs where id=r.job_id and tenant_id=r.tenant_id for share;
 if not found or j.metadata#>>'{learn_business_input,connection_id}' is distinct from r.connection_id::text
  or j.metadata#>>'{learn_business_input,source_version_id}' is distinct from r.source_version_id::text
  or j.source_system is distinct from 'commusoft:connection:'||r.connection_id::text
  or j.external_id is distinct from r.external_id then return false;end if;
 perform 1 from public.learn_business_input_current_links l where l.tenant_id=r.tenant_id
  and l.entity_kind='job' and l.entity_table='jobs' and l.entity_id=r.job_id
  and l.provider='commusoft' and l.collection='jobs' and l.connection_id=r.connection_id
  and l.external_id=r.external_id and l.source_version_id=r.source_version_id;
 if not found then return false;end if;
 if (select count(*) from public.learn_business_input_current_links l where l.tenant_id=r.tenant_id
  and l.entity_kind='job' and l.entity_table='jobs' and l.entity_id=r.job_id
  and l.provider='commusoft' and l.collection='jobs')<>1 then return false;end if;
 v:=public.learn_business_input_latest(r.tenant_id,r.connection_id,'commusoft','jobs',r.external_id);
 return v.id is not distinct from r.source_version_id;
exception when sqlstate '42501' then return false;
end $$;

create function public.new_dawn_commusoft_job_detail_start(
 p_tenant uuid,p_job uuid,p_request uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();j public.jobs%rowtype;c public.provider_connections%rowtype;
 link_count integer;cid uuid;vid uuid;external text;v public.learn_business_input_versions%rowtype;
 audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'authenticated' or p_job is null or p_request is null or
  p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'job_detail_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'job_detail_input_off' using errcode='42501';end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb for share;
 if not found then raise exception 'job_detail_input_off' using errcode='42501';end if;
 perform 1 from public.platform_jobs where tenant_id=p_tenant
  and job_type='commusoft.source_sync' and status in ('queued','running','retrying') for share;
 if found then raise exception 'job_detail_import_active' using errcode='55000';end if;
 select * into j from public.jobs where tenant_id=p_tenant and id=p_job for share;
 if not found then raise exception 'job_detail_unavailable' using errcode='42501';end if;
 select count(*)::integer,min(l.connection_id::text)::uuid,min(l.source_version_id::text)::uuid,min(l.external_id)
 into link_count,cid,vid,external from public.learn_business_input_current_links l
 where l.tenant_id=p_tenant and l.entity_id=p_job and l.entity_kind='job' and l.entity_table='jobs'
  and l.provider='commusoft' and l.collection='jobs';
 if link_count<>1 or external !~ '^[1-9][0-9]{0,15}$' or external::numeric>9007199254740991
  or j.metadata#>>'{learn_business_input,connection_id}' is distinct from cid::text
  or j.metadata#>>'{learn_business_input,source_version_id}' is distinct from vid::text
  or j.source_system is distinct from 'commusoft:connection:'||cid::text
  or j.external_id is distinct from external then
  raise exception 'job_detail_link_review_required' using errcode='42501';end if;
 v:=public.learn_business_input_latest(p_tenant,cid,'commusoft','jobs',external);
 if v.id is distinct from vid or v.payload->>'id' is distinct from external then
  raise exception 'job_detail_source_changed' using errcode='42501';end if;
 select * into c from public.provider_connections where id=cid and tenant_id=p_tenant and provider='commusoft'
  and status='configured' and auth_mode='private_api_key' and revoked_at is null
  and verified_at is not null and coalesce(non_secret_config->>'region','') in('uk','us')
  and coalesce(secret_refs->>'api_key','')~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' for share;
 if not found then raise exception 'job_detail_connection_unavailable' using errcode='42501';end if;
 insert into public.new_dawn_commusoft_job_detail_reads
 (id,tenant_id,actor_id,job_id,connection_id,connection_revision,secret_id,source_version_id,external_id,reason)
 values(p_request,p_tenant,actor,p_job,c.id,c.updated_at,(c.secret_refs->>'api_key')::uuid,vid,external,btrim(p_reason));
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_jobs.provider_detail_requested','jobs',p_job::text,
  jsonb_build_object('request_id',p_request,'source_version_id',vid,'connection_id',cid),
  btrim(p_reason),p_request::text,false,'new-dawn-commusoft-job-detail');
 return jsonb_build_object('request_id',p_request,'state','prepared');
end $$;

-- A claim releases the key once to the server, paced by the existing shared
-- Commusoft credential gate. Waiting does not claim or release a key.
create function public.new_dawn_commusoft_job_detail_acquire(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_job_detail_reads%rowtype;c public.provider_connections%rowtype;
 secret text;fingerprint text;next_at timestamptz;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'job_detail_forbidden' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_job_detail_reads where id=p_request for update;
 if not found or r.state<>'prepared' or r.created_at<clock_timestamp()-interval '5 minutes' then
  raise exception 'job_detail_unavailable' using errcode='42501';end if;
 -- Temporarily claim in this transaction so the same full source and authority
 -- predicate is used before releasing a credential. Roll back on any failure.
 update public.new_dawn_commusoft_job_detail_reads set state='claimed',claimed_at=clock_timestamp() where id=p_request;
 if not public.new_dawn_commusoft_job_detail_current(p_request) then
  raise exception 'job_detail_scope_changed' using errcode='42501';end if;
 select * into c from public.provider_connections where id=r.connection_id and tenant_id=r.tenant_id for share;
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=r.secret_id and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key';
 if secret is null or length(secret) not between 1 and 4096 or secret !~ '^[!-~]+$' then
  raise exception 'job_detail_credential_unavailable' using errcode='42501';end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates
  where credential_fingerprint=fingerprint for update;
 if next_at>clock_timestamp() then
  update public.new_dawn_commusoft_job_detail_reads set state='prepared',claimed_at=null where id=p_request;
  return jsonb_build_object('state','wait','retry_at',ceil(extract(epoch from next_at)*1000)::bigint);
 end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
  where credential_fingerprint=fingerprint;
 return jsonb_build_object('state','ready','request_id',r.id,'tenant_id',r.tenant_id,
  'job_id',r.job_id,'source_version_id',r.source_version_id,'external_id',r.external_id,
  'region',c.non_secret_config->>'region','api_key',secret);
end $$;

create function public.new_dawn_commusoft_job_detail_finish(p_request uuid,p_raw text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_job_detail_reads%rowtype;body jsonb;assigned jsonb;
 outcome jsonb;updated_time text;onsite text;completion text;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'service_role' or p_raw is null or length(p_raw) not between 2 and 131072 then
  raise exception 'job_detail_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_job_detail_reads where id=p_request for update;
 if not found or not public.new_dawn_commusoft_job_detail_current(p_request) then
  raise exception 'job_detail_scope_changed' using errcode='42501';end if;
 body:=p_raw::jsonb;
 if jsonb_typeof(body) is distinct from 'object' or jsonb_typeof(body->'id') is distinct from 'number'
  or body->>'id' is distinct from r.external_id or body ? 'error' then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;
 if body ? 'usersCurrentlyAssignedToJob' and jsonb_typeof(body->'usersCurrentlyAssignedToJob') not in('array','null') then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;
 assigned:=coalesce(body->'usersCurrentlyAssignedToJob','[]'::jsonb);
 if assigned='null'::jsonb then assigned:='[]'::jsonb;end if;
 if jsonb_array_length(assigned)>20 or exists(select 1 from jsonb_array_elements(assigned) x
  where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'id') is distinct from 'number'
   or x->>'id'!~'^(0|[1-9][0-9]{0,15})$' or jsonb_typeof(x->'fullName') is distinct from 'string'
   or length(x->>'fullName')>200) then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('source_user_id',x->>'id','name',x->>'fullName')),'[]'::jsonb)
 into assigned from jsonb_array_elements(assigned)x;
 updated_time:=body->>'lastUpdatedOnDateTime';onsite:=body->>'expectedOnsiteDateTime';completion:=body->>'expectedCompletionDateTime';
 if (updated_time is not null and length(updated_time)>80) or (onsite is not null and length(onsite)>80)
  or (completion is not null and length(completion)>80) then
  raise exception 'job_detail_response_invalid' using errcode='22023';end if;
 outcome:=jsonb_build_object('version','commusoft-exact-job-detail/1','tenant_id',r.tenant_id,
  'job_id',r.job_id,'connection_id',r.connection_id,'source_version_id',r.source_version_id,
  'external_id',r.external_id,'status',left(body->>'status',120),
  'stage',left(body->>'stageName',200),'pipeline',left(body->>'pipelineName',200),
  'expected_onsite',onsite,'expected_completion',completion,
  'source_assigned_users',assigned,'provider_updated_at',updated_time,
  'checked_at',clock_timestamp());
 update public.new_dawn_commusoft_job_detail_reads set state='complete',result=outcome,
  raw_sha256=encode(sha256(convert_to(p_raw,'UTF8')),'hex'),checked_at=clock_timestamp()
 where id=r.id;
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,r.tenant_id,r.actor_id::text,'client_jobs.provider_detail_completed','jobs',r.job_id::text,
  jsonb_build_object('request_id',r.id,'source_version_id',r.source_version_id,
   'source_user_count',jsonb_array_length(assigned)),r.reason,r.id::text,false,'new-dawn-commusoft-job-detail');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return outcome||jsonb_build_object('audit_id',audit,'request_id',r.id);
exception when invalid_text_representation or numeric_value_out_of_range then
 raise exception 'job_detail_response_invalid' using errcode='22023';
end $$;

create function public.new_dawn_commusoft_job_detail_fail(p_request uuid,p_code text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_job_detail_reads%rowtype;begin
 if auth.role() is distinct from 'service_role' or p_code not in('scope_changed','authentication_required',
  'provider_unavailable','response_too_large','response_invalid','transport_unavailable','result_unconfirmed') then
  raise exception 'job_detail_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_job_detail_reads where id=p_request for update;
 if not found or r.state not in('prepared','claimed') then return;end if;
 update public.new_dawn_commusoft_job_detail_reads set state='failed',failure_code=p_code where id=r.id;
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(gen_random_uuid(),r.tenant_id,r.actor_id::text,'client_jobs.provider_detail_failed','jobs',r.job_id::text,
  jsonb_build_object('request_id',r.id,'code',p_code),r.reason,r.id::text,false,'new-dawn-commusoft-job-detail');
end $$;

revoke all on function public.new_dawn_commusoft_job_actor_access(uuid,uuid),
 public.new_dawn_commusoft_job_detail_current(uuid),
 public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text),
 public.new_dawn_commusoft_job_detail_acquire(uuid),
 public.new_dawn_commusoft_job_detail_finish(uuid,text),
 public.new_dawn_commusoft_job_detail_fail(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_job_detail_start(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.new_dawn_commusoft_job_detail_current(uuid),
 public.new_dawn_commusoft_job_detail_acquire(uuid),
 public.new_dawn_commusoft_job_detail_finish(uuid,text),
 public.new_dawn_commusoft_job_detail_fail(uuid,text) to service_role;
commit;
