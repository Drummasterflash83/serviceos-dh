begin;
create table public.receptionist_rehearsals (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, issue_id uuid not null,
 actor_id uuid not null references public.profiles(id), issue_version integer not null,
 approved_at timestamptz not null, proposal text not null, test_plan text not null,
 state text not null default 'running' check(state in ('running','completed','failed','superseded')),
 assistant_version text not null, assistant_hash text not null, candidate_hash text not null,
 opening text not null, caller text not null, result jsonb, safe_error text,
 created_at timestamptz not null default now(), finished_at timestamptz,
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id)
);
alter table public.receptionist_rehearsals enable row level security;
revoke all on public.receptionist_rehearsals from public,anon,authenticated;
grant select on public.receptionist_rehearsals to authenticated;
grant all on public.receptionist_rehearsals to service_role;
create policy rehearsal_operator on public.receptionist_rehearsals for select to authenticated using(public.care_desk_operator());
create index rehearsal_issue on public.receptionist_rehearsals(tenant_id,issue_id,created_at desc);

create function public.care_reserve_rehearsal(p_tenant uuid,p_issue uuid,p_actor uuid,p_version integer,p_assistant_version text,p_assistant_hash text,p_candidate_hash text,p_opening text,p_caller text)
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.receptionist_care_issues; r uuid;
begin
 perform public.notification_require_actor(p_actor);
 if not exists(select 1 from auth.users where id=p_actor and lower(email)='chris@openfolk.ai') then raise exception 'Administrator required'; end if;
 perform 1 from public.receptionist_workspaces where tenant_id=p_tenant for update;
 select * into i from public.receptionist_care_issues where tenant_id=p_tenant and id=p_issue for update;
 if not found or i.stage<>'approved' or i.approved_at is null or i.approved_by is null or i.version is distinct from p_version then raise exception 'Current approved proposal required'; end if;
 if p_assistant_version is null or p_assistant_hash is null or p_candidate_hash is null or p_opening is null or length(p_opening)>6000 or p_caller is null or length(btrim(p_caller)) not between 1 and 2000 then raise exception 'Invalid rehearsal'; end if;
 if exists(select 1 from public.receptionist_rehearsals where tenant_id=p_tenant and state='running' and created_at>now()-interval '2 minutes') then raise exception 'Rehearsal already running'; end if;
 if exists(select 1 from public.receptionist_rehearsals where tenant_id=p_tenant and issue_id=p_issue and created_at>now()-interval '1 minute') then raise exception 'Wait a minute before retrying'; end if;
 if (select count(*) from public.receptionist_rehearsals where tenant_id=p_tenant and created_at>now()-interval '1 day')>=30 then raise exception 'Daily rehearsal safeguard reached'; end if;
 update public.receptionist_rehearsals set state='failed',safe_error='Interrupted rehearsal. No live change was made.',finished_at=now() where tenant_id=p_tenant and state='running' and created_at<=now()-interval '2 minutes';
 insert into public.receptionist_rehearsals(tenant_id,issue_id,actor_id,issue_version,approved_at,proposal,test_plan,assistant_version,assistant_hash,candidate_hash,opening,caller)
 values(p_tenant,p_issue,p_actor,i.version,i.approved_at,i.proposal,i.test_plan,p_assistant_version,p_assistant_hash,p_candidate_hash,p_opening,p_caller) returning id into r;
 return r;
end $$;
revoke all on function public.care_reserve_rehearsal(uuid,uuid,uuid,integer,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.care_reserve_rehearsal(uuid,uuid,uuid,integer,text,text,text,text,text) to service_role;

create function public.care_finish_rehearsal(p_id uuid,p_result jsonb,p_error text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.receptionist_rehearsals; i public.receptionist_care_issues; outcome text; message text;
begin
 select * into r from public.receptionist_rehearsals where id=p_id for update;
 if not found or r.state<>'running' then raise exception 'Active rehearsal required'; end if;
 if p_error is null and (p_result is null or jsonb_typeof(p_result)<>'object') then raise exception 'Result required'; end if;
 select * into i from public.receptionist_care_issues where id=r.issue_id and tenant_id=r.tenant_id for update;
 outcome:=case when i.stage<>'approved' or i.approved_at is distinct from r.approved_at or i.proposal is distinct from r.proposal or i.version<>r.issue_version then 'superseded' when p_error is not null then 'failed' else 'completed' end;
 update public.receptionist_rehearsals set state=outcome,result=p_result,safe_error=p_error,finished_at=now() where id=p_id;
 if outcome='superseded' then return; end if;
 message:=case when outcome='completed' then 'OpenFolk has run an isolated wording rehearsal of the approved improvement. We are reviewing the result before a voice retest. Your live receptionist is unchanged.' else 'OpenFolk could not complete the isolated wording rehearsal. We will check it before retrying. Your live receptionist is unchanged.' end;
 update public.receptionist_care_issues set customer_update=message,version=version+1,updated_at=now() where id=i.id returning * into i;
 insert into public.receptionist_care_events(tenant_id,issue_id,actor_id,action,version,detail) values(i.tenant_id,i.id,r.actor_id,'rehearsal_'||outcome,i.version,jsonb_build_object('rehearsal_id',r.id,'live_changes',0));
 -- Existing client-feedback projection and notification outbox publish honest progress.
end $$;
revoke all on function public.care_finish_rehearsal(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.care_finish_rehearsal(uuid,jsonb,text) to service_role;
commit;
