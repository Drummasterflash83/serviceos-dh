-- This scenario runs at the known-positive point of the existing customer/Slack
-- journey and rolls its own changes back before the remaining negative cases.
create function pg_temp.reobserve_job_source(p_version uuid) returns void language plpgsql as $$
declare s public.learn_business_input_versions%rowtype;p uuid:=gen_random_uuid();permit uuid:=gen_random_uuid();job uuid:=gen_random_uuid();t timestamptz;begin
 select * into strict s from public.learn_business_input_versions where id=p_version and tenant_id=pg_temp.sc(1);
 select greatest(clock_timestamp(),max(committed_at)+interval '1 microsecond') into t from public.learn_business_input_pages where tenant_id=s.tenant_id;
 insert into public.learn_business_input_request_permits(id,tenant_id,job_id,claimed_by,attempt_count,binding,credential_fingerprint) values(permit,s.tenant_id,job,'synthetic',1,'{}','synthetic-slack-customer');
 insert into public.learn_business_input_pages(id,tenant_id,connection_id,provider,collection,job_id,permit_id,envelope,checkpoint_before,checkpoint_after,record_count,committed_at) values(p,s.tenant_id,s.connection_id,s.provider,s.collection,job,permit,jsonb_build_object('data',jsonb_build_array(s.payload)),'{}','{}',1,t);
 insert into public.learn_business_input_observations(page_id,version_id,ordinal) values(p,p_version,0);
