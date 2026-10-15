-- Calculate revisions for only the first requested unlinked emails when none
-- of those sources has a review receipt. If any does, retain the original wider
-- window and exact revision check so a stale hold cannot hide a changed source.
-- The first N eligible global rows are contained in the first N of each input.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare definition text;
 old_cte text := ' ), email_revisions as materialized (';
 new_cte text := $replacement$ ), ranked_unlinked as materialized (
  select u.id,u.occurred,row_number() over(order by u.occurred,u.id) selection_rank
  from unlinked u
 ), has_review_in_first as materialized (
  select exists(select 1 from ranked_unlinked u
   join public.learn_interaction_projection_receipts r on r.tenant_id=p_tenant
    and r.source_kind='email' and r.source_id=u.id
   where u.selection_rank<=bound and r.receipt->>'state'='review_required') held
 ), selected_unlinked as materialized (
  select u.id,u.occurred from ranked_unlinked u cross join has_review_in_first h
  where u.selection_rank<=bound or h.held
 ), email_revisions as materialized ($replacement$;
 old_join text := 'from unlinked u join public.email_messages m';
 new_join text := 'from selected_unlinked u join public.email_messages m';
begin
 definition:=pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure);
 if md5(definition)<>'8ea6962d53df7e121a36b4771fe87689'
  or length(definition)-length(replace(definition,old_cte,''))<>length(old_cte)
  or length(definition)-length(replace(definition,old_join,''))<>length(old_join)
 then raise exception 'projection_bounded_review_prefetch_baseline_changed';end if;
 execute replace(replace(definition,old_cte,new_cte),old_join,new_join);
end$$;
commit;
