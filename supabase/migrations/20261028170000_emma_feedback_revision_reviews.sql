begin;
-- Feedback text is private evidence. Lifecycle/status updates are not new client
-- instructions and must never create a review/notification feedback loop.
alter table public.receptionist_auto_review_queue
 add column feedback_id uuid references public.receptionist_feedback(id),
 add column feedback_revision_hash text,
 add column feedback_snapshot jsonb,
 add constraint auto_feedback_snapshot_complete check(
  (feedback_id is null and feedback_revision_hash is null and feedback_snapshot is null)
  or (feedback_id is not null and feedback_revision_hash is not null and feedback_snapshot is not null
   and feedback_revision_hash ~ '^[0-9a-f]{64}$' and jsonb_typeof(feedback_snapshot)='object')
 );
alter table public.receptionist_task_reviews alter column actor_id drop not null;
alter table public.receptionist_task_reviews add column automation_queue_id uuid unique references public.receptionist_auto_review_queue(id);
alter table public.receptionist_task_reviews add constraint task_review_attributed
 check(actor_id is not null or automation_queue_id is not null);

-- Scheduled feedback assessments have their own atomic 100/day reservation.
-- They must not consume the existing operator's separate 30/day manual quota.
create or replace function public.care_desk_reserve_review(p_tenant uuid,p_issue uuid,p_actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 perform public.notification_require_actor(p_actor);
 if not exists(select 1 from auth.users where id=p_actor and lower(email)='chris@openfolk.ai') then raise exception 'Administrator required' using errcode='42501'; end if;
 perform 1 from public.receptionist_workspaces where tenant_id=p_tenant for update;
 if not found then raise exception 'Workspace unavailable'; end if;
 if not exists(select 1 from public.receptionist_care_issues where id=p_issue and tenant_id=p_tenant and stage<>'resolved') then raise exception 'Open task required'; end if;
 if exists(select 1 from public.receptionist_task_reviews where tenant_id=p_tenant and automation_queue_id is null and state='running' and created_at>now()-interval '2 minutes') then raise exception 'A review is already running'; end if;
 if exists(select 1 from public.receptionist_task_reviews where tenant_id=p_tenant and automation_queue_id is null and issue_id=p_issue and created_at>now()-interval '1 minute') then raise exception 'Wait a minute before reviewing again'; end if;
 if (select count(*) from public.receptionist_task_reviews where tenant_id=p_tenant and automation_queue_id is null and created_at>now()-interval '1 day')>=30 then raise exception 'Daily review safeguard reached'; end if;
 update public.receptionist_task_reviews set state='failed',safe_error='Review interrupted. Retry when ready.',finished_at=now() where tenant_id=p_tenant and automation_queue_id is null and state='running' and created_at<=now()-interval '2 minutes';
 insert into public.receptionist_task_reviews(tenant_id,issue_id,actor_id) values(p_tenant,p_issue,p_actor) returning id into r;
 return r;
end $$;

create function public.care_auto_enqueue_feedback(p_feedback uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare f public.receptionist_feedback; s public.receptionist_practice_sessions; cid uuid; kind text; snapshot jsonb; fingerprint text; qid uuid;
begin
 select * into f from public.receptionist_feedback where id=p_feedback;
 if not found or f.archived_at is not null or not exists(select 1 from public.receptionist_review_settings where tenant_id=f.tenant_id and enabled) then return null; end if;
 cid:=f.call_id; kind:='live';
 if f.practice_session_id is not null then
  select * into s from public.receptionist_practice_sessions where id=f.practice_session_id and tenant_id=f.tenant_id;
  if not found or s.call_id is null or (cid is not null and cid<>s.call_id) then return null; end if;
  cid:=s.call_id; kind:='practice';
 end if;
 if cid is null then return null; end if;
 snapshot:=jsonb_build_object('title',f.title,'body',f.body,'priority',f.priority,'category',f.category,'callId',cid,'practiceSessionId',f.practice_session_id);
 fingerprint:=encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
 insert into public.receptionist_auto_review_queue(tenant_id,call_id,reviewer_version,call_kind,practice_session_id,call_created_at,feedback_id,feedback_revision_hash,feedback_snapshot)
 values(f.tenant_id,cid,'emma-care-v3-client-improvement:feedback:'||f.id||':'||fingerprint,kind,f.practice_session_id,coalesce(s.created_at,f.created_at),f.id,fingerprint,snapshot||jsonb_build_object('version',f.version))
 on conflict(tenant_id,call_id,reviewer_version) do nothing returning id into qid;
 return qid;
end $$;
create function public.care_auto_feedback_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.title is not distinct from old.title and new.body is not distinct from old.body
 and new.priority is not distinct from old.priority and new.category is not distinct from old.category
 and new.call_id is not distinct from old.call_id and new.practice_session_id is not distinct from old.practice_session_id then return new; end if;
 perform public.care_auto_enqueue_feedback(new.id);
 return new;
end $$;
create trigger receptionist_auto_feedback_changed after insert or update on public.receptionist_feedback
 for each row execute function public.care_auto_feedback_changed();
create function public.care_auto_practice_linked() returns trigger language plpgsql security definer set search_path='' as $$
declare f uuid;
begin
 if new.call_id is not null and new.call_id is distinct from old.call_id then
  for f in select id from public.receptionist_feedback where tenant_id=new.tenant_id and practice_session_id=new.id loop
   perform public.care_auto_enqueue_feedback(f);
  end loop;
 end if;
 return new;
end $$;
create trigger receptionist_auto_practice_linked after update of call_id on public.receptionist_practice_sessions
 for each row execute function public.care_auto_practice_linked();

create function public.care_auto_review_reserve_evidence(p_id uuid,p_lease uuid,p_hash text)
returns text language plpgsql security definer set search_path='' as $$
declare q public.receptionist_auto_review_queue;
begin
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Evidence hash required'; end if;
 select * into q from public.receptionist_auto_review_queue where id=p_id for update;
 if not found or q.state<>'running' or q.lease_id is distinct from p_lease or q.lease_until<=now() then return 'budget_or_lease'; end if;
 perform pg_advisory_xact_lock(hashtextextended('emma-evidence:'||q.tenant_id||':'||q.call_id||':'||p_hash,0));
 if exists(select 1 from public.receptionist_call_reviews where tenant_id=q.tenant_id and call_id=q.call_id and evidence_hash=p_hash and state='reviewed' and reviewer_version like 'emma-care-v3-client-improvement%')
 or exists(select 1 from public.receptionist_auto_review_queue where tenant_id=q.tenant_id and call_id=q.call_id and evidence_hash=p_hash and state='running' and lease_until>now() and id<>q.id) then return 'evidence_busy'; end if;
 if not public.care_auto_review_reserve_ai(p_id,p_lease) then return 'budget_or_lease'; end if;
 update public.receptionist_auto_review_queue set evidence_hash=p_hash where id=q.id;
 return 'reserved';
end $$;

-- Save the assessment, care task attachment and queue receipt atomically. The
-- worker can reuse equivalent prior evidence without spending on AI again.
-- Only new call/category issues get a Slack alert; repeated feedback is not spam.
create function public.care_auto_store_review(p_queue uuid,p_lease uuid,p_hash text,p_assessment jsonb,p_model text,p_rules_version integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare q public.receptionist_auto_review_queue; old_ids uuid[]; categories jsonb; v_assessment jsonb; issue uuid; current_hash text;
begin
 select * into q from public.receptionist_auto_review_queue where id=p_queue for update;
 if not found or q.state<>'running' or q.lease_id is distinct from p_lease or q.lease_until<=now() then raise exception 'Active review lease required'; end if;
 if p_model is null or length(p_model)>100 or p_rules_version is null then raise exception 'Review provenance required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('emma-review-save:'||q.tenant_id||':'||q.call_id,0));
 select coalesce(array_agg(id),'{}'::uuid[]) into old_ids from public.receptionist_care_issues where tenant_id=q.tenant_id and source_key like 'call:'||q.call_id||':%';
 v_assessment:=p_assessment||jsonb_build_object('feedbackRevisionHash',q.feedback_revision_hash,'reviewerVersion',q.reviewer_version,'rulesVersion',p_rules_version,'source',case when q.feedback_id is null then 'scheduled_call_review' else 'scheduled_feedback_review' end);
 perform public.care_store_review(q.tenant_id,q.call_id,p_hash,q.reviewer_version,v_assessment);
 select coalesce(jsonb_agg(distinct split_part(source_key,':',3)),'[]'::jsonb) into categories
 from public.receptionist_care_issues where tenant_id=q.tenant_id and source_key like 'call:'||q.call_id||':%' and not(id=any(old_ids));
 update public.receptionist_call_reviews set assessment=v_assessment||jsonb_build_object('alertCategories',categories)
 where tenant_id=q.tenant_id and call_id=q.call_id and evidence_hash=p_hash and reviewer_version=q.reviewer_version;
 if q.feedback_id is not null then
  select id into issue from public.receptionist_care_issues where tenant_id=q.tenant_id and feedback_id=q.feedback_id;
  if issue is null then raise exception 'Original feedback task unavailable'; end if;
  -- Attach only the latest semantic feedback revision. Old immutable revisions
  -- remain in call review history but must not replace the latest task advice.
  select encode(extensions.digest(convert_to(jsonb_build_object('title',f.title,'body',f.body,'priority',f.priority,'category',f.category,'callId',q.call_id,'practiceSessionId',f.practice_session_id)::text,'UTF8'),'sha256'),'hex') into current_hash
  from public.receptionist_feedback f where f.id=q.feedback_id and f.tenant_id=q.tenant_id;
  if current_hash=q.feedback_revision_hash then
   insert into public.receptionist_task_reviews(tenant_id,issue_id,actor_id,state,assessment,evidence_hash,call_id,model,finished_at,automation_queue_id)
   values(q.tenant_id,issue,null,'completed',v_assessment,p_hash,q.call_id,p_model,now(),q.id)
   on conflict(automation_queue_id) do nothing;
  end if;
 end if;
 update public.receptionist_auto_review_queue set state='reviewed',evidence_hash=p_hash,rules_version=p_rules_version,model=p_model,safe_error=null,
 lease_id=null,lease_until=null,updated_at=now(),slack_state=case when jsonb_array_length(categories)>0 then 'pending' else 'not_required' end where id=q.id;
 return true;
end $$;
create function public.care_auto_review_counts(p_tenant uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'pending',count(*) filter(where state in ('pending','running','awaiting_evidence')),
  'needsReview',count(*) filter(where state='needs_review'),
  'alertsNeedReview',count(*) filter(where slack_state in ('needs_review','sending')),
  'liveReviewed',count(distinct call_id) filter(where state='reviewed' and call_kind='live'),
  'practiceReviewed',count(distinct call_id) filter(where state='reviewed' and call_kind='practice'),
  'feedbackRevisionsReviewed',count(*) filter(where state='reviewed' and feedback_id is not null)
 ) from public.receptionist_auto_review_queue where tenant_id=p_tenant;
$$;
revoke all on function public.care_auto_enqueue_feedback(uuid),public.care_auto_feedback_changed(),public.care_auto_practice_linked(),public.care_auto_review_reserve_evidence(uuid,uuid,text),public.care_auto_store_review(uuid,uuid,text,jsonb,text,integer),public.care_auto_review_counts(uuid) from public,anon,authenticated;
grant execute on function public.care_auto_enqueue_feedback(uuid),public.care_auto_review_reserve_evidence(uuid,uuid,text),public.care_auto_store_review(uuid,uuid,text,jsonb,text,integer),public.care_auto_review_counts(uuid) to service_role;
commit;
