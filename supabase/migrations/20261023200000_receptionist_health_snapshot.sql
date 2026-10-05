-- Read-only, tenant-scoped health projection. Never exposes internal diagnosis,
-- proposals, credentials, transcripts, rules or Slack destinations to clients.
begin;
create function public.care_health_snapshot(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not (public.care_desk_operator() or
 exists(select 1 from public.receptionist_access where tenant_id=p_tenant and profile_id=auth.uid()) or
 exists(select 1 from public.client_portal_access where tenant_id=p_tenant and profile_id=auth.uid())) then
  raise exception 'Workspace unavailable' using errcode='42501';
 end if;
 with active as (
  select i.*,f.call_id,f.category,f.title as feedback_title,
   coalesce((select r.assessment->'findings' from public.receptionist_task_reviews r
    where r.tenant_id=p_tenant and r.issue_id=i.id and r.state='completed'
    order by r.created_at desc limit 1),'[]'::jsonb) findings
  from public.receptionist_care_issues i
  left join public.receptionist_feedback f on f.id=i.feedback_id and f.tenant_id=i.tenant_id
  where i.tenant_id=p_tenant and i.archived_at is null and i.stage<>'resolved'
 ), grouped as (
  select a.*,coalesce((select jsonb_agg(distinct area) from (
   select case label
    when 'routing' then 'handover' when 'handover' then 'handover'
    when 'technical' then 'service' when 'safety' then 'service'
    when 'caller-experience' then 'experience' when 'repetition' then 'experience'
    when 'contradiction' then 'experience' when 'understanding' then 'experience'
    when 'follow-up' then 'help' else null end area
   from (select a.category label union all select split_part(a.source_key,':',3)
    union all select value->>'category' from jsonb_array_elements(a.findings)) labels
  ) areas where area is not null),'["general"]'::jsonb) categories
  from active a
 ), latest_reviews as (
  select distinct on (r.call_id) r.call_id,r.state,r.reviewed_at
  from public.receptionist_call_reviews r where r.tenant_id=p_tenant
  order by r.call_id,r.reviewed_at desc
 )
 select jsonb_build_object(
  'checked_at',now(),
  'issues',coalesce((select jsonb_agg(jsonb_build_object(
   'id',g.id,'feedback_id',g.feedback_id,
   'call_id',coalesce(g.call_id::text,case when g.source_key ~ '^call:[0-9a-f-]{36}:' then split_part(g.source_key,':',2) end),
   'title',coalesce(g.feedback_title,case split_part(g.source_key,':',3)
     when 'handover' then 'A handover needs review' when 'technical' then 'Call handling needs review'
     when 'safety' then 'An urgent call needs review' else 'A conversation needs review' end),
   'categories',g.categories,'priority',g.priority,
   'status',case when g.stage='received' then 'Submitted' else 'In review' end,
   'message',g.customer_update,'created_at',g.created_at
  ) order by case g.priority when 'urgent' then 0 when 'high' then 1 else 2 end,g.created_at desc) from grouped g),'[]'::jsonb),
  'reviewed_calls',(select count(*) from latest_reviews where state='reviewed'),
  'reviews_awaiting_evidence',(select count(*) from latest_reviews where state='awaiting_evidence'),
  'reviews_failed',(select count(*) from latest_reviews where state='failed'),
  'last_call_review',(select max(reviewed_at) from latest_reviews where state='reviewed'),
  'feedback_reviewed',(select count(distinct r.issue_id) from public.receptionist_task_reviews r
    join public.receptionist_care_issues i on i.id=r.issue_id and i.tenant_id=r.tenant_id
    where r.tenant_id=p_tenant and r.state='completed' and i.archived_at is null),
  'resolved_reports',(select count(*) from public.receptionist_care_issues where tenant_id=p_tenant and archived_at is null and stage='resolved')
 ) into result;
 return result;
end $$;
revoke all on function public.care_health_snapshot(uuid) from public,anon;
grant execute on function public.care_health_snapshot(uuid) to authenticated;
commit;
