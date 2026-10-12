-- Continue the actual capture/traversal fixture through owner review into cards.
-- Synthetic data only, in a dedicated offline database removed with its container.
reset role;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(199),fixture_id(180),fixture_definition('start')||'{"resource":"jobs"}')->>'state';
reset role;set request.jwt.claim.role='service_role';
select fixture_contact_capture('[{"id":901,"propertyID":303,"description":"Synthetic completed repair","status":"completed","completed":{"completedOnDateTime":"2026-10-01T09:00:00Z"}}]',false,null)->'checkpoint';
create function fixture_captured_version(collection text,external_id text,parent text default null) returns uuid
 language sql security definer set search_path=pg_catalog as $$
 select v.id from public.learn_business_input_versions v where v.tenant_id=public.fixture_id(100)
  and v.connection_id=public.fixture_id(105) and v.collection=$1 and v.external_id=$2
  and ($3 is null or v.payload->>'propertyID'=$3)$$;
grant execute on function fixture_captured_version(text,text,text) to authenticated;
create table fixture_capture_preserved as select md5(string_agg(to_jsonb(v)::text,'' order by id)) hash
 from learn_business_input_versions v where v.tenant_id=fixture_id(100);
-- The operator identity is not substituted for the client's authorised owner.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';set role authenticated;
do $$declare r jsonb;card uuid;site uuid;contact uuid;job uuid;begin
 r:=learn_commusoft_confirm_customer(fixture_id(100),fixture_captured_version('properties','101'),'person',null,'Reviewed captured synthetic customer');
 card:=(r->>'card_id')::uuid;assert card is not null;
 r:=learn_commusoft_confirm_work_record(fixture_id(100),fixture_captured_version('properties','303'),null,'Reviewed captured synthetic site');
 assert r->>'state'='linked';site:=(r->>'entity_id')::uuid;
 r:=learn_commusoft_confirm_contact(fixture_id(100),fixture_captured_version('propertyContacts','1','101'),null,'Old parent must be reviewed');
 assert r->>'state'='held' and r->>'reason'='source_changed_or_ambiguous';
 r:=learn_commusoft_confirm_contact(fixture_id(100),fixture_captured_version('propertyContacts','1','303'),null,'Reviewed captured site contact');
 assert r->>'state'='linked';contact:=(r->>'entity_id')::uuid;
 r:=learn_commusoft_confirm_work_record(fixture_id(100),fixture_captured_version('jobs','901'),null,'Reviewed captured synthetic job');
 assert r->>'state'='linked';job:=(r->>'entity_id')::uuid;
 assert exists(select 1 from customer_cards where id=card and tenant_id=fixture_id(100));
 assert exists(select 1 from sites where id=site and tenant_id=fixture_id(100));
 assert exists(select 1 from people where id=contact and tenant_id=fixture_id(100));
 assert exists(select 1 from jobs where id=job and tenant_id=fixture_id(100) and status='completed' and completed_date='2026-10-01T09:00:00Z');
 r:=learn_commusoft_confirm_work_record(fixture_id(100),fixture_captured_version('jobs','901'),null,'Exact captured job replay');
 assert r->>'already'='true' and (r->>'entity_id')::uuid=job;
 r:=learn_commusoft_job_details(fixture_id(100),fixture_id(105),fixture_captured_version('jobs','901'));
 assert r->>'current'='true' and r->'dates'->'completed'->>'instant'='2026-10-01T09:00:00.000000Z';
 assert not exists(select 1 from customer_cards where tenant_id<>fixture_id(100));
end$$;
reset role;
do $$begin
 assert (select count(distinct card_id)=1 and count(*)=4 from learn_business_input_links where tenant_id=fixture_id(100));
 assert (select count(*)=1 from customer_cards where tenant_id=fixture_id(100));
 assert (select count(*)=2 from graph_edges where tenant_id=fixture_id(100) and edge_type='contact_for');
 assert (select hash from fixture_capture_preserved)=(select md5(string_agg(to_jsonb(v)::text,'' order by id)) from learn_business_input_versions v where v.tenant_id=fixture_id(100));
end$$;
