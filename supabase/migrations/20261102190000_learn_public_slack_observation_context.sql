-- Observe proven public-channel source evidence without fabricating attribution.
-- No source/identity updates, new browser grants, capture changes or external actions.
begin;
create function public.learn_public_slack_observation_context(p_tenant uuid,p_interaction uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare i public.interactions%rowtype;s public.slack_messages%rowtype;v uuid;rid uuid;proven boolean:=false;
begin
 -- Resolve unique identities first. Do not let a broad joined predicate classify
 -- unrelated sources or rescan the entire receipt history for every interaction.
 select * into i from public.interactions where tenant_id=p_tenant and id=p_interaction;
 if not found or i.source_type is distinct from 'chat' or i.source_connector_id is distinct from 'slack'
  or i.source_table is distinct from 'slack_messages' or i.interaction_type is distinct from 'slack_message'
  or i.processing_status is distinct from 'identity_review' or i.direction is distinct from 'unknown'
  or i.metadata#>>'{identity_delivery,state}' is distinct from 'review_required'
  or i.metadata#>>'{identity_delivery,reason}' is distinct from 'direction_unverified'
  or coalesce(i.status,'') in('deleted','removed') or i.related_person_id is not null
  or i.related_company_id is not null or i.related_job_id is not null or i.subject is not null or i.summary is not null
  or i.metadata ? 'work_context'
  or not exists(select 1 from public.tenants t where t.id=p_tenant and t.status='active') then return null;end if;
 select * into s from public.slack_messages where tenant_id=p_tenant and id=i.source_id and source_version=i.metadata->>'source_version';
 if not found or s.source_version!~'^[a-f0-9]{64}$' or nullif(btrim(s.message_text),'') is null
  or i.body_preview is distinct from left(s.message_text,2000) then return null;end if;
 begin
  if public.learn_slack_message_kind(s.provider_payload) is distinct from 'conversation' then return null;end if;
 exception when raise_exception then return null; -- Unsupported source shape stays held.
 end;
 select sv.id into v from public.slack_message_versions sv where sv.tenant_id=p_tenant
  and sv.message_id=s.id and sv.source_version=s.source_version and sv.provider_payload=s.provider_payload;
 if not found then return null;end if;
 -- Anchor each receipt lookup to this exact indexed source version. A broad
 -- joined plan can scan every channel receipt for each historical interaction.
 for rid in select receipt_id from public.slack_source_visibility_proofs where version_id=v loop
  if exists(select 1 from public.slack_channel_visibility_receipts vr
  where vr.id=rid and vr.tenant_id=p_tenant and vr.team_id=s.team_id and vr.channel_id=s.channel_id
   and exists(select 1 from public.provider_connections c where c.id=vr.connection_id
    and c.tenant_id=p_tenant and c.provider='slack' and c.status='configured' and c.revoked_at is null
    and c.non_secret_config->>'team_id'=vr.team_id)
   and vr.evidence->>'version'='slack-capture-visibility/1'
   and vr.evidence->'is_channel'='true'::jsonb and vr.evidence->'is_private'='false'::jsonb
   and vr.evidence->'is_shared'='false'::jsonb and vr.evidence->'pending_shared'='false'::jsonb
   and vr.evidence ?& array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']
   and not exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) f
    where vr.evidence->f not in('false'::jsonb,'null'::jsonb))) then proven:=true;exit;end if;
 end loop;
 if not proven then return null;end if;
 return jsonb_build_object('version','learn-retained-source-context/1','scope','company_source','attribution','unresolved',
  'tenant_id',i.tenant_id,'interaction_id',i.id,'source_id',s.id,'source_version',s.source_version,'interaction_updated_at',i.updated_at);
end$$;
revoke all on function public.learn_public_slack_observation_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_public_slack_observation_context(uuid,uuid) to service_role;

