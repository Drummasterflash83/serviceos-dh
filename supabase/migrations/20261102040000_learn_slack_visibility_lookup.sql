begin;
-- Preserve the existing withholding semantics, authority and ACL. Restrict the
-- dependency search to UUID values actually present in this document instead of
-- rebuilding all withheld observations/measurements for every candidate row.
create or replace function public.learn_slack_document_withheld(p_tenant uuid,p_document jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 with document_refs as materialized (
  select distinct (v #>> '{}')::uuid id
  from jsonb_path_query(coalesce(p_document,'null'::jsonb),'strict $.** ? (@.type() == "string")') v
  where (v #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ), measurement_refs as materialized (
  select distinct (v #>> '{}')::uuid id
  from document_refs r join public.measurements m on m.tenant_id=p_tenant and m.id=r.id
  cross join lateral jsonb_path_query(jsonb_build_object('evidence',m.evidence,'exclusions',m.exclusions,'request',m.request_payload),
   'strict $.** ? (@.type() == "string")') v
  where (v #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ), direct_refs as materialized (
  select id from document_refs union select id from measurement_refs
 ), observation_refs as materialized (
  select distinct (v #>> '{}')::uuid id
  from direct_refs r join public.intelligence_objects o on o.tenant_id=p_tenant and o.id=r.id
  cross join lateral jsonb_path_query(jsonb_build_object('sources',o.source_interactions,'evidence',o.evidence),
   'strict $.** ? (@.type() == "string")') v
  where (v #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ), interaction_refs as (
  select id from direct_refs union select id from observation_refs
 )
 select exists (
  select 1 from interaction_refs r
  join public.interactions i on i.id=r.id and i.tenant_id=p_tenant and i.source_table='slack_messages'
  join public.slack_messages s on s.tenant_id=i.tenant_id and s.id=i.source_id
  where s.provider_payload->>'type'='message' and s.provider_payload->>'subtype'='tombstone'
   and s.provider_payload->'hidden'='true'::jsonb
 )
$$;
commit;
