CREATE OR REPLACE FUNCTION public.intelligence_select_uningested(p_tenant uuid, p_mapper_version text, p_limit integer DEFAULT 25)
 RETURNS TABLE(interaction_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
  select i.id
  from interactions i
  where i.tenant_id = p_tenant
    and i.processing_status = 'enriched'
    and not exists (
      select 1 from intelligence_ingestions g
      where g.tenant_id = p_tenant
        and g.interaction_id = i.id
        and g.mapper_version = p_mapper_version
    )
  order by i.occurred_at asc nulls first, i.created_at asc
  limit greatest(1, least(coalesce(p_limit, 25), 200));
$function$
