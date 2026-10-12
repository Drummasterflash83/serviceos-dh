-- DRAFT: atomic observations and audited retained-evidence reads; no capture activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 then raise exception 'Production learning target/checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_work_context_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='59c5dc3edfc0a893e1a44e8624fadda74a31a6e3e945eab55492aef594bebc67')
 then raise exception 'Pinned learning prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_learning_delivery_reads_v1')
 or to_regclass('public.learn_observation_receipts') is not null
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_learning_retained_counts','learn_observation_deliver']))
 then raise exception 'Learning package already exists; inspect before retry';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid='public.openfolk_client_information(uuid,text,text,uuid,uuid)'::regprocedure) is distinct from '155954ff232b629ce86dc35267cf66a9'
 then raise exception 'Prior information reader changed';end if;
 if exists(select 1 from public.platform_jobs where status='running') then raise exception 'Running work must drain';end if;
end$$;
-- Atomic observe-only LEARN delivery; no schedules, provider access or automation execution.

create table if not exists intelligence_ingestions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  interaction_id uuid not null references interactions(id) on delete cascade,

  -- The mapper version is part of the identity: one interaction → one logical
  -- Observation PER mapper version (a bump is an intentional re-mapping).
  mapper_version text not null,
  ingest_key     text not null,                 -- deterministic ingest:{tenant}:{interaction}:{mapper}
  domain         text,                          -- horizontal domain pack used for evaluation

  -- Lineage (backfilled after the atomic claim; the claim is what's authoritative).
  observe_job_id uuid references platform_jobs(id),
  observation_id uuid,                           -- soft ref intelligence_objects.id (set later)
  correlation_id uuid,
  status         text not null default 'enqueued', -- enqueued | observed | failed

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- ATOMIC CLAIM: at most one ingestion per (tenant, interaction, mapper version).
  unique (tenant_id, interaction_id, mapper_version)
);

-- Deterministic-key lookups + per-interaction lineage.
create unique index if not exists intelligence_ingestions_ingest_key_uk
  on intelligence_ingestions (tenant_id, ingest_key);
create index if not exists intelligence_ingestions_interaction_idx
  on intelligence_ingestions (tenant_id, interaction_id, created_at desc);
create index if not exists intelligence_ingestions_job_idx
  on intelligence_ingestions (tenant_id, observe_job_id);

drop trigger if exists intelligence_ingestions_set_updated_at on intelligence_ingestions;
create trigger intelligence_ingestions_set_updated_at
  before update on intelligence_ingestions
  for each row execute function set_updated_at();

alter table intelligence_ingestions enable row level security;

-- Tenant-scoped SELECT only. Writes are service-role via Edge Functions.
drop policy if exists intelligence_ingestions_select_tenant on intelligence_ingestions;
create policy intelligence_ingestions_select_tenant on intelligence_ingestions
  for select to authenticated using (tenant_id = current_tenant_id());

alter table public.intelligence_ingestions add column if not exists eligibility_reason text;
alter table public.intelligence_ingestions add column if not exists eligibility_confidence numeric;
grant select,insert,update on public.intelligence_ingestions to service_role;

