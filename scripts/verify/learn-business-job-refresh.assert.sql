-- This scenario runs at the known-positive point of the existing customer/Slack
-- journey and rolls its own changes back before the remaining negative cases.
create function pg_temp.refresh_fail() returns trigger language plpgsql as $$begin raise exception 'Injected refresh ledger failure';end$$;
do $$declare l uuid;v uuid;plan jsonb;receipt jsonb;before_job jsonb;initial_link jsonb;old_source jsonb;args jsonb;answer jsonb;begin
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
  raise exception 'rollback_refresh_scenario';
 exception when raise_exception then if sqlerrm<>'rollback_refresh_scenario' then raise;end if;end;
end$$;
