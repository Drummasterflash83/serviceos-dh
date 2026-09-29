begin;
create table public.receptionist_approved_voice_tests (
 session_id uuid primary key references public.receptionist_practice_sessions(id),
 tenant_id uuid not null, issue_id uuid not null, rehearsal_id uuid not null references public.receptionist_rehearsals(id),
 actor_id uuid not null references public.profiles(id), approved_at timestamptz not null,
 proposal text not null, source_version text not null, candidate_hash text not null,
 created_at timestamptz not null default now(),
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id)
);
alter table public.receptionist_approved_voice_tests enable row level security;
revoke all on public.receptionist_approved_voice_tests from public,anon,authenticated;
grant select on public.receptionist_approved_voice_tests to authenticated;
grant all on public.receptionist_approved_voice_tests to service_role;
create policy approved_voice_operator on public.receptionist_approved_voice_tests for select to authenticated using(public.care_desk_operator());
create function public.care_bind_voice_test(p_tenant uuid,p_issue uuid,p_actor uuid,p_version integer,p_session uuid,p_rehearsal uuid,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare i public.receptionist_care_issues; r public.receptionist_rehearsals;
begin
 perform public.notification_require_actor(p_actor);
 if not exists(select 1 from auth.users where id=p_actor and lower(email)='chris@openfolk.ai') then raise exception 'Administrator required'; end if;
 select * into i from public.receptionist_care_issues where tenant_id=p_tenant and id=p_issue for update;
 if not found or i.stage<>'approved' or i.version is distinct from p_version or i.approved_at is null then raise exception 'Current approval required'; end if;
 select * into r from public.receptionist_rehearsals where id=p_rehearsal and tenant_id=p_tenant and issue_id=p_issue;
 if not found or r.state<>'completed' or r.approved_at is distinct from i.approved_at or r.proposal is distinct from i.proposal or r.result->>'version' is distinct from 'approved-wording-v2-recorded-opening' then raise exception 'Matching text rehearsal required'; end if;
 if not exists(select 1 from public.receptionist_practice_sessions where id=p_session and tenant_id=p_tenant and author_id=p_actor and state='starting' and expires_at>now()) then raise exception 'Reserved voice session required'; end if;
 if p_hash is null or length(p_hash)<>64 then raise exception 'Candidate receipt required'; end if;
 insert into public.receptionist_approved_voice_tests(session_id,tenant_id,issue_id,rehearsal_id,actor_id,approved_at,proposal,source_version,candidate_hash)
 values(p_session,p_tenant,p_issue,p_rehearsal,p_actor,i.approved_at,i.proposal,r.assistant_version,p_hash);
end $$;
revoke all on function public.care_bind_voice_test(uuid,uuid,uuid,integer,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.care_bind_voice_test(uuid,uuid,uuid,integer,uuid,uuid,text) to service_role;
commit;