create table public.learn_observation_receipts (
 job_id uuid primary key references public.platform_jobs(id),
 tenant_id uuid not null references public.tenants(id),
 interaction_id uuid not null references public.interactions(id),
 observation_id uuid not null references public.intelligence_objects(id),
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_observation_receipts enable row level security;
revoke all on public.learn_observation_receipts from public,anon,authenticated,service_role;

create function public.learn_observation_deliver(p_tenant uuid,p_job uuid,p_claim jsonb,p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.platform_jobs%rowtype; i public.interactions%rowtype;
 g public.intelligence_ingestions%rowtype; d jsonb; pkg jsonb; op jsonb; obj jsonb;
 r jsonb; oid uuid; did uuid; nid uuid; iid uuid; node record; anchor uuid; nodes uuid[]:='{}';
begin
 select * into q from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or q.job_type<>'intelligence.observe' then raise exception 'learn_observation_job_unavailable';end if;
 select receipt into r from public.learn_observation_receipts where job_id=p_job and tenant_id=p_tenant;
 if found then return r;end if;
 if p_result is null then return jsonb_build_object('version','learn-observation-delivery/1','state','pending','job_id',p_job,'tenant_id',p_tenant);end if;
 if p_claim->>'claimedBy' is null or p_claim->>'attemptCount' is null or q.status<>'running' or q.claimed_by is distinct from p_claim->>'claimedBy'
 or q.attempt_count is distinct from (p_claim->>'attemptCount')::int
 or q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp()
 then raise exception 'learn_observation_lease_unavailable';end if;
 d:=q.payload->'observation';pkg:=p_result->'package';op:=p_result->'operational';obj:=p_result->'object';
 if d->>'created_from' is distinct from 'intelligence.ingest_interaction' or d#>>'{attributes,ingest,mapper_version}' is distinct from 'obs-ingest/2'
 or jsonb_array_length(d->'source_interactions') is distinct from 1
 or op->>'blocked_reason' is distinct from 'mode_observe_only'
 or op->'can_execute' is distinct from 'false'::jsonb
 or obj->>'tenant_id' is distinct from p_tenant::text
 or obj->>'object_type' is distinct from 'Observation'
 or obj->>'subject' is distinct from d->>'subject'
 or obj->'source_interactions' is distinct from d->'source_interactions'
 or obj->'attributes' is distinct from d->'attributes'
 or pkg->>'id' is null then raise exception 'learn_observation_result_invalid';end if;
 iid:=(d->'source_interactions'->>0)::uuid;oid:=(obj->>'id')::uuid;did:=(pkg->>'id')::uuid;
 if oid is null or did is null then raise exception 'learn_observation_result_invalid';end if;
 select * into i from public.interactions where id=iid and tenant_id=p_tenant for share;
 if not found or i.processing_status<>'enriched' or d#>>'{attributes,ingest,source_updated_at}' is null
 or i.updated_at is distinct from (d#>>'{attributes,ingest,source_updated_at}')::timestamptz
 then raise exception 'learn_observation_source_changed';end if;
 select * into g from public.intelligence_ingestions where tenant_id=p_tenant and interaction_id=iid and mapper_version='obs-ingest/2' for update;
 if not found or g.status<>'enqueued' or g.observe_job_id is distinct from p_job
 then raise exception 'learn_observation_lineage_unavailable';end if;
 -- Project only verified foreign-key relationships for this retained interaction.
 -- Existing graph nodes/edges are reused; no identity guesses or source updates.
 if (i.related_person_id is not null and not exists(select 1 from public.people where tenant_id=p_tenant and id=i.related_person_id))
 or (i.related_company_id is not null and not exists(select 1 from public.companies where tenant_id=p_tenant and id=i.related_company_id))
 or (i.related_job_id is not null and not exists(select 1 from public.jobs where tenant_id=p_tenant and id=i.related_job_id))
 then raise exception 'learn_observation_reference_unavailable';end if;
 for node in select * from (values (1,'interaction','interactions',i.id),(2,'person','people',i.related_person_id),
 (3,'company','companies',i.related_company_id),(4,'job','jobs',i.related_job_id)) n(ord,kind,tab,id) where id is not null order by ord loop
  insert into public.graph_nodes(tenant_id,node_type,source_table,source_id,label,metadata)
  values(p_tenant,node.kind,node.tab,node.id,initcap(node.kind),jsonb_build_object('projection','learn-observation/1'))
  on conflict(tenant_id,node_type,source_table,source_id) where source_id is not null do nothing;
  select id into strict nid from public.graph_nodes where tenant_id=p_tenant and node_type=node.kind and source_table=node.tab and source_id=node.id;
  nodes:=array_append(nodes,nid);
  if node.kind='interaction' then anchor:=nid;else
   insert into public.graph_edges(tenant_id,edge_type,from_node_id,to_node_id,confidence,evidence,metadata)
   values(p_tenant,'relates_to',anchor,nid,1,jsonb_build_array(jsonb_build_object('interaction_id',iid)),jsonb_build_object('projection','learn-observation/1'))
   on conflict(tenant_id,edge_type,from_node_id,to_node_id) do nothing;
  end if;
 end loop;
 insert into public.intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,severity,confidence,ambiguity,risk,reversibility,status,
 evidence,source_interactions,source_entities,created_by,created_from,attributes,decision_id)
 values(oid,p_tenant,d->>'domain','Observation','observation',d->>'subject',d->>'severity',(d->>'confidence')::numeric,(d->>'ambiguity')::numeric,
 (d->>'risk')::numeric,(d->>'reversibility')::numeric,'monitoring',coalesce(d->'evidence','[]'),array[iid],nodes,'system',d->>'created_from',d->'attributes',did);
 insert into public.decision_log(id,tenant_id,object_id,object_snapshot,effective_profile_hash,policy_version_ids,matched_rules,outputs,
 input_hash,decision,operational_mode,next_owner_kind,engine_version,operating_profile_version,learning_version_ids,reason_codes,correlation_id,
 output_hash,supersedes,decision_package)
 values(did,p_tenant,oid,obj,pkg#>>'{audit,inputHash}',array(select jsonb_array_elements_text(pkg#>'{versions,policyVersionIds}'))::uuid[],pkg#>'{rationale,policyMatches}',
 jsonb_build_object('decision',pkg->'decision','reason_codes',pkg#>'{rationale,reasonCodes}','next_owner',pkg->'nextDecisionOwner','operational',op),
 pkg#>>'{audit,inputHash}',pkg->>'decision',op->>'mode',pkg#>>'{nextDecisionOwner,kind}',pkg#>>'{versions,engineVersion}',pkg#>>'{versions,operatingProfileVersion}',
 array(select jsonb_array_elements_text(pkg#>'{versions,learningVersionIds}')),array(select jsonb_array_elements_text(pkg#>'{rationale,reasonCodes}')),
 (pkg#>>'{audit,correlationId}')::uuid,pkg#>>'{audit,outputHash}',(pkg->>'supersedes')::uuid,pkg);
 insert into public.object_state_history(tenant_id,object_id,to_state,actor,reason,decision_id)
 values(p_tenant,oid,'monitoring','{"kind":"automation","ref":"intelligence.observe"}', 'Observation recorded in observe-only mode; no action executed',did);
 insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,source,domain,actor,payload,metadata)
 values(p_tenant,'intelligence.observation.created','intelligence_object',oid,'intelligence.observe',d->>'domain',
 '{"kind":"automation","ref":"intelligence.observe"}',jsonb_build_object('decision',pkg->'decision'),jsonb_build_object('decision_id',did,'job_id',p_job));
 update public.intelligence_ingestions set observation_id=oid,correlation_id=(pkg#>>'{audit,correlationId}')::uuid,status='observed' where id=g.id;
 r:=jsonb_build_object('version','learn-observation-delivery/1','state','committed','job_id',p_job,'tenant_id',p_tenant,
 'interaction_id',iid,'observation_id',oid,'decision_id',did,'decision',pkg->'decision','operational_mode',op->'mode','can_execute',false,'action_ids','[]'::jsonb,'graph_nodes',cardinality(nodes));
 insert into public.learn_observation_receipts(job_id,tenant_id,interaction_id,observation_id,receipt) values(p_job,p_tenant,iid,oid,r);
 return r;
end$$;
revoke all on function public.learn_observation_deliver(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.learn_observation_deliver(uuid,uuid,jsonb,jsonb) to service_role;

-- Explicit audited operator reads. No client RLS changes, provider calls or writes
-- to source records. Collection/column choices are server-owned allowlists.

create or replace function public.openfolk_client_information(
 p_tenant uuid,p_collection text,p_reason text,p_after uuid default null,p_record uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 tab text; cols text[]; body text; predicate text:='true'; result jsonb; entries jsonb; next_id uuid;
 audit_id uuid:=gen_random_uuid(); actor uuid:=auth.uid(); checked timestamptz;
begin
 -- Admin is required for business content, even though this operation only reads.
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 500
  or p_collection is null or (p_after is not null and p_record is not null) then
  raise exception 'operator_information_request_invalid' using errcode='22023';end if;
 case p_collection
 when 'customers' then tab:='customer_cards';cols:=array['title','summary','status','priority','person_id','company_id','owner_id','due_at','latest_activity_at','recommended_action','updated_at'];
 when 'contacts' then tab:='people';cols:=array['display_name','first_name','last_name','primary_email','primary_phone','company_id','address_text','postcode','verified','updated_at'];
 when 'companies' then tab:='companies';cols:=array['name','domain','phone','address_text','postcode','verified','updated_at'];
 when 'sites' then tab:='sites';cols:=array['label','source_system','external_id','company_id','person_id','address_text','postcode','verified','updated_at'];
 when 'jobs' then tab:='jobs';cols:=array['title','job_number','description','source_system','external_id','customer_person_id','customer_company_id','site_id','status','priority','value_pennies','created_date','booked_date','completed_date','verified','updated_at'];
 when 'emails' then tab:='email_messages';cols:=array['provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails','subject','snippet','body_text','sent_at','received_at','direction','updated_at'];
 when 'calls' then tab:='phone_calls';cols:=array['provider','provider_call_id','linked_id','direction','from_number','to_number','started_at','duration_seconds','outcome','updated_at'];
 when 'recordings' then tab:='phone_recordings';cols:=array['provider','provider_recording_id','provider_call_id','linked_id','file_size','started_at','duration_seconds','updated_at'];
 when 'transcripts' then tab:='phone_transcripts';cols:=array['recording_id','transcript_text','language','status','model','updated_at'];
 when 'communications' then tab:='interactions';cols:=array['source_connector_id','source_type','source_table','source_id','interaction_type','direction','occurred_at','subject','summary','body_preview','status','processing_status','related_person_id','related_company_id','related_job_id','updated_at'];
 when 'learning_observations' then
  tab:='intelligence_objects';cols:=array['subject','status','source_interactions','created_at','updated_at'];
  predicate:=$filter$t.object_type='Observation' and t.created_from='intelligence.ingest_interaction'
   and t.attributes#>>'{ingest,mapper_version}'='obs-ingest/2' and cardinality(t.source_interactions)=1
   and exists(select 1 from public.learn_observation_receipts r where r.tenant_id=t.tenant_id and r.observation_id=t.id
    and r.interaction_id=t.source_interactions[1] and r.receipt->>'state'='committed')$filter$;
 when 'business_sources' then tab:='learn_business_input_versions';cols:=array['provider','collection','external_id','connection_id','content_hash','first_seen_at'];
 else raise exception 'operator_information_collection_invalid' using errcode='22023';end case;
 -- Only receipt-backed LEARN observations are presented as completed processing.
 -- Project explicit columns, never return metadata, raw messages, credentials,
 -- provider recording URLs or Storage paths. Large scalar fields disclose truncation.
 select string_agg(format('%L,to_jsonb(t.%I)',c,c),',') into body from unnest(cols)c;
 if p_collection='business_sources' then
  body:=body||',''source_type'',t.payload->''type'',''source_status'',t.payload->''status'',''property_reference'',coalesce(t.payload->''propertyID'',t.payload->''parentPropertyID''),''description'',t.payload->''description'',''name'',t.payload->''name'',''address_line_1'',t.payload->''addressLine1'',''address_line_2'',t.payload->''addressLine2'',''postcode'',t.payload->''postcode''';
 end if;
 if p_collection='learning_observations' then
  body:=body||$fields$,'processing_method','rules-based observation',
   'channel',t.attributes->'channel','direction',t.attributes->'direction',
   'source_updated_at',t.attributes#>'{ingest,source_updated_at}',
   'source_current',(select i.updated_at=(t.attributes#>>'{ingest,source_updated_at}')::timestamptz
     from public.interactions i where i.tenant_id=t.tenant_id and i.id=t.source_interactions[1]),
   'decision',(select r.receipt->'decision' from public.learn_observation_receipts r
     where r.tenant_id=t.tenant_id and r.observation_id=t.id limit 1),
   'operational_mode',(select r.receipt->'operational_mode' from public.learn_observation_receipts r
     where r.tenant_id=t.tenant_id and r.observation_id=t.id limit 1),
   'can_execute',(select r.receipt->'can_execute' from public.learn_observation_receipts r
     where r.tenant_id=t.tenant_id and r.observation_id=t.id limit 1)$fields$;
 end if;
 execute format($query$
  with page as materialized(
   select t.id,jsonb_build_object(%s) fields from public.%I t
   where t.tenant_id=$1 and (%s) and ($2::uuid is null or t.id>$2)
    and ($3::uuid is null or t.id=$3) order by t.id limit 26
  ), shown as(select * from page order by id limit 25), mapped as(
   select id,jsonb_build_object('id',id,'fields',(
    select jsonb_object_agg(key,case when jsonb_typeof(value)='string' then to_jsonb(left(value#>>'{}',6000))
      when length(value::text)>6000 then to_jsonb(left(value::text,6000)) else value end)
    from jsonb_each(fields)),
    'truncated_fields',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from jsonb_each(fields)
     where case when jsonb_typeof(value)='string' then length(value#>>'{}') else length(value::text) end>6000)) entry
   from shown
  ) select coalesce((select jsonb_agg(entry order by id) from mapped),'[]'::jsonb),
   case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end
 $query$,body,tab,predicate) into entries,next_id using p_tenant,p_after,p_record;
 if p_record is not null and jsonb_array_length(entries)<>1 then
  raise exception 'operator_information_unavailable' using errcode='42501';end if;
 -- Recheck current effective authority before the response, retaining real actor.
 perform public.learn_operator_input_access(p_tenant,actor,true);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_information.read',p_collection,coalesce(p_record::text,p_tenant::text),
  jsonb_build_object('record_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(entries)x),'after',p_after),
  btrim(p_reason),audit_id::text,false,'openfolk-client-information');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 result:=jsonb_build_object('version','openfolk-client-information/1','tenant_id',p_tenant,'actor_id',actor,
  'collection',p_collection,'after',p_after,'record',p_record,'rows',entries,'next_after',next_id,
  'observed_at',checked,'audit_id',audit_id);
 return result;
end$$;
revoke all on function public.openfolk_client_information(uuid,text,text,uuid,uuid) from public,anon,service_role;
grant execute on function public.openfolk_client_information(uuid,text,text,uuid,uuid) to authenticated;

-- Complete legacy roster columns where absent; production already has these.
-- The count broker exposes only totals, retaining the raw input-table lockdown.

alter table public.team_members add column if not exists formal_role_status text not null default 'proposed' check(formal_role_status in ('proposed','confirmed'));
alter table public.team_members add column if not exists target_role text;
create function public.learn_learning_retained_counts(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_tenant is null or not exists(select 1 from public.tenants where id=p_tenant) then
  raise exception 'learning_tenant_unavailable' using errcode='42501';end if;
 return jsonb_build_object('version','learn-learning-counts/1','tenant_id',p_tenant,
  'commusoft_versions',(select count(*) from public.learn_business_input_versions where tenant_id=p_tenant and provider='commusoft'),
  'slack_messages',(select count(*) from public.slack_messages where tenant_id=p_tenant));
end$$;
revoke all on function public.learn_learning_retained_counts(uuid) from public,anon,authenticated;
grant execute on function public.learn_learning_retained_counts(uuid) to service_role;

insert into of_learn_deploy.migrations values('learn_learning_delivery_reads_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
