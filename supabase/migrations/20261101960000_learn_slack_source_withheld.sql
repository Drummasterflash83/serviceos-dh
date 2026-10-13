begin;
-- PREPARED ONLY. Exact provider withholding marker; no restoration is inferred.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_message_kind(jsonb)'::regprocedure);
 needle:=' if jsonb_typeof(m) is distinct from ''object''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Classifier baseline differs';end if;
 execute replace(d,needle,$patch$ if m->>'type'='message' and m->>'subtype'='tombstone' and m->'hidden'='true'::jsonb then return 'source_withheld';end if;
$patch$||needle);
end$$;

create index slack_withheld_source_identity on public.slack_messages(tenant_id,id) where provider_payload->>'type'='message' and provider_payload->>'subtype'='tombstone' and provider_payload->'hidden'='true'::jsonb;

-- Private helpers do not grant clients a new source reader.
create function public.learn_slack_source_withheld(p_tenant uuid,p_source uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.slack_messages s where s.tenant_id=p_tenant and s.id=p_source
 and s.provider_payload->>'type'='message' and s.provider_payload->>'subtype'='tombstone' and s.provider_payload->'hidden'='true'::jsonb)
$$;
revoke all on function public.learn_slack_source_withheld(uuid,uuid) from public,anon,authenticated,service_role;
create function public.learn_slack_interaction_withheld(p_tenant uuid,p_interaction uuid) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.interactions i where i.tenant_id=p_tenant and i.id=p_interaction
 and i.source_table='slack_messages' and public.learn_slack_source_withheld(i.tenant_id,i.source_id))
$$;
revoke all on function public.learn_slack_interaction_withheld(uuid,uuid) from public,anon,authenticated,service_role;

-- Raw versions stay immutable. Ordinary projections are cleared; stale queued
-- enrichment cannot put their preview, source version or customer links back.
create function public.learn_slack_withheld_interaction_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$declare s public.slack_messages%rowtype;begin
 if tg_op='UPDATE' and old.source_table='slack_messages' and public.learn_slack_source_withheld(old.tenant_id,old.source_id)
  and (new.tenant_id,new.source_table,new.source_id) is distinct from (old.tenant_id,old.source_table,old.source_id)
 then raise exception 'Withheld source identity cannot change' using errcode='55000';end if;
 if new.source_table is distinct from 'slack_messages' then return new;end if;
 select * into s from public.slack_messages where tenant_id=new.tenant_id and id=new.source_id;
 if not found or not public.learn_slack_source_withheld(new.tenant_id,new.source_id) then return new;end if;
 new.status:='removed';new.processing_status:='source_withheld';
 new.subject:=null;new.summary:=null;new.body_preview:=null;
 new.from_address:=null;new.from_name:=null;new.to_addresses:='{}';new.cc_addresses:='{}';
 new.phone_from:=null;new.phone_to:=null;new.sentiment:=null;new.priority:=null;
 new.related_thread_id:=null;new.related_campaign_id:=null;new.source_version:=s.source_version;
 new.related_person_id:=null;new.related_company_id:=null;new.related_job_id:=null;new.related_task_id:=null;
 new.metadata:=jsonb_build_object('source_version',s.source_version,'message_kind','source_withheld','provider_subtype','tombstone','source_withheld',true);
 return new;
end$$;
revoke all on function public.learn_slack_withheld_interaction_guard() from public,anon,authenticated,service_role;
create trigger zzzz_slack_withheld_interaction_guard before insert or update on public.interactions for each row execute function public.learn_slack_withheld_interaction_guard();

create function public.learn_slack_withheld_source_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$begin
 if old.provider_payload->>'type'='message' and old.provider_payload->>'subtype'='tombstone' and old.provider_payload->'hidden'='true'::jsonb
  and ((new.id,new.tenant_id,new.source_external_id,new.team_id,new.channel_id,new.provider_timestamp) is distinct from (old.id,old.tenant_id,old.source_external_id,old.team_id,old.channel_id,old.provider_timestamp) or (new.provider_payload->>'type'='message' and new.provider_payload->>'subtype'='tombstone' and new.provider_payload->'hidden'='true'::jsonb) is distinct from true)
 then raise exception 'Explicit source restoration required' using errcode='55000';end if;
 return new;
