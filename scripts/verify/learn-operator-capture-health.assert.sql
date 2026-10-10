set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;
do $$declare r jsonb;begin
 r:=learn_operator_capture_health(fixture_id(100));
 assert jsonb_array_length(r->'rows')=3;
 assert r->'next_cursor'='null'::jsonb;
 assert r->'rows'->0->>'source'='email';
 assert r->'rows'->1->'enabled'='true'::jsonb;
 assert r->'rows'->2->'bounded_complete'='true'::jsonb;
 assert r->'rows'->2->'latest_job'->>'status'='succeeded';
 assert r::text not like '%PRIVATE%' and r::text not like '%DO_NOT_EXPOSE%';
 begin perform learn_operator_capture_health(fixture_id(100),'invalid');raise exception 'Invalid cursor accepted';exception when invalid_parameter_value then null;end;
end$$;
reset role;
-- DWD mailboxes share the gmail provider name; stale personal OAuth state is not DWD authority.
update email_accounts set status='active_dwd',auth_state='revoked' where id=fixture_id(301);
update connector_accounts set sync_cursor=jsonb_set(sync_cursor,'{scopeKey}','"new_scope"') where id=fixture_id(306);
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_operator_capture_health(fixture_id(100));
 assert r->'rows'->0->>'provider'='google_workspace';
 assert r->'rows'->0->>'auth_state'='unknown';
 assert r->'rows'->2->'bounded_complete'='false'::jsonb;
end$$;
reset role;
update connector_accounts set sync_cursor=jsonb_set(sync_cursor,'{scopeKey}','"synthetic_scope"') where id=fixture_id(306);
update platform_jobs set result=jsonb_set(result,'{pages}','2') where id=fixture_id(307);
set role authenticated;
do $$begin assert learn_operator_capture_health(fixture_id(100))->'rows'->2->'bounded_complete'='false'::jsonb;end$$;
reset role;
update platform_jobs set result=jsonb_set(result,'{pages}','1') where id=fixture_id(307);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';set role authenticated;
do $$begin begin perform learn_operator_capture_health(fixture_id(100));raise exception 'Client owner read platform metadata';exception when insufficient_privilege then null;end;end$$;
reset role;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(182);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;
do $$begin begin perform learn_operator_capture_health(fixture_id(100));raise exception 'Revoked viewer read metadata';exception when insufficient_privilege then null;end;end$$;
reset role;
update platform_authority_grants set effective_to=null where profile_id=fixture_id(182);
-- More than one server page: no duplicate/omitted rows, bounded results.
insert into email_accounts(id,tenant_id,provider,display_name,status,auth_state) select fixture_id(400+n),fixture_id(100),'gmail','Synthetic paged mailbox','active','unknown' from generate_series(1,55)n;
set role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=learn_operator_capture_health(fixture_id(100));assert jsonb_array_length(a->'rows')=50;assert a->>'next_cursor' is not null;
 b:=learn_operator_capture_health(fixture_id(100),a->>'next_cursor');assert jsonb_array_length(b->'rows')=8;assert b->'next_cursor'='null'::jsonb;
 assert not exists(select 1 from jsonb_array_elements(a->'rows')x join jsonb_array_elements(b->'rows')y on x->>'key'=y->>'key');
end$$;
reset role;
do $$begin assert not has_function_privilege('anon','learn_operator_capture_health(uuid,text)','execute');assert not has_function_privilege('service_role','learn_operator_capture_health(uuid,text)','execute');end$$;
select 'Capture metadata isolation, redaction, pagination and authority checks passed';
