begin;
CREATE OR REPLACE FUNCTION public.learn_slack_document_withheld(p_tenant uuid, p_document jsonb)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$;

commit;
