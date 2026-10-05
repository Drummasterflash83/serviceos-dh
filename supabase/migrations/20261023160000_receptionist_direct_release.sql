begin;
create table public.receptionist_releases (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, issue_id uuid not null,
 actor_id uuid not null references public.profiles(id), issue_version integer not null,
 proposal text not null, instruction text not null, source_hash text not null, candidate_hash text not null,
 assistant_id text not null, source_version text not null, provider_version text,
 state text not null default 'prepared' check(state in ('prepared','publishing','applied','conflict','uncertain','rolling_back','rolled_back')),
 operation text not null default 'publish' check(operation in ('publish','rollback')),
 safe_error text, created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz,
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id)
);
create unique index receptionist_one_release on public.receptionist_releases(tenant_id) where state in ('publishing','uncertain','rolling_back');
-- Configuration may contain private provider connection details. It never reaches the browser.
create table public.receptionist_release_snapshots (
 release_id uuid primary key references public.receptionist_releases(id),
 before_config jsonb not null, candidate_config jsonb not null
);
alter table public.receptionist_releases enable row level security;
alter table public.receptionist_release_snapshots enable row level security;
revoke all on public.receptionist_releases,public.receptionist_release_snapshots from public,anon,authenticated;
grant select on public.receptionist_releases to authenticated;
grant all on public.receptionist_releases,public.receptionist_release_snapshots to service_role;
create policy releases_operator on public.receptionist_releases for select to authenticated using(public.care_desk_operator());

create function public.care_release_actor(p_actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.notification_require_actor(p_actor);
 if not exists(select 1 from auth.users where id=p_actor and lower(email)='chris@openfolk.ai') then raise exception 'Administrator required' using errcode='42501'; end if;
end $$;

create function public.care_prepare_release(p_tenant uuid,p_issue uuid,p_actor uuid,p_version integer,p_assistant text,p_source_version text,p_source_hash text,p_candidate_hash text,p_instruction text,p_before jsonb,p_candidate jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.receptionist_care_issues; r uuid;
begin
 perform public.care_release_actor(p_actor);
 select * into i from public.receptionist_care_issues where tenant_id=p_tenant and id=p_issue for update;
 if not found or i.version<>p_version or i.stage not in ('approval','approved') or length(btrim(i.proposal))<5 then raise exception 'Saved proposal required'; end if;
 if not exists(select 1 from public.receptionist_workspaces where tenant_id=p_tenant and assistant_id::text=p_assistant) then raise exception 'Assistant mismatch'; end if;
 if p_source_hash !~ '^[a-f0-9]{64}$' or p_candidate_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_before)<>'object' or jsonb_typeof(p_candidate)<>'object' or length(p_instruction)>22000 then raise exception 'Invalid snapshot'; end if;
 insert into public.receptionist_releases(tenant_id,issue_id,actor_id,issue_version,proposal,instruction,assistant_id,source_version,source_hash,candidate_hash)
 values(p_tenant,p_issue,p_actor,p_version,i.proposal,p_instruction,p_assistant,p_source_version,p_source_hash,p_candidate_hash) returning id into r;
 insert into public.receptionist_release_snapshots values(r,p_before,p_candidate);
 return r;
end $$;

create function public.care_claim_release(p_id uuid,p_actor uuid,p_operation text) returns void language plpgsql security definer set search_path='' as $$
declare r public.receptionist_releases; i public.receptionist_care_issues;
begin
 perform public.care_release_actor(p_actor);
 select * into r from public.receptionist_releases where id=p_id for update;
 if not found or r.actor_id<>p_actor then raise exception 'Release unavailable'; end if;
 select * into i from public.receptionist_care_issues where id=r.issue_id for update;
 if p_operation='publish' then
  if r.state<>'prepared' or r.created_at<now()-interval '15 minutes' or i.version<>r.issue_version or i.proposal<>r.proposal or i.stage not in ('approval','approved') then raise exception 'Preview expired or proposal changed'; end if;
 elsif p_operation='rollback' then
  if r.state<>'applied' then raise exception 'Applied release required'; end if;
 else raise exception 'Invalid operation'; end if;
 update public.receptionist_releases set operation=p_operation,started_at=now(),state=case p_operation when 'publish' then 'publishing' else 'rolling_back' end where id=p_id;
end $$;

create function public.care_finish_release(p_id uuid,p_state text,p_provider_version text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.receptionist_releases; i public.receptionist_care_issues; next_stage text; msg text;
begin
 select * into r from public.receptionist_releases where id=p_id for update;
 if not found or r.state not in ('publishing','rolling_back','uncertain') or p_state not in ('applied','conflict','uncertain') then raise exception 'Invalid completion'; end if;
 -- An uncertain outcome remains locked until a read-only reconciliation proves it.
 update public.receptionist_releases set state=case when p_state='applied' and operation='rollback' then 'rolled_back' else p_state end,
  provider_version=p_provider_version,finished_at=now(),safe_error=case p_state when 'uncertain' then 'Vapi outcome needs checking. Do not resend this change.' when 'conflict' then 'Emma changed since the preview. Nothing was sent by this attempt.' else null end where id=p_id;
 if p_state='applied' then
  next_stage:=case r.operation when 'publish' then 'verifying' else 'reviewing' end;
  msg:=case r.operation when 'publish' then 'OpenFolk has published the improvement to Emma. We are checking the result; your report stays open until verified.' else 'OpenFolk has restored the previous version while we review this improvement.' end;
 elsif p_state='uncertain' then
  next_stage:=null; msg:='OpenFolk is checking the outcome of this update. We will confirm it here once verified.';
 else next_stage:=null; msg:='OpenFolk found a newer configuration and is reviewing the change before publishing.';
 end if;
 select * into i from public.receptionist_care_issues where id=r.issue_id for update;
 perform set_config('openfolk.release_finishing','true',true);
 update public.receptionist_care_issues set stage=coalesce(next_stage,stage),customer_update=msg,
  approved_by=case when p_state='applied' and r.operation='publish' then r.actor_id else approved_by end,
  approved_at=case when p_state='applied' and r.operation='publish' then now() else approved_at end,
  release_ref=case when p_state='applied' then case r.operation when 'publish' then r.id::text else null end else release_ref end,
  version=version+1,updated_at=now() where id=i.id returning * into i;
 insert into public.receptionist_care_events(tenant_id,issue_id,actor_id,action,version,detail)
 values(r.tenant_id,r.issue_id,r.actor_id,'release_'||r.operation||'_'||p_state,i.version,jsonb_build_object('release_id',r.id,'provider_version',p_provider_version));
end $$;

create function public.care_block_inflight_edit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('openfolk.release_finishing',true),'')<>'true' and exists(select 1 from public.receptionist_releases where issue_id=old.id and state in ('publishing','rolling_back','uncertain')) then raise exception 'Check the in-flight release before changing this task'; end if;
 return new;
end $$;
create trigger care_block_inflight_edit before update on public.receptionist_care_issues for each row execute function public.care_block_inflight_edit();
revoke all on function public.care_release_actor(uuid),public.care_prepare_release(uuid,uuid,uuid,integer,text,text,text,text,text,jsonb,jsonb),public.care_claim_release(uuid,uuid,text),public.care_finish_release(uuid,text,text),public.care_block_inflight_edit() from public,anon,authenticated;
grant execute on function public.care_release_actor(uuid),public.care_prepare_release(uuid,uuid,uuid,integer,text,text,text,text,text,jsonb,jsonb),public.care_claim_release(uuid,uuid,text),public.care_finish_release(uuid,text,text) to service_role;
commit;
