-- Retained Slack conversations can be reviewed as company/job context without
-- inventing a customer identity or communication direction. No automatic linking.
begin;
create table public.learn_slack_context_reviews(
 request_id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),
 interaction_id uuid not null references public.interactions(id),
 definition jsonb not null,
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_slack_context_reviews enable row level security;
revoke all on public.learn_slack_context_reviews from public,anon,authenticated,service_role;
create trigger learn_slack_context_reviews_immutable before update or delete on public.learn_slack_context_reviews
 for each row execute function public.slack_version_immutable();

create function public.learn_slack_context_state(p_tenant uuid,p_interaction uuid,p_job uuid default null)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare i public.interactions%rowtype;s public.slack_messages%rowtype;j public.jobs%rowtype;revision text;
begin
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction;
 if not found or i.source_table is distinct from 'slack_messages' or i.source_connector_id is distinct from 'slack' or i.interaction_type is distinct from 'slack_message'
 then raise exception 'slack_context_unavailable' using errcode='42501';end if;
 select * into s from public.slack_messages where tenant_id=p_tenant and id=i.source_id;
 if not found or i.metadata->>'source_version' is distinct from s.source_version or s.message_text is null
 then raise exception 'slack_context_source_changed' using errcode='PT409';end if;
 if p_job is not null then
  select * into j from public.jobs where tenant_id=p_tenant and id=p_job;
  if not found then raise exception 'slack_context_job_unavailable' using errcode='42501';end if;
 end if;
 revision:=encode(sha256(convert_to(jsonb_build_object('interaction',i.id,'source',s.id,'version',s.source_version,
  'status',i.processing_status,'person',i.related_person_id,'company',i.related_company_id,'job',i.related_job_id,
  'context',i.metadata->'work_context','candidateJob',to_jsonb(j))::text,'UTF8')),'hex');
 return jsonb_build_object('version','learn-slack-context-state/1','tenant_id',p_tenant,'interaction_id',i.id,
  'revision',revision,'source_version',s.source_version,'channel_id',s.channel_id,'thread_timestamp',s.thread_timestamp,
  'current_job_id',i.related_job_id,'context',i.metadata->'work_context',
  'job',case when j.id is null then null else jsonb_build_object('id',j.id,'title',left(j.title,500),'job_number',j.job_number,'status',j.status)end);
