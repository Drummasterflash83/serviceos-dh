-- Retain unsent Gmail source records without publishing them as customer replies.
-- Existing source messages/interactions/cards and historical receipts are preserved.
-- Draft detection is based on retained provider labels, never a caller-supplied flag.
begin;
create function public.learn_email_is_draft(m public.email_messages) returns boolean
 language sql stable strict set search_path=pg_catalog as $$
 select coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
$$;
create function public.learn_interaction_is_draft(p_tenant uuid,p_table text,p_source uuid) returns boolean
 language sql stable security definer set search_path=pg_catalog as $$
 select coalesce(p_table='email_messages' and exists(select 1 from public.email_messages m
  where m.tenant_id=p_tenant and m.id=p_source and public.learn_email_is_draft(m)),false)
$$;
revoke all on function public.learn_email_is_draft(public.email_messages),public.learn_interaction_is_draft(uuid,text,uuid) from public,anon,authenticated,service_role;
create or replace function public.learn_email_source_fields(m public.email_messages) returns jsonb language sql stable strict set search_path=pg_catalog set timezone='UTC' as $$
 select jsonb_build_object('source_connector_id','email','source_type','email','source_table','email_messages','source_id',m.id,
 'source_external_id',m.provider_message_id,'interaction_type',case when public.learn_email_is_draft(m) then 'email_draft' else 'email_message' end,'direction',case when public.learn_email_is_draft(m) then 'unknown' when m.direction in('inbound','outbound','internal') then m.direction else 'unknown' end,
 'occurred_at',coalesce(m.received_at,m.sent_at,m.created_at),'subject',m.subject,'summary',null,'body_preview',m.snippet,
 'from_address',m.from_email,'from_name',m.from_name,'to_addresses',m.to_emails,'cc_addresses',m.cc_emails,'related_thread_id',m.provider_thread_id)
$$;
create or replace function public.learn_projection_pending(p_tenant uuid,p_source text,p_limit integer default 100)
 returns table(source_kind text,source_id uuid,source_revision text)
 language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
begin
 if p_source is null or p_source not in('all','phone','email') then raise exception 'projection_source_invalid' using errcode='22023';end if;
 return query with candidates as (
  select 'phone'::text as kind,c.id,coalesce(c.started_at,c.created_at) as occurred,
   public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end) as revision,
   i.id is null or case when i.metadata?'phone_handoff' then i.source_version is distinct from public.phone_projection_version(p_tenant,c.id)
    else i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_phone_source_fields(c),null) end as dirty
  from public.phone_calls c left join public.interactions i on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and p_source in('all','phone')
  union all
  select 'email',m.id,coalesce(m.received_at,m.sent_at,m.created_at),public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id','')),
   i.id is null or i.metadata->'source_projection'->>'revision' is distinct from public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))
  from public.email_messages m left join public.interactions i on i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id=p_tenant and p_source in('all','email') and not public.learn_email_is_draft(m)
 ) select x.kind,x.id,x.revision from candidates x where x.dirty
 and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
 and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind=x.kind and r.source_id=x.id and r.source_revision=x.revision and r.receipt->>'state'='review_required')
 order by x.occurred,x.kind,x.id limit greatest(1,least(2000,coalesce(p_limit,100)));
end$$;
create or replace function public.learn_project_interaction(p_tenant uuid,p_request uuid,p_source text,p_source_id uuid,p_revision text,p_phase text)
 returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
