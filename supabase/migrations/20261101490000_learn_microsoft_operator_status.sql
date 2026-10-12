-- Read-only OpenFolk diagnostics. No capture activation, credentials or source content.
begin;
create function public.learn_operator_microsoft_status(p_tenant uuid,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 with accounts as materialized(
  select a.id,a.email_address,(a.status='active' and a.auth_state='ok') as account_active
  from public.email_accounts a where a.tenant_id=p_tenant and a.provider='microsoft_365'
   and (p_after is null or a.id>p_after) order by a.id limit 21
 ), shown as materialized(select * from accounts order by id limit 20),
 entries as(select a.id,jsonb_build_object(
  'account_id',a.id,'email_address',a.email_address,'account_active',coalesce(a.account_active,false),
  'capture_allowed',public.learn_capture_allowed(p_tenant,'email'),
  'bindings',(select count(*) from public.learn_microsoft_mailbox_bindings b where b.tenant_id=p_tenant and b.email_account_id=a.id),
  'enabled_bindings',(select count(*) from public.learn_microsoft_mailbox_bindings b where b.tenant_id=p_tenant and b.email_account_id=a.id and b.enabled),
  'coverage_complete',false,'attachments_captured',false,
  'saved_pages',pages.saved,'settled_pages',pages.settled,'last_saved_at',pages.last_saved,'last_settled_at',pages.last_settled,
  'published_observations',pages.published,'held_observations',pages.held,
  'draft_observations',pages.drafts,'removal_observations',pages.removed,
  'physical_folders',folders.physical,'search_folders',folders.search,
  'discovery_rounds',rounds.rounds,'last_discovery_at',rounds.last_discovery,
  'jobs',jobs.counts,'next_job_at',jobs.next_at,
  'issue_code',issue.code,'issue_at',issue.updated_at
 ) as entry from shown a
 cross join lateral(
  select count(*) as saved,count(c.job_id) as settled,max(p.recorded_at) as last_saved,max(c.recorded_at) as last_settled,
   coalesce(sum((r.result->>'published')::bigint),0) as published,coalesce(sum((r.result->>'held')::bigint),0) as held,
   coalesce(sum((r.result->>'drafts')::bigint),0) as drafts,coalesce(sum((r.result->>'removedFromFolder')::bigint),0) as removed
  from public.learn_microsoft_capture_streams s join public.learn_microsoft_source_pages p on p.stream_id=s.id and p.tenant_id=s.tenant_id
  left join public.learn_microsoft_job_completions c on c.source_receipt_id=p.id and c.tenant_id=p.tenant_id
  left join public.learn_microsoft_projection_receipts r on r.page_id=p.id and r.tenant_id=p.tenant_id
  where s.tenant_id=p_tenant and s.email_account_id=a.id
 ) pages
 cross join lateral(
  select count(*) filter(where d.kind='physical') as physical,count(*) filter(where d.kind='search') as search
  from public.learn_microsoft_folder_dispatches d join public.learn_microsoft_capture_streams s on s.id=d.stream_id and s.tenant_id=d.tenant_id
  where s.tenant_id=p_tenant and s.email_account_id=a.id
 ) folders
 cross join lateral(
  select count(*) as rounds,max(d.recorded_at) as last_discovery from public.learn_microsoft_discovery_rounds d
  join public.learn_microsoft_capture_streams s on s.id=d.stream_id and s.tenant_id=d.tenant_id
  where s.tenant_id=p_tenant and s.email_account_id=a.id
 ) rounds
 cross join lateral(
  select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) as counts,min(due) as next_at from(
   select case when status in('queued','retrying','running','succeeded','dead_letter','failed','cancelled','skipped') then status else 'unknown' end as status,
    count(*) as n,min(available_at) filter(where status in('queued','retrying')) as due
   from public.platform_jobs where tenant_id=p_tenant and connector_id='microsoft-365' and module_id='communications.email'
    and job_type in('email.microsoft_discovery','email.microsoft_sync') and payload->>'email_account_id'=a.id::text group by 1
  ) grouped
 ) jobs
 left join lateral(
  select case when error_code in('microsoft_auth_required','microsoft_access_denied','microsoft_folder_unavailable','microsoft_delta_expired',
   'microsoft_throttled','microsoft_provider_unavailable','microsoft_fetch_failed','microsoft_refresh_failed','microsoft_credential_unavailable',
   'microsoft_reauthorization_required','microsoft_capture_unconfirmed','microsoft_retry_delay_requires_review','microsoft_capture_paused')
   then error_code else 'microsoft_review_required' end as code,updated_at
  from public.platform_jobs where tenant_id=p_tenant and connector_id='microsoft-365' and module_id='communications.email'
   and job_type in('email.microsoft_discovery','email.microsoft_sync') and payload->>'email_account_id'=a.id::text
   and status in('retrying','dead_letter','failed') order by updated_at desc,id desc limit 1
 ) issue on true)
 select jsonb_build_object('version','learn-microsoft-status/1','tenant_id',p_tenant,'observed_at',clock_timestamp(),
  'accounts',coalesce((select jsonb_agg(entry order by id) from entries),'[]'::jsonb),
  'next_after',case when (select count(*) from accounts)>20 then (select id from shown order by id desc limit 1) else null end)
 into result;
 return result;
end$$;
revoke all on function public.learn_operator_microsoft_status(uuid,uuid) from public,anon,service_role;
grant execute on function public.learn_operator_microsoft_status(uuid,uuid) to authenticated;
commit;
