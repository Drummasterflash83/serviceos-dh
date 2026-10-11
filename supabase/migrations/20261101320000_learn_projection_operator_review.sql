-- Audited operator reconciliation of retained-source projection holds.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_projection_operator_reviews(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),actor_id uuid not null references public.profiles(id),
 hold_id uuid not null references public.learn_interaction_projection_receipts(request_id),
 definition jsonb not null,receipt jsonb not null,previous_interaction jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_projection_operator_reviews enable row level security;
revoke all on public.learn_projection_operator_reviews from public,anon,authenticated,service_role;
create trigger learn_projection_operator_reviews_immutable before update or delete on public.learn_projection_operator_reviews
 for each row execute function public.learn_operator_input_immutable();

-- Only whitelisted canonical fields are returned, never raw provider metadata.
-- The full previous canonical row is retained privately when an action commits.
create function public.learn_projection_review_state(p_tenant uuid,p_hold uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare h public.learn_interaction_projection_receipts%rowtype;i public.interactions%rowtype;
 c public.phone_calls%rowtype;m public.email_messages%rowtype;fields jsonb;canonical jsonb;
 version text;revision text;reason text;allowed boolean;oversize boolean;fresh boolean;
begin
 select * into h from public.learn_interaction_projection_receipts where tenant_id=p_tenant and request_id=p_hold and receipt->>'state'='review_required';
 if not found then raise exception 'projection_review_unavailable' using errcode='42501';end if;
 if h.source_kind='phone' then
  select * into c from public.phone_calls where tenant_id=p_tenant and id=h.source_id;
  if not found then raise exception 'projection_review_source_unavailable' using errcode='PT409';end if;
  fields:=public.learn_phone_source_fields(c);version:=null;
 else
  select * into m from public.email_messages where tenant_id=p_tenant and id=h.source_id;
  if not found then raise exception 'projection_review_source_unavailable' using errcode='PT409';end if;
  fields:=public.learn_email_source_fields(m);version:=coalesce(to_jsonb(m)->>'origin_campaign_id','');
 end if;
 select * into i from public.interactions where tenant_id=p_tenant and source_table=case h.source_kind when 'phone' then 'phone_calls' else 'email_messages' end and source_id=h.source_id;
 select jsonb_object_agg(k,to_jsonb(i)->k) into canonical from jsonb_object_keys(fields) k;
 fresh:=h.source_revision=public.learn_projection_revision(fields,version);
 reason:=case when i.metadata?'phone_handoff' then 'authoritative_phone_owner'
  when not fresh then 'source_changed' when i.id is null then 'canonical_missing'
  when i.source_type is distinct from fields->>'source_type' or i.interaction_type is distinct from fields->>'interaction_type' then 'canonical_shape_unverified'
  -- Campaign publication may change a Marketing link not present in this
  -- communication comparison. Require its governed review instead.
  when h.source_kind='email' and version<>'' then 'campaign_review_required'
  when exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind=h.source_kind and r.source_id=h.source_id and (r.created_at,r.request_id)>(h.created_at,h.request_id)) then 'newer_processing_exists'
  else h.receipt->>'reason' end;
 oversize:=octet_length(jsonb_build_object('source',fields,'canonical',canonical)::text)>20000;
 allowed:=public.learn_capture_allowed(p_tenant,h.source_kind);
 revision:=encode(sha256(convert_to(jsonb_build_object('hold',p_hold,'source',fields,'version',version,'canonical',to_jsonb(i))::text,'UTF8')),'hex');
 return jsonb_build_object('version','learn-projection-review-detail/1','tenant_id',p_tenant,'hold_id',p_hold,'source_kind',h.source_kind,'source_id',h.source_id,'interaction_id',i.id,
  'revision',revision,'source_revision',public.learn_projection_revision(fields,version),'reason',reason,'capture_allowed',allowed,'can_apply',allowed and not oversize and reason in('legacy_projection_review','canonical_fields_changed'),
  'evidence_too_large',oversize,'source_fields',case when oversize then null else fields end,'canonical_fields',case when oversize then null else canonical end,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_projection_review_state(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_operator_projection_reviews(p_tenant uuid,p_after uuid default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare h record;detail jsonb;rows jsonb:='[]';last_id uuid;more boolean:=false;n integer:=0;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 for h in with latest as (
  select distinct on(r.source_kind,r.source_id) r.* from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant
  order by r.source_kind,r.source_id,r.created_at desc,r.request_id desc
 ) select * from latest where receipt->>'state'='review_required' and (p_after is null or request_id>p_after) order by request_id limit 21 loop
  n:=n+1;if n>20 then more:=true;exit;end if;
  last_id:=h.request_id;
  rows:=rows||jsonb_build_array(jsonb_build_object('hold_id',h.request_id,'source_kind',h.source_kind,'source_id',h.source_id,'reason',h.receipt->>'reason','recorded_at',h.created_at));
 end loop;
 return jsonb_build_object('version','learn-projection-reviews/1','tenant_id',p_tenant,'rows',rows,'next_cursor',case when more then last_id else null end,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_operator_projection_reviews(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_projection_reviews(uuid,uuid) to authenticated;
create function public.learn_operator_projection_review_detail(p_tenant uuid,p_hold uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 return public.learn_projection_review_state(p_tenant,p_hold);
end$$;
revoke all on function public.learn_operator_projection_review_detail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_projection_review_detail(uuid,uuid) to authenticated;

create function public.learn_operator_projection_review(p_tenant uuid,p_actor uuid,p_request uuid,p_hold uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare saved public.learn_projection_operator_reviews%rowtype;h public.learn_interaction_projection_receipts%rowtype;
 i public.interactions%rowtype;detail jsonb;answer jsonb;published jsonb;previous jsonb;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_hold is null or p_mode is null or p_mode not in('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>4000
  or not p_definition?&array['action','revision','reason'] or p_definition-array['action','revision','reason']<>'{}'::jsonb
  or p_definition->>'action' is distinct from 'apply_source' or coalesce(p_definition->>'revision','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
 then raise exception 'projection_review_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-projection-review:'||p_request::text,0));
 select * into saved from public.learn_projection_operator_reviews where id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.actor_id<>p_actor or saved.hold_id<>p_hold or saved.definition<>p_definition then raise exception 'projection_review_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 select * into h from public.learn_interaction_projection_receipts where tenant_id=p_tenant and request_id=p_hold and receipt->>'state'='review_required';
 if not found then raise exception 'projection_review_unavailable' using errcode='42501';end if;
 answer:=jsonb_build_object('version','learn-projection-review-receipt/1','tenant_id',p_tenant,'request_id',p_request,'hold_id',p_hold);
 if p_mode='check' then return answer||jsonb_build_object('state','pending');end if;
 if p_mode='cancel' then answer:=answer||jsonb_build_object('state','cancelled');
 else
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
  perform pg_advisory_xact_lock(hashtextextended('learn-project:'||p_tenant::text||':'||h.source_kind||':'||h.source_id::text,0));
  -- Match the publisher's source -> canonical -> event lock order.
  if h.source_kind='phone' then perform 1 from public.phone_calls where tenant_id=p_tenant and id=h.source_id for update;
  else perform 1 from public.email_messages where tenant_id=p_tenant and id=h.source_id for update;end if;
  select * into i from public.interactions where tenant_id=p_tenant and source_table=case h.source_kind when 'phone' then 'phone_calls' else 'email_messages' end and source_id=h.source_id for update;
  detail:=public.learn_projection_review_state(p_tenant,p_hold);
  if detail->>'revision' is distinct from p_definition->>'revision' then raise exception 'projection_review_changed' using errcode='PT409';end if;
  if detail->'can_apply' is distinct from 'true'::jsonb then raise exception 'projection_review_not_applicable' using errcode='PT409';end if;
  previous:=to_jsonb(i);
  -- Explicit human consent to use the displayed retained source values. Stamp
  -- current canonical ownership only inside this transaction, then let the
  -- authoritative projector validate and publish its actual source fields.
  update public.interactions set metadata=metadata||jsonb_build_object('source_projection',jsonb_build_object('version','learn-interaction-projection/1','revision',repeat('0',64),'fields',detail->'canonical_fields','operatorReviewId',p_request))
   where tenant_id=p_tenant and id=i.id;
  published:=public.learn_project_interaction(p_tenant,p_request,h.source_kind,h.source_id,detail->>'source_revision','publish');
  if published->>'state' is distinct from 'committed' or published->>'action' is distinct from 'updated' or published->>'interactionId' is distinct from i.id::text
  then raise exception 'projection_review_publication_unconfirmed' using errcode='PT409';end if;
  update public.interactions set metadata=metadata||jsonb_build_object('projection_review',jsonb_build_object('requestId',p_request,'actorId',p_actor,'holdId',p_hold)) where tenant_id=p_tenant and id=i.id;
  answer:=answer||jsonb_build_object('state','recorded','interaction_id',i.id,'event_id',published->'eventId','card_processing','pending');
 end if;
 insert into public.learn_projection_operator_reviews(id,tenant_id,actor_id,hold_id,definition,receipt,previous_interaction)
  values(p_request,p_tenant,p_actor,p_hold,p_definition,answer,previous);
 return answer;
end$$;
revoke all on function public.learn_operator_projection_review(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_projection_review(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;
commit;
