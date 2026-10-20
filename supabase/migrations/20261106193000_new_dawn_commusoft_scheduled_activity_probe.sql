-- Optional one-use, operator-only Commusoft scheduled-activity source probe.
-- Office tasks only: no engineer appointment inference, client UI, provider write, or schedule.
begin;

create table public.new_dawn_commusoft_scheduled_activity_probes (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 connection_id uuid not null references public.provider_connections(id),
 binding jsonb not null,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 state text not null default 'prepared' check(state in ('prepared','claimed','complete','failed')),
 expires_at timestamptz not null,
 claimed_at timestamptz,
 permit_id uuid unique,
 credential_fingerprint text,
 result jsonb,
 raw_envelope jsonb,
 content_hash text,
 failure_code text,
 created_at timestamptz not null default clock_timestamp()
);
create table public.new_dawn_commusoft_scheduled_activity_probe_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.new_dawn_commusoft_scheduled_activity_probes(id),
 tenant_id uuid not null,
 actor_id uuid not null,
 event text not null,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.new_dawn_commusoft_scheduled_activity_probes enable row level security;
alter table public.new_dawn_commusoft_scheduled_activity_probe_events enable row level security;
revoke all on public.new_dawn_commusoft_scheduled_activity_probes,
 public.new_dawn_commusoft_scheduled_activity_probe_events from public,anon,authenticated,service_role;
-- A claimed probe may advance once; a completed/failed receipt is immutable.
create function public.new_dawn_commusoft_scheduled_activity_probe_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if old.state in ('complete','failed') or
  old.raw_envelope is not null or old.content_hash is not null or old.result is not null then
  raise exception 'scheduled_activity_probe_receipt_immutable' using errcode='42501';
 end if;
 return new;
end $$;
create trigger new_dawn_scheduled_activity_probe_guard before update
 on public.new_dawn_commusoft_scheduled_activity_probes for each row
 execute function public.new_dawn_commusoft_scheduled_activity_probe_guard();
create trigger new_dawn_scheduled_activity_probe_retain before delete or truncate
 on public.new_dawn_commusoft_scheduled_activity_probes for each statement
 execute function public.learn_operator_input_immutable();
create trigger new_dawn_scheduled_activity_event_retain before update or delete
 on public.new_dawn_commusoft_scheduled_activity_probe_events for each row
 execute function public.learn_operator_input_immutable();
create trigger new_dawn_scheduled_activity_event_truncate_retain before truncate
 on public.new_dawn_commusoft_scheduled_activity_probe_events for each statement
 execute function public.learn_operator_input_immutable();