end$$;
revoke all on function public.learn_slack_context_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_operator_slack_context(p_tenant uuid,p_interaction uuid,p_job uuid,p_reason text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();r jsonb;a uuid:=gen_random_uuid();begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'slack_context_reason_invalid' using errcode='22023';end if;
 r:=public.learn_slack_context_state(p_tenant,p_interaction,p_job);
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(a,p_tenant,actor::text,'slack_context.read','interaction',p_interaction::text,jsonb_build_object('job_id',p_job),btrim(p_reason),a::text,false,'learn-slack-context');
 return r||jsonb_build_object('actor_id',actor,'audit_id',a,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_operator_slack_context(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_operator_slack_context(uuid,uuid,uuid,text) to authenticated;

create function public.learn_operator_slack_context_review(p_tenant uuid,p_actor uuid,p_request uuid,p_interaction uuid,p_definition jsonb,p_mode text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare saved public.learn_slack_context_reviews%rowtype;i public.interactions%rowtype;j uuid;r jsonb;receipt jsonb;ctx jsonb;events integer;begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_interaction is null or p_mode is null or p_mode not in('apply','check','cancel') or jsonb_typeof(p_definition) is distinct from 'object'
  or not(p_definition?&array['revision','job_id','reason']) or (select count(*) from jsonb_object_keys(p_definition))<>3
  or coalesce(p_definition->>'revision','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_definition->'reason') is distinct from 'string'
  or length(btrim(p_definition->>'reason')) not between 3 and 500 or jsonb_typeof(p_definition->'job_id') not in('string','null')
 then raise exception 'slack_context_request_invalid' using errcode='22023';end if;
 j:=(p_definition->>'job_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('slack-context-request:'||p_request::text,0));
 select * into saved from public.learn_slack_context_reviews where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.actor_id<>p_actor or saved.interaction_id<>p_interaction or saved.definition<>p_definition
  then raise exception 'slack_context_request_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 receipt:=jsonb_build_object('version','learn-slack-context-review/1','state','pending','tenant_id',p_tenant,'actor_id',p_actor,
  'request_id',p_request,'interaction_id',p_interaction,'definition',p_definition);
 if p_mode='check' then return receipt;end if;
 if p_mode='cancel' then
  perform 1 from public.interactions where tenant_id=p_tenant and id=p_interaction and source_table='slack_messages';
  if not found then raise exception 'slack_context_unavailable' using errcode='42501';end if;
  receipt:=receipt||jsonb_build_object('state','cancelled');
  insert into public.learn_slack_context_reviews values(p_request,p_tenant,p_actor,p_interaction,p_definition,receipt,clock_timestamp());
  insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
  values(p_tenant,p_actor::text,'slack_context.cancel','interaction',p_interaction::text,jsonb_build_object('request_id',p_request),btrim(p_definition->>'reason'),p_request::text,false,'learn-slack-context');
  return receipt;
 end if;
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction for update;
 if not found then raise exception 'slack_context_unavailable' using errcode='42501';end if;
 perform 1 from public.slack_messages where tenant_id=p_tenant and id=i.source_id for share;
 if j is not null then perform 1 from public.jobs where tenant_id=p_tenant and id=j for share;end if;
 r:=public.learn_slack_context_state(p_tenant,p_interaction,j);
 if r->>'revision' is distinct from p_definition->>'revision' then raise exception 'slack_context_review_changed' using errcode='PT409';end if;
 ctx:=jsonb_build_object('version','learn-slack-work-context/1','request_id',p_request,'source_version',r->>'source_version',
  'scope',case when j is null then 'company' else 'job' end,'job_id',j,'reviewed_by',p_actor,'reviewed_at',clock_timestamp(),'state','reviewed');
 update public.interactions set related_job_id=j,processing_status='enriched',metadata=metadata||jsonb_build_object('work_context',ctx)
  where tenant_id=p_tenant and id=p_interaction;
 update public.platform_events set status='consumed',consumed_at=clock_timestamp(),metadata=metadata||jsonb_build_object('work_context_request',p_request)
  where tenant_id=p_tenant and subject_id=p_interaction and subject_type='interaction' and event_type='interaction.ready' and status='pending';
 get diagnostics events=row_count;
 receipt:=jsonb_build_object('version','learn-slack-context-review/1','state','committed','tenant_id',p_tenant,'actor_id',p_actor,
  'request_id',p_request,'interaction_id',p_interaction,'definition',p_definition,'context',ctx,'events_consumed',events,
  'previous',jsonb_build_object('job_id',i.related_job_id,'processing_status',i.processing_status,'context',i.metadata->'work_context'));
 insert into public.learn_slack_context_reviews values(p_request,p_tenant,p_actor,p_interaction,p_definition,receipt,clock_timestamp());
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,before,after,reason,correlation_id,view_as_active,source)
 values(p_tenant,p_actor::text,'slack_context.review','interaction',p_interaction::text,receipt->'previous',ctx,btrim(p_definition->>'reason'),p_request::text,false,'learn-slack-context');
 return receipt;
end$$;
revoke all on function public.learn_operator_slack_context_review(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.learn_operator_slack_context_review(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

-- An edited provider message must be reviewed again; retain every prior decision.
create function public.learn_slack_context_source_changed() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if old.source_table='slack_messages' and old.metadata->'work_context'->>'version'='learn-slack-work-context/1'
  and new.metadata->>'source_version' is distinct from old.metadata->>'source_version' then
  if new.related_job_id is not distinct from (old.metadata->'work_context'->>'job_id')::uuid then new.related_job_id:=null;end if;
  new.processing_status:='pending';
  new.metadata:=new.metadata||jsonb_build_object('work_context',(old.metadata->'work_context')||jsonb_build_object('state','source_changed'));
 end if;
 return new;
end$$;
revoke all on function public.learn_slack_context_source_changed() from public,anon,authenticated,service_role;
create trigger learn_slack_context_source_changed before update on public.interactions
 for each row execute function public.learn_slack_context_source_changed();
commit;
