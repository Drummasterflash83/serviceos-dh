-- Additional checks for the smaller TEST foundation. No marketing mocks.
do $$ declare refused boolean;begin
 assert to_regclass('public.communication_preferences') is null;
 assert to_regclass('public.contact_suppressions') is null;
 assert to_regprocedure('public.marketing_endpoint_eligibility(uuid,uuid,text)') is null;
 assert not exists(select 1 from contact_points where verification_state<>'unverified' or source<>'import');
 refused:=false;
 begin
  insert into contact_points(tenant_id,person_id,channel,value,normalized_value)
  values('aaaa0000-0000-0000-0000-0000000000a2','dddd0000-0000-0000-0000-0000000000e1','email','foreign@example.invalid','foreign@example.invalid');
 exception when foreign_key_violation then refused:=true;end;
 assert refused,'contact endpoint cannot refer to another company person';
 assert not has_table_privilege('anon','contact_points','SELECT');
 assert not has_table_privilege('authenticated','contact_points','INSERT,UPDATE,DELETE,TRUNCATE');
 assert not has_table_privilege('service_role','contact_points','TRUNCATE');
 assert not has_function_privilege('authenticated','marketing_normalize_endpoint(text,text)','EXECUTE');
end $$;
set local role authenticated;
set local "request.jwt.claim.sub"='bbbb0000-0000-0000-0000-0000000000a3';
do $$ begin
 assert not exists(select 1 from contact_points where tenant_id='aaaa0000-0000-0000-0000-0000000000a1'),'foreign company endpoint privacy';
end $$;
reset role;
