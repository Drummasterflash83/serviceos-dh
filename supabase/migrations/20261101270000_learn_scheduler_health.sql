-- Bounded scheduler summaries. No raw-table client grants, source changes or schedules.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create index learn_email_scheduler_latest_idx on public.email_sync_runs(tenant_id,sync_type,started_at desc nulls last,id desc);
create index learn_phone_scheduler_latest_idx on public.phone_sync_runs(tenant_id,sync_type,started_at desc nulls last,id desc);

create function public.learn_scheduler_health_read(p_tenant uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor_tenant uuid;actor_role text;result jsonb;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null or p_tenant is null
  or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'scheduler_health_forbidden' using errcode='42501';end if;
 select tenant_id,role into actor_tenant,actor_role from public.profiles where id=auth.uid() for share;
 if not found then raise exception 'scheduler_health_forbidden' using errcode='42501';end if;
 -- Own-company summary follows the existing tenant SELECT policy, including viewers.
 -- Other-company reads require the existing effective-dated OpenFolk view grant.
 if actor_tenant is distinct from p_tenant or coalesce(actor_role,'') not in ('owner','admin','ops','viewer') then
  perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 end if;
 if exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null
  and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'scheduler_health_preview_forbidden' using errcode='42501';end if;
 with definitions(name,source,kind) as (values
  ('phone-scheduled-sync','phone','scheduled_sync'),
  ('phone-processing-scheduled-sync','job','phone.process_pending'),
  ('email-scheduled-sync','email','scheduled_sync'),
  ('email-workspace-scheduled-sync','email','workspace_scheduled_sync'),
  ('email-workspace-backfill-scheduled-sync','email','workspace_backfill_scheduled'),
  ('interactions-scheduled-sync','job','interactions.sync'),
  ('identity-scheduled-sync','job','identity.resolve'),
  ('business-graph-scheduled-sync','job','graph.sync'),
  ('customer-card-scheduled-sync','job','customer_card.sync'),
  ('recommendation-scheduled-sync','job','recommendation.sync')
 ), observations as (
  select d.name,x.observed_at,x.status,x.metadata from definitions d
  left join lateral (
   (select r.started_at as observed_at,r.status,r.metadata from public.email_sync_runs r
    where d.source='email' and r.tenant_id=p_tenant and r.sync_type=d.kind
    order by r.started_at desc nulls last,r.id desc limit 1)
   union all
   (select r.started_at,r.status,null::jsonb from public.phone_sync_runs r
    where d.source='phone' and r.tenant_id=p_tenant and r.sync_type=d.kind
    order by r.started_at desc nulls last,r.id desc limit 1)
   union all
   (select j.created_at,j.status,null::jsonb from public.platform_jobs j
    where d.source='job' and j.tenant_id=p_tenant and j.job_type=d.kind
    order by j.created_at desc nulls last,j.id desc limit 1)
  ) x on true
 ) select jsonb_agg(jsonb_build_object(
   'name',name,'observed_at',observed_at,
   'status',case when status in ('success','failed','queued','running','succeeded','retrying','dead_letter','cancelled') then status when status is not null then 'unknown' end,
   'capture_paused',case when jsonb_typeof(metadata->'capture_paused')='number' and metadata->>'capture_paused' ~ '^[0-9]{1,9}$' then (metadata->>'capture_paused')::integer end,
   'enqueue_unconfirmed',case when jsonb_typeof(metadata->'enqueue_unconfirmed')='number' and metadata->>'enqueue_unconfirmed' ~ '^[0-9]{1,9}$' then (metadata->>'enqueue_unconfirmed')::integer end,
   'inventory_unavailable',case when jsonb_typeof(metadata->'inventory_unavailable')='boolean' then (metadata->>'inventory_unavailable')::boolean end
  ) order by name) into result from observations;
 return jsonb_build_object('version','learn-scheduler-health/1','tenant_id',p_tenant,
  'checked_at',statement_timestamp(),'rows',result);
end $$;
revoke all on function public.learn_scheduler_health_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_scheduler_health_read(uuid) to authenticated;
commit;
