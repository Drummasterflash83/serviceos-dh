-- Must be wrapped in BEGIN/ROLLBACK on hosted TEST only. No provider requests.
-- Every test identity is random and banned; all data, access and synthetic Vault
-- entries disappear with rollback. Never substitute real credentials or users.
create function pg_temp.commusoft_current_probe_capture(p_tenant uuid,p_account uuid,p_data jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;c public.provider_connections%rowtype;j public.platform_jobs%rowtype;
 b jsonb;r jsonb;result jsonb;target jsonb;begin
 select * into a from public.connector_accounts where id=p_account and tenant_id=p_tenant;
 select * into c from public.provider_connections where id=(a.settings->'commusoft_import'->>'connectionId')::uuid and tenant_id=p_tenant;
 if c.non_secret_config->>'account_key' not like 'synthetic-current-jobs-%' then raise exception 'Synthetic-only capture';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and job_type='commusoft.source_sync'
  and job_key='commusoft.source:'||a.id||':'||(a.settings->'commusoft_import'->>'approvalId') and status='queued' for update;
 if j.id is null then raise exception 'No synthetic queued job';end if;
 update public.platform_jobs set status='running',claimed_by='synthetic-current-jobs-probe',attempt_count=attempt_count+1,
 lease_expires_at=clock_timestamp()+interval '2 minutes' where id=j.id returning * into j;
 b:=jsonb_build_object('tenantId',a.tenant_id,'jobId',j.id,'accountId',a.id,'connectorId',a.tenant_connector_id,
 'connectionId',c.id,'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key',
 'approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor,'pages',coalesce(a.sync_cursor->'pages','0'::jsonb),
 'complete',coalesce(a.sync_cursor->'complete','false'::jsonb),'request',jsonb_build_object('region','uk',
 'resource',a.settings->'commusoft_import'->>'resource','after',a.sync_cursor->'after','limit',a.settings->'commusoft_import'->'pageSize')
 ||public.learn_commusoft_update_window(a.settings->'commusoft_import'));
 if a.settings->'commusoft_import'->>'resource'='propertyContacts' then
  target:=public.learn_commusoft_contact_target(p_tenant,c.id,a.settings->'commusoft_import',a.sync_cursor);
  b:=b||jsonb_build_object('contactTarget',target,'request',b->'request'||jsonb_build_object('contactType','customer','propertyId',target->'propertyId'));
 end if;
 -- Only this synthetic secret's gate is advanced by the fixture.
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second'
 where credential_fingerprint=encode(sha256(convert_to('commusoft:SYNTHETIC_CURRENT_JOBS_'||p_tenant::text,'UTF8')),'hex');
 r:=public.learn_commusoft_acquire_page(p_tenant,j.id,j.claimed_by,j.attempt_count,b);
 if r->>'state' is distinct from 'ready' or r->>'apiKey' is distinct from 'SYNTHETIC_CURRENT_JOBS_'||p_tenant::text then raise exception 'Synthetic permit failed';end if;
 result:=public.learn_commusoft_commit_page(p_tenant,j.id,j.claimed_by,j.attempt_count,(r->>'permitId')::uuid,
 jsonb_build_object('data',p_data,'pagination',jsonb_build_object('hasMore',false,'nextCursor',null)));
 perform public.learn_commusoft_finish_job(p_tenant,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
 return result;
end$$;
do $probe$
declare t uuid:=gen_random_uuid();actor uuid:=gen_random_uuid();c uuid:=gen_random_uuid();secret_id uuid;
 prop_request uuid:=gen_random_uuid();job_request uuid:=gen_random_uuid();contact_request uuid:=gen_random_uuid();
 a uuid;revision timestamptz;definition jsonb;receipt jsonb;old_cfg jsonb;old_cp jsonb;fast_request uuid;
 prior_watermark timestamptz:=date_trunc('milliseconds',clock_timestamp()-interval '2 hours');
begin
 insert into public.tenants(id,slug,display_name,status,metadata) values(t,'commusoft-current-jobs-'||t,'Synthetic current-jobs rollback probe','active','{"synthetic":true}');
 insert into auth.users(id,banned_until) values(actor,'infinity');
 insert into public.profiles(id,tenant_id,role) values(actor,t,'owner') on conflict(id) do update set tenant_id=t,role='owner';
 insert into public.platform_authority_grants(profile_id,permission,granted_by) values(actor,'platform.controlplane.admin','synthetic-current-jobs-rollback-probe');
 select vault.create_secret('SYNTHETIC_CURRENT_JOBS_'||t::text,'provider_secret:'||t||':commusoft:api_key') into secret_id;
 insert into public.provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config,configured_fields,secret_refs)
 values(c,t,'commusoft','configured','private_api_key',clock_timestamp(),jsonb_build_object('region','uk','account_key','synthetic-current-jobs-'||t),array['api_key'],jsonb_build_object('api_key',secret_id)) returning updated_at into revision;
 insert into public.feature_flags(tenant_id,flag,value) values(t,'learn.enabled','true'),(t,'learn.inputs.commusoft.enabled','true');
 perform set_config('request.jwt.claim.sub',actor::text,true);perform set_config('request.jwt.claim.role','authenticated',true);
 definition:=jsonb_build_object('kind','start_commusoft','reason','Synthetic current-jobs rollback probe','connection_id',c,'revision',revision,
 'resource','properties','max_pages',10,'page_size',100,'expires_at',clock_timestamp()+interval '1 hour');
 receipt:=public.learn_operator_input_request(t,prop_request,actor,definition);a:=(receipt->>'account_id')::uuid;
 perform set_config('request.jwt.claim.role','service_role',true);
 perform pg_temp.commusoft_current_probe_capture(t,a,'[{"id":101,"type":"customer"},{"id":202,"type":"customer"}]');
 perform set_config('request.jwt.claim.role','authenticated',true);
 receipt:=public.learn_operator_input_request(t,job_request,actor,definition||'{"resource":"jobs"}');
 perform set_config('request.jwt.claim.role','service_role',true);
 perform pg_temp.commusoft_current_probe_capture(t,a,'[{"id":901,"description":"001. Synthetic job","propertyID":101,"status":"Open"}]');
 perform set_config('request.jwt.claim.role','authenticated',true);
 receipt:=public.learn_operator_input_request(t,contact_request,actor,definition||'{"resource":"propertyContacts","contact_type":"customer"}');
 select settings->'commusoft_import',sync_cursor into old_cfg,old_cp from public.connector_accounts where id=a;
 insert into public.learn_commusoft_recurring(account_id,tenant_id,connection_id,connection_revision,approved_by,enabled,max_pages,page_size,
 phase,current_request,current_definition,cycle_start,cycle_end,watermark)
 values(a,t,c,revision,actor,true,10,100,3,contact_request,definition||'{"resource":"propertyContacts","contact_type":"customer"}',prior_watermark-interval '1 hour',prior_watermark,prior_watermark-interval '1 hour');
 insert into public.learn_commusoft_recurring_steps values(job_request,a,t,actor,prior_watermark-interval '1 hour',prior_watermark,2,definition||'{"resource":"jobs"}',null,clock_timestamp());
 insert into public.learn_commusoft_recurring_steps values(contact_request,a,t,actor,prior_watermark-interval '1 hour',prior_watermark,3,definition||'{"resource":"propertyContacts","contact_type":"customer"}',(receipt->>'job_id')::uuid,clock_timestamp());
 insert into public.learn_commusoft_current_jobs(account_id,tenant_id,enabled) values(a,t,true);
 perform set_config('request.jwt.claim.role','service_role',true);
 perform public.learn_commusoft_schedule_current_jobs(50);
 select f.current_request into fast_request from public.learn_commusoft_current_jobs f where account_id=a;
 if fast_request is null then raise exception 'Hosted TEST did not interleave jobs';end if;
 if public.learn_commusoft_recurring_page_allowed(t,contact_request::text) or public.learn_commusoft_recurring_page_allowed(gen_random_uuid(),fast_request::text) then raise exception 'Suspended/foreign scope admitted';end if;
 perform pg_temp.commusoft_current_probe_capture(t,a,'[{"id":901,"description":"001. Synthetic job","propertyID":101,"status":"completed"}]');
 perform public.learn_commusoft_schedule_current_jobs(50);
 if not exists(select 1 from public.learn_commusoft_current_jobs where account_id=a and watermark>prior_watermark and suspended is null and last_state='window_complete') then raise exception 'Hosted TEST completion missing';end if;
 if not exists(select 1 from public.connector_accounts where id=a and settings->'commusoft_import'=old_cfg and sync_cursor=old_cp) then raise exception 'Hosted TEST checkpoint changed';end if;
 if not exists(select 1 from public.learn_commusoft_recurring where account_id=a and phase=3 and current_request=contact_request and watermark=prior_watermark-interval '1 hour') then raise exception 'Hosted TEST full cycle advanced';end if;
 perform pg_temp.commusoft_current_probe_capture(t,a,'[]');
 if not exists(select 1 from public.connector_accounts where id=a and sync_cursor->>'propertiesCompleted'='1') then raise exception 'Hosted TEST contacts did not resume';end if;
 if (select count(*) from public.learn_business_input_versions where tenant_id=t and collection='jobs' and payload->>'description'='001. Synthetic job')<>2 then raise exception 'Source history/code lost';end if;
 if (select count(*) from public.learn_commusoft_current_job_receipts where tenant_id=t)<>2 then raise exception 'Hosted TEST receipt missing';end if;
end $probe$;
select 'hosted_test_current_jobs_interleave_restore_and_source_history_verified' marker;