#variable_conflict use_column
declare c public.phone_calls%rowtype;m public.email_messages%rowtype;i public.interactions%rowtype;
 saved public.learn_interaction_projection_receipts%rowtype;fields jsonb;actual text;table_name text;
 reason text;answer jsonb;event_id uuid;interaction_id uuid;created boolean:=false;prior_fields jsonb;
 provider text;version text;h jsonb;run_id uuid;campaign uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'projection_snapshot_invalid' using errcode='22023';end if;
 if p_tenant is null or p_request is null or p_source is null or p_source not in('phone','email') or p_source_id is null
 or coalesce(p_revision,'') !~ '^[a-f0-9]{64}$' or p_phase is null or p_phase not in('publish','inspect') then raise exception 'projection_request_invalid' using errcode='22023';end if;
 select * into saved from public.learn_interaction_projection_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.source_kind<>p_source or saved.source_id<>p_source_id or saved.source_revision<>p_revision then raise exception 'projection_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if p_phase='inspect' then raise exception 'projection_receipt_missing' using errcode='PT409';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('learn-project:'||p_tenant::text||':'||p_source||':'||p_source_id::text,0));
 select * into saved from public.learn_interaction_projection_receipts where request_id=p_request;
 if found then
  if saved.tenant_id<>p_tenant or saved.source_kind<>p_source or saved.source_id<>p_source_id or saved.source_revision<>p_revision then raise exception 'projection_receipt_conflict' using errcode='PT409';end if;
  return saved.receipt;
 end if;
 if not public.learn_capture_allowed(p_tenant,p_source) then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 table_name:=case p_source when 'phone' then 'phone_calls' else 'email_messages' end;
 -- Observe authoritative ownership before taking the legacy source lock. The
 -- phone publisher owns recording->run->transcript->insight->call->interaction.
 select * into i from public.interactions where tenant_id=p_tenant and source_table=table_name and source_id=p_source_id;
 if p_source='phone' and i.metadata?'phone_handoff' then
  select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id;
  if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
  actual:=public.learn_projection_revision(public.learn_phone_source_fields(c),public.phone_projection_version(p_tenant,c.id));
  if actual<>p_revision then raise exception 'projection_source_changed' using errcode='PT409';end if;
  if i.source_version=public.phone_projection_version(p_tenant,c.id) then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','unchanged');
  else
  -- Only the existing exact-provenance publisher may refresh this interaction.
  run_id:=p_request;
  insert into public.phone_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
   values(run_id,p_tenant,'pipeline','pipeline','running',jsonb_build_object('recording_id',i.metadata->'phone_handoff'->>'recordingId','repair_only',true,'source','interactions.sync'));
  h:=public.learn_phone_handoff(p_tenant,run_id,(i.metadata->'phone_handoff'->>'recordingId')::uuid,
   (i.metadata->'phone_handoff'->>'transcriptId')::uuid,(i.metadata->'phone_handoff'->>'insightId')::uuid,'publish');
  select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id;
  if public.learn_projection_revision(public.learn_phone_source_fields(c),public.phone_projection_version(p_tenant,c.id))<>p_revision
   or h->>'callId'<>c.id::text or h->>'interactionId'<>i.id::text then raise exception 'projection_source_changed' using errcode='PT409';end if;
  update public.phone_sync_runs set status='success',completed_at=clock_timestamp(),records_processed=1,metadata=metadata||jsonb_build_object('handoff_receipt',h,'repair_only',true) where id=run_id and tenant_id=p_tenant;
  answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',h->'eventId','action',case when (h->>'alreadyEnriched')::boolean then 'unchanged' else 'authoritative_phone_refresh' end);
  end if;
 else
  if p_source='phone' then
   select * into c from public.phone_calls where tenant_id=p_tenant and id=p_source_id for update;
   if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
   fields:=public.learn_phone_source_fields(c);provider:=c.provider;version:=null;
  else
   select * into m from public.email_messages where tenant_id=p_tenant and id=p_source_id for update;
   if not found then raise exception 'projection_source_changed' using errcode='PT409';end if;
   if public.learn_email_is_draft(m) then reason:='email_draft';end if;
   fields:=public.learn_email_source_fields(m);provider:=m.provider;version:=coalesce(to_jsonb(m)->>'origin_campaign_id','');
   if version<>'' then campaign:=version::uuid;end if;
   if jsonb_typeof(m.to_emails) is distinct from 'array' or jsonb_typeof(m.cc_emails) is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(m.to_emails||m.cc_emails) e where jsonb_typeof(e)<>'string') then reason:=coalesce(reason,'email_addresses_unverified');end if;
  end if;
  actual:=public.learn_projection_revision(fields,version);
  if actual<>p_revision then raise exception 'projection_source_changed' using errcode='PT409';end if;
  select * into i from public.interactions where tenant_id=p_tenant and source_table=table_name and source_id=p_source_id for update;
  created:=not found;
  -- A concurrent live publisher may have won since the initial ownership read.
  if not created and i.metadata?'phone_handoff' then raise exception 'projection_owner_changed' using errcode='PT409';end if;
  if not created and not(i.metadata?'source_projection') then reason:=coalesce(reason,'legacy_projection_review');end if;
  if not created and i.metadata?'source_projection' then
   select jsonb_object_agg(k,to_jsonb(i)->k) into prior_fields from jsonb_object_keys(i.metadata->'source_projection'->'fields') k;
   if prior_fields is distinct from i.metadata->'source_projection'->'fields' then reason:=coalesce(reason,'canonical_fields_changed');end if;
  end if;
  if reason is not null then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','review_required','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','held','reason',reason);
  elsif not created and i.metadata->'source_projection'->>'revision'=p_revision then
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',i.id,'eventId',null,'action','unchanged');
  else
   insert into public.interactions as target(tenant_id,source_connector_id,source_type,source_table,source_id,source_external_id,interaction_type,direction,occurred_at,subject,summary,body_preview,
    from_address,from_name,to_addresses,cc_addresses,phone_from,phone_to,related_thread_id,processing_status,metadata)
   values(p_tenant,fields->>'source_connector_id',p_source,table_name,p_source_id,fields->>'source_external_id',fields->>'interaction_type',fields->>'direction',(fields->>'occurred_at')::timestamptz,
    fields->>'subject',fields->>'summary',fields->>'body_preview',fields->>'from_address',fields->>'from_name',array(select jsonb_array_elements_text(coalesce(fields->'to_addresses','[]'))),array(select jsonb_array_elements_text(coalesce(fields->'cc_addresses','[]'))),
    fields->>'phone_from',fields->>'phone_to',fields->>'related_thread_id','ready',jsonb_build_object('source_projection',jsonb_build_object('version','learn-interaction-projection/1','revision',p_revision,'fields',fields,'provider',provider,'coverage','unverified','accountBinding','unverified')))
   on conflict(tenant_id,source_table,source_id) do update set source_connector_id=excluded.source_connector_id,source_external_id=excluded.source_external_id,direction=excluded.direction,occurred_at=excluded.occurred_at,
    subject=excluded.subject,summary=excluded.summary,body_preview=excluded.body_preview,from_address=excluded.from_address,from_name=excluded.from_name,to_addresses=excluded.to_addresses,cc_addresses=excluded.cc_addresses,
    phone_from=excluded.phone_from,phone_to=excluded.phone_to,related_thread_id=excluded.related_thread_id,processing_status='ready',metadata=target.metadata||excluded.metadata
    where target.id=i.id and target.metadata->'source_projection'=i.metadata->'source_projection'
   returning id into interaction_id;
   if interaction_id is null then raise exception 'projection_owner_changed' using errcode='PT409';end if;
   if campaign is not null then
    -- The historical TEST schema lacks this optional Marketing column. Preserve
    -- campaign provenance in metadata there; set its native link where supported.
    update public.interactions set metadata=metadata||jsonb_build_object('origin_campaign_id',campaign) where tenant_id=p_tenant and id=interaction_id;
    if exists(select 1 from pg_attribute where attrelid='public.interactions'::regclass and attname='related_campaign_id' and not attisdropped) then
     if to_jsonb(i)->>'related_campaign_id' is not null and to_jsonb(i)->>'related_campaign_id'<>campaign::text then raise exception 'projection_campaign_conflict' using errcode='PT409';end if;
     execute 'update public.interactions set related_campaign_id=$1 where tenant_id=$2 and id=$3' using campaign,p_tenant,interaction_id;
    end if;
   end if;
   insert into public.platform_events as e(tenant_id,event_type,subject_type,subject_id,source,status,payload)
    values(p_tenant,'interaction.ready','interaction',interaction_id,'interactions-sync','pending',jsonb_build_object('projection_revision',p_revision,'source_kind',p_source,'source_id',p_source_id))
    on conflict(tenant_id,event_type,subject_id) where status='pending' do update set payload=e.payload||excluded.payload returning id into event_id;
   answer:=jsonb_build_object('version','learn-interaction-projection/1','state','committed','tenantId',p_tenant,'requestId',p_request,'sourceKind',p_source,'sourceId',p_source_id,'sourceRevision',p_revision,'interactionId',interaction_id,'eventId',event_id,'action',case when created then 'created' else 'updated' end);
  end if;
 end if;
 insert into public.learn_interaction_projection_receipts(request_id,tenant_id,source_kind,source_id,source_revision,receipt) values(p_request,p_tenant,p_source,p_source_id,p_revision,answer);
 return answer;
