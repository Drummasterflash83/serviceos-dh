-- A lost authority read may stop an otherwise unchanged, approved recurring
-- contact traversal. Retry only that exact empty-page job under the original
-- approval; never turn a changed/revoked scope into a provider request.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.learn_commusoft_recurring_authority_retry_allowed(p_tenant uuid,p_job uuid)
returns boolean language sql volatile security definer set search_path=pg_catalog as $$
 select exists(
  select 1 from public.platform_jobs j
  join public.learn_commusoft_recurring s on s.tenant_id=j.tenant_id
  join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id
  join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  join public.provider_connections c on c.id=s.connection_id and c.tenant_id=s.tenant_id
  join public.tenants t on t.id=s.tenant_id
  where j.id=p_job and j.tenant_id=p_tenant and j.job_type='commusoft.source_sync'
   and j.status in ('running','dead_letter') and j.error_code is distinct from 'commusoft_attempts_exhausted'
   and j.attempt_count<j.max_attempts
   and j.payload->>'connector_account_id'=a.id::text
   and j.job_key='commusoft.source:'||a.id::text||':'||s.current_request::text
   and not (coalesce(j.metadata,'{}'::jsonb) ? 'commusoft_page_v1')
   and not exists(select 1 from public.learn_business_input_pages p where p.job_id=j.id and p.tenant_id=j.tenant_id)
   and not exists(select 1 from public.platform_jobs other where other.tenant_id=j.tenant_id
    and other.job_type=j.job_type and other.payload->>'connector_account_id'=a.id::text
    and other.id<>j.id and other.status in ('queued','running','retrying'))
   and not exists(select 1 from public.learn_commusoft_current_jobs f
    where f.tenant_id=s.tenant_id and f.account_id=s.account_id and f.current_request is not null)
   and s.enabled and s.phase in (3,4) and s.current_request is not null
   and s.connection_revision=c.updated_at and public.learn_commusoft_recurring_actor(s.approved_by)
   and a.status='active' and a.account_key=c.non_secret_config->>'account_key'
   and a.settings->'commusoft_import'->'approved'='true'::jsonb
   and a.settings->'commusoft_import'->>'approvalId'=s.current_request::text
   and a.settings->'commusoft_import'->>'connectionId'=c.id::text
   and a.settings->'commusoft_import'->>'resource'='propertyContacts'
   and a.settings->'commusoft_import'->>'contactType'=case s.phase when 3 then 'customer' else 'workaddress' end
   and a.settings->'commusoft_import'->>'expiresAt'~'^2[0-9]{3}-'
   and (a.settings->'commusoft_import'->>'expiresAt')::timestamptz>clock_timestamp()+interval '5 minutes'
   and a.sync_cursor->>'approvalId'=s.current_request::text
   and a.sync_cursor->'complete'='false'::jsonb
   and a.sync_cursor->>'pages'~'^[0-9]{1,5}$'
   and a.settings->'commusoft_import'->>'maxPages'~'^[0-9]{1,5}$'
   and (a.sync_cursor->>'pages')::integer<(a.settings->'commusoft_import'->>'maxPages')::integer
   and exists(select 1 from public.learn_business_input_pages p
    where p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider='commusoft'
     and p.collection='propertyContacts' and p.checkpoint_after=a.sync_cursor)
   and t.status='active' and tc.connector_id='commusoft' and tc.provider='commusoft'
   and tc.enabled and tc.status='active'
   and c.provider='commusoft' and c.status='configured' and c.auth_mode='private_api_key'
   and c.revoked_at is null and c.verified_at is not null and c.verified_at<=clock_timestamp()
   and c.non_secret_config->>'region' in ('uk','us')
   and 'api_key'=any(c.configured_fields)
   and c.secret_refs->>'api_key'~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   and exists(select 1 from vault.secrets v where v.id::text=c.secret_refs->>'api_key'
    and v.name='provider_secret:'||s.tenant_id::text||':commusoft:api_key')
   and public.learn_operator_input_flags(s.tenant_id)='{"learn.enabled":true,"learn.inputs.commusoft.enabled":true}'::jsonb
 );
$$;
revoke all on function public.learn_commusoft_recurring_authority_retry_allowed(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_recurring_authority_retry_allowed(uuid,uuid) to service_role;

do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.learn_commusoft_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure);
 needle:='p_outcome->''retryable''=''true''::jsonb and j.attempt_count<j.max_attempts';
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'commusoft_recurring_retry_finish_shape_changed';end if;
 execute replace(d,needle,
  '(p_outcome->''retryable''=''true''::jsonb or
    (p_outcome->>''code''=''commusoft_authority_unavailable'' and
     public.learn_commusoft_recurring_authority_retry_allowed(j.tenant_id,j.id)))
   and j.attempt_count<j.max_attempts');
end $patch$;

-- This is deliberately separate from installation. A stopped job is requeued
-- only by an explicit, exact job-id call after a fresh readback.
create function public.learn_commusoft_requeue_retained_authority(p_tenant uuid,p_job uuid)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype; receipt jsonb;begin
 if p_tenant is null or p_job is null or current_setting('transaction_isolation')<>'read committed' then
  raise exception 'commusoft_requeue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.status<>'dead_letter' or j.error_code<>'commusoft_authority_unavailable'
  or j.attempt_count<>1 or not public.learn_commusoft_recurring_authority_retry_allowed(p_tenant,p_job) then
  raise exception 'commusoft_requeue_scope_changed' using errcode='PT409';end if;
 update public.platform_jobs set status='retrying',dead_lettered_at=null,
  available_at=clock_timestamp()+interval '60 seconds',
  metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('commusoft_authority_requeue_v1',
   jsonb_build_object('prior_status','dead_letter','attempt_count',j.attempt_count,'at',clock_timestamp()))
  where id=j.id;
 receipt:=jsonb_build_object('job_id',j.id,'state','retrying','prior_error',j.error_code,
  'attempt_count',j.attempt_count,'retained_page_written',false);
 return receipt;
end $$;
revoke all on function public.learn_commusoft_requeue_retained_authority(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_requeue_retained_authority(uuid,uuid) to service_role;
commit;
