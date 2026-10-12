-- Entire fixture, temporary access and reads roll back with the enclosing rehearsal.
create function pg_temp.bcid(n int) returns uuid language sql immutable as $$select ('cf820000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.bcid(int) to authenticated;
insert into public.tenants(id,slug,display_name,status) values
 (pg_temp.bcid(1),'context-rollback-a','Synthetic context A','active'),
 (pg_temp.bcid(2),'context-rollback-b','Synthetic context B','active');
insert into auth.users(id,email,banned_until) values(pg_temp.bcid(10),'context-rollback@example.invalid','infinity');
insert into public.profiles(id,tenant_id,role) values(pg_temp.bcid(10),pg_temp.bcid(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.companies(id,tenant_id,name) values(pg_temp.bcid(20),pg_temp.bcid(1),'Company A'),(pg_temp.bcid(21),pg_temp.bcid(1),'Unrelated company'),(pg_temp.bcid(22),pg_temp.bcid(2),'Foreign company');
insert into public.customer_cards(id,tenant_id,company_id,title) values(pg_temp.bcid(30),pg_temp.bcid(1),pg_temp.bcid(20),'Company A'),(pg_temp.bcid(31),pg_temp.bcid(2),pg_temp.bcid(22),'Foreign card');
insert into public.sites(id,tenant_id,company_id,label) values(pg_temp.bcid(40),pg_temp.bcid(1),pg_temp.bcid(20),'Linked site'),(pg_temp.bcid(41),pg_temp.bcid(1),pg_temp.bcid(21),'Unrelated site');
insert into public.jobs(id,tenant_id,customer_company_id,site_id,title,description,status,metadata)
 select pg_temp.bcid(100+n),pg_temp.bcid(1),pg_temp.bcid(20),pg_temp.bcid(40),'Job '||n,repeat('x',4001),'completed',
 '{"secret":"NEVER_RETURN","learn_business_input":{"timestamps":{"created":{"state":"absent","source":null,"instant":null},"completed":{"state":"timezone_required","source":"2026-10-01 12:00:00","instant":null,"secret":"NEVER_RETURN"}}}}'
 from generate_series(1,26)n;
do $$begin begin
 insert into public.jobs(id,tenant_id,customer_company_id,title) values(pg_temp.bcid(200),pg_temp.bcid(2),pg_temp.bcid(20),'Invalid foreign company reference');
 raise exception 'Foreign foundation reference accepted';exception when check_violation then null;end;end$$;
insert into public.jobs(id,tenant_id,customer_company_id,title) values(pg_temp.bcid(200),pg_temp.bcid(2),pg_temp.bcid(22),'Foreign job'),(pg_temp.bcid(201),pg_temp.bcid(1),pg_temp.bcid(21),'Unrelated job');
insert into public.people(id,tenant_id,display_name) values(pg_temp.bcid(50),pg_temp.bcid(1),'Graph-linked contact'),(pg_temp.bcid(51),pg_temp.bcid(1),'Unrelated contact');
insert into public.people(id,tenant_id,display_name) values(pg_temp.bcid(52),pg_temp.bcid(1),'Individual customer');
insert into public.customer_cards(id,tenant_id,person_id,title) values(pg_temp.bcid(32),pg_temp.bcid(1),pg_temp.bcid(52),'Individual customer');
insert into public.jobs(id,tenant_id,customer_person_id,title) values(pg_temp.bcid(202),pg_temp.bcid(1),pg_temp.bcid(52),'Individual job');
insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,content_hash,payload)
 values(pg_temp.bcid(400),pg_temp.bcid(1),pg_temp.bcid(401),'alternative_business_system','jobs','source-101','synthetic','{"secret":"NEVER_RETURN"}');
insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
 values(pg_temp.bcid(1),pg_temp.bcid(401),'alternative_business_system','jobs','source-101',pg_temp.bcid(400),'job','jobs',pg_temp.bcid(101),pg_temp.bcid(30),'{}',pg_temp.bcid(10));
insert into public.graph_nodes(id,tenant_id,node_type,source_table,source_id) values(pg_temp.bcid(60),pg_temp.bcid(1),'person','people',pg_temp.bcid(50)),(pg_temp.bcid(61),pg_temp.bcid(1),'customer_card','customer_cards',pg_temp.bcid(30));
insert into public.graph_edges(tenant_id,edge_type,from_node_id,to_node_id) values(pg_temp.bcid(1),'contact_for',pg_temp.bcid(60),pg_temp.bcid(61));
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='cf820000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(30),'jobs');
 assert (a->>'total')::int=26 and jsonb_array_length(a->'rows')=25 and a->>'next_after'=pg_temp.bcid(125)::text;
 assert a->'audit_id'='null'::jsonb and a->'operator_mode'='false'::jsonb;
 assert a::text not like '%NEVER_RETURN%' and a::text not like '%Foreign%' and a::text not like '%Unrelated%';
 assert length(a#>>'{rows,0,fields,description}')=4000 and a#>'{rows,0,truncated_fields}'='["description"]'::jsonb;
 assert a#>>'{rows,0,fields,time_evidence,completed,state}'='timezone_required';
 assert a#>>'{rows,0,sources,0,provider}'='alternative_business_system' and a#>>'{rows,0,sources,0,version_id}'=pg_temp.bcid(400)::text;
 b:=public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(30),'jobs',(a->>'next_after')::uuid);
 assert jsonb_array_length(b->'rows')=1 and b->'next_after'='null'::jsonb and (b->>'total')::int=26;
 a:=public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(30),'sites');assert jsonb_array_length(a->'rows')=1;
 a:=public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(30),'contacts');assert jsonb_array_length(a->'rows')=1 and a#>>'{rows,0,id}'=pg_temp.bcid(50)::text;
 a:=public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(32),'jobs');assert (a->>'total')::int=1 and a#>>'{rows,0,id}'=pg_temp.bcid(202)::text;
 a:=public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(32),'contacts');assert (a->>'total')::int=1 and a#>>'{rows,0,id}'=pg_temp.bcid(52)::text;
 begin perform public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(31),'jobs');raise exception 'Foreign card admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_customer_business_context(pg_temp.bcid(2),pg_temp.bcid(31),'jobs');raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(30),'vault.secrets');raise exception 'Arbitrary collection admitted';exception when invalid_parameter_value then null;end;
