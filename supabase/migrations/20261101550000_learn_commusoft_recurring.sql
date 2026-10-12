-- Ongoing Commusoft cycles. Installation creates no approvals or schedules.
-- Every cycle traverses the full property inventory before jobs and both contact
-- kinds. The first cycle is unfiltered; later cycles share frozen update bounds.
begin;
create table public.learn_commusoft_recurring (
 account_id uuid primary key references public.connector_accounts(id),
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 connection_revision timestamptz not null,
 approved_by uuid not null references public.profiles(id),
 enabled boolean not null,
 revision bigint not null default 1 check(revision>0),
 max_pages integer not null check(max_pages between 1 and 10000),
 page_size integer not null check(page_size between 1 and 100),
 watermark timestamptz,
 cycle_start timestamptz,
 cycle_end timestamptz,
 phase integer not null default 0 check(phase between 0 and 4),
 current_request uuid,
 current_definition jsonb,
 last_state text not null default 'approved',
 next_check_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.learn_commusoft_recurring_steps (
 request_id uuid primary key,
 account_id uuid not null references public.learn_commusoft_recurring(account_id),
 tenant_id uuid not null,
 approved_by uuid not null,
 cycle_start timestamptz,
 cycle_end timestamptz not null,
 phase integer not null check(phase between 1 and 4),
 definition jsonb not null,
 job_id uuid,
 created_at timestamptz not null default clock_timestamp()
);
create table public.learn_commusoft_recurring_requests (
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,
 definition jsonb not null,receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_commusoft_recurring enable row level security;
alter table public.learn_commusoft_recurring_steps enable row level security;
alter table public.learn_commusoft_recurring_requests enable row level security;
revoke all on public.learn_commusoft_recurring,public.learn_commusoft_recurring_steps,public.learn_commusoft_recurring_requests from public,anon,authenticated,service_role;
create trigger retain_steps before update or delete on public.learn_commusoft_recurring_steps
 for each row execute function public.learn_operator_input_immutable();
create trigger retain_requests before update or delete on public.learn_commusoft_recurring_requests
 for each row execute function public.learn_operator_input_immutable();
create index learn_commusoft_recurring_due on public.learn_commusoft_recurring(next_check_at,account_id) where enabled;

-- Fences both unattended dispatch and credential/page admission. No JWT claims
-- are fabricated, and no browser can execute this private helper.
create function public.learn_commusoft_recurring_actor(p_actor uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$begin
 perform 1 from public.profiles where id=p_actor for share;
 if not found then return false;end if;
 perform 1 from public.platform_authority_grants where profile_id=p_actor and permission='platform.controlplane.admin'
  and coalesce(effective_from,'-infinity')<=clock_timestamp() and coalesce(effective_to,'infinity')>clock_timestamp() for share;
 if not found then return false;end if;
 return not exists(select 1 from public.view_as_context where actor_user_id=p_actor and ended_at is null
  and (expires_at is null or expires_at>clock_timestamp()));
end $$;
create function public.learn_commusoft_recurring_admission(p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb)
returns void language plpgsql security definer set search_path=pg_catalog as $$declare s public.learn_commusoft_recurring%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_recurring_forbidden' using errcode='42501';end if;
 select * into s from public.learn_commusoft_recurring where tenant_id=p_tenant and current_request=p_request for share;
 if not found or not s.enabled or s.approved_by is distinct from p_actor or s.current_definition is distinct from p_definition
  or not public.learn_commusoft_recurring_actor(p_actor) then
  raise exception 'commusoft_recurring_approval_changed' using errcode='42501';end if;
end $$;
create function public.learn_commusoft_recurring_page_allowed(p_tenant uuid,p_approval text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$declare r public.learn_commusoft_recurring_steps%rowtype;s public.learn_commusoft_recurring%rowtype;begin
 select * into r from public.learn_commusoft_recurring_steps where request_id::text=p_approval;
 if not found then return true;end if; -- Existing manual approvals keep their own checks.
 select * into s from public.learn_commusoft_recurring where account_id=r.account_id for share;
 return found and s.enabled and s.tenant_id=p_tenant and r.tenant_id=p_tenant
  and s.current_request=r.request_id and s.approved_by=r.approved_by
  and public.learn_commusoft_recurring_actor(r.approved_by);
end $$;

-- Reuse the complete reviewed setup transaction and its connection, incomplete
-- import, frozen contact-target and receipt checks; change only its entry gate.
do $$declare d text;old text:='perform public.learn_operator_input_access(p_tenant,p_actor,true);';begin
 d:=pg_get_functiondef('public.learn_operator_input_request(uuid,uuid,uuid,jsonb,text)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>2 or position('public.learn_commusoft_update_window(p_definition)' in d)=0 then
  raise exception 'commusoft_recurring_setup_source_changed';end if;
 d:=replace(d,'FUNCTION public.learn_operator_input_request(','FUNCTION public.learn_commusoft_recurring_start(');
 d:=replace(d,old,'perform public.learn_commusoft_recurring_admission(p_tenant,p_request,p_actor,p_definition);');
 execute d;
 d:=pg_get_functiondef('public.learn_commusoft_acquire_page(uuid,uuid,text,integer,jsonb)'::regprocedure);
 old:='  cfg:=a.settings->''commusoft_import'';';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'commusoft_recurring_acquire_source_changed';end if;
 d:=replace(d,'  perform 1 from public.tenants where id=p_tenant_id and status=''active'' for share;',E'  perform 1 from public.learn_commusoft_recurring where account_id::text=j.payload->>''connector_account_id'' and tenant_id=p_tenant_id for share;\n  perform 1 from public.tenants where id=p_tenant_id and status=''active'' for share;');
 execute replace(d,old,old||E'\n  if not public.learn_commusoft_recurring_page_allowed(p_tenant_id,cfg->>''approvalId'') then return null;end if;');
 d:=pg_get_functiondef('public.learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)'::regprocedure);
 old:='  b:=permit.binding; cfg:=b->''approval''; cp:=b->''checkpoint'';';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'commusoft_recurring_commit_source_changed';end if;
 d:=replace(d,'  perform 1 from public.tenants where id=p_tenant_id and status=''active'' for share;',E'  perform 1 from public.learn_commusoft_recurring where account_id::text=j.payload->>''connector_account_id'' and tenant_id=p_tenant_id for share;\n  perform 1 from public.tenants where id=p_tenant_id and status=''active'' for share;');
 execute replace(d,old,old||E'\n  if not public.learn_commusoft_recurring_page_allowed(p_tenant_id,cfg->>''approvalId'') then raise exception ''commusoft_recurring_approval_changed'' using errcode=''42501'';end if;');
end $$;

create function public.learn_commusoft_recurring_control(p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_recurring_requests%rowtype;s public.learn_commusoft_recurring%rowtype;
 a public.connector_accounts%rowtype;c public.provider_connections%rowtype;receipt jsonb;aid uuid;want boolean;expected bigint;pages integer;size integer;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in('apply','check','cancel') or jsonb_typeof(p_definition) is distinct from 'object'
  or octet_length(p_definition::text)>4000 then raise exception 'commusoft_recurring_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('commusoft-recurring-request:'||p_request::text,0));
 select * into r from public.learn_commusoft_recurring_requests where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>p_actor or r.definition<>p_definition then raise exception 'commusoft_recurring_conflict' using errcode='PT409';end if;
  return r.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('state','pending','request_id',p_request);end if;
 if p_mode='cancel' then receipt:=jsonb_build_object('state','cancelled','request_id',p_request);
 else
  if not p_definition ?& array['account_id','expected_revision','enabled','max_pages','page_size','reason']
   or (p_definition-array['account_id','expected_revision','enabled','max_pages','page_size','reason'])<>'{}'::jsonb
   or jsonb_typeof(p_definition->'enabled') is distinct from 'boolean'
   or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
   or jsonb_typeof(p_definition->'expected_revision') is distinct from 'number' or p_definition->>'expected_revision'!~'^[0-9]{1,15}$'
   or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,5}$'
   or jsonb_typeof(p_definition->'page_size') is distinct from 'number' or p_definition->>'page_size'!~'^[0-9]{1,3}$' then
   raise exception 'commusoft_recurring_invalid' using errcode='22023';end if;
  aid:=(p_definition->>'account_id')::uuid;want:=(p_definition->>'enabled')::boolean;expected:=(p_definition->>'expected_revision')::bigint;
  pages:=(p_definition->>'max_pages')::integer;size:=(p_definition->>'page_size')::integer;
  if pages not between 1 and 10000 or size not between 1 and 100 then raise exception 'commusoft_recurring_invalid' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
  select * into s from public.learn_commusoft_recurring where account_id=aid for update;
  if (found and (s.tenant_id<>p_tenant or s.revision<>expected)) or (not found and expected<>0) then
   raise exception 'commusoft_recurring_revision_changed' using errcode='PT409';end if;
  select * into a from public.connector_accounts where id=aid and tenant_id=p_tenant for update;
  if not found then raise exception 'commusoft_recurring_account_unavailable' using errcode='42501';end if;
  if s.account_id is null then
   if not want or a.sync_cursor->'complete' is distinct from 'true'::jsonb then raise exception 'commusoft_recurring_initial_import_required' using errcode='55000';end if;
   select * into c from public.provider_connections where id=(a.settings->'commusoft_import'->>'connectionId')::uuid and tenant_id=p_tenant for share;
   if not found or c.provider<>'commusoft' or c.status<>'configured' or c.revoked_at is not null or c.verified_at is null then
    raise exception 'commusoft_recurring_connection_unavailable' using errcode='55000';end if;
   insert into public.learn_commusoft_recurring(account_id,tenant_id,connection_id,connection_revision,approved_by,enabled,max_pages,page_size)
    values(aid,p_tenant,c.id,c.updated_at,p_actor,true,pages,size) returning * into s;
  else
   -- A paused cycle resumes the same frozen definition. Changed budgets or
   -- operator identity require a completed cycle and a separate reviewed setup.
   if s.approved_by<>p_actor or s.max_pages<>pages or s.page_size<>size then raise exception 'commusoft_recurring_scope_changed' using errcode='PT409';end if;
   update public.learn_commusoft_recurring set enabled=want,revision=revision+1,next_check_at=clock_timestamp(),
    updated_at=clock_timestamp(),last_state=case when want then 'approved' else 'paused' end where account_id=aid returning * into s;
  end if;
  receipt:=jsonb_build_object('state','recorded','request_id',p_request,'account_id',aid,'revision',s.revision,'enabled',s.enabled);
 end if;
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_commusoft_recurring_requests values(p_request,p_tenant,p_actor,p_definition,receipt,clock_timestamp());
 return receipt;
end $$;

-- Zero parents is a positive statement backed by this cycle's completed,
-- unfiltered inventory. Unknown property kinds cannot establish an empty set.
create function public.learn_commusoft_recurring_empty_parent(p_account uuid,p_end timestamptz,p_kind text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare r public.learn_commusoft_recurring_steps%rowtype;c uuid;begin
 if p_kind is null or p_kind not in('customer','workaddress') then return false;end if;
 select * into r from public.learn_commusoft_recurring_steps where account_id=p_account and cycle_end=p_end and phase=1;
 if not found or r.job_id is null or r.definition ?| array['updatedFrom','updatedBefore'] then return false;end if;
 c:=(r.definition->>'connection_id')::uuid;
 if not exists(select 1 from public.learn_business_input_pages p join public.platform_jobs j on j.id=p.job_id
  where p.tenant_id=r.tenant_id and p.connection_id=c and p.collection='properties'
   and p.checkpoint_after->>'approvalId'=r.request_id::text and p.checkpoint_after->'complete'='true'::jsonb
   and j.status='succeeded' and j.metadata->'commusoft_page_v1'->>'pageId'=p.id::text) then return false;end if;
 return not exists(select 1 from public.learn_business_input_pages p
  join public.learn_business_input_observations o on o.page_id=p.id
  join public.learn_business_input_versions v on v.id=o.version_id and v.tenant_id=p.tenant_id and v.connection_id=p.connection_id
  where p.tenant_id=r.tenant_id and p.connection_id=c and p.collection='properties'
   and p.checkpoint_after->>'approvalId'=r.request_id::text
   and (v.payload->>'type'=p_kind or coalesce(v.payload->>'type','') not in('customer','workaddress')));
end $$;
revoke all on function public.learn_commusoft_recurring_empty_parent(uuid,timestamptz,text) from public,anon,authenticated,service_role;

create function public.learn_commusoft_schedule_recurring(p_batch integer default 10) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare s public.learn_commusoft_recurring%rowtype;a public.connector_accounts%rowtype;c public.provider_connections%rowtype;
 stage integer;state text;definition jsonb;receipt jsonb;rid uuid;start_at timestamptz;end_at timestamptz;
 checked integer:=0;queued integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'commusoft_recurring_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' or p_batch is null or p_batch not between 1 and 50 then raise exception 'commusoft_recurring_invalid' using errcode='22023';end if;
 for s in select * from public.learn_commusoft_recurring where enabled and next_check_at<=clock_timestamp() order by next_check_at,account_id limit p_batch loop
  if not pg_try_advisory_xact_lock(hashtextextended('learn-input-setup:'||s.tenant_id::text,0)) then continue;end if;
  select * into s from public.learn_commusoft_recurring where account_id=s.account_id and enabled and next_check_at<=clock_timestamp() for update;
  if not found then continue;end if;
  checked:=checked+1;state:='ready';
  if not public.learn_commusoft_recurring_actor(s.approved_by) then state:='approval_changed';end if;
  select * into a from public.connector_accounts where id=s.account_id and tenant_id=s.tenant_id for update;
  if not found or a.status is distinct from 'active' then state:='account_unavailable';end if;
  select * into c from public.provider_connections where id=s.connection_id and tenant_id=s.tenant_id for share;
  if not found or c.status is distinct from 'configured' or c.revoked_at is not null or c.updated_at is distinct from s.connection_revision then state:='connection_changed';end if;
  if public.learn_operator_input_flags(s.tenant_id) is distinct from '{"learn.enabled":true,"learn.inputs.commusoft.enabled":true}'::jsonb then state:='capture_paused';end if;
  if state='ready' and exists(select 1 from public.platform_jobs where tenant_id=s.tenant_id and job_type='commusoft.source_sync' and payload->>'connector_account_id'=s.account_id::text and status in('queued','running','retrying')) then state:='window_active';end if;
  if state='ready' and s.current_request is not null then
   if s.phase>=3 and exists(select 1 from public.learn_commusoft_recurring_steps r where r.request_id=s.current_request
     and r.account_id=s.account_id and r.tenant_id=s.tenant_id and r.phase=s.phase and r.cycle_end=s.cycle_end and r.job_id is null)
     and public.learn_commusoft_recurring_empty_parent(s.account_id,s.cycle_end,case s.phase when 3 then 'customer' else 'workaddress' end) then null;
   elsif a.settings->'commusoft_import'->>'approvalId' is distinct from s.current_request::text then state:='window_changed';
   elsif a.sync_cursor->'complete' is distinct from 'true'::jsonb then state:='window_incomplete';
   elsif not exists(select 1 from public.learn_business_input_pages p join public.platform_jobs j on j.id=p.job_id
    where p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.checkpoint_after=a.sync_cursor
     and p.checkpoint_after->>'approvalId'=s.current_request::text and j.status='succeeded'
     and j.metadata->'commusoft_page_v1'->>'pageId'=p.id::text) then state:='completion_unverified';end if;
  end if;
  if state='ready' then
   stage:=s.phase+1;start_at:=s.cycle_start;end_at:=s.cycle_end;
   if s.phase=4 then
    -- Only four verified stages can advance the watermark. Partial cycles never do.
    update public.learn_commusoft_recurring set watermark=s.cycle_end,phase=0,current_request=null,current_definition=null,
     cycle_start=null,cycle_end=null,next_check_at=clock_timestamp()+interval '1 hour',last_state='cycle_complete',updated_at=clock_timestamp() where account_id=s.account_id;
    continue;
   elsif s.phase=0 then
    start_at:=case when s.watermark is null then null else greatest(to_timestamp(0),s.watermark-interval '5 minutes') end;
    end_at:=date_trunc('milliseconds',least(coalesce(s.watermark+interval '24 hours','infinity'::timestamptz),clock_timestamp()-interval '2 minutes'));
    if s.watermark is not null and end_at<=s.watermark then state:='caught_up';end if;
   end if;
   if state='ready' then
    rid:=gen_random_uuid();
    definition:=jsonb_build_object('kind','start_commusoft','reason','Approved ongoing Commusoft cycle','connection_id',s.connection_id,
     'revision',s.connection_revision,'resource',case stage when 1 then 'properties' when 2 then 'jobs' else 'propertyContacts' end,
     'max_pages',s.max_pages,'page_size',s.page_size,'expires_at',clock_timestamp()+interval '24 hours');
    if stage>=3 then definition:=definition||jsonb_build_object('contact_type',case stage when 3 then 'customer' else 'workaddress' end);end if;
    if stage>1 and start_at is not null then definition:=definition||jsonb_build_object(
     'updatedFrom',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     'updatedBefore',to_char(end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));end if;
    begin
     update public.learn_commusoft_recurring set current_request=rid,current_definition=definition,phase=stage,cycle_start=start_at,cycle_end=end_at where account_id=s.account_id;
     if stage>=3 and public.learn_commusoft_recurring_empty_parent(s.account_id,end_at,definition->>'contact_type') then
      insert into public.learn_commusoft_recurring_steps values(rid,s.account_id,s.tenant_id,s.approved_by,start_at,end_at,stage,definition,null,clock_timestamp());
      state:='empty_parent_set_verified';
     else
     receipt:=public.learn_commusoft_recurring_start(s.tenant_id,rid,s.approved_by,definition,'apply');
     if receipt->>'account_id' is distinct from s.account_id::text then raise exception 'commusoft_recurring_account_changed' using errcode='PT409';end if;
     insert into public.learn_commusoft_recurring_steps values(rid,s.account_id,s.tenant_id,s.approved_by,start_at,end_at,stage,definition,(receipt->>'job_id')::uuid,clock_timestamp());
     queued:=queued+1;state:='window_queued';
     end if;
    exception when sqlstate '55000' or sqlstate 'PT409' or insufficient_privilege then state:='setup_needs_review';end;
   end if;
  end if;
  if state not in('window_queued','window_active','caught_up','empty_parent_set_verified') then held:=held+1;end if;
  update public.learn_commusoft_recurring set last_state=state,next_check_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp() where account_id=s.account_id;
 end loop;
 return jsonb_build_object('checked',checked,'queued',queued,'held',held);
end $$;
-- The existing dedicated worker is the wake-up path. No independent timer is
-- installed here; its already configured caller must be verified at activation.
-- Paused/revoked recurring work is skipped without spending a retry attempt.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_commusoft_claim_jobs(uuid)'::regprocedure);
 needle:=' for j in select * from public.platform_jobs q';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'commusoft_recurring_claim_source_changed';end if;
 d:=replace(d,needle,' perform public.learn_commusoft_schedule_recurring(10);'||chr(10)||needle);
 needle:='   order by q.priority,q.created_at,q.id for update skip locked limit 1';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'commusoft_recurring_claim_gate_changed';end if;
 d:=replace(d,needle,$gate$   and public.learn_commusoft_recurring_page_allowed(q.tenant_id,split_part(q.job_key,':',3))
$gate$||needle);
 execute d;
end $$;

create function public.learn_commusoft_recurring_read(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$declare result jsonb;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 select coalesce(jsonb_agg(to_jsonb(s)-'current_definition' order by s.account_id),'[]'::jsonb) into result from public.learn_commusoft_recurring s where tenant_id=p_tenant;
 return jsonb_build_object('tenant_id',p_tenant,'checked_at',clock_timestamp(),'accounts',result);
end $$;
revoke all on function public.learn_commusoft_recurring_actor(uuid),public.learn_commusoft_recurring_admission(uuid,uuid,uuid,jsonb),public.learn_commusoft_recurring_page_allowed(uuid,text),public.learn_commusoft_recurring_start(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text),public.learn_commusoft_recurring_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_recurring_control(uuid,uuid,uuid,jsonb,text),public.learn_commusoft_recurring_read(uuid) to authenticated;
revoke all on function public.learn_commusoft_schedule_recurring(integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_schedule_recurring(integer) to service_role;
commit;
