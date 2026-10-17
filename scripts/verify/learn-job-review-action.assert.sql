-- Synthetic only. No provider or hosted database is contacted.
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = 'bbbb0000-0000-0000-0000-0000000000b5';
do $$declare
 t uuid:='aaaa0000-0000-0000-0000-0000000000a1';
 c uuid:='eeee0000-0000-0000-0000-0000000000b1';
 v uuid:='eeee0000-0000-0000-0000-0000000000b2';
 a jsonb; b jsonb; failed boolean;
begin
 failed:=false;
 begin perform learn_commusoft_create_job_review_action(t,c,'123',
   'eeee0000-0000-0000-0000-0000000000b3','Wrong source');
 exception when sqlstate 'PT409' then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform learn_commusoft_create_job_review_action('aaaa0000-0000-0000-0000-0000000000a2',c,'123',v,'Foreign company');
 exception when insufficient_privilege then failed:=true; end;
 assert failed;
 failed:=false;
 begin perform learn_commusoft_create_job_review_action(t,c,'123',v,'');
 exception when invalid_parameter_value then failed:=true; end;
 assert failed;
 a:=learn_commusoft_create_job_review_action(t,c,'123',v,'Review source-only hold');
 assert (a->>'created')::boolean;
 assert (select object_class='action' and status='ready' and responsible_ref is null
   and accountable_ref is null and source_entities='{}'::uuid[]
   and attributes->>'source_version_id'=v::text
   and attributes->>'recorded_source_status'='on_hold'
   and attributes->>'review_only'='true'
   and evidence->0->>'source_version_id'=v::text
   from intelligence_objects where id=(a->>'id')::uuid),
   'Review task keeps exact source evidence without inventing an assignee';
 b:=learn_commusoft_create_job_review_action(t,c,'123',v,'Replay source-only hold');
 assert not (b->>'created')::boolean and b->>'id'=a->>'id';
 assert (select count(*) from intelligence_objects where tenant_id=t
   and attributes->>'action_type'='openfolk_commusoft_job_review')=1;
 perform set_config('test.job_review_task_id',a->>'id',false);
end $$;
reset role;
reset request.jwt.claim.role;
reset request.jwt.claim.sub;
do $$begin
 assert (select count(*) from controlplane_change_log
   where resource_id=current_setting('test.job_review_task_id')
     and action='learn.job_review_action.create'
     and reason='Review source-only hold')=1;
 assert not has_function_privilege('anon',
   'learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)','execute');
 assert has_function_privilege('authenticated',
   'learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)','execute');
end $$;