end$$;
create or replace function public.learn_identity_deliver_internal(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text,p_reviewed_person uuid)
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
end$$;
create or replace function public.learn_identity_review_state(p_tenant uuid,p_interaction uuid,p_person uuid) returns jsonb
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
 reason:=case when public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) then 'email_draft'
  when i.processing_status<>'identity_review' or i.metadata->'identity_delivery'->>'state' is distinct from 'review_required' then 'hold_changed'
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
create or replace function public.learn_identity_pending(p_tenant uuid,p_limit integer default 20)
 returns table(interaction_id uuid,source_revision text)
 language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 select i.id,public.learn_identity_revision(i) from public.interactions i
 join public.tenants t on t.id=i.tenant_id and t.status='active'
 where i.tenant_id=p_tenant and i.processing_status in('pending','ready') and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id)
 order by i.occurred_at,i.id limit greatest(1,least(50,coalesce(p_limit,20)))
$$;
revoke all on function public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid),public.learn_identity_review_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public.learn_identity_deliver(p_tenant uuid,p_request uuid,p_interaction uuid,p_revision text,p_phase text)
 returns jsonb language sql security definer set search_path=pg_catalog set timezone='UTC' as $$
 select public.learn_identity_deliver_internal(p_tenant,p_request,p_interaction,p_revision,p_phase,null)
