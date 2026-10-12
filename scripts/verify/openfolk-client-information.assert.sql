-- Synthetic passwordless, banned actor and all fixture rows are rolled back.
create function pg_temp.info_id(n int) returns uuid language sql immutable as $$select ('cf800000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.info_id(int) to authenticated;
insert into public.tenants(id,slug,display_name,status) values
 (pg_temp.info_id(1),'operator-info-rollback-a','Synthetic information A','active'),
 (pg_temp.info_id(2),'operator-info-rollback-b','Synthetic information B','active');
insert into auth.users(id,email,banned_until) values(pg_temp.info_id(10),'operator-info-rollback@example.invalid','infinity');
insert into public.profiles(id,tenant_id,role) values(pg_temp.info_id(10),pg_temp.info_id(1),'viewer') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.companies(id,tenant_id,name,metadata) select pg_temp.info_id(100+n),pg_temp.info_id(1),'Company '||n,'{"secret":"NEVER_RETURN"}' from generate_series(1,26)n;
insert into public.companies(id,tenant_id,name) values(pg_temp.info_id(200),pg_temp.info_id(2),'Other company');
insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(pg_temp.info_id(300),pg_temp.info_id(1),pg_temp.info_id(400),'commusoft','jobs','20','synthetic',jsonb_build_object('id',20,'description',repeat('x',6001),'propertyID',31,'api_key','NEVER_RETURN'));
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='cf800000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$begin begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','test scope');raise exception 'Tenant viewer gained operator read';exception when insufficient_privilege then null;end;end$$;
reset role;
insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.info_id(10),'platform.controlplane.view','rollback fixture',clock_timestamp()+interval '5 minutes');
set local role authenticated;
do $$begin begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','test scope');raise exception 'View-only grant exposed business content';exception when insufficient_privilege then null;end;end$$;
reset role;
insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.info_id(10),'platform.controlplane.admin','rollback fixture',clock_timestamp()+interval '5 minutes');
set local role authenticated;
do $$declare a jsonb;b jsonb;k text;begin
 a:=public.openfolk_client_information(pg_temp.info_id(1),'companies','verify selected client');
 assert jsonb_array_length(a->'rows')=25 and a->>'next_after'=pg_temp.info_id(125)::text,'First page differs';
 assert a->>'actor_id'=auth.uid()::text and a->>'tenant_id'=pg_temp.info_id(1)::text,'Actor or selected client differs';
 assert a::text not like '%NEVER_RETURN%' and a::text not like '%Other company%','Foreign data or metadata escaped';
 b:=public.openfolk_client_information(pg_temp.info_id(1),'companies','verify next page',(a->>'next_after')::uuid);
 assert jsonb_array_length(b->'rows')=1 and b->'next_after'='null'::jsonb,'Next page differs';
 a:=public.openfolk_client_information(pg_temp.info_id(2),'companies','verify second client');
 assert jsonb_array_length(a->'rows')=1 and a#>>'{rows,0,fields,name}'='Other company','Selected second client missing';
 begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','reject foreign detail',null,pg_temp.info_id(200));raise exception 'Foreign detail admitted';exception when insufficient_privilege then null;end;
 a:=public.openfolk_client_information(pg_temp.info_id(1),'business_sources','inspect retained input');
 assert a#>>'{rows,0,id}'=pg_temp.info_id(300)::text and length(a#>>'{rows,0,fields,description}')=6000,'Source detail differs';
 assert a#>'{rows,0,truncated_fields}'='["description"]'::jsonb and a::text not like '%NEVER_RETURN%','Truncation or projection differs';
 foreach k in array array['customers','contacts','sites','jobs','emails','calls','recordings','transcripts','communications'] loop
  a:=public.openfolk_client_information(pg_temp.info_id(1),k,'verify supported collection');
  assert a->'rows'='[]'::jsonb,'Empty collection invented content';
 end loop;
 begin perform public.openfolk_client_information(pg_temp.info_id(1),'vault.secrets','reject arbitrary selector');raise exception 'Arbitrary selector admitted';exception when invalid_parameter_value then null;end;
 begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','');raise exception 'Missing reason admitted';exception when invalid_parameter_value then null;end;
 begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','reject ambiguous page',pg_temp.info_id(101),pg_temp.info_id(102));raise exception 'Ambiguous page admitted';exception when invalid_parameter_value then null;end;
 begin perform 1 from public.learn_business_input_versions;raise exception 'Raw source access granted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 assert (select count(*) from public.controlplane_change_log where actor=pg_temp.info_id(10)::text and source='openfolk-client-information')=13,'Every successful read must be audited';
 assert not exists(select 1 from public.controlplane_change_log where actor=pg_temp.info_id(10)::text and after::text like '%Company%'),'Audit stores content';
 assert (select role='viewer' and tenant_id=pg_temp.info_id(1) from public.profiles where id=pg_temp.info_id(10)),'Operator profile changed';
end$$;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(pg_temp.info_id(1),pg_temp.info_id(10),'role','viewer','rollback fixture');
set local role authenticated;
do $$begin begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','reject view-as');raise exception 'View-As admitted';exception when insufficient_privilege then null;end;end$$;
reset role;
update public.view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.info_id(10);
create function pg_temp.reject_information_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic_audit_unavailable' using errcode='P0001';end$$;
create trigger synthetic_information_audit_failure before insert on public.controlplane_change_log for each row execute function pg_temp.reject_information_audit();
set local role authenticated;
do $$begin begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','fail closed audit');raise exception 'Audit failure released content' using errcode='XX000';exception when raise_exception then if sqlerrm<>'synthetic_audit_unavailable' then raise;end if;end;end$$;
reset role;
drop trigger synthetic_information_audit_failure on public.controlplane_change_log;
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.info_id(10);
set local role authenticated;
do $$begin begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','reject revoked access');raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local request.jwt.claim.sub='';set local role authenticated;
do $$begin begin perform public.openfolk_client_information(pg_temp.info_id(1),'companies','reject unsigned');raise exception 'Unsigned admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role anon;
do $$begin begin perform public.openfolk_client_information(null,'companies','reject anon');raise exception 'Anon admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role service_role;
do $$begin begin perform public.openfolk_client_information(null,'companies','reject machine');raise exception 'Machine admitted';exception when insufficient_privilege then null;end;end$$;
reset role;