end$$;
create function pg_temp.refresh_fail() returns trigger language plpgsql as $$begin raise exception 'Injected refresh ledger failure';end$$;
do $$declare l uuid;v uuid;plan jsonb;receipt jsonb;before_job jsonb;initial_link jsonb;old_source jsonb;args jsonb;answer jsonb;mutation text;begin
 begin
  insert into feature_flags(tenant_id,flag,value) values(pg_temp.sc(1),'learn.enabled','true'),(pg_temp.sc(1),'learn.inputs.commusoft.enabled','true') on conflict do nothing;
  update feature_flags set value='true' where tenant_id=pg_temp.sc(1) and flag in ('learn.enabled','learn.inputs.commusoft.enabled');
  insert into tenant_connectors(tenant_id,connector_id,provider,category,status,enabled) values(pg_temp.sc(1),'commusoft','commusoft','business','active',true);
  update provider_connections set verified_at=clock_timestamp()-interval '1 minute' where id=pg_temp.sc(70);
  select id,to_jsonb(x) into l,initial_link from learn_business_input_links x where tenant_id=pg_temp.sc(1) and collection='jobs' and external_id='100';
  select to_jsonb(x) into old_source from learn_business_input_versions x where id=(initial_link->>'source_version_id')::uuid;
  -- Match the actual creation writer's source-owned fields, not a hand-written title.
  update jobs set title='Job 100',description=null,created_date=null,completed_date=null,
   metadata=jsonb_set(metadata,'{learn_business_input,timestamps}',public.learn_commusoft_job_fields(old_source->'payload','100')->'timestamps')
   where id=pg_temp.sc(20);
  select to_jsonb(j) into before_job from jobs j where id=pg_temp.sc(20);
  v:=pg_temp.scsource('jobs','{"id":100,"propertyID":1,"status":"completed","description":"001. Synthetic repair","completed":{"completedOnDateTime":"2026-10-13 12:30:00"}}');
  perform set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);perform set_config('role','authenticated',true);
  assert pg_temp.context_count()=0,'Stale job must remain withheld before reviewed refresh';
  plan:=public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l);
  assert plan->>'state'='ready' and plan#>>'{before,status}'='open' and plan#>>'{after,status}'='completed';
  assert plan#>'{after,completed_date}'='null'::jsonb and plan->'timing_limitations'='["completed"]'::jsonb;
  assert public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(700),l,v,plan->>'revision','Reviewed source lifecycle update','check')->>'state'='pending';
  begin
   perform public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(700),l,v,repeat('0',32),'Reviewed source lifecycle update','apply');
   raise exception 'Stale review revision accepted';
  exception when sqlstate 'PT409' then null;end;
  begin perform public.learn_commusoft_job_refresh_plan(pg_temp.sc(2),l);raise exception 'Foreign refresh accepted';exception when insufficient_privilege then null;end;
  perform set_config('role','none',true);
  -- Local edits and reassignment are held, never overwritten by the provider.
  begin
   update jobs set status='pending' where id=pg_temp.sc(20);
   perform set_config('role','authenticated',true);
   assert public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l)->>'reason'='local_fields_changed';
   perform set_config('role','none',true);raise exception 'rollback_case';
  exception when raise_exception then if sqlerrm<>'rollback_case' then raise;end if;end;
  begin
   update jobs set customer_company_id=pg_temp.sc(61) where id=pg_temp.sc(20);
   perform set_config('role','authenticated',true);
   assert public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l)->>'reason'='canonical_owner_changed';
   perform set_config('role','none',true);raise exception 'rollback_case';
  exception when raise_exception then if sqlerrm<>'rollback_case' then raise;end if;end;
  create trigger fixture_refresh_fail before insert on learn_business_input_refreshes for each row execute function pg_temp.refresh_fail();
  perform set_config('role','authenticated',true);
  begin perform public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(700),l,v,plan->>'revision','Reviewed source lifecycle update','apply');raise exception 'Late failure not injected';
   exception when raise_exception then if sqlerrm<>'Injected refresh ledger failure' then raise;end if;end;
  perform set_config('role','none',true);
  assert (select to_jsonb(j) from jobs j where id=pg_temp.sc(20))=before_job,'Canonical job escaped failed ledger transaction';
  assert not exists(select 1 from learn_business_input_refreshes where tenant_id=pg_temp.sc(1));
  drop trigger fixture_refresh_fail on learn_business_input_refreshes;
  -- Execute through the real cross-client operator facade; no profile switching.
  perform set_config('request.jwt.claim.sub',pg_temp.sc(10)::text,true);perform set_config('role','authenticated',true);
  answer:=public.openfolk_business_review(pg_temp.sc(1),'learn_commusoft_job_refresh_plan','Review job source update',jsonb_build_object('p_tenant',pg_temp.sc(1),'p_link',l));
  plan:=answer->'result';assert plan->>'state'='ready';
  args:=jsonb_build_object('p_tenant',pg_temp.sc(1),'p_request',pg_temp.sc(700),'p_link',l,'p_source',v,'p_revision',plan->>'revision','p_reason','Reviewed source lifecycle update','p_action','apply');
  answer:=public.openfolk_business_review(pg_temp.sc(1),'learn_commusoft_job_refresh','Apply reviewed job source update',args);receipt:=answer->'result';
  assert receipt->>'state'='committed' and receipt->>'revision'='1';
  assert public.openfolk_business_review(pg_temp.sc(1),'learn_commusoft_job_refresh','Recover saved refresh receipt',args||'{"p_action":"check"}') ->'result'=receipt;
  assert public.openfolk_business_review(pg_temp.sc(1),'learn_commusoft_job_refresh','Retry saved refresh safely',args)->'result'=receipt;
  begin perform public.openfolk_business_review(pg_temp.sc(1),'learn_commusoft_job_refresh','Conflicting request',args||'{"p_reason":"Different review"}');raise exception 'Conflicting retry accepted';exception when sqlstate 'PT409' then null;end;
  perform set_config('role','none',true);
  assert (select to_jsonb(x) from learn_business_input_links x where id=l)=initial_link;
  assert (select to_jsonb(x) from learn_business_input_versions x where id=(initial_link->>'source_version_id')::uuid)=old_source;
  assert (select source_version_id from learn_business_input_current_links where id=l)=v;
  assert (select status='completed' and title='001. Synthetic repair' and completed_date is null and customer_company_id=pg_temp.sc(60) from jobs where id=pg_temp.sc(20));
  assert (select count(*) from learn_business_input_refreshes where tenant_id=pg_temp.sc(1))=1;
  assert exists(select 1 from controlplane_change_log where tenant_id=pg_temp.sc(1) and actor=pg_temp.sc(10)::text and resource_type='learn_commusoft_job_refresh');
  assert (select tenant_id is null from profiles where id=pg_temp.sc(10));
  perform set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);perform set_config('role','authenticated',true);
  assert pg_temp.context_count()=1,'Refreshed version did not restore the proven Slack/customer context';
  assert public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l)->>'state'='current';
  answer:=public.learn_customer_business_context(pg_temp.sc(1),pg_temp.sc(62),'jobs');
  assert exists(select 1 from jsonb_array_elements(answer->'rows') row where row->>'id'=pg_temp.sc(20)::text and row#>>'{fields,status}'='completed' and row#>>'{sources,0,version_id}'=v::text);
  perform set_config('role','none',true);
  assert not has_table_privilege('authenticated','learn_business_input_refreshes','select');
  assert not has_table_privilege('authenticated','learn_business_input_current_links','select');
  assert not has_function_privilege('anon','learn_commusoft_job_refresh_plan(uuid,uuid)','execute');
  begin delete from learn_business_input_refreshes where tenant_id=pg_temp.sc(1);raise exception 'Refresh history deleted';exception when insufficient_privilege then null;end;
  -- Completed requests cannot be undone by a late cancel.
  perform set_config('request.jwt.claim.sub',pg_temp.sc(10)::text,true);perform set_config('role','authenticated',true);
  assert public.openfolk_business_review(pg_temp.sc(1),'learn_commusoft_job_refresh','Check already saved update',args||'{"p_action":"cancel"}')->'result'=receipt;
  perform set_config('role','none',true);
  begin
   -- A newer source invalidates a previously rendered preview. Cancellation still
   -- fences that exact request, even after its source is no longer latest.
   v:=pg_temp.scsource('jobs','{"id":100,"propertyID":1,"status":"on_hold","description":"001. Synthetic repair"}');
   perform set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);perform set_config('role','authenticated',true);
   plan:=public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l);
   assert plan->>'state'='ready';
   perform set_config('role','none',true);
   perform pg_temp.scsource('jobs','{"id":100,"propertyID":1,"status":"Closed","description":"001. Synthetic repair"}');
   perform set_config('role','authenticated',true);
   begin perform public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(701),l,v,plan->>'revision','Obsolete pending review','apply');raise exception 'Superseded preview applied';exception when sqlstate 'PT409' then null;end;
   answer:=public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(701),l,v,plan->>'revision','Obsolete pending review','cancel');
   assert answer->>'state'='cancelled';
   assert public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(701),l,v,plan->>'revision','Obsolete pending review','apply')=answer;
   assert public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(701),l,v,plan->>'revision','Obsolete pending review','check')=answer;
   perform set_config('role','none',true);
   assert (select status from jobs where id=pg_temp.sc(20))='completed';
   assert (select count(*) from learn_business_input_refreshes where tenant_id=pg_temp.sc(1))=1;
   assert (select count(*) from learn_business_input_refresh_cancellations where tenant_id=pg_temp.sc(1))=1;
   assert not has_table_privilege('authenticated','learn_business_input_refresh_cancellations','select');
   begin delete from learn_business_input_refresh_cancellations where tenant_id=pg_temp.sc(1);raise exception 'Cancellation history deleted';exception when insufficient_privilege then null;end;
   perform set_config('role','authenticated',true);
   plan:=public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l);
   answer:=public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(702),l,(plan->>'source_version_id')::uuid,plan->>'revision','Reviewed later closed state','apply');
   assert answer->>'revision'='2';
   perform set_config('role','none',true);
   assert (select status='closed' and completed_date is null from jobs where id=pg_temp.sc(20));
   assert (select count(*) from learn_business_input_refreshes where tenant_id=pg_temp.sc(1))=2;
   assert (select to_jsonb(x) from learn_business_input_links x where id=l)=initial_link;
   -- Re-observe the original content without inserting a duplicate version.
   insert into learn_business_input_observations(page_id,version_id,ordinal)
    select page_id,(initial_link->>'source_version_id')::uuid,1 from learn_business_input_observations
     where version_id=(plan->>'source_version_id')::uuid limit 1;
   perform set_config('role','authenticated',true);
   assert public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l)->>'reason'='source_changed_or_ambiguous','Equal-time versions must remain ambiguous';
   perform set_config('role','none',true);

   -- A later, unambiguous observation may return to an existing content version.
   -- Retain another page receipt, never duplicate or rewrite the old version.
   perform pg_temp.reobserve_job_source((initial_link->>'source_version_id')::uuid);
   perform set_config('role','authenticated',true);
   plan:=public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l);
   assert plan->>'state'='ready' and plan->>'source_version_id'=initial_link->>'source_version_id';
   answer:=public.learn_commusoft_job_refresh(pg_temp.sc(1),pg_temp.sc(703),l,(plan->>'source_version_id')::uuid,plan->>'revision','Reviewed return to the original source content','apply');
   assert answer->>'revision'='3';
   perform set_config('role','none',true);
   assert (select status='open' and title='Job 100' and completed_date is null from jobs where id=pg_temp.sc(20));
   assert (select count(*) from learn_business_input_refreshes where tenant_id=pg_temp.sc(1))=3;
   assert (select to_jsonb(x) from learn_business_input_links x where id=l)=initial_link;
   assert (select to_jsonb(x) from learn_business_input_versions x where id=(initial_link->>'source_version_id')::uuid)=old_source;
   assert (select source_version_id from learn_business_input_current_links where id=l)=(initial_link->>'source_version_id')::uuid;
   raise exception 'rollback_transitions';
  exception when raise_exception then if sqlerrm<>'rollback_transitions' then raise;end if;end;
  -- Removing existing access or capture availability must stop a new review.
  foreach mutation in array array[
   'update profiles set role=''viewer'' where id=pg_temp.sc(11)',
   'update feature_flags set value=''false'' where tenant_id=pg_temp.sc(1) and flag=''learn.inputs.commusoft.enabled''',
   'update provider_connections set revoked_at=clock_timestamp() where id=pg_temp.sc(70)'
  ]loop
   begin
    execute mutation;perform set_config('request.jwt.claim.sub',pg_temp.sc(11)::text,true);perform set_config('role','authenticated',true);
    begin perform public.learn_commusoft_job_refresh_plan(pg_temp.sc(1),l);raise exception 'Revoked refresh access accepted';exception when insufficient_privilege then null;end;
    perform set_config('role','none',true);raise exception 'rollback_revocation';
   exception when raise_exception then if sqlerrm<>'rollback_revocation' then raise;end if;end;
  end loop;

  raise exception 'rollback_refresh_scenario';
 exception when raise_exception then if sqlerrm<>'rollback_refresh_scenario' then raise;end if;end;
end$$;
