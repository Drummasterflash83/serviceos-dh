-- Operator resolution of held customer attribution. All publication and audit
-- changes commit together; no new grants, provider calls or source rewrites.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_identity_operator_reviews(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),actor_id uuid not null references public.profiles(id),
 interaction_id uuid not null references public.interactions(id),definition jsonb not null,receipt jsonb not null,
 previous_interaction jsonb,reviewed_person jsonb,reviewed_company jsonb,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_identity_operator_reviews enable row level security;
revoke all on public.learn_identity_operator_reviews from public,anon,authenticated,service_role;
create trigger learn_identity_operator_reviews_immutable before update or delete on public.learn_identity_operator_reviews
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_identity_deliver_internal(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text,p_reviewed_person uuid)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
<<delivery>>
declare
 i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;card public.customer_cards%rowtype;
 saved public.learn_identity_delivery_receipts%rowtype;event public.platform_events%rowtype;
 email text;phone text;contact_name text;domain text;person_id uuid;company_id uuid;email_id uuid;phone_id uuid;
 matches integer;created_person boolean:=false;created_company boolean:=false;new_card boolean:=false;
 reason text;confidence numeric:=0;evidence jsonb:='[]';company_evidence jsonb:='[]';person_level text:='possible';
 answer jsonb;suggestions integer:=0;recs integer:=0;consumed integer:=0;affected integer:=0;
 interaction_count integer;today_count integer;open_rec_score integer;priority_score integer;priority_bucket text;
 start_today timestamptz:=date_trunc('day',statement_timestamp());activity timestamptz;has_phone_receipt boolean;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'identity_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_request is null or p_interaction is null or coalesce(p_revision,'') !~ '^[a-f0-9]{64}$'
 or p_phase is null or p_phase not in('publish','inspect') then raise exception 'identity_request_invalid' using errcode='22023';end if;
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'identity_receipt_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 -- Serialise this engine's provisional identity creation within the tenant.
 perform pg_advisory_xact_lock(hashtextextended('learn-identity:'||p_tenant::text,0));
 select * into saved from public.learn_identity_delivery_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.interaction_id<>p_interaction or saved.source_revision<>p_revision then raise exception 'identity_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'identity_tenant_inactive' using errcode='PT409';end if;
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction for update;
 if not found or public.learn_identity_revision(i)<>p_revision or i.processing_status not in('pending','ready','identity_review')
 then raise exception 'identity_source_changed' using errcode='PT409';end if;
 select * into event from public.platform_events where tenant_id=p_tenant and event_type='interaction.ready' and subject_type='interaction'
 and subject_id=i.id and status='pending' for update;
 has_phone_receipt:=i.metadata->'phone_handoff'->>'version'='learn-phone-handoff/1';
 if coalesce(has_phone_receipt,false) and (event.id is null or event.payload->>'source_fingerprint' is distinct from i.metadata->'phone_handoff'->>'sourceFingerprint')
 then raise exception 'identity_event_changed' using errcode='PT409';end if;
 if i.direction='internal' then reason:='internal_interaction';
 elsif i.direction not in('inbound','outbound') or i.direction is null then reason:='direction_unverified';end if;
 email:=nullif(lower(btrim(case when i.direction='outbound' then i.to_addresses[1] else i.from_address end)),'');
 phone:=nullif(btrim(case when i.direction='outbound' then i.phone_to else i.phone_from end),'');
 contact_name:=case when i.direction='inbound' then nullif(btrim(i.from_name),'') else null end;
 -- Treat provider text as data. No dynamic filters or SQL are built from identifiers.
 if email is not null and email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then reason:=coalesce(reason,'email_unverified');end if;
 if phone is not null and phone !~ '^\+?[0-9][0-9 ()-]{4,30}$' then reason:=coalesce(reason,'phone_unverified');end if;
 if email is null and phone is null then reason:=coalesce(reason,'contact_missing');end if;
 if reason is null and p_reviewed_person is not null then
  select * into p from public.people where tenant_id=p_tenant and id=p_reviewed_person for update;
  if not found then raise exception 'identity_review_person_unavailable' using errcode='PT409';end if;
  person_id:=p.id;company_id:=p.company_id;
  contact_name:=coalesce(p.display_name,p.primary_email,p.primary_phone);
  if company_id is not null then
   select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
   if not found then raise exception 'identity_review_company_unavailable' using errcode='PT409';end if;
  end if;
  confidence:=1;person_level:='confirmed';
  evidence:=jsonb_build_array(jsonb_build_object('source','operator_attribution','detail','An authorised operator attributed this communication to the selected contact; this does not verify the contact globally','requestId',p_request,'weight',1));
 else
 if reason is null and email is not null then
  select count(*),min(x.id::text)::uuid into matches,email_id from public.people x where x.tenant_id=p_tenant and lower(btrim(x.primary_email))=email;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and phone is not null then
  select count(*),min(x.id::text)::uuid into matches,phone_id from public.people x where x.tenant_id=p_tenant and btrim(x.primary_phone)=phone;
  if matches>1 then reason:='person_ambiguous';end if;
 end if;
 if reason is null and email_id is not null and phone_id is not null and email_id<>phone_id then reason:='person_conflict';end if;
 if reason is null then
  person_id:=coalesce(email_id,phone_id);
  if i.related_person_id is not null then
   perform 1 from public.people where tenant_id=p_tenant and id=i.related_person_id;
   if not found then reason:='person_link_invalid';
   elsif person_id is not null and person_id<>i.related_person_id then reason:='person_link_conflict';
   else person_id:=i.related_person_id;end if;
  end if;
 end if;
 if reason is null and person_id is not null then
  select * into p from public.people where tenant_id=p_tenant and id=person_id for update;
  if not found then raise exception 'identity_source_changed' using errcode='PT409';end if;
  confidence:=case when email_id=person_id then 0.95 when phone_id=person_id then 0.92 else 0 end;
  person_level:=case when confidence>=0.9 then 'confirmed' else 'possible' end;
  evidence:=jsonb_build_array(jsonb_build_object('source',case when email_id=person_id then 'email' when phone_id=person_id then 'phone' else 'existing_interaction_link' end,
   'detail',case when confidence>=0.9 then 'Unique exact contact match within this tenant' else 'Preserved existing interaction attribution; contact match unverified' end,'weight',confidence));
  company_id:=coalesce(i.related_company_id,p.company_id);
  if i.related_company_id is not null and p.company_id is not null and i.related_company_id<>p.company_id then reason:='company_link_conflict';end if;
 else company_id:=i.related_company_id;end if;
 if reason is null and company_id is not null then
  select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
  if not found then reason:='company_link_invalid';end if;
 end if;
 if reason is null and company_id is null and email is not null then
  domain:=split_part(email,'@',2);
  if domain<>all(array['gmail.com','googlemail.com','outlook.com','hotmail.com','hotmail.co.uk','live.com','yahoo.com','yahoo.co.uk','icloud.com','me.com','aol.com','btinternet.com','sky.com','msn.com','protonmail.com','gmx.com']) then
   select count(*),min(x.id::text)::uuid into matches,company_id from public.companies x where x.tenant_id=p_tenant and lower(btrim(x.domain))=domain;
   if matches>1 then reason:='company_ambiguous';
   elsif company_id is not null then
    select * into c from public.companies where tenant_id=p_tenant and id=company_id for share;
    company_evidence:=jsonb_build_array(jsonb_build_object('source','email_domain','detail','Unique company domain match; provisional attribution','weight',0.85));
   end if;
  else domain:=null;end if;
 end if;
 if reason is null and exists(select 1 from public.interaction_match_suggestions s where s.tenant_id=p_tenant and s.interaction_id=i.id and s.status='rejected' and ((s.target_type='person' and s.target_id=person_id) or (s.target_type='company' and s.target_id=company_id))) then reason:='reviewed_match_rejected';end if;
 end if;
 -- Never consume a signal or invent a card when its external identity needs review.
 if reason is not null then
  update public.interactions set processing_status='identity_review',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','review_required','reason',reason,'requestId',p_request)) where id=i.id and tenant_id=p_tenant;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','review_required','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'reason',reason,'cardId',null,'personCreated',false,'companyCreated',false,'cardEnriched',false,'recommendations',0,'suggestions',0,'eventsConsumed',0);
 else
  if company_id is null and domain is not null then
   insert into public.companies(tenant_id,name,domain,verified,created_source) values(p_tenant,domain,domain,false,'interaction') returning id into company_id;
   created_company:=true;
  end if;
  if person_id is null then
   insert into public.people(tenant_id,primary_email,primary_phone,display_name,company_id,verified,created_source,metadata)
    values(p_tenant,email,phone,contact_name,company_id,false,'interaction',jsonb_build_object('origin_interaction',i.id)) returning * into p;
   person_id:=p.id;created_person:=true;confidence:=0;
   evidence:=jsonb_build_array(jsonb_build_object('source','interaction','detail','Provisional contact created from source identifier; identity review required','weight',0));
  end if;
  -- Preserve reviewed suggestions instead of resetting accepted/rejected decisions.
  if not created_person then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,recommended_action,status,created_by)
    values(p_tenant,i.id,'person',person_id,person_level,confidence,evidence,'Contact evidence retained with the interaction','Review contact attribution','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set confidence=excluded.confidence,evidence=excluded.evidence,explanation=excluded.explanation where s.status='pending';
   get diagnostics suggestions=row_count;
  end if;
  if company_id is not null and company_evidence<>'[]'::jsonb then
   insert into public.interaction_match_suggestions as s(tenant_id,interaction_id,target_type,target_id,match_level,confidence,evidence,explanation,status,created_by)
    values(p_tenant,i.id,'company',company_id,'likely',0.85,company_evidence,'Provisional attribution from company domain','pending','system')
    on conflict(tenant_id,interaction_id,target_type,target_id) do update set evidence=excluded.evidence where s.status='pending';
   get diagnostics affected=row_count;suggestions:=suggestions+affected;
  end if;
  -- Link inside this transaction so aggregate counts include this interaction.
  update public.interactions set related_person_id=person_id,related_company_id=company_id where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  select count(*),count(*) filter(where occurred_at>=start_today and occurred_at<start_today+interval '1 day') into interaction_count,today_count
   from public.interactions where tenant_id=p_tenant and related_person_id=person_id;
  select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;
  if not found then
   insert into public.customer_cards(tenant_id,person_id,company_id,title,summary,latest_activity_at,confidence)
    values(p_tenant,person_id,company_id,coalesce(contact_name,p.display_name,email,phone),coalesce(i.summary,i.body_preview),i.occurred_at,confidence)
    on conflict(tenant_id,person_id) where person_id is not null do nothing returning * into card;
   new_card:=found;
   if not new_card then select * into card from public.customer_cards x where x.tenant_id=p_tenant and x.person_id=delivery.person_id for update;end if;
  end if;
  if card.id is null then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if today_count>=2 then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'repeat_contact_today','Repeated contact today','Multiple interactions recorded during the current UTC day; review response needs.','high','open',card.id,i.id,person_id,company_id,
     jsonb_build_array(jsonb_build_object('source','interactions','count',today_count,'periodStart',start_today,'timezone','UTC')),'Review and respond','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  if created_person then
   insert into public.recommendations(tenant_id,type,title,detail,severity,status,card_id,interaction_id,person_id,company_id,evidence,recommended_action,created_by)
    values(p_tenant,'review_new_contact','New contact — confirm identity','Provisional contact from a source interaction; confirm or link it.','info','open',card.id,i.id,person_id,company_id,evidence,'Review and confirm the contact','system')
    on conflict(tenant_id,card_id,type) where status='open' and card_id is not null do nothing;
   get diagnostics affected=row_count;recs:=recs+affected;
  end if;
  select coalesce(sum(case severity when 'critical' then 30 when 'high' then 20 when 'medium' then 10 when 'low' then 5 else 2 end),0) into open_rec_score
   from public.recommendations where tenant_id=p_tenant and card_id=card.id and status='open';
  priority_score:=least(100,20+least(30,interaction_count*5)+open_rec_score+case when i.sentiment='negative' then 20 else 0 end+case when today_count>=2 then 15 else 0 end);
  priority_bucket:=case when priority_score>=75 then 'critical' when priority_score>=50 then 'high' when priority_score>=25 then 'medium' else 'low' end;
  activity:=greatest(card.latest_activity_at,i.occurred_at);
  -- Read locks and manual values at commit time, not from a stale client snapshot.
  update public.customer_cards x set
   company_id=case when 'company_id'=any(card.locked_fields) then x.company_id else delivery.company_id end,
   title=case when 'title'=any(card.locked_fields) then x.title else coalesce(contact_name,p.display_name,email,phone,x.title) end,
   summary=case when 'summary'=any(card.locked_fields) or card.latest_activity_at>i.occurred_at then x.summary else coalesce(i.summary,i.body_preview,x.summary) end,
   latest_activity_at=case when 'latest_activity_at'=any(card.locked_fields) then x.latest_activity_at else activity end,
   confidence=case when 'confidence'=any(card.locked_fields) then x.confidence else delivery.confidence end,
   priority=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority else priority_bucket end,
   priority_score=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_score else delivery.priority_score end,
   priority_inputs=case when card.locked_fields&&array['priority','priority_score','priority_inputs'] then x.priority_inputs else jsonb_build_object('version','identity-priority/2','interaction_count',interaction_count,'open_rec_score',open_rec_score,'negative_sentiment',i.sentiment='negative','repeat_today',today_count>=2,'periodStart',start_today,'timezone','UTC','sourceInteractionId',i.id,'sourceRevision',p_revision) end
   where x.tenant_id=p_tenant and x.id=card.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_card_unconfirmed' using errcode='PT409';end if;
  if event.id is not null then
   update public.platform_events set status='consumed',consumed_at=clock_timestamp(),metadata=metadata||jsonb_build_object('identity_delivery_request',p_request,'identity_source_revision',p_revision)
    where tenant_id=p_tenant and id=event.id and status='pending';
   get diagnostics consumed=row_count;if consumed<>1 then raise exception 'identity_event_changed' using errcode='PT409';end if;
  end if;
  update public.interactions set processing_status='enriched',metadata=metadata||jsonb_build_object('identity_delivery',jsonb_build_object('state','committed','requestId',p_request,'sourceRevision',p_revision,'cardId',card.id)) where tenant_id=p_tenant and id=i.id;
  get diagnostics affected=row_count;if affected<>1 then raise exception 'identity_source_changed' using errcode='PT409';end if;
  answer:=jsonb_build_object('version','learn-identity-delivery/1','state','committed','tenantId',p_tenant,'requestId',p_request,'interactionId',i.id,'sourceRevision',p_revision,'cardId',card.id,'personCreated',created_person,'companyCreated',created_company,'cardEnriched',true,'recommendations',recs,'suggestions',suggestions,'eventsConsumed',consumed);
 end if;
 insert into public.learn_identity_delivery_receipts(request_id,tenant_id,interaction_id,source_revision,receipt) values(p_request,p_tenant,i.id,p_revision,answer);
 return answer;
end$$;

revoke all on function public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
-- Preserve the service API and its automatic matching behaviour. Only the
-- governed operator RPC may provide a reviewed person to the private engine.
create or replace function public.learn_identity_deliver(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text)
 returns jsonb language sql security definer set search_path=pg_catalog set timezone='UTC' as $$
 select public.learn_identity_deliver_internal(p_tenant,p_request,p_interaction,p_revision,p_phase,null)
$$;

create function public.learn_identity_review_state(p_tenant uuid,p_interaction uuid,p_person uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;reason text;revision text;rejected jsonb;source jsonb;
begin
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction;
 if not found then raise exception 'identity_review_unavailable' using errcode='42501';end if;
 select * into p from public.people where tenant_id=p_tenant and id=p_person;
 if not found then raise exception 'identity_review_person_unavailable' using errcode='42501';end if;
 if p.company_id is not null then select * into c from public.companies where tenant_id=p_tenant and id=p.company_id;end if;
 select coalesce(jsonb_agg(jsonb_build_object('target_type',s.target_type,'target_id',s.target_id,'status',s.status,'explanation',left(s.explanation,1000)) order by s.target_type,s.target_id),'[]') into rejected
 from public.interaction_match_suggestions s where s.tenant_id=p_tenant and s.interaction_id=i.id and s.status='rejected' and ((s.target_type='person' and s.target_id=p.id) or(s.target_type='company' and s.target_id=c.id));
 reason:=case when i.processing_status<>'identity_review' or i.metadata->'identity_delivery'->>'state' is distinct from 'review_required' then 'hold_changed'
  when i.direction not in('inbound','outbound') or i.direction is null then 'direction_needs_source_review'
  when p.company_id is not null and c.id is null then 'company_link_invalid'
  when exists(select 1 from public.learn_identity_delivery_receipts r where r.tenant_id=p_tenant and r.interaction_id=i.id and r.receipt->>'state'='committed') then 'previous_delivery_needs_reconciliation'
  when i.related_person_id is not null and i.related_person_id<>p.id and exists(select 1 from public.customer_cards k where k.tenant_id=p_tenant and k.person_id=i.related_person_id) then 'previous_card_needs_reconciliation'
  when coalesce(i.metadata->'identity_delivery'->>'reason','') not in('person_ambiguous','person_conflict','person_link_invalid','person_link_conflict','company_link_conflict','company_link_invalid','company_ambiguous','reviewed_match_rejected') then 'source_needs_review'
  else null end;
 source:=jsonb_build_object('source_type',i.source_type,'direction',i.direction,'occurred_at',i.occurred_at,'subject',left(i.subject,1000),'preview',left(coalesce(i.summary,i.body_preview),2000),'from_address',left(i.from_address,500),'to_address',left(i.to_addresses[1],500),'phone_from',left(i.phone_from,100),'phone_to',left(i.phone_to,100),'related_person_id',i.related_person_id,'related_company_id',i.related_company_id);
 revision:=encode(sha256(convert_to(jsonb_build_object('interaction',to_jsonb(i),'person',to_jsonb(p),'company',to_jsonb(c),'rejected',rejected)::text,'UTF8')),'hex');
 return jsonb_build_object('version','learn-identity-review-detail/1','tenant_id',p_tenant,'interaction_id',i.id,'person_id',p.id,'revision',revision,'can_apply',reason is null,'blocked_reason',reason,'hold_reason',i.metadata->'identity_delivery'->>'reason','source',source,
  'person',jsonb_build_object('name',left(p.display_name,500),'email',left(p.primary_email,500),'phone',left(p.primary_phone,100),'verified',p.verified),
  'company',case when c.id is null then null else jsonb_build_object('id',c.id,'name',left(c.name,500),'domain',left(c.domain,500)) end,
  'rejected_matches',rejected,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_identity_review_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create function public.learn_operator_identity_reviews(p_tenant uuid,p_after uuid default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare rows jsonb:='[]';i record;n integer:=0;last_id uuid;more boolean:=false;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 for i in select * from public.interactions where tenant_id=p_tenant and processing_status='identity_review' and (p_after is null or id>p_after) order by id limit 21 loop
  n:=n+1;if n>20 then more:=true;exit;end if;last_id:=i.id;
  rows:=rows||jsonb_build_array(jsonb_build_object('interaction_id',i.id,'source_type',i.source_type,'subject',left(i.subject,200),'occurred_at',i.occurred_at,'reason',coalesce(i.metadata->'identity_delivery'->>'reason','source_needs_review')));
 end loop;
 return jsonb_build_object('version','learn-identity-reviews/1','tenant_id',p_tenant,'rows',rows,'next_cursor',case when more then last_id else null end,'checked_at',clock_timestamp());
end$$;
revoke all on function public.learn_operator_identity_reviews(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_reviews(uuid,uuid) to authenticated;
create function public.learn_operator_identity_people(p_tenant uuid,p_search text,p_after uuid default null) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare rows jsonb:='[]';p record;n integer:=0;last_id uuid;more boolean:=false;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_search is null or length(btrim(p_search)) not between 2 and 100 then raise exception 'identity_search_invalid' using errcode='22023';end if;
 for p in select * from public.people where tenant_id=p_tenant and (p_after is null or id>p_after)
  and (strpos(lower(coalesce(display_name,'')),lower(btrim(p_search)))>0 or strpos(lower(coalesce(primary_email,'')),lower(btrim(p_search)))>0 or strpos(coalesce(primary_phone,''),btrim(p_search))>0)
  order by id limit 21 loop
  n:=n+1;if n>20 then more:=true;exit;end if;last_id:=p.id;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',p.id,'name',left(p.display_name,500),'email',left(p.primary_email,500),'phone',left(p.primary_phone,100)));
 end loop;
 return jsonb_build_object('version','learn-identity-people/1','tenant_id',p_tenant,'search',p_search,'rows',rows,'next_cursor',case when more then last_id else null end);
end$$;
revoke all on function public.learn_operator_identity_people(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_people(uuid,text,uuid) to authenticated;
create function public.learn_operator_identity_review_detail(p_tenant uuid,p_interaction uuid,p_person uuid) returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 return public.learn_identity_review_state(p_tenant,p_interaction,p_person);
end$$;
revoke all on function public.learn_operator_identity_review_detail(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_review_detail(uuid,uuid,uuid) to authenticated;
create function public.learn_operator_identity_review(p_tenant uuid,p_actor uuid,p_request uuid,p_interaction uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare saved public.learn_identity_operator_reviews%rowtype;i public.interactions%rowtype;p public.people%rowtype;c public.companies%rowtype;
 detail jsonb;answer jsonb;published jsonb;previous jsonb;person_id uuid;
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_interaction is null or p_mode is null or p_mode not in('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>4000
  or not p_definition?&array['action','revision','reason','person_id'] or p_definition-array['action','revision','reason','person_id']<>'{}'::jsonb
  or p_definition->>'action' is distinct from 'attribute_contact' or coalesce(p_definition->>'revision','')!~'^[a-f0-9]{64}$'
  or coalesce(p_definition->>'person_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
 then raise exception 'identity_review_request_invalid' using errcode='22023';end if;
 person_id:=(p_definition->>'person_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('learn-identity-review:'||p_request::text,0));
 select * into saved from public.learn_identity_operator_reviews where id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.actor_id<>p_actor or saved.interaction_id<>p_interaction or saved.definition<>p_definition then raise exception 'identity_review_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 perform 1 from public.interactions where tenant_id=p_tenant and id=p_interaction;
 if not found then raise exception 'identity_review_unavailable' using errcode='42501';end if;
 answer:=jsonb_build_object('version','learn-identity-review-receipt/1','tenant_id',p_tenant,'request_id',p_request,'interaction_id',p_interaction,'person_id',person_id);
 if p_mode='check' then return answer||jsonb_build_object('state','pending');end if;
 if p_mode='cancel' then answer:=answer||jsonb_build_object('state','cancelled');
 else
  perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
  perform pg_advisory_xact_lock(hashtextextended('learn-identity:'||p_tenant::text,0));
  select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction for update;
  -- Match the delivery engine's interaction -> event -> person -> company order.
  perform 1 from public.platform_events where tenant_id=p_tenant and event_type='interaction.ready' and subject_type='interaction' and subject_id=i.id and status='pending' for update;
  select * into p from public.people where tenant_id=p_tenant and id=person_id for update;
  if p.company_id is not null then select * into c from public.companies where tenant_id=p_tenant and id=p.company_id for share;end if;
  perform 1 from public.interaction_match_suggestions where tenant_id=p_tenant and interaction_id=i.id for update;
  detail:=public.learn_identity_review_state(p_tenant,p_interaction,person_id);
  if detail->>'revision' is distinct from p_definition->>'revision' then raise exception 'identity_review_changed' using errcode='PT409';end if;
  if detail->'can_apply' is distinct from 'true'::jsonb then raise exception 'identity_review_not_applicable' using errcode='PT409';end if;
  previous:=to_jsonb(i);
  published:=public.learn_identity_deliver_internal(p_tenant,p_request,i.id,public.learn_identity_revision(i),'publish',person_id);
  if published->>'state' is distinct from 'committed' or published->'cardEnriched' is distinct from 'true'::jsonb
   or published->>'interactionId' is distinct from i.id::text then raise exception 'identity_review_publication_unconfirmed' using errcode='PT409';end if;
  update public.interactions set metadata=metadata||jsonb_build_object('identity_review',jsonb_build_object('requestId',p_request,'actorId',p_actor,'personId',person_id)) where tenant_id=p_tenant and id=i.id;
  answer:=answer||jsonb_build_object('state','recorded','card_id',published->'cardId','card_processing','committed');
 end if;
 insert into public.learn_identity_operator_reviews(id,tenant_id,actor_id,interaction_id,definition,receipt,previous_interaction,reviewed_person,reviewed_company)
  values(p_request,p_tenant,p_actor,p_interaction,p_definition,answer,previous,case when previous is null then null else to_jsonb(p) end,case when c.id is null then null else to_jsonb(c) end);
 return answer;
end$$;
revoke all on function public.learn_operator_identity_review(uuid,uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_identity_review(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;
commit;
