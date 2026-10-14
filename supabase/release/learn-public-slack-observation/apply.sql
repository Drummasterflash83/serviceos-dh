begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $$begin
if current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from '17047281e70605fde9db69df821f5db5528088b5a8b79a447f133c8968e8b932' then raise exception 'Reviewed target/source required';end if;
if (select md5(pg_get_functiondef(oid))||'|'||pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text from pg_proc where oid='public.intelligence_select_uningested(uuid,text,integer)'::regprocedure) is distinct from '8b9fca6f388b599604881b3f9b4c5651|postgres|{postgres=X/postgres,service_role=X/postgres}|false' then raise exception 'Reviewed function baseline changed';end if;
if (select md5(pg_get_functiondef(oid))||'|'||pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text from pg_proc where oid='public.learn_observation_deliver(uuid,uuid,jsonb,jsonb)'::regprocedure) is distinct from '8424ee4e639b930eac5f0ddb400cdd7e|postgres|{postgres=X/postgres,service_role=X/postgres}|true' then raise exception 'Reviewed function baseline changed';end if;
if (select md5(pg_get_functiondef(oid))||'|'||pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text from pg_proc where oid='public.learn_slack_message_kind(jsonb)'::regprocedure) is distinct from 'c93159306801b19d70bb4b223e49c977|postgres|{postgres=X/postgres}|false' then raise exception 'Reviewed function baseline changed';end if;
if (select md5(pg_get_functiondef(oid))||'|'||pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text from pg_proc where oid='public.learn_slack_document_withheld(uuid,jsonb)'::regprocedure) is distinct from 'dcd5606ed5fab4214ce581b4e7f610b8|postgres|{postgres=X/postgres}|true' then raise exception 'Reviewed function baseline changed';end if;
if to_regprocedure('public.learn_public_slack_observation_context(uuid,uuid)') is not null then raise exception 'Source qualifier already exists';end if;
end$$;

create function public.learn_public_slack_observation_context(p_tenant uuid,p_interaction uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog set timezone='UTC' as $$
declare i public.interactions%rowtype;s public.slack_messages%rowtype;v uuid;
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
 if not exists(select 1 from public.slack_source_visibility_proofs vp
  join public.slack_channel_visibility_receipts vr on vr.id=vp.receipt_id and vr.tenant_id=p_tenant
  join public.provider_connections c on c.id=vr.connection_id and c.tenant_id=p_tenant and c.provider='slack'
   and c.status='configured' and c.revoked_at is null and c.non_secret_config->>'team_id'=vr.team_id
  where vp.version_id=v and vr.team_id=s.team_id and vr.channel_id=s.channel_id
   and vr.evidence->>'version'='slack-capture-visibility/1'
   and vr.evidence->'is_channel'='true'::jsonb and vr.evidence->'is_private'='false'::jsonb
   and vr.evidence->'is_shared'='false'::jsonb and vr.evidence->'pending_shared'='false'::jsonb
   and vr.evidence ?& array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']
   and not exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) f
    where vr.evidence->f not in('false'::jsonb,'null'::jsonb))) then return null;end if;
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
 with limits as(select greatest(1,least(coalesce(p_limit,25),200)) n), eligible as materialized(
  select i.id,i.occurred_at,i.created_at,i.processing_status='enriched' enriched,
   coalesce(i.source_connector_id='slack' and i.source_table='slack_messages' and i.interaction_type='slack_message'
    and i.status not in('deleted','removed') and i.metadata#>>'{work_context,version}'='learn-slack-work-context/1'
    and i.metadata#>>'{work_context,state}'='reviewed' and i.metadata#>>'{work_context,source_version}'=i.metadata->>'source_version'
    and exists(select 1 from public.slack_messages s where s.tenant_id=i.tenant_id and s.id=i.source_id
     and s.source_version=i.metadata->>'source_version' and not coalesce(s.provider_payload->>'subtype'='tombstone' and s.provider_payload->'hidden'='true'::jsonb,false)),false) reviewed
  from public.interactions i where i.tenant_id=p_tenant
   and (i.processing_status='enriched' or case when i.processing_status='identity_review'
    and i.source_connector_id='slack' and i.source_table='slack_messages' and i.interaction_type='slack_message'
    and i.metadata#>>'{identity_delivery,reason}'='direction_unverified'
    then public.learn_public_slack_observation_context(p_tenant,i.id) is not null else false end)
   and not exists(select 1 from public.intelligence_ingestions g where g.tenant_id=p_tenant and g.interaction_id=i.id and g.mapper_version=p_mapper_version)
 ), reviewed as materialized(select * from eligible where reviewed order by occurred_at asc nulls first,created_at,id limit(select n/5 from limits)),
 recent_sources as materialized(select * from eligible e where not enriched and not exists(select 1 from reviewed r where r.id=e.id)
  order by occurred_at desc nulls last,created_at desc,id limit(select n*2/5 from limits)),
 history as(select * from eligible e where not exists(select 1 from reviewed r where r.id=e.id) and not exists(select 1 from recent_sources r where r.id=e.id)
  order by occurred_at asc nulls first,created_at,id limit(select n-(select count(*) from reviewed)-(select count(*) from recent_sources) from limits))
 select id from(select r.*,0 lane from reviewed r union all select r.*,1 lane from recent_sources r union all select h.*,2 lane from history h)x
 order by lane,case when lane=1 then occurred_at end desc nulls last,case when lane<>1 then occurred_at end asc nulls first,
  case when lane=1 then created_at end desc,case when lane<>1 then created_at end asc,id;
$$;

do $$begin
if (select md5(prosrc)||'|'||pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text||'|'||proconfig::text from pg_proc where oid='public.intelligence_select_uningested(uuid,text,integer)'::regprocedure) is distinct from 'a7d5df37fe9fe78f8cf55da5d67a48a5|postgres|{postgres=X/postgres,service_role=X/postgres}|false|{search_path=pg_catalog}' then raise exception 'Prepared function or authority differs';end if;
if (select md5(prosrc)||'|'||pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text||'|'||proconfig::text from pg_proc where oid='public.learn_observation_deliver(uuid,uuid,jsonb,jsonb)'::regprocedure) is distinct from '41fd2e0a95faabec25949cf9b1dbdac3|postgres|{postgres=X/postgres,service_role=X/postgres}|true|{"search_path=pg_catalog, public"}' then raise exception 'Prepared function or authority differs';end if;
if (select md5(prosrc)||'|'||pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text||'|'||proconfig::text from pg_proc where oid='public.learn_public_slack_observation_context(uuid,uuid)'::regprocedure) is distinct from 'a6c722aba45bc8290462d9649726fd9c|postgres|{postgres=X/postgres,service_role=X/postgres}|true|{search_path=pg_catalog,TimeZone=UTC}' then raise exception 'Prepared function or authority differs';end if;
end$$;
commit;
