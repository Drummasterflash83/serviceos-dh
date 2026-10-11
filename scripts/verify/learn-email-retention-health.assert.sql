set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';
set role authenticated;
do $$declare p jsonb;r jsonb;begin
 p:=learn_operator_capture_health(fixture_id(100));r:=p->'email_retention';
 assert r=jsonb_build_object('version','learn-email-retention/1','tenant_id',fixture_id(100),'scope','company','total',6,'available',1,'unavailable',1,'unverified',4,'unbound',2,'archived_versions',1),r::text;
 assert learn_operator_capture_health(fixture_id(100),p->>'next_cursor')->'email_retention'=r;
 assert p::text not like '%PRIVATE%';
 r:=learn_operator_capture_health(fixture_id(101))->'email_retention';
 assert r->>'total'='1' and r->>'unavailable'='1' and r->>'archived_versions'='1';
end$$;
reset role;
-- The addition must not weaken platform authority, including revocation.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';set role authenticated;
do $$begin begin perform learn_operator_capture_health(fixture_id(100));raise exception 'Client read platform retention';exception when insufficient_privilege then null;end;end$$;
reset role;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(182);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;
do $$begin begin perform learn_operator_capture_health(fixture_id(100));raise exception 'Revoked operator read retention';exception when insufficient_privilege then null;end;end$$;
reset role;
update platform_authority_grants set effective_to=null where profile_id=fixture_id(182);
do $$begin assert not has_function_privilege('anon','learn_operator_capture_health(uuid,text)','execute');assert not has_function_privilege('service_role','learn_operator_capture_health(uuid,text)','execute');end$$;
select 'Retention counts, paging, tenant boundaries, payload exclusion and authority checks passed';
