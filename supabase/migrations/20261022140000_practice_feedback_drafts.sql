-- Typed practice feedback is saved to its tenant, never browser localStorage.
-- Drafts do not notify Slack or become improvement requests until submitted.
create table public.receptionist_practice_drafts (
 id uuid primary key,
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 session_id uuid not null references public.receptionist_practice_sessions(id),
 author_id uuid not null references public.profiles(id),
 body text not null default '' check(length(body)<=3500),
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 unique(session_id,author_id)
);
alter table public.receptionist_practice_drafts enable row level security;
revoke all on public.receptionist_practice_drafts from anon,authenticated;
grant select on public.receptionist_practice_drafts to authenticated;
grant all on public.receptionist_practice_drafts to service_role;
create policy receptionist_practice_drafts_read on public.receptionist_practice_drafts
 for select to authenticated using(author_id=auth.uid() and exists(
 select 1 from public.receptionist_workspaces w where w.tenant_id=receptionist_practice_drafts.tenant_id));

create function public.save_receptionist_practice_draft(p_session uuid,p_submission uuid,p_version integer,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.receptionist_practice_sessions; d public.receptionist_practice_drafts;
begin
 select * into s from public.receptionist_practice_sessions where id=p_session and author_id=auth.uid();
 if s.id is null or s.call_id is null or not (
 public.current_user_is_openfolk_operator() or
 exists(select 1 from public.receptionist_access where tenant_id=s.tenant_id and profile_id=auth.uid()) or
 exists(select 1 from public.client_portal_access where tenant_id=s.tenant_id and profile_id=auth.uid()))
 then raise exception 'Practice feedback unavailable' using errcode='42501';end if;
 if p_submission is null or p_version is null or p_version<0 or p_body is null or length(p_body)>3500
 then raise exception 'Invalid practice draft' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session::text,28));
 if exists(select 1 from public.receptionist_feedback where tenant_id=s.tenant_id and author_id=auth.uid() and submission_key=p_submission)
 then raise exception 'This report was already submitted' using errcode='40001';end if;
 select * into d from public.receptionist_practice_drafts where session_id=p_session and author_id=auth.uid() for update;
 if d.id is not null and d.id=p_submission and d.body=p_body then
  return jsonb_build_object('id',d.id,'version',d.version,'body',d.body);
 end if;
 if (d.id is null and p_version<>0) or (d.id is not null and (d.id<>p_submission or d.version<>p_version))
 then raise exception 'Draft changed in another window; reopen this call before editing' using errcode='40001';end if;
 if d.id is null then
  insert into public.receptionist_practice_drafts(id,tenant_id,session_id,author_id,body)
  values(p_submission,s.tenant_id,s.id,auth.uid(),p_body) returning * into d;
 else
  update public.receptionist_practice_drafts set body=p_body,version=version+1,updated_at=now()
  where id=d.id returning * into d;
 end if;
 return jsonb_build_object('id',d.id,'version',d.version,'body',d.body);
end $$;

create function public.complete_receptionist_practice_draft(p_session uuid,p_submission uuid,p_version integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare s public.receptionist_practice_sessions; d public.receptionist_practice_drafts; result uuid;
begin
 select * into s from public.receptionist_practice_sessions where id=p_session and author_id=auth.uid();
 if s.id is null or s.call_id is null or not (
 public.current_user_is_openfolk_operator() or
 exists(select 1 from public.receptionist_access where tenant_id=s.tenant_id and profile_id=auth.uid()) or
 exists(select 1 from public.client_portal_access where tenant_id=s.tenant_id and profile_id=auth.uid()))
 then raise exception 'Practice feedback unavailable' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session::text,28));
 select id into result from public.receptionist_feedback where tenant_id=s.tenant_id and author_id=auth.uid() and submission_key=p_submission;
 if result is not null then return result;end if;
 select * into d from public.receptionist_practice_drafts where id=p_submission and session_id=p_session and author_id=auth.uid() for update;
 if d.id is null or d.version is distinct from p_version then
  raise exception 'Draft changed; reopen this call before sending' using errcode='40001';end if;
 if length(btrim(d.body))>0 then
  insert into public.receptionist_feedback(tenant_id,author_id,call_id,practice_session_id,submission_key,title,body,category,priority)
  values(s.tenant_id,auth.uid(),s.call_id,s.id,d.id,'Emma test feedback',btrim(d.body),'improvement','normal') returning id into result;
 end if;
 delete from public.receptionist_practice_drafts where id=d.id;
 return result;
end $$;
revoke all on function public.save_receptionist_practice_draft(uuid,uuid,integer,text),public.complete_receptionist_practice_draft(uuid,uuid,integer) from public,anon;
grant execute on function public.save_receptionist_practice_draft(uuid,uuid,integer,text),public.complete_receptionist_practice_draft(uuid,uuid,integer) to authenticated;

-- Observations use the same receipt on an ambiguous network retry.
create function public.submit_receptionist_observation(p_tenant uuid,p_submission uuid,p_call uuid,p_title text,p_body text,p_category text,p_priority text)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.receptionist_feedback; result uuid;
begin
 if auth.uid() is null or not (
 public.current_user_is_openfolk_operator() or
 exists(select 1 from public.receptionist_access where tenant_id=p_tenant and profile_id=auth.uid()) or
 exists(select 1 from public.client_portal_access where tenant_id=p_tenant and profile_id=auth.uid()))
 then raise exception 'Workspace unavailable' using errcode='42501';end if;
 if p_submission is null or p_title is null or length(btrim(p_title)) not between 1 and 160
 or p_body is null or length(btrim(p_body)) not between 1 and 10000
 or p_category is null or p_category not in ('improvement','routing','knowledge','caller-experience','technical','praise')
 or p_priority is null or p_priority not in ('normal','high','urgent')
 then raise exception 'Invalid observation' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||auth.uid()::text||p_submission::text,29));
 select * into existing from public.receptionist_feedback where tenant_id=p_tenant and author_id=auth.uid() and submission_key=p_submission;
 if existing.id is not null then
  if existing.call_id is distinct from p_call or existing.title<>btrim(p_title) or existing.body<>btrim(p_body)
   or existing.category<>p_category or existing.priority<>p_priority or existing.practice_session_id is not null
  then raise exception 'This submission was already saved with different details; open a new observation' using errcode='40001';end if;
  return existing.id;
 end if;
 insert into public.receptionist_feedback(tenant_id,author_id,call_id,submission_key,title,body,category,priority)
 values(p_tenant,auth.uid(),p_call,p_submission,btrim(p_title),btrim(p_body),p_category,p_priority) returning id into result;
 return result;
end $$;
revoke all on function public.submit_receptionist_observation(uuid,uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.submit_receptionist_observation(uuid,uuid,uuid,text,text,text,text) to authenticated;