-- Reuse the existing, account-bound Commusoft authority: effective OpenFolk
-- operator, active tenant, unchanged Vault binding and no active source sync.
create function public.new_dawn_commusoft_scheduled_activity_probe_authority(
 p public.new_dawn_commusoft_scheduled_activity_probes
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare gate public.learn_commusoft_verification_requests%rowtype;
begin
 gate.id:=p.id; gate.tenant_id:=p.tenant_id; gate.actor_id:=p.actor_id;
 gate.definition:=jsonb_build_object('connection_id',p.connection_id);
 gate.binding:=p.binding; gate.expires_at:=p.expires_at;
 return public.learn_commusoft_verification_authority(gate)
  and exists(select 1 from public.feature_flags where tenant_id=p.tenant_id
   and flag='new_dawn.m2_scheduled_activity_probe' and value='true'::jsonb);
end $$;

create function public.new_dawn_commusoft_scheduled_activity_probe_start(
 p_tenant uuid,p_connection uuid,p_request uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c public.provider_connections%rowtype;r public.new_dawn_commusoft_scheduled_activity_probes%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null
  or p_tenant is null or p_connection is null or p_request is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'scheduled_activity_probe_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,auth.uid(),true);
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 select * into r from public.new_dawn_commusoft_scheduled_activity_probes where id=p_request;
 if found then
  if r.tenant_id=p_tenant and r.connection_id=p_connection and r.actor_id=auth.uid()
   and r.reason=btrim(p_reason) and r.state='prepared'
   and public.new_dawn_commusoft_scheduled_activity_probe_authority(r) then
   return jsonb_build_object('requestId',r.id,'state','prepared','limit',10);
  end if;
  raise exception 'scheduled_activity_probe_request_conflict' using errcode='PT409';
 end if;
 select * into c from public.provider_connections where id=p_connection
  and tenant_id=p_tenant and provider='commusoft' for share;
 if not found then raise exception 'scheduled_activity_probe_connection_unavailable' using errcode='42501';end if;
 if exists(select 1 from public.new_dawn_commusoft_scheduled_activity_probes
  where tenant_id=p_tenant and state in ('prepared','claimed') and expires_at>clock_timestamp()) then
  raise exception 'scheduled_activity_probe_active' using errcode='55000';end if;
 r.id:=p_request; r.tenant_id:=p_tenant; r.actor_id:=auth.uid();
 r.connection_id:=c.id; r.binding:=public.learn_commusoft_verification_binding(c);
 r.expires_at:=clock_timestamp()+interval '2 minutes';
 if not public.new_dawn_commusoft_scheduled_activity_probe_authority(r) then
  raise exception 'scheduled_activity_probe_unavailable' using errcode='42501';end if;
 insert into public.new_dawn_commusoft_scheduled_activity_probes
  (id,tenant_id,actor_id,connection_id,binding,reason,expires_at)
 values(r.id,r.tenant_id,r.actor_id,r.connection_id,r.binding,btrim(p_reason),r.expires_at);
 insert into public.new_dawn_commusoft_scheduled_activity_probe_events(request_id,tenant_id,actor_id,event,detail)
 values(r.id,r.tenant_id,r.actor_id,'prepared',jsonb_build_object('connection_id',c.id,'limit',10));
 return jsonb_build_object('requestId',r.id,'state','prepared','limit',10);
end $$;

-- This RPC is service-role only. It consumes the one-use permit before returning
-- the tenant-bound Vault key and observes the shared Commusoft quota gate.
create function public.new_dawn_commusoft_scheduled_activity_probe_acquire(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_scheduled_activity_probes%rowtype;
 secret text;fingerprint text;next_at timestamptz;permit uuid:=gen_random_uuid();send_before timestamptz;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'scheduled_activity_probe_forbidden' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_scheduled_activity_probes where id=p_request for update;
 if not found or r.state<>'prepared' or not public.new_dawn_commusoft_scheduled_activity_probe_authority(r) then
  raise exception 'scheduled_activity_probe_unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||r.tenant_id::text,0));
 if not public.new_dawn_commusoft_scheduled_activity_probe_authority(r) then
  raise exception 'scheduled_activity_probe_unavailable' using errcode='42501';end if;
 select decrypted_secret into secret from vault.decrypted_secrets
  where id::text=r.binding->>'secret_id'
  and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key';
 if secret is null or octet_length(secret) not between 1 and 4096 or secret!~'^[!-~]+$' then
  raise exception 'scheduled_activity_probe_credential_unavailable' using errcode='55000';end if;
 fingerprint:=encode(sha256(convert_to('commusoft:'||secret,'UTF8')),'hex');
 insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates
  where credential_fingerprint=fingerprint for update;
 if next_at>clock_timestamp() then
  return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
  where credential_fingerprint=fingerprint;
 send_before:=least(r.expires_at,clock_timestamp()+interval '5 seconds');
 update public.new_dawn_commusoft_scheduled_activity_probes
  set state='claimed',claimed_at=clock_timestamp(),permit_id=permit,credential_fingerprint=fingerprint
  where id=r.id;
 insert into public.new_dawn_commusoft_scheduled_activity_probe_events(request_id,tenant_id,actor_id,event,detail)
 values(r.id,r.tenant_id,r.actor_id,'claimed',jsonb_build_object('permit_id',permit));
 return jsonb_build_object('state','ready','requestId',r.id,'tenantId',r.tenant_id,
  'connectionId',r.connection_id,'region',r.binding->>'region','apiKey',secret,
  'permitId',permit,'sendBefore',floor(extract(epoch from send_before)*1000)::bigint);
end $$;

create function public.new_dawn_commusoft_scheduled_activity_probe_current(p_request uuid,p_permit uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_scheduled_activity_probes%rowtype;fingerprint text;
begin
 if auth.role() is distinct from 'service_role' then return false;end if;
 select * into r from public.new_dawn_commusoft_scheduled_activity_probes
  where id=p_request and permit_id=p_permit and state='claimed'
   and claimed_at>clock_timestamp()-interval '2 minutes';
 if not found or not public.new_dawn_commusoft_scheduled_activity_probe_authority(r) then return false;end if;
 select encode(sha256(convert_to('commusoft:'||decrypted_secret,'UTF8')),'hex') into fingerprint
  from vault.decrypted_secrets where id::text=r.binding->>'secret_id'
   and name='provider_secret:'||r.tenant_id::text||':commusoft:api_key';
 return fingerprint is not null and fingerprint=r.credential_fingerprint;
end $$;

-- Raw source stays in the private receipt; the operator sees counts only.
-- A scheduled activity is an office task, not an engineer diary appointment.
create function public.new_dawn_commusoft_scheduled_activity_probe_summarize(p_raw text)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare body jsonb;entries jsonb;parent_counts jsonb;status_counts jsonb;
begin
 if p_raw is null or octet_length(p_raw) not between 2 and 262144 then
  raise exception 'scheduled_activity_probe_response_invalid' using errcode='22023';end if;
 body:=p_raw::jsonb;entries:=body->'data';
 if jsonb_typeof(body) is distinct from 'object' or jsonb_typeof(entries) is distinct from 'array'
  or jsonb_array_length(entries)>10 or body ? 'error'
  or exists(select 1 from jsonb_array_elements(entries) x
   where jsonb_typeof(x) is distinct from 'object' or x->>'id' is null
    or length(x->>'id') not between 1 and 128)
  or (select count(distinct x->>'id') from jsonb_array_elements(entries) x)<>jsonb_array_length(entries) then
  raise exception 'scheduled_activity_probe_response_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('parentType',parent_type,'count',n) order by parent_type),'[]'::jsonb)
 into parent_counts from (
  select left(coalesce(nullif(btrim(x->>'parentType'),''),'<unspecified>'),100) parent_type,count(*) n
  from jsonb_array_elements(entries) x group by 1
 ) s;
 select coalesce(jsonb_agg(jsonb_build_object('status',status,'count',n) order by status),'[]'::jsonb)
 into status_counts from (
  select left(coalesce(nullif(btrim(x->>'status'),''),'<unspecified>'),100) status,count(*) n
  from jsonb_array_elements(entries) x group by 1
 ) s;
 return jsonb_build_object('version','commusoft-scheduled_activity-probe/1',
  'meaning','office_task_source_only',
  'recordCount',jsonb_array_length(entries),'hasMore',case when jsonb_typeof(body#>'{pagination,hasMore}')='boolean'
   then body#>'{pagination,hasMore}' else null end,
  'parentTypeCounts',parent_counts,'statusCounts',status_counts,
  'jobParentCount',(select count(*) from jsonb_array_elements(entries) x where lower(x->>'parentType')='job'),
  'dueDatePresentCount',(select count(*) from jsonb_array_elements(entries) x where nullif(btrim(x->>'dueDateTime'),'') is not null),
  'assignedTooPresentCount',(select count(*) from jsonb_array_elements(entries) x
   where case when jsonb_typeof(x->'assignedToo')='array'
    then jsonb_array_length(x->'assignedToo')>0 else false end));
exception when invalid_text_representation then
 raise exception 'scheduled_activity_probe_response_invalid' using errcode='22023';
end $$;

create function public.new_dawn_commusoft_scheduled_activity_probe_finish(
 p_request uuid,p_permit uuid,p_raw text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_scheduled_activity_probes%rowtype;
 body jsonb;entries jsonb;summary jsonb;
begin
 if auth.role() is distinct from 'service_role' or p_raw is null
  or octet_length(p_raw) not between 2 and 262144 then
  raise exception 'scheduled_activity_probe_response_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_scheduled_activity_probes where id=p_request for update;
 if not found or r.permit_id is distinct from p_permit or r.state<>'claimed'
  or not public.new_dawn_commusoft_scheduled_activity_probe_current(p_request,p_permit) then
  raise exception 'scheduled_activity_probe_unavailable' using errcode='42501';end if;
 summary:=public.new_dawn_commusoft_scheduled_activity_probe_summarize(p_raw);
 summary:=summary||jsonb_build_object('requestId',r.id,'tenantId',r.tenant_id,
  'connectionId',r.connection_id,'observedAt',clock_timestamp());
 body:=p_raw::jsonb;entries:=body->'data';
 update public.new_dawn_commusoft_scheduled_activity_probes
  set state='complete',raw_envelope=body,content_hash=encode(sha256(convert_to(p_raw,'UTF8')),'hex'),result=summary
  where id=r.id;
 insert into public.new_dawn_commusoft_scheduled_activity_probe_events(request_id,tenant_id,actor_id,event,detail)
 values(r.id,r.tenant_id,r.actor_id,'completed',jsonb_build_object('record_count',jsonb_array_length(entries)));
 return summary;
exception when invalid_text_representation then
 raise exception 'scheduled_activity_probe_response_invalid' using errcode='22023';
end $$;

create function public.new_dawn_commusoft_scheduled_activity_probe_fail(p_request uuid,p_code text)
returns void language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_scheduled_activity_probes%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_code is null or p_code not in
  ('scope_changed','authentication_required','access_denied','provider_unavailable',
   'rate_limited','response_too_large','response_invalid','transport_unavailable','result_unconfirmed') then
  raise exception 'scheduled_activity_probe_invalid' using errcode='22023';end if;
 select * into r from public.new_dawn_commusoft_scheduled_activity_probes where id=p_request for update;
 if not found or r.state not in ('prepared','claimed') then return;end if;
 update public.new_dawn_commusoft_scheduled_activity_probes set state='failed',failure_code=p_code where id=r.id;
 insert into public.new_dawn_commusoft_scheduled_activity_probe_events(request_id,tenant_id,actor_id,event,detail)
 values(r.id,r.tenant_id,r.actor_id,'failed',jsonb_build_object('code',p_code));
end $$;

create function public.new_dawn_commusoft_scheduled_activity_probe_result(p_request uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.new_dawn_commusoft_scheduled_activity_probes%rowtype;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then
  raise exception 'scheduled_activity_probe_forbidden' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_scheduled_activity_probes
  where id=p_request and actor_id=auth.uid();
 if not found then raise exception 'scheduled_activity_probe_unavailable' using errcode='42501';end if;
 perform public.learn_operator_input_access(r.tenant_id,auth.uid(),true);
 insert into public.new_dawn_commusoft_scheduled_activity_probe_events(request_id,tenant_id,actor_id,event)
 values(r.id,r.tenant_id,r.actor_id,'result_read');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('requestId',r.id,'state',r.state,'result',r.result,'failureCode',r.failure_code);
end $$;

revoke all on function public.new_dawn_commusoft_scheduled_activity_probe_guard(),
 public.new_dawn_commusoft_scheduled_activity_probe_authority(public.new_dawn_commusoft_scheduled_activity_probes),
 public.new_dawn_commusoft_scheduled_activity_probe_start(uuid,uuid,uuid,text),
 public.new_dawn_commusoft_scheduled_activity_probe_acquire(uuid),
 public.new_dawn_commusoft_scheduled_activity_probe_current(uuid,uuid),
 public.new_dawn_commusoft_scheduled_activity_probe_summarize(text),
 public.new_dawn_commusoft_scheduled_activity_probe_finish(uuid,uuid,text),
 public.new_dawn_commusoft_scheduled_activity_probe_fail(uuid,text),
 public.new_dawn_commusoft_scheduled_activity_probe_result(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_scheduled_activity_probe_start(uuid,uuid,uuid,text),
 public.new_dawn_commusoft_scheduled_activity_probe_result(uuid) to authenticated;
grant execute on function public.new_dawn_commusoft_scheduled_activity_probe_acquire(uuid),
 public.new_dawn_commusoft_scheduled_activity_probe_current(uuid,uuid),
 public.new_dawn_commusoft_scheduled_activity_probe_summarize(text),
 public.new_dawn_commusoft_scheduled_activity_probe_finish(uuid,uuid,text),
 public.new_dawn_commusoft_scheduled_activity_probe_fail(uuid,text) to service_role;
commit;