end$$;
revoke all on function public.learn_slack_withheld_source_guard() from public,anon,authenticated,service_role;
create trigger slack_withheld_source_guard before update on public.slack_messages for each row execute function public.learn_slack_withheld_source_guard();

do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_store_records(uuid,jsonb,jsonb,text)'::regprocedure);
 needle:=$old$seen=array_append(seen,r->>'provider_timestamp');$old$;
 replacement:=$new$if r->'provider_payload'->>'type'='message' and r->'provider_payload'->>'subtype'='tombstone'
   and r->'provider_payload'->'hidden'='true'::jsonb and exists(
    select 1 from public.interactions i join public.learn_identity_delivery_receipts d on d.tenant_id=i.tenant_id and d.interaction_id=i.id
    where i.tenant_id=p_tenant_id and i.source_table='slack_messages' and i.source_id in(select sm.id from public.slack_messages sm where sm.tenant_id=p_tenant_id and sm.source_external_id=r->>'source_external_id')
     and d.receipt->>'state'='committed' and nullif(d.receipt->>'cardId','') is not null)
  then raise exception 'slack_history_withheld_card_review_required' using errcode='PT409';end if;
  seen=array_append(seen,r->>'provider_timestamp');$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Card withholding preflight baseline differs';end if;d:=replace(d,needle,replacement);

 needle:=$old$or r->'provider_payload'->>'text' is distinct from r->>'text'$old$;
 replacement:=$new$or ((jsonb_typeof(r->'provider_payload'->'text') is distinct from 'string' or r->'provider_payload'->>'text' is distinct from r->>'text')
    and (r->'provider_payload'->>'type'='message' and r->'provider_payload'->>'subtype'='tombstone'
     and r->'provider_payload'->'hidden'='true'::jsonb and not (r->'provider_payload' ? 'text') and r->>'text'='') is distinct from true)$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Provider text binding baseline differs';end if;d:=replace(d,needle,replacement);

 needle:=$old$and public.learn_slack_message_kind(m.provider_payload) <> public.learn_slack_message_kind(r->'provider_payload'))$old$;
 replacement:=$new$and public.learn_slack_message_kind(m.provider_payload) <> public.learn_slack_message_kind(r->'provider_payload')
   and public.learn_slack_message_kind(m.provider_payload)<>'source_withheld'
   and public.learn_slack_message_kind(r->'provider_payload')<>'source_withheld')$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Semantic guard baseline differs';end if;d:=replace(d,needle,replacement);
 needle:='source_updated_at=excluded.source_updated_at,updated_at=now()';
 replacement:='source_updated_at=greatest(slack_messages.source_updated_at,excluded.source_updated_at),updated_at=now()';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Source clock baseline differs';end if;d:=replace(d,needle,replacement);
 needle:='where slack_messages.source_updated_at<=excluded.source_updated_at and slack_messages.source_version is distinct from excluded.source_version;';
 replacement:=$new$where (public.learn_slack_message_kind(excluded.provider_payload)='source_withheld'
    or (public.learn_slack_message_kind(slack_messages.provider_payload)<>'source_withheld' and slack_messages.source_updated_at<=excluded.source_updated_at))
    and slack_messages.source_version is distinct from excluded.source_version;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Source revision baseline differs';end if;d:=replace(d,needle,replacement);
 needle:='  insert into public.slack_message_versions(tenant_id,message_id,source_version,provider_payload)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Retained source identity baseline differs';end if;
 d:=replace(d,needle,'  select id into strict sid from public.slack_messages where tenant_id=p_tenant_id and source_external_id=r->>''source_external_id'';'||chr(10)||needle);
 needle:=$old$if public.learn_slack_message_kind(r->'provider_payload') in ('channel_activity','source_needs_review') then continue;end if;$old$;
 replacement:=$new$if public.learn_slack_message_kind(r->'provider_payload')='source_withheld' then
   update public.interactions set status='removed' where tenant_id=p_tenant_id and source_table='slack_messages' and source_id=sid;
   continue;
  end if;
  if public.learn_slack_message_kind(r->'provider_payload') in ('channel_activity','source_needs_review') then continue;end if;$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Projection baseline differs';end if;d:=replace(d,needle,replacement);
 execute d;
 -- Withheld roots may still have available replies. Capture only those replies
 -- that independently pass the existing public-scope/shape/source contracts.
 d:=pg_get_functiondef('public.learn_slack_campaign_threads_step(uuid,uuid)'::regprocedure);
 needle:=$old$in ('conversation','source_needs_review')$old$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Thread discovery baseline differs';end if;
 execute replace(d,needle,$new$in ('conversation','source_needs_review','source_withheld')$new$);
