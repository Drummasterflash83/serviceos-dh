begin;
insert into tenants(id,slug,display_name) values
 ('77000000-0000-0000-0000-000000000001','card-import-a','SYNTHETIC card import A'),
 ('77000000-0000-0000-0000-000000000002','card-import-b','SYNTHETIC card import B');
insert into people(id,tenant_id,display_name) values
 ('77000000-0000-0000-0000-000000000011','77000000-0000-0000-0000-000000000001','SYNTHETIC imported person'),
 ('77000000-0000-0000-0000-000000000012','77000000-0000-0000-0000-000000000001','SYNTHETIC existing person'),
 ('77000000-0000-0000-0000-000000000013','77000000-0000-0000-0000-000000000002','SYNTHETIC foreign person');
insert into companies(id,tenant_id,name) values('77000000-0000-0000-0000-000000000021','77000000-0000-0000-0000-000000000001','SYNTHETIC imported company');
insert into customer_cards(id,tenant_id,person_id,company_id,title,summary,status,locked_fields,latest_activity_at,priority_score,metadata)
 values('77000000-0000-0000-0000-000000000031','77000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000012','77000000-0000-0000-0000-000000000021','Protected title','Protected summary','archived',array['title','summary'],'2026-01-01Z',72,'{"synthetic_manual":true}');
create temp table saved_card as select to_jsonb(c) as value from customer_cards c where id='77000000-0000-0000-0000-000000000031';
create temp table saved_people as select jsonb_agg(to_jsonb(p) order by id) as value from people p;
set local role service_role;
insert into import_entity_links(id,tenant_id,source_system,entity_kind,external_id,entity_table,entity_id,link_strategy) values
 ('77000000-0000-0000-0000-000000000041','77000000-0000-0000-0000-000000000001','commusoft','customer','person-a','people','77000000-0000-0000-0000-000000000011','created'),
 ('77000000-0000-0000-0000-000000000042','77000000-0000-0000-0000-000000000001','commusoft','customer','existing-person','people','77000000-0000-0000-0000-000000000012','email'),
 ('77000000-0000-0000-0000-000000000043','77000000-0000-0000-0000-000000000001','commusoft','customer','company-a','companies','77000000-0000-0000-0000-000000000021','created');
reset role;
do $$ declare c customer_cards%rowtype;r jsonb;denied boolean;begin
 select * into c from customer_cards where person_id='77000000-0000-0000-0000-000000000011';
 assert found and c.title='SYNTHETIC imported person';
 assert c.summary is null and c.latest_activity_at is null and c.priority_score is null and c.confidence is null and c.owner_id is null;
 assert c.status='grey' and c.priority_inputs='{}' and c.context='{}','new card cannot invent assessment or activity';
 assert c.metadata->'learn_import_identity'->>'link_id'='77000000-0000-0000-0000-000000000041';
 assert (select to_jsonb(x) from customer_cards x where id='77000000-0000-0000-0000-000000000031')=(select value from saved_card),'existing card changed';
 assert (select jsonb_agg(to_jsonb(p) order by id) from people p)=(select value from saved_people),'source people changed';
 assert (select count(*) from customer_cards where tenant_id='77000000-0000-0000-0000-000000000001')=3,'company card must remain separate from named person card';
 r:=learn_import_customer_cards_reconcile('77000000-0000-0000-0000-000000000001',null,2);
 assert r->>'processed'='2' and r->>'next_cursor'='77000000-0000-0000-0000-000000000042';
 r:=learn_import_customer_cards_reconcile('77000000-0000-0000-0000-000000000001',(r->>'next_cursor')::uuid,2);
 assert r->>'processed'='1' and r->'next_cursor'='null';
 assert (select count(*) from customer_cards where tenant_id='77000000-0000-0000-0000-000000000001')=3,'repair created duplicate cards';
 denied:=false;begin perform learn_import_customer_card('77000000-0000-0000-0000-000000000002','77000000-0000-0000-0000-000000000041');exception when invalid_parameter_value then denied:=true;end;assert denied;
 denied:=false;begin perform learn_import_customer_cards_reconcile('77000000-0000-0000-0000-000000000001',null,201);exception when invalid_parameter_value then denied:=true;end;assert denied;
 update tenants set status='suspended' where id='77000000-0000-0000-0000-000000000001';
 denied:=false;begin perform learn_import_customer_cards_reconcile('77000000-0000-0000-0000-000000000001');exception when insufficient_privilege then denied:=true;end;assert denied;
 update tenants set status='active' where id='77000000-0000-0000-0000-000000000001';
 assert not has_function_privilege('authenticated','learn_import_customer_card(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('anon','learn_import_customer_cards_reconcile(uuid,uuid,integer)','EXECUTE');
end $$;
-- Different source aliases still reuse the same canonical customer card.
insert into import_entity_links(tenant_id,source_system,entity_kind,external_id,entity_table,entity_id,link_strategy)
values('77000000-0000-0000-0000-000000000001','another-source','customer','alias','people','77000000-0000-0000-0000-000000000011','external_id');
do $$ begin assert (select count(*) from customer_cards where person_id='77000000-0000-0000-0000-000000000011')=1;end $$;
-- Future duplicate writes from ANY path are refused rather than splitting the card history.
do $$ declare denied boolean:=false;begin
 begin insert into customer_cards(tenant_id,person_id) values('77000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000011');exception when unique_violation then denied:=true;end;assert denied;
end $$;
insert into auth.users(id,email,is_sso_user,is_anonymous)
values('77000000-0000-0000-0000-000000000051','synthetic-card-reader@example.invalid',false,false);
insert into profiles(id,email,tenant_id,role)
values('77000000-0000-0000-0000-000000000051','synthetic-card-reader@example.invalid','77000000-0000-0000-0000-000000000001','viewer');
insert into import_entity_links(tenant_id,source_system,entity_kind,external_id,entity_table,entity_id,link_strategy)
values('77000000-0000-0000-0000-000000000002','commusoft','customer','foreign','people','77000000-0000-0000-0000-000000000013','created');
set local role authenticated;
set local request.jwt.claim.sub='77000000-0000-0000-0000-000000000051';
do $$ declare denied boolean:=false;begin
 assert (select count(*) from customer_cards)=3,'reader sees only own company cards';
 assert not exists(select 1 from customer_cards where tenant_id='77000000-0000-0000-0000-000000000002');
 begin perform learn_import_customer_cards_reconcile('77000000-0000-0000-0000-000000000001');exception when insufficient_privilege then denied:=true;end;assert denied,'reader cannot run private repair';
end $$;
reset role;
commit;
