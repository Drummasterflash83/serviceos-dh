-- Positive writes run as the service role, not the database owner.
insert into config_versions(id,tenant_id,artifact_kind,artifact_key,version) values
 (verify.id(31),null,'profile','global',1),(verify.id(32),verify.id(2),'profile','foreign',1);
set role service_role;
insert into companies(id,tenant_id,name) values (verify.id(101),verify.id(1),'Company A'),(verify.id(102),verify.id(2),'Company B');
insert into people(id,tenant_id,company_id,display_name) values (verify.id(111),verify.id(1),verify.id(101),'Person A'),(verify.id(112),verify.id(2),verify.id(102),'Person B');
insert into customer_cards(id,tenant_id,person_id,company_id,title) values (verify.id(121),verify.id(1),verify.id(111),verify.id(101),'Card A'),(verify.id(122),verify.id(2),verify.id(112),verify.id(102),'Card B');
insert into org_units(id,tenant_id,kind,name) values (verify.id(131),verify.id(1),'team','Team A'),(verify.id(132),verify.id(2),'team','Team B');
insert into org_unit_members(org_unit_id,user_id) values (verify.id(131),verify.id(11)),(verify.id(132),verify.id(14));
insert into team_members(id,tenant_id,org_unit_id,display_name) values (verify.id(141),verify.id(1),verify.id(131),'Staff A'),(verify.id(142),verify.id(2),verify.id(132),'Staff B');
insert into sites(id,tenant_id,company_id,person_id) values (verify.id(151),verify.id(1),verify.id(101),verify.id(111)),(verify.id(152),verify.id(2),verify.id(102),verify.id(112));
insert into jobs(id,tenant_id,site_id,customer_person_id) values (verify.id(161),verify.id(1),verify.id(151),verify.id(111)),(verify.id(162),verify.id(2),verify.id(152),verify.id(112));
insert into graph_nodes(id,tenant_id,node_type,label) values (verify.id(171),verify.id(1),'person','A'),(verify.id(172),verify.id(2),'person','B');
insert into graph_edges(tenant_id,edge_type,from_node_id,to_node_id) values (verify.id(1),'self',verify.id(171),verify.id(171)),(verify.id(2),'self',verify.id(172),verify.id(172));
insert into intelligence_objects(id,tenant_id,domain,object_type,subject) values (verify.id(181),verify.id(1),'core','Task','Task A'),(verify.id(182),verify.id(2),'core','Task','Task B');
insert into ownership_assignments(tenant_id,object_id,raci_role,party_kind,party_ref) values (verify.id(1),verify.id(181),'responsible','user',verify.id(11)),(verify.id(2),verify.id(182),'responsible','user',verify.id(14));
insert into operating_profile_entries(tenant_id,scope_kind,namespace,key,value,version_id) values
 (null,'platform','sla','global','{}',verify.id(31)),(verify.id(1),'tenant','sla','local','{}',verify.id(31)),(verify.id(2),'tenant','sla','local','{}',verify.id(32));
insert into import_profiles(id,tenant_id,source_system,entity_type,name) values
 (verify.id(191),null,'generic','jobs','Shared'),(verify.id(192),verify.id(2),'generic','jobs','Private');
insert into data_imports(tenant_id,source_system,entity_type,profile_id) values (verify.id(1),'generic','jobs',verify.id(191));
-- Named exception checks cannot pass by swallowing their own assertion failure.
do $$ begin
 begin insert into people(tenant_id,company_id) values (verify.id(1),verify.id(102));raise exception 'foreign company accepted';exception when check_violation then null;end;
 begin update customer_cards set person_id=verify.id(112) where id=verify.id(121);raise exception 'foreign person accepted';exception when check_violation then null;end;
 begin update jobs set site_id=verify.id(152) where id=verify.id(161);raise exception 'foreign site accepted';exception when check_violation then null;end;
 begin insert into graph_edges(tenant_id,edge_type,from_node_id,to_node_id) values (verify.id(1),'foreign',verify.id(171),verify.id(172));raise exception 'foreign graph edge accepted';exception when check_violation then null;end;
 begin update team_members set org_unit_id=verify.id(132) where id=verify.id(141);raise exception 'foreign org accepted';exception when check_violation then null;end;
 begin insert into org_unit_members(org_unit_id,user_id) values (verify.id(131),verify.id(14));raise exception 'foreign profile accepted';exception when check_violation then null;end;
 begin insert into ownership_assignments(tenant_id,object_id,raci_role,party_kind,party_ref) values (verify.id(1),verify.id(182),'responsible','user',verify.id(11));raise exception 'foreign work accepted';exception when check_violation then null;end;
 begin insert into operating_profile_entries(tenant_id,scope_kind,namespace,key,value,version_id) values (verify.id(1),'tenant','sla','bad','{}',verify.id(32));raise exception 'foreign config accepted';exception when check_violation then null;end;
 begin insert into data_imports(tenant_id,source_system,entity_type,profile_id) values (verify.id(1),'generic','jobs',verify.id(192));raise exception 'foreign import profile accepted';exception when check_violation then null;end;
 begin insert into people(tenant_id,company_id) values (verify.id(1),verify.id(999));raise exception 'missing company accepted';exception when foreign_key_violation then null;end;
 begin insert into companies(tenant_id,name) values (verify.id(999),'No tenant');raise exception 'missing tenant accepted';exception when foreign_key_violation then null;end;
 begin update jobs set tenant_id=verify.id(2) where id=verify.id(161);raise exception 'tenant mutation accepted';exception when check_violation then null;end;
 begin update companies set id=verify.id(999) where id=verify.id(101);raise exception 'identity mutation accepted';exception when check_violation then null;end;
 begin update org_unit_members set org_unit_id=verify.id(132) where user_id=verify.id(11);raise exception 'membership mutation accepted';exception when check_violation then null;end;
end $$;
reset role;
-- Each login uses actual RLS through authenticated, including historical OpenFolk.
set role authenticated;
do $$ declare n int;t text;c int;begin
 for n in 11..14 loop
  perform set_config('request.jwt.claim.sub',verify.id(n)::text,true);
  foreach t in array array['companies','people','customer_cards','org_units','org_unit_members','team_members','sites','jobs','graph_nodes','graph_edges','intelligence_objects','ownership_assignments'] loop
   execute format('select count(*) from public.%I',t) into c;
   assert c=1,format('Tenant RLS failed: profile %s table %s count %s',n,t,c);
  end loop;
  assert (select count(*)=2 from operating_profile_entries),'Local and platform defaults must be visible';
  assert (select count(*)=case when n=14 then 2 else 1 end from import_profiles),'Import defaults/private separation';
  assert (select count(*)=16 from authority_permissions),'Permission vocabulary missing';
 end loop;
 perform set_config('request.jwt.claim.sub',verify.id(11)::text,true);
 begin insert into companies(tenant_id,name) values (verify.id(1),'Direct write');raise exception 'authenticated write accepted';exception when insufficient_privilege then null;end;
 begin perform body_text from email_messages;raise exception 'raw communications exposed';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',verify.id(999)::text,true);
 assert (select count(*)=0 from intelligence_objects),'Missing profile exposed tenant records';
end $$;
reset role;
-- Existing source rows survive byte-for-byte, including private raw metadata.
do $$ begin
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b);
 assert (select count(*)=1 from of_test_deploy.migrations where migration_name='learn_card_work_foundations_v1');
end $$;
-- Native FK SET NULL remains usable under the additional guard.
set role service_role;
delete from companies where id=verify.id(101);
do $$ begin assert (select company_id is null from people where id=verify.id(111));end $$;
reset role;