end$$;
-- A typed UUID reference retained anywhere in an evidence/snapshot document is
-- a direct dependency. Free text is not searched or reinterpreted as identity.
create function public.learn_slack_document_withheld(p_tenant uuid,p_document jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 with held_interactions as materialized (
  select i.id from public.interactions i join public.slack_messages s on s.tenant_id=i.tenant_id and s.id=i.source_id
   where i.tenant_id=p_tenant and i.source_table='slack_messages' and s.provider_payload->>'type'='message'
   and s.provider_payload->>'subtype'='tombstone' and s.provider_payload->'hidden'='true'::jsonb
 ), held_observations as materialized (
  select o.id from public.intelligence_objects o where o.tenant_id=p_tenant and exists(select 1 from held_interactions h
   where h.id=any(o.source_interactions) or jsonb_path_exists(o.evidence,'strict $.** ? (@ == $id)',jsonb_build_object('id',h.id::text)))
 ), source_ids as materialized (select id from held_interactions union select id from held_observations),
 held_measurements as materialized (
  select m.id from public.measurements m where m.tenant_id=p_tenant and exists(select 1 from source_ids h
   where jsonb_path_exists(jsonb_build_object('evidence',m.evidence,'exclusions',m.exclusions,'request',m.request_payload),
    'strict $.** ? (@ == $id)',jsonb_build_object('id',h.id::text)))
 ), ids as (select id from source_ids union select id from held_measurements)
 select exists(select 1 from ids h where jsonb_path_exists(coalesce(p_document,'null'),
  'strict $.** ? (@ == $id)',jsonb_build_object('id',h.id::text)))
$$;
revoke all on function public.learn_slack_document_withheld(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.learn_slack_derived_withheld(p_tenant uuid,p_kind text,p_id uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$declare d jsonb;n public.graph_nodes%rowtype;e public.graph_edges%rowtype;begin
 if p_kind='source' then return public.learn_slack_source_withheld(p_tenant,p_id);end if;
 if p_kind='interaction' then return public.learn_slack_interaction_withheld(p_tenant,p_id);end if;
 if p_kind='observation' then select jsonb_build_object('sources',source_interactions,'evidence',evidence) into d from public.intelligence_objects where tenant_id=p_tenant and id=p_id;
 elsif p_kind='decision' then
  if exists(select 1 from public.decision_log q where q.tenant_id=p_tenant and q.id=p_id and public.learn_slack_derived_withheld(p_tenant,'observation',q.object_id)) then return true;end if;
  select object_snapshot into d from public.decision_log where tenant_id=p_tenant and id=p_id;
 elsif p_kind='recommendation' then select jsonb_build_object('interaction',interaction_id,'evidence',evidence) into d from public.recommendations where tenant_id=p_tenant and id=p_id;
 elsif p_kind='suggestion' then select jsonb_build_object('interaction',interaction_id,'evidence',evidence) into d from public.interaction_match_suggestions where tenant_id=p_tenant and id=p_id;
 elsif p_kind='measurement' then select jsonb_build_object('evidence',evidence,'exclusions',exclusions,'request',request_payload) into d from public.measurements where tenant_id=p_tenant and id=p_id;
 elsif p_kind='assessment' then select snapshot into d from public.learn_assessments where tenant_id=p_tenant and id=p_id;
 elsif p_kind='job' then select payload into d from public.platform_jobs where tenant_id=p_tenant and id=p_id;
 elsif p_kind='graph_node' then
  select * into n from public.graph_nodes where tenant_id=p_tenant and id=p_id;
  if n.source_table='interactions' then return public.learn_slack_interaction_withheld(p_tenant,n.source_id);end if;
  if n.source_table='intelligence_objects' then return public.learn_slack_derived_withheld(p_tenant,'observation',n.source_id);end if;
  return public.learn_slack_document_withheld(p_tenant,n.metadata);
 elsif p_kind='graph_edge' then
  select * into e from public.graph_edges where tenant_id=p_tenant and id=p_id;
  return public.learn_slack_derived_withheld(p_tenant,'graph_node',e.from_node_id) or public.learn_slack_derived_withheld(p_tenant,'graph_node',e.to_node_id)
   or public.learn_slack_document_withheld(p_tenant,e.evidence);
 else raise exception 'Unsupported withheld dependency';end if;
 return public.learn_slack_document_withheld(p_tenant,d);
end$$;
revoke all on function public.learn_slack_derived_withheld(uuid,text,uuid) from public,anon,authenticated,service_role;

-- New callable helper returns availability only, and only within the caller's
-- existing tenant. It cannot retrieve text or test foreign-company sources.
-- Fail the affected scoring query rather than silently compute a partial score.
create function public.learn_slack_source_read_available(p_tenant uuid,p_kind text,p_id uuid) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$begin
 if auth.uid() is null or p_tenant is distinct from public.current_tenant_id() then return false;end if;
 if p_kind in('measurement','assessment') and coalesce(public.current_user_role(),'') not in('owner','admin') then return false;end if;
 if public.learn_slack_derived_withheld(p_tenant,p_kind,p_id) then
  if p_kind in('measurement','assessment') then raise exception 'Retained scoring evidence is currently unavailable' using errcode='PT409';end if;
  return false;
 end if;
 return true;
end$$;
revoke all on function public.learn_slack_source_read_available(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_slack_source_read_available(uuid,text,uuid) to authenticated;
create policy slack_source_withheld_read on public.slack_messages as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'source',id));
create policy slack_version_withheld_read on public.slack_message_versions as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'source',message_id));
create policy slack_interaction_withheld_read on public.interactions as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'interaction',id));
create policy slack_observation_withheld_read on public.intelligence_objects as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'observation',id));
create policy slack_decision_withheld_read on public.decision_log as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'decision',id));
create policy slack_graph_node_withheld_read on public.graph_nodes as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'graph_node',id));
create policy slack_graph_edge_withheld_read on public.graph_edges as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'graph_edge',id));
create policy slack_job_withheld_read on public.platform_jobs as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'job',id));
create policy slack_measurement_withheld_read on public.measurements as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'measurement',id));
create policy slack_assessment_withheld_read on public.learn_assessments as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'assessment',id));

