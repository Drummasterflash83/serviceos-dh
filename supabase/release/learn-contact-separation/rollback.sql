begin;
set local lock_timeout='5s';set local statement_timeout='45s';
do $$begin
 if current_setting('serviceos.release_project',true) is null or current_setting('serviceos.release_project',true) not in ('saatxzwxvdvqevbnskxy','tgbnakbxwcqjeimygroz') then raise exception 'Explicit release project required';end if;
 if md5(pg_get_functiondef('public.learn_commusoft_separate_contact(uuid,uuid,text,jsonb)'::regprocedure)) is distinct from '740db099b4cb70b2660a3c02510e0183' then raise exception 'Contact rollback baseline changed';end if;
 if md5(pg_get_functiondef('public.learn_commusoft_work_batch(uuid,uuid,uuid,text,jsonb,text,boolean,uuid)'::regprocedure)) is distinct from 'a28b4b2681011321d7ea3ec989ee9653' then raise exception 'Contact rollback baseline changed';end if;
 if md5(pg_get_functiondef('public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure)) is distinct from '60adf2eca5be0f1c0aaa97765364eeca' then raise exception 'Contact rollback baseline changed';end if;
 if md5(pg_get_functiondef('public.learn_identity_shared_contact_channel(uuid,text,text)'::regprocedure)) is distinct from '66956079de9e9094f88ce921d303ec1c' then raise exception 'Contact rollback baseline changed';end if;
 if exists(select 1 from public.people where metadata ? 'reviewed_contact_separation') or exists(select 1 from public.learn_business_input_projection_attempts where request#>>'{identity_review,mode}'='separate_named_person' and result->>'state'='linked') then raise exception 'Retain shared-channel guard after separate-contact publication';end if;
end$$;
CREATE OR REPLACE FUNCTION public.learn_commusoft_work_batch(p_tenant uuid, p_request uuid, p_connection uuid, p_kind text, p_items jsonb, p_reason text, p_cancel boolean DEFAULT false, p_expected_actor uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare b public.learn_business_input_projection_batches%rowtype;v public.learn_business_input_versions%rowtype;
 request jsonb;result jsonb;outcomes jsonb:='[]';item jsonb;outcome jsonb;version uuid;target uuid;
 seen uuid[]:='{}';identities text[]:='{}';linked integer:=0;held integer:=0;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 if p_expected_actor is distinct from auth.uid() then raise exception 'business_input_actor_changed' using errcode='42501';end if;
 -- Existing tenant roster lock also serializes competing confirmations/cancellations.
 perform public.learn_business_review_authority(p_tenant,auth.uid());
 if p_request is null or p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_cancel is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 or jsonb_typeof(p_items) is distinct from 'array'
  or jsonb_array_length(p_items) not between 1 and 50 then raise exception 'business_input_batch_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>2
   or jsonb_typeof(item->'version_id') is distinct from 'string' or item->>'version_id'!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or not item ? 'target_id' or not (item->'target_id'='null'::jsonb or (jsonb_typeof(item->'target_id')='string' and item->>'target_id'~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')) then
   raise exception 'business_input_batch_item_invalid' using errcode='22023';end if;
  version:=(item->>'version_id')::uuid;
  if version=any(seen) then raise exception 'business_input_batch_duplicate' using errcode='22023';end if;
  seen:=array_append(seen,version);
 end loop;
 request:=jsonb_build_object('connection_id',p_connection,'kind',p_kind,'items',p_items,'reason',btrim(p_reason));
 select * into b from public.learn_business_input_projection_batches where tenant_id=p_tenant and id=p_request;
 if found then
  if b.actor_id is distinct from auth.uid() or b.request is distinct from request then raise exception 'business_input_batch_conflict' using errcode='PT409';end if;
  return b.result; -- A saved cancellation also fences a late original apply.
 end if;
 if not p_cancel then
  perform public.learn_business_input_review_access(p_tenant,p_connection);
  perform 1 from public.provider_connections where id=p_connection and tenant_id=p_tenant for update;
  -- Prevalidate every scope before any row is projected. Unknown/foreign rows
  -- abort the batch, rather than becoming successful partial application.
  for item in select value from jsonb_array_elements(p_items) loop
   select * into v from public.learn_business_input_versions where id=(item->>'version_id')::uuid and tenant_id=p_tenant
    and connection_id=p_connection and provider='commusoft';
   if not found or (p_kind='contact' and v.collection<>'propertyContacts') or (p_kind='job' and v.collection<>'jobs') or
    (p_kind='site' and (v.collection<>'properties' or v.payload->>'type' is distinct from 'workaddress')) then
    raise exception 'business_input_batch_scope_invalid' using errcode='22023';end if;
   if v.external_id=any(identities) then raise exception 'business_input_batch_identity_duplicate' using errcode='22023';end if;
   identities:=array_append(identities,v.external_id);
  end loop;
  for item in select value from jsonb_array_elements(p_items) loop
   if p_kind='contact' then outcome:=public.learn_commusoft_confirm_contact(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));
   else outcome:=public.learn_commusoft_confirm_work_record(p_tenant,(item->>'version_id')::uuid,(item->>'target_id')::uuid,btrim(p_reason));end if;
   if outcome->>'state'='linked' then linked:=linked+1;
   elsif outcome->>'state'='held' then held:=held+1;
   else raise exception 'business_input_batch_outcome_invalid';end if;
   outcomes:=outcomes||jsonb_build_array(jsonb_build_object('version_id',item->>'version_id','outcome',outcome));
  end loop;
 end if;
 result:=jsonb_build_object('batch_id',p_request,'tenant_id',p_tenant,'actor_id',auth.uid(),'connection_id',p_connection,'kind',p_kind,
  'state',case when p_cancel then 'cancelled' else 'recorded' end,'items',outcomes,'linked',linked,'held',held);
 insert into public.learn_business_input_projection_batches(tenant_id,id,actor_id,request,result) values(p_tenant,p_request,auth.uid(),request,result);
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.learn_identity_deliver_internal(p_tenant uuid, p_request uuid, p_interaction uuid, p_revision text, p_phase text, p_reviewed_person uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET "TimeZone" TO 'UTC'
AS $function$
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
 if public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) then reason:='email_draft';
 elsif i.direction='internal' then reason:='internal_interaction';
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
   from public.interactions x where tenant_id=p_tenant and related_person_id=person_id and not public.learn_interaction_is_draft(x.tenant_id,x.source_table,x.source_id);
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
end$function$
;
drop function public.learn_commusoft_separate_contact(uuid,uuid,text,jsonb);
drop function public.learn_identity_shared_contact_channel(uuid,text,text);
notify pgrst,'reload schema';
commit;
