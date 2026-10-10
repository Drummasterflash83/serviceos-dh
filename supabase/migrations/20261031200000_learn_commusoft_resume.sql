-- Explicit operator continuation. Retains the approval identity, collection,
-- cursor, source pages and terminal jobs; creates only one new bounded job.
begin;
create function public.learn_operator_resume_commusoft(
 p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply'
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_operator_input_requests%rowtype;a public.connector_accounts%rowtype;
 c public.provider_connections%rowtype;tc public.tenant_connectors%rowtype;j public.platform_jobs%rowtype;
 cfg jsonb;cp jsonb;observed jsonb;receipt jsonb;previous jsonb;k text;
 expiry timestamptz;revision timestamptz;pages integer;retained integer;jid uuid:=gen_random_uuid();
begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel')
  or jsonb_typeof(p_definition) is distinct from 'object' or octet_length(p_definition::text)>10000 then
  raise exception 'learn_operator_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-request:'||p_request::text,0));
 select * into prior from public.learn_operator_input_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_operator_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then
  receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
  insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt)
   values(p_request,p_tenant,p_actor,p_definition,receipt);
  return receipt;
 end if;
 if p_definition->>'kind' is distinct from 'resume_commusoft'
  or not p_definition ?& array['kind','reason','account_id','approval_id','job_id','connection_id','revision','checkpoint','max_pages','expires_at']
  or (select count(*) from jsonb_object_keys(p_definition))<>10
  or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
  or jsonb_typeof(p_definition->'revision') is distinct from 'string'
  or jsonb_typeof(p_definition->'expires_at') is distinct from 'string'
  or jsonb_typeof(p_definition->'checkpoint') is distinct from 'object'
  or jsonb_typeof(p_definition->'max_pages') is distinct from 'number' or p_definition->>'max_pages'!~'^[0-9]{1,5}$' then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 foreach k in array array['account_id','approval_id','job_id','connection_id'] loop
  if jsonb_typeof(p_definition->k) is distinct from 'string' or p_definition->>k!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
   raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 end loop;
 expiry:=(p_definition->>'expires_at')::timestamptz;revision:=(p_definition->>'revision')::timestamptz;pages:=(p_definition->>'max_pages')::integer;
 if not isfinite(expiry) or not isfinite(revision) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '24 hours' or pages not between 1 and 10000 then
  raise exception 'learn_operator_resume_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 perform 1 from public.tenants where id=p_tenant and status='active';
 if not found then raise exception 'learn_operator_tenant_inactive' using errcode='55000';end if;
 foreach k in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=k and value='true'::jsonb for share;
  if not found then raise exception 'learn_operator_module_disabled' using errcode='55000';end if;
 end loop;
 select * into c from public.provider_connections where id=(p_definition->>'connection_id')::uuid and tenant_id=p_tenant for share;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.auth_mode is distinct from 'private_api_key'
  or c.revoked_at is not null or c.verified_at is null or c.verified_at>clock_timestamp() or c.updated_at is distinct from revision
  or coalesce(c.non_secret_config->>'region','') not in ('uk','us')
  or not coalesce('api_key'=any(c.configured_fields),false)
  or coalesce(c.secret_refs->>'api_key','')!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_connection_changed' using errcode='PT409';end if;
 perform 1 from vault.secrets where id=(c.secret_refs->>'api_key')::uuid and name='provider_secret:'||p_tenant::text||':commusoft:api_key';
 if not found then raise exception 'learn_operator_credential_missing' using errcode='55000';end if;
 select * into tc from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft' for update;
 if not found or tc.provider is distinct from 'commusoft' or tc.enabled is distinct from true or tc.status is distinct from 'active' then
  raise exception 'learn_operator_connector_disabled' using errcode='55000';end if;
 select * into a from public.connector_accounts where id=(p_definition->>'account_id')::uuid and tenant_id=p_tenant and tenant_connector_id=tc.id for update;
 if not found or a.status is distinct from 'active' or a.account_key is distinct from c.non_secret_config->>'account_key' then
  raise exception 'learn_operator_account_changed' using errcode='PT409';end if;
 cfg:=a.settings->'commusoft_import';cp:=a.sync_cursor;
 observed:=jsonb_build_object('approvalId',cp->'approvalId','pages',cp->'pages','after',cp->'after','complete',cp->'complete');
 if cfg->'approved' is distinct from 'true'::jsonb or cfg->>'approvalId' is distinct from p_definition->>'approval_id'
  or cfg->>'connectionId' is distinct from c.id::text or observed is distinct from p_definition->'checkpoint'
  or jsonb_typeof(cfg->'maxPages') is distinct from 'number' or coalesce(cfg->>'maxPages','')!~'^[0-9]{1,5}$'
  or jsonb_typeof(cfg->'expiresAt') is distinct from 'string'
  or coalesce(cfg->>'resource','') not in ('properties','jobs','propertyContacts')
  or (cfg->>'resource'='propertyContacts' and coalesce(cfg->>'contactType','') not in ('customer','workaddress')) then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 -- No active attempt is reset or displaced, even after its lease expires.
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text and status in ('queued','running','retrying')) then
  raise exception 'learn_operator_import_active' using errcode='55000';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and payload->>'connector_account_id'=a.id::text order by created_at desc,id desc limit 1 for update;
 if not found or j.id::text is distinct from p_definition->>'job_id' or j.status not in ('succeeded','dead_letter')
  or j.job_key is distinct from 'commusoft.source:'||a.id::text||':'||(cfg->>'approvalId')
  or coalesce(j.lease_expires_at,'-infinity')>clock_timestamp() then
  raise exception 'learn_operator_progress_changed' using errcode='PT409';end if;
 -- Committed but unsettled work must go through source-free worker recovery.
 if j.status='dead_letter' and (j.metadata ? 'commusoft_page_v1' or exists(select 1 from public.learn_business_input_pages where job_id=j.id)) then
  raise exception 'learn_operator_page_unsettled' using errcode='55000';end if;
 if j.status='succeeded' and not exists(select 1 from public.learn_business_input_pages where job_id=j.id and tenant_id=p_tenant
  and connection_id=c.id and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after=cp) then
  raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 if cp='{}'::jsonb then
  retained:=0;
  if j.status='succeeded' or exists(select 1 from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id and checkpoint_after->>'approvalId'=cfg->>'approvalId') then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 else
  if cp->>'approvalId' is distinct from cfg->>'approvalId' or cp->'complete' is distinct from 'false'::jsonb
   or jsonb_typeof(cp->'pages') is distinct from 'number' or cp->>'pages'!~'^[0-9]{1,5}$' then
   raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
  retained:=(cp->>'pages')::integer;
  -- Require the exact last retained page, not a cursor supplied by the browser.
  select checkpoint_after into observed from public.learn_business_input_pages where tenant_id=p_tenant and connection_id=c.id
   and provider='commusoft' and collection=cfg->>'resource' and checkpoint_after->>'approvalId'=cfg->>'approvalId'
   order by (checkpoint_after->>'pages')::integer desc limit 1;
  if not found or observed is distinct from cp or retained<1 then raise exception 'learn_operator_checkpoint_invalid' using errcode='PT409';end if;
 end if;
 if pages<=retained or pages<(cfg->>'maxPages')::integer or expiry<(cfg->>'expiresAt')::timestamptz then
  raise exception 'learn_operator_resume_limits' using errcode='22023';end if;
 previous:=jsonb_build_object('approval',cfg,'checkpoint',cp,'job_id',j.id,'job_status',j.status);
 cfg:=cfg||jsonb_build_object('expiresAt',expiry,'maxPages',pages);
 update public.connector_accounts set settings=settings||jsonb_build_object('commusoft_import',cfg) where id=a.id;
 insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,available_at,parent_job_id,payload,created_by)
  values(jid,p_tenant,'commusoft','learn','commusoft.source_sync',j.job_key,'queued',5,clock_timestamp(),j.id,jsonb_build_object('connector_account_id',a.id),p_actor);
 receipt:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','kind','resume_commusoft','account_id',a.id,'job_id',jid,'approval_id',cfg->>'approvalId','checkpoint',p_definition->'checkpoint');
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 insert into public.learn_operator_input_requests(id,tenant_id,actor_id,definition,receipt,previous_state) values(p_request,p_tenant,p_actor,p_definition,receipt,previous);
 return receipt;
end $$;
revoke all on function public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text) to authenticated;
commit;