-- Existing privileged readers bypass ordinary tenant RLS; add explicit source
-- availability there, retaining their current operator-access/audit checks.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_slack_threads_read(uuid,uuid,text)'::regprocedure);
 needle:=$old$'excerpt',left(message_text,400)$old$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Thread reader baseline differs';end if;
 execute replace(d,needle,$new$'excerpt',case when public.learn_slack_source_withheld(p_tenant_id,id) then 'Unavailable at source' else left(message_text,400) end$new$);
 d:=pg_get_functiondef('public.learn_slack_context_state(uuid,uuid,uuid)'::regprocedure);
 needle:=' if p_job is not null then';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Context reader baseline differs';end if;
 execute replace(d,needle,' if public.learn_slack_source_withheld(p_tenant,s.id) then raise exception ''slack_context_source_withheld'' using errcode=''PT409'';end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.learn_observation_deliver(uuid,uuid,jsonb,jsonb)'::regprocedure);
 needle:=' select receipt into r from public.learn_observation_receipts';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Observation delivery baseline differs';end if;
 execute replace(d,needle,' if public.learn_slack_document_withheld(p_tenant,q.payload) then raise exception ''learn_observation_source_withheld'';end if;'||chr(10)||needle);
 d:=pg_get_functiondef('public.openfolk_client_information(uuid,text,text,uuid,uuid)'::regprocedure);
 needle:='and cardinality(t.source_interactions)=1';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Operator observation reader baseline differs';end if;
 execute replace(d,needle,needle||' and not public.learn_slack_derived_withheld(t.tenant_id,''observation'',t.id)');
 d:=pg_get_functiondef('public.learn_work_measurement_receipt_check(uuid,uuid)'::regprocedure);
 needle:=' if coalesce(m.source,''''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Measurement receipt baseline differs';end if;
 execute replace(d,needle,' if public.learn_slack_derived_withheld(p_tenant,''measurement'',m.id) then raise exception ''Scoring source is currently withheld'' using errcode=''PT409'';end if;'||chr(10)||needle);
end$$;

-- Defence against an already-running observer publishing an obsolete result
-- through a different existing writer after its source was withheld.
create function public.learn_slack_withheld_derivation_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$declare d jsonb;begin
 if tg_op='UPDATE' and public.learn_slack_derived_withheld(old.tenant_id,case tg_table_name when 'intelligence_objects' then 'observation' when 'decision_log' then 'decision' when 'graph_nodes' then 'graph_node' when 'graph_edges' then 'graph_edge' when 'recommendations' then 'recommendation' else 'suggestion' end,old.id) then raise exception 'Withheld derivation remains audit-only' using errcode='PT409';end if;
 if tg_table_name='intelligence_objects' then
  d:=jsonb_build_object('sources',new.source_interactions,'evidence',new.evidence);
 elsif tg_table_name='decision_log' then
  if public.learn_slack_derived_withheld(new.tenant_id,'observation',new.object_id) then raise exception 'Source is currently withheld' using errcode='PT409';end if;
  d:=new.object_snapshot;
 elsif tg_table_name in('recommendations','interaction_match_suggestions') then
  d:=jsonb_build_object('interaction',new.interaction_id,'evidence',new.evidence);
 elsif tg_table_name='graph_nodes' then
  if (new.source_table='interactions' and public.learn_slack_interaction_withheld(new.tenant_id,new.source_id))
   or (new.source_table='intelligence_objects' and public.learn_slack_derived_withheld(new.tenant_id,'observation',new.source_id))
   then raise exception 'Source is currently withheld' using errcode='PT409';end if;
  d:=new.metadata;
 elsif tg_table_name='graph_edges' then
  if public.learn_slack_derived_withheld(new.tenant_id,'graph_node',new.from_node_id) or public.learn_slack_derived_withheld(new.tenant_id,'graph_node',new.to_node_id)
   then raise exception 'Source is currently withheld' using errcode='PT409';end if;
  d:=new.evidence;
 else raise exception 'Unknown source derivation table';end if;
 if public.learn_slack_document_withheld(new.tenant_id,d) then raise exception 'Source is currently withheld' using errcode='PT409';end if;
 return new;
end$$;
revoke all on function public.learn_slack_withheld_derivation_guard() from public,anon,authenticated,service_role;
create trigger slack_withheld_observation_guard before insert or update on public.intelligence_objects for each row execute function public.learn_slack_withheld_derivation_guard();
create trigger slack_withheld_decision_guard before insert or update on public.decision_log for each row execute function public.learn_slack_withheld_derivation_guard();

create trigger slack_withheld_graph_node_guard before insert or update on public.graph_nodes for each row execute function public.learn_slack_withheld_derivation_guard();
create trigger slack_withheld_graph_edge_guard before insert or update on public.graph_edges for each row execute function public.learn_slack_withheld_derivation_guard();

create policy slack_recommendation_withheld_read on public.recommendations as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'recommendation',id));
create policy slack_suggestion_withheld_read on public.interaction_match_suggestions as restrictive for select to authenticated using(public.learn_slack_source_read_available(tenant_id,'suggestion',id));
create trigger slack_withheld_recommendation_guard before insert or update on public.recommendations for each row execute function public.learn_slack_withheld_derivation_guard();
create trigger slack_withheld_suggestion_guard before insert or update on public.interaction_match_suggestions for each row execute function public.learn_slack_withheld_derivation_guard();
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_card_projection_inputs(uuid,uuid)'::regprocedure);
 needle:=$old$r.card_id=p_card and r.status='open'$old$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Card recommendation projection baseline differs';end if;
 execute replace(d,needle,needle||$new$ and not public.learn_slack_derived_withheld(r.tenant_id,'recommendation',r.id)$new$);
end$$;
-- Add a separate unavailable-source count to the existing authorised campaign read.
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_campaign_read(uuid,uuid)'::regprocedure);
 needle:=$old$'threadsComplete',threads_done,'complete',all_done,$old$;
 replacement:=$new$'sourceWithheldCount',(select count(*) from public.slack_messages sm
  where sm.tenant_id=h.tenant_id and sm.team_id=h.team_id
   and sm.provider_timestamp::numeric between extract(epoch from h.starts_at) and extract(epoch from h.ends_at)
   and exists(select 1 from public.slack_history_campaign_channels mc where mc.campaign_id=h.id and mc.tenant_id=h.tenant_id and mc.channel_id=sm.channel_id)
   and sm.provider_payload->>'type'='message' and sm.provider_payload->>'subtype'='tombstone' and sm.provider_payload->'hidden'='true'::jsonb),
 'threadsComplete',threads_done,'complete',all_done,$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Campaign coverage reader baseline differs';end if;
 execute replace(d,needle,replacement);
end$$;
-- A source replay can observe an actual withholding marker. Save that exact
-- marker under the existing identity/scope/budget, without verifying the old version.
do $$declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.learn_slack_commit_source_replay(uuid,uuid,text,integer,jsonb,jsonb)'::regprocedure);
 needle:='result_state text;begin';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay declaration baseline differs';end if;
 d:=replace(d,needle,'result_state text;withheld_version text;begin');
 needle:=' if matched then';
 replacement:=$new$ if not matched and jsonb_array_length(p_records)=1
  and p_records->0->'provider_payload'->>'type'='message' and p_records->0->'provider_payload'->>'subtype'='tombstone'
  and p_records->0->'provider_payload'->'hidden'='true'::jsonb then
  perform public.learn_slack_store_records(p_tenant,cfg,p_records,cfg->>'parentTimestamp');
  select source_version into strict withheld_version from public.slack_messages where tenant_id=p_tenant and id=s.id;
 end if;
 if matched then$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay match baseline differs';end if;d:=replace(d,needle,replacement);
 needle:=$old$'records_processed',case when matched then 1 else 0 end,'committed_at'$old$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay receipt baseline differs';end if;
 d:=replace(d,needle,$new$'withheld_source_version',withheld_version,'records_processed',case when matched or withheld_version is not null then 1 else 0 end,'committed_at'$new$);execute d;
 d:=pg_get_functiondef('public.learn_slack_source_replay_allowed(uuid,uuid)'::regprocedure);
 needle:='s.source_version=r.source_version';
 replacement:=$new$(s.source_version=r.source_version or (
  j.metadata->'slack_page_v1'->>'kind'='source_replay' and j.metadata->'slack_page_v1'->>'replay_id'=r.id::text
  and j.metadata->'slack_page_v1'->>'account_id'=r.account_id::text and j.metadata->'slack_page_v1'->>'state'='source_changed'
  and j.metadata->'slack_page_v1'->>'withheld_source_version'=s.source_version
  and public.learn_slack_source_withheld(p_tenant,s.id)))$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Replay authority baseline differs';end if;execute replace(d,needle,replacement);
end$$;
commit;