$$;
create or replace function public.learn_card_communications_read(p_tenant uuid,p_person uuid default null,p_company uuid default null,p_job uuid default null,p_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 -- The reader role can see only the actual caller profile through its RLS policy.
 -- Policies bind auth.uid() at creation; runtime auth-schema lookup is unnecessary.
 select p.tenant_id,p.role into actor_tenant,actor_role from public.profiles p;
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin') then
  raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or
  (p_ids is null and p_person is null and p_company is null and p_job is null) or
  (p_ids is not null and (cardinality(p_ids)<1 or cardinality(p_ids)>50 or array_position(p_ids,null) is not null or p_person is not null or p_company is not null or p_job is not null)) or
  (p_job is not null and (p_person is not null or p_company is not null)) then
  raise exception 'One bounded communication scope is required' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by s.occurred_at desc nulls last,s.id),'[]'::jsonb) into result from (
  select i.id,i.tenant_id,i.source_connector_id,i.source_type,i.source_table,i.source_id,i.occurred_at,
   case when length(i.subject)>4000 then left(i.subject,4000)||'… [excerpt shortened]' else i.subject end as subject,
   case when length(i.summary)>4000 then left(i.summary,4000)||'… [excerpt shortened]' else i.summary end as summary,
   case when length(i.body_preview)>4000 then left(i.body_preview,4000)||'… [excerpt shortened]' else i.body_preview end as body_preview,
   i.status,i.related_person_id,i.related_company_id,i.related_job_id
  from public.interactions i where i.tenant_id=p_tenant and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) and coalesce(i.status,'') not in ('deleted','removed') and
   (i.related_person_id=p_person or i.related_company_id=p_company or i.related_job_id=p_job or i.id=any(p_ids))
  order by i.occurred_at desc nulls last,i.id limit 51
 ) s;
 return jsonb_build_object('version','learn-card-communications/1','tenant_id',p_tenant,'rows',result);
end $$;
grant execute on function public.learn_interaction_is_draft(uuid,text,uuid) to learn_card_communication_reader;
create or replace function public.learn_projection_review_count(p_tenant uuid,p_source text) returns integer
 language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 with latest as (
  select distinct on(r.source_kind,r.source_id) r.* from public.learn_interaction_projection_receipts r
  where r.tenant_id=p_tenant and (p_source='all' or r.source_kind=p_source)
  order by r.source_kind,r.source_id,r.created_at desc,r.request_id desc
 ) select count(*)::integer from latest r where r.receipt->>'state'='review_required' and coalesce(r.receipt->>'reason','')<>'email_draft'
 and (case r.source_kind when 'phone' then exists(select 1 from public.phone_calls c left join public.interactions i
  on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and c.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end))
 else exists(select 1 from public.email_messages m where m.tenant_id=p_tenant and m.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))) end)
$$;
create or replace function public.learn_identity_review_count(p_tenant uuid) returns integer
 language sql stable security definer set search_path=pg_catalog as $$
 select count(*)::integer from public.interactions i where i.tenant_id=p_tenant and i.processing_status='identity_review'
 and not public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id)