-- The observer rechecks the current proof in its existing atomic, observe-only
-- commit. It preserves the lease, timestamp, mapper, tenant and zero-action gates.
do $$declare d text;needle text:='if not found or i.processing_status<>''enriched'' or d#>>''{attributes,ingest,source_updated_at}'' is null';begin
 d:=pg_get_functiondef('public.learn_observation_deliver(uuid,uuid,jsonb,jsonb)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Observation lifecycle guard differs';end if;
 d:=replace(d,needle,$guard$if not found or (i.processing_status<>'enriched' and (
  public.learn_public_slack_observation_context(p_tenant,i.id) is null or
  d#>'{attributes,retained_source_context}' is distinct from public.learn_public_slack_observation_context(p_tenant,i.id)))
  or d#>>'{attributes,ingest,source_updated_at}' is null$guard$);
 execute d;
end$$;

-- Keep reviewed work and old eligible history moving, while beginning with the
-- newest qualifying unresolved company sources. Unused reserved slots return to
-- the oldest-first lane; all existing mapper ledger states remain excluded.
create or replace function public.intelligence_select_uningested(p_tenant uuid,p_mapper_version text,p_limit integer default 25)
returns table(interaction_id uuid) language sql stable security invoker set search_path=pg_catalog as $$
 with limits as(select greatest(1,least(coalesce(p_limit,25),200)) n), candidates as materialized(
  select i.id,i.occurred_at,i.created_at,i.processing_status='enriched' enriched,
   coalesce(i.source_connector_id='slack' and i.source_table='slack_messages' and i.interaction_type='slack_message'
    and i.status not in('deleted','removed') and i.metadata#>>'{work_context,version}'='learn-slack-work-context/1'
    and i.metadata#>>'{work_context,state}'='reviewed' and i.metadata#>>'{work_context,source_version}'=i.metadata->>'source_version'
    and exists(select 1 from public.slack_messages s where s.tenant_id=i.tenant_id and s.id=i.source_id
     and s.source_version=i.metadata->>'source_version' and not coalesce(s.provider_payload->>'subtype'='tombstone' and s.provider_payload->'hidden'='true'::jsonb,false)),false) reviewed
  from public.interactions i where i.tenant_id=p_tenant
   and (i.processing_status='enriched' or (i.processing_status='identity_review'
    and i.source_connector_id='slack' and i.source_table='slack_messages' and i.interaction_type='slack_message'
    and i.metadata#>>'{identity_delivery,reason}'='direction_unverified'))
   and not exists(select 1 from public.intelligence_ingestions g where g.tenant_id=p_tenant and g.interaction_id=i.id and g.mapper_version=p_mapper_version)
 ), reviewed as materialized(select * from candidates where enriched and reviewed
  order by occurred_at asc nulls first,created_at,id limit(select n/5 from limits)),
 -- Materialize order before proof evaluation. LIMIT is applied only after a
 -- source qualifies, so unavailable history cannot conceal later valid sources.
 recent_candidates as materialized(select * from candidates where not enriched
  order by occurred_at desc nulls last,created_at desc,id),
 recent_sources as materialized(select * from recent_candidates e
  where public.learn_public_slack_observation_context(p_tenant,e.id) is not null
  limit(select n*2/5 from limits)),
 history_candidates as materialized(select * from candidates e
  where not exists(select 1 from reviewed r where r.id=e.id)
   and not exists(select 1 from recent_sources r where r.id=e.id)
  order by occurred_at asc nulls first,created_at,id),
 history as(select * from history_candidates e
  where enriched or public.learn_public_slack_observation_context(p_tenant,e.id) is not null
  limit(select n-(select count(*) from reviewed)-(select count(*) from recent_sources) from limits))
 select id from(select r.*,0 lane from reviewed r union all select r.*,1 lane from recent_sources r union all select h.*,2 lane from history h)x
 order by lane,case when lane=1 then occurred_at end desc nulls last,case when lane<>1 then occurred_at end asc nulls first,
  case when lane=1 then created_at end desc,case when lane<>1 then created_at end asc,id;
$$;
commit;
