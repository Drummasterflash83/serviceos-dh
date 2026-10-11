-- Guarded repair/backfill from retained Phone/Email sources. No provider requests.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
create table public.learn_interaction_projection_receipts(
 request_id uuid primary key,tenant_id uuid not null references public.tenants(id),
 source_kind text not null check(source_kind in('phone','email')),source_id uuid not null,
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 receipt jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index learn_interaction_projection_source_idx on public.learn_interaction_projection_receipts(tenant_id,source_kind,source_id,source_revision);
alter table public.learn_interaction_projection_receipts enable row level security;
revoke all on public.learn_interaction_projection_receipts from public,anon,authenticated,service_role;
create trigger learn_interaction_projection_receipts_immutable before update or delete on public.learn_interaction_projection_receipts
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_phone_source_fields(c public.phone_calls) returns jsonb language sql stable strict set search_path=pg_catalog set timezone='UTC' as $$
 select jsonb_build_object('source_connector_id',c.provider,'source_type','phone','source_table','phone_calls','source_id',c.id,
 'source_external_id',c.provider_call_id,'interaction_type','phone_call','direction',case c.direction when 'IN' then 'inbound' when 'OUT' then 'outbound' else 'unknown' end,
 'occurred_at',coalesce(c.started_at,c.created_at),'summary',null,'body_preview',concat('Call',case when c.duration_seconds is not null then ' · '||c.duration_seconds::text||'s' else '' end,case when c.outcome is not null then ' · '||c.outcome else '' end),
 'phone_from',c.from_number,'phone_to',c.to_number,'related_thread_id',c.linked_id)
$$;
create function public.learn_email_source_fields(m public.email_messages) returns jsonb language sql stable strict set search_path=pg_catalog set timezone='UTC' as $$
 select jsonb_build_object('source_connector_id','email','source_type','email','source_table','email_messages','source_id',m.id,
 'source_external_id',m.provider_message_id,'interaction_type','email_message','direction',case when m.direction in('inbound','outbound','internal') then m.direction else 'unknown' end,
 'occurred_at',coalesce(m.received_at,m.sent_at,m.created_at),'subject',m.subject,'summary',null,'body_preview',m.snippet,
 'from_address',m.from_email,'from_name',m.from_name,'to_addresses',m.to_emails,'cc_addresses',m.cc_emails,'related_thread_id',m.provider_thread_id)
$$;
create function public.learn_projection_revision(p_fields jsonb,p_version text default null) returns text language sql immutable strict set search_path=pg_catalog as $$
 select encode(sha256(convert_to(jsonb_build_object('fields',p_fields,'version',p_version)::text,'UTF8')),'hex')
$$;
-- NULL is meaningful for the optional authoritative version, so do not use STRICT.
alter function public.learn_projection_revision(jsonb,text) called on null input;
revoke all on function public.learn_phone_source_fields(public.phone_calls),public.learn_email_source_fields(public.email_messages),public.learn_projection_revision(jsonb,text) from public,anon,authenticated,service_role;

create function public.learn_projection_pending(p_tenant uuid,p_source text,p_limit integer default 100)
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
  where m.tenant_id=p_tenant and p_source in('all','email')
 ) select x.kind,x.id,x.revision from candidates x where x.dirty
 and exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active')
 and not exists(select 1 from public.learn_interaction_projection_receipts r where r.tenant_id=p_tenant and r.source_kind=x.kind and r.source_id=x.id and r.source_revision=x.revision and r.receipt->>'state'='review_required')
 order by x.occurred,x.kind,x.id limit greatest(1,least(2000,coalesce(p_limit,100)));
end$$;
revoke all on function public.learn_projection_pending(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_pending(uuid,text,integer) to service_role;

create function public.learn_project_interaction(p_tenant uuid,p_request uuid,p_source text,p_source_id uuid,p_revision text,p_phase text)
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
   fields:=public.learn_email_source_fields(m);provider:=m.provider;version:=coalesce(to_jsonb(m)->>'origin_campaign_id','');
   if version<>'' then campaign:=version::uuid;end if;
   if jsonb_typeof(m.to_emails) is distinct from 'array' or jsonb_typeof(m.cc_emails) is distinct from 'array'
    or exists(select 1 from jsonb_array_elements(m.to_emails||m.cc_emails) e where jsonb_typeof(e)<>'string') then reason:='email_addresses_unverified';end if;
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
revoke all on function public.learn_project_interaction(uuid,uuid,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_project_interaction(uuid,uuid,text,uuid,text,text) to service_role;
-- Outstanding holds stay visible even when no new row is eligible this cycle.
create function public.learn_projection_review_count(p_tenant uuid,p_source text) returns integer
 language sql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
 with latest as (
  select distinct on(r.source_kind,r.source_id) r.* from public.learn_interaction_projection_receipts r
  where r.tenant_id=p_tenant and (p_source='all' or r.source_kind=p_source)
  order by r.source_kind,r.source_id,r.created_at desc,r.request_id desc
 ) select count(*)::integer from latest r where r.receipt->>'state'='review_required'
 and (case r.source_kind when 'phone' then exists(select 1 from public.phone_calls c left join public.interactions i
  on i.tenant_id=c.tenant_id and i.source_table='phone_calls' and i.source_id=c.id
  where c.tenant_id=p_tenant and c.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_phone_source_fields(c),case when i.metadata?'phone_handoff' then public.phone_projection_version(p_tenant,c.id) else null end))
 else exists(select 1 from public.email_messages m where m.tenant_id=p_tenant and m.id=r.source_id and r.source_revision=public.learn_projection_revision(public.learn_email_source_fields(m),coalesce(to_jsonb(m)->>'origin_campaign_id',''))) end)
$$;
revoke all on function public.learn_projection_review_count(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_projection_review_count(uuid,text) to service_role;

commit;