end$$;
reset role;update public.profiles set role='viewer' where id=pg_temp.bcid(10);set local role authenticated;
do $$begin begin perform public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(30),'jobs');raise exception 'Viewer admitted';exception when insufficient_privilege then null;end;end$$;
reset role;insert into public.platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.bcid(10),'platform.controlplane.admin','rollback fixture',clock_timestamp()+interval '5 minutes');set local role authenticated;
do $$declare a jsonb;begin
 a:=public.learn_customer_business_context(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'Review selected client');
 assert a->>'actor_id'=pg_temp.bcid(10)::text and a->>'audit_id' is not null and a->'operator_mode'='true'::jsonb;
 begin perform public.learn_customer_business_context(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'');raise exception 'Blank reason admitted';exception when invalid_parameter_value then null;end;
end$$;
reset role;
do $$begin assert (select count(*)=1 from public.controlplane_change_log where actor=pg_temp.bcid(10)::text and source='learn-customer-business-context');end$$;
insert into public.view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values(pg_temp.bcid(2),pg_temp.bcid(10),'role','viewer','rollback fixture');set local role authenticated;
do $$begin begin perform public.learn_customer_business_context(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'View-as denied');raise exception 'View-as admitted';exception when insufficient_privilege then null;end;end$$;
reset role;update public.view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.bcid(10);
create function pg_temp.reject_context_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic_context_audit_failure';end$$;
create trigger synthetic_context_audit_failure before insert on public.controlplane_change_log for each row execute function pg_temp.reject_context_audit();set local role authenticated;
do $$begin begin perform public.learn_customer_business_context(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'Audit failure');raise exception 'Audit failure released data' using errcode='XX000';exception when raise_exception then if sqlerrm<>'synthetic_context_audit_failure' then raise;end if;end;end$$;
reset role;drop trigger synthetic_context_audit_failure on public.controlplane_change_log;
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.bcid(10);set local role authenticated;
do $$begin begin perform public.learn_customer_business_context(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'Revoked denied');raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role anon;
do $$begin begin perform public.learn_customer_business_context(null,null,'jobs');raise exception 'Anon admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role service_role;
do $$begin begin perform public.learn_customer_business_context(null,null,'jobs');raise exception 'Service role admitted';exception when insufficient_privilege then null;end;end$$;
reset role;
