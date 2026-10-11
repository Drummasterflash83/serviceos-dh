-- Card refresh must use the same retained-source eligibility as publication.
-- Filtering happens before bounded windows; source records are never removed.
begin;
create function public.learn_card_projection_inputs(p_tenant uuid,p_card uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare c public.customer_cards%rowtype; answer jsonb;
begin
 if p_tenant is null or p_card is null then raise exception 'card_projection_scope_required' using errcode='22023';end if;
 select * into c from public.customer_cards where tenant_id=p_tenant and id=p_card;
 if not found then raise exception 'card_projection_card_unavailable' using errcode='PT404';end if;
 with associated as materialized (
  select i.id,i.interaction_type,i.direction,i.occurred_at,i.sentiment,i.source_type,
   public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id) as draft
  from public.interactions i where i.tenant_id=p_tenant
   and (i.related_person_id=c.person_id or i.related_company_id=c.company_id)
   and coalesce(i.status,'') not in('deleted','removed')
 ), eligible as materialized (select * from associated where not draft),
 bounded as (select id,interaction_type,direction,occurred_at,sentiment,source_type from eligible order by occurred_at desc nulls last,id limit 100),
 recs as materialized (
  select r.id,r.type,r.title,r.severity,r.status,r.recommended_action,r.created_at,
   coalesce(public.learn_interaction_is_draft(i.tenant_id,i.source_table,i.source_id),false) as draft
  from public.recommendations r left join public.interactions i on i.tenant_id=r.tenant_id and i.id=r.interaction_id
  where r.tenant_id=p_tenant and r.card_id=p_card and r.status='open'
 ), eligible_recs as materialized (select * from recs where not draft),
 bounded_recs as (select id,type,title,severity,status,recommended_action,created_at from eligible_recs order by created_at desc,id limit 50)
 select jsonb_build_object('version','learn-card-inputs/1','tenantId',p_tenant,'cardId',p_card,'capturedAt',statement_timestamp(),
  'interactions',coalesce((select jsonb_agg(to_jsonb(b) order by occurred_at desc nulls last,id) from bounded b),'[]'),
  'recommendations',coalesce((select jsonb_agg(to_jsonb(b) order by created_at desc,id) from bounded_recs b),'[]'),
  'coverage',jsonb_build_object('eligibleInteractions',(select count(*) from eligible),
   'excludedDraftInteractions',(select count(*) from associated where draft),
   'interactionsLast7',(select count(*) from eligible where occurred_at>=statement_timestamp()-interval '7 days' and occurred_at<=statement_timestamp()),
   'interactionsPrev7',(select count(*) from eligible where occurred_at>=statement_timestamp()-interval '14 days' and occurred_at<statement_timestamp()-interval '7 days'),
   'eligibleRecommendations',(select count(*) from eligible_recs),
   'urgentRecommendations',(select count(*) from eligible_recs where lower(coalesce(severity,'')) in('high','critical','emergency','urgent')),
   'excludedDraftRecommendations',(select count(*) from recs where draft),
   'interactionLimit',100,'recommendationLimit',50)) into answer;
 return answer;
end$$;
revoke all on function public.learn_card_projection_inputs(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_card_projection_inputs(uuid,uuid) to service_role;
commit;