$$;
create or replace function public.learn_email_store_page(p_context jsonb,p_threads jsonb,p_messages jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;thread_count integer;message_count integer;v jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 tenant:=(p_context->>'tenant_id')::uuid;
 if jsonb_typeof(p_threads) is distinct from 'array' or jsonb_typeof(p_messages) is distinct from 'array'
  or jsonb_array_length(p_threads)>2000 or jsonb_array_length(p_messages)>2000
  or octet_length(p_threads::text)+octet_length(p_messages::text)>67108864
 then raise exception 'learn_email_store_rows_invalid' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_threads) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>7
   or not(v ?& array['tenant_id','provider','provider_thread_id','subject','participants','last_message_at','updated_at'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'participants') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(v->'participants')e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'subject') not in ('string','null') or jsonb_typeof(v->'last_message_at') is distinct from 'string'
  then raise exception 'learn_email_store_thread_invalid' using errcode='22023';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_messages) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>16
   or not(v ?& array['tenant_id','provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails','subject','snippet','body_text','body_html','sent_at','received_at','direction','raw_payload'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_message_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_message_id')>256)
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'to_emails') is distinct from 'array' or jsonb_typeof(v->'cc_emails') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements((v->'to_emails')||(v->'cc_emails'))e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'raw_payload') is distinct from 'object' or jsonb_typeof(v->'direction') is distinct from 'string' or not coalesce(v->>'direction' in ('inbound','outbound') or (v->>'direction'='unknown' and v->'raw_payload'->'label_ids' @> '["DRAFT"]'::jsonb and v->'sent_at'='null'::jsonb),false)
   or exists(select 1 from jsonb_each(v)e where e.key=any(array['from_email','from_name','subject','snippet','body_text','body_html','sent_at','received_at']) and jsonb_typeof(e.value) not in ('string','null'))
  then raise exception 'learn_email_store_message_invalid' using errcode='22023';end if;
 end loop;
 -- Each thread summary must come from a message in this page and vice versa.
 if exists(select 1 from jsonb_array_elements(p_messages)m where not exists(select 1 from jsonb_array_elements(p_threads)t where t->>'provider_thread_id'=m->>'provider_thread_id'))
  or exists(select 1 from jsonb_array_elements(p_threads)t where not exists(select 1 from jsonb_array_elements(p_messages)m where m->>'provider_thread_id'=t->>'provider_thread_id'))
  or (select count(distinct elem->>'provider_thread_id') from jsonb_array_elements(p_threads)elem)<>jsonb_array_length(p_threads)
  or (select count(distinct elem->>'provider_message_id') from jsonb_array_elements(p_messages)elem)<>jsonb_array_length(p_messages)
 then raise exception 'learn_email_store_page_mismatch' using errcode='22023';end if;
 insert into public.email_threads as retained(tenant_id,provider,provider_thread_id,subject,participants,last_message_at)
 select tenant,'gmail',x.provider_thread_id,x.subject,x.participants,x.last_message_at
 from jsonb_populate_recordset(null::public.email_threads,p_threads)x order by x.provider_thread_id
 on conflict(tenant_id,provider,provider_thread_id) do update set
  subject=case when retained.last_message_at is null or excluded.last_message_at>retained.last_message_at then coalesce(excluded.subject,retained.subject) else retained.subject end,
  last_message_at=greatest(retained.last_message_at,excluded.last_message_at),
  participants=(select coalesce(jsonb_agg(distinct e order by e),'[]') from jsonb_array_elements(retained.participants||excluded.participants)e);
 get diagnostics thread_count=row_count;
 insert into public.email_messages as retained(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
 select tenant,'gmail',x.provider_message_id,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,x.raw_payload
 from jsonb_populate_recordset(null::public.email_messages,p_messages)x order by x.provider_message_id
 on conflict(tenant_id,provider,provider_message_id) do update set
  provider_thread_id=excluded.provider_thread_id,from_email=coalesce(excluded.from_email,retained.from_email),from_name=coalesce(excluded.from_name,retained.from_name),
  to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,subject=coalesce(excluded.subject,retained.subject),snippet=coalesce(excluded.snippet,retained.snippet),
  body_text=coalesce(excluded.body_text,retained.body_text),body_html=coalesce(excluded.body_html,retained.body_html),sent_at=coalesce(excluded.sent_at,retained.sent_at),received_at=coalesce(excluded.received_at,retained.received_at),direction=excluded.direction,raw_payload=retained.raw_payload||excluded.raw_payload
 where p_context->>'fetch_policy'='refetch_all'
  and case when retained.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'history_id')::numeric else false end
    else true end;
 get diagnostics message_count=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'message_upsert_count',message_count,'thread_upsert_count',thread_count);
end $$;
commit;
