-- After the contact fixture, exercise the real delivery and operator APIs.
-- The caller encloses all synthetic records and grants in a rollback transaction.
create function pg_temp.separation_delivery(n int,phone text,email text default null) returns jsonb language plpgsql as $$
declare i public.interactions%rowtype;r jsonb;begin
 insert into public.interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,phone_from,from_address,summary,processing_status)
 values(public.fixture_id(n),public.fixture_id(1),'synthetic','phone','phone_calls',public.fixture_id(n+1000),'phone_call','inbound','2026-10-14T00:00:00Z',phone,email,'Synthetic shared-office communication','ready') returning * into i;
 r:=public.learn_identity_deliver(i.tenant_id,public.fixture_id(n+2000),i.id,public.learn_identity_revision(i),'publish');return r;
end$$;
-- Reproduce the dangerous shape: one primary owner and a distinct named person
-- carrying only a non-primary source contact point.
update public.people set primary_phone='02079460123' where id=(select entity_id from public.learn_business_input_links where tenant_id=fixture_id(1) and collection='propertyContacts' and external_id='501');
do $$declare r jsonb;before_cards int;begin
 select count(*) into before_cards from public.customer_cards where tenant_id=fixture_id(1);
 assert public.learn_identity_shared_contact_channel(fixture_id(1),'phone','02079460123');
 assert public.learn_identity_shared_contact_channel(fixture_id(1),'phone','+44 20 7946 0123'),'Source-region normalization failed';
 assert not public.learn_identity_shared_contact_channel(fixture_id(2),'phone','02079460123'),'Other tenant affected';
 r:=pg_temp.separation_delivery(800,'02079460123');assert r->>'reason'='person_ambiguous';
 r:=pg_temp.separation_delivery(801,'+442079460123');assert r->>'reason'='person_ambiguous';
 r:=pg_temp.separation_delivery(802,null,'SHARED@example.invalid');assert r->>'reason'='person_ambiguous','Shared email auto-attributed';
 assert (select count(*) from public.customer_cards where tenant_id=fixture_id(1))=before_cards,'Ambiguous delivery created cards';
 assert not exists(select 1 from public.interactions where id in(fixture_id(800),fixture_id(801),fixture_id(802)) and (related_person_id is not null or processing_status<>'identity_review'));
 -- One person's multiple source endpoints do not count as distinct people.
 assert not public.learn_identity_shared_contact_channel(fixture_id(1),'email','jamie@example.invalid');
end$$;
-- Primary-only counterpart: the old person need not have a contact_points row.
insert into public.people(id,tenant_id,display_name,primary_phone) values(fixture_id(850),fixture_id(1),'Primary only shared manager','07700900456');
insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value,metadata)
 select fixture_id(1),entity_id,'phone','07700 900456','+447700900456',jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',fixture_id(5))) from public.learn_business_input_links where tenant_id=fixture_id(1) and collection='propertyContacts' and external_id='511';
do $$declare r jsonb;begin
 r:=pg_temp.separation_delivery(803,'+447700900456');assert r->>'reason'='person_ambiguous','Primary-only counterpart missed';
end$$;
-- No hard-coded UK assumption: a non-UK source normalizes punctuation without
-- treating an initial zero as a UK calling code.
update public.provider_connections set non_secret_config=jsonb_set(non_secret_config,'{region}','"us"') where id=fixture_id(5);
insert into public.people(id,tenant_id,display_name,primary_phone) values(fixture_id(852),fixture_id(1),'Foreign-region primary','01234 56789');
insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value,metadata)
 select fixture_id(1),entity_id,'phone','01234-56789','0123456789',jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',fixture_id(5))) from public.learn_business_input_links where tenant_id=fixture_id(1) and collection='propertyContacts' and external_id='511';
do $$begin
 assert public.learn_identity_shared_contact_channel(fixture_id(1),'phone','01234-56789');
 assert not public.learn_identity_shared_contact_channel(fixture_id(1),'phone','+44123456789'),'UK assumption applied to other region';
end$$;
update public.provider_connections set non_secret_config=jsonb_set(non_secret_config,'{region}','"uk"') where id=fixture_id(5);
-- An ordinary unique primary still publishes; foreign contact points cannot hold it.
insert into public.people(id,tenant_id,display_name,primary_phone) values(fixture_id(853),fixture_id(1),'Unique manager','+441632960853');
insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value) values(fixture_id(2),fixture_id(84),'phone','+441632960853','+441632960853');
do $$declare r jsonb;begin
 r:=pg_temp.separation_delivery(804,'+441632960853');assert r->>'state'='committed';
 assert (select related_person_id=fixture_id(853) from public.interactions where id=fixture_id(804));
end$$;
-- The private helper cannot be called by API roles.
set local role service_role;
do $$begin begin perform public.learn_identity_shared_contact_channel(public.fixture_id(1),'phone','02079460123');raise exception 'Private identity helper exposed';exception when insufficient_privilege then null;end;end$$;
reset role;
-- Existing logged operator review can resolve one held communication. It does
-- not globally verify either person or turn the shared endpoint into a primary.
update public.platform_authority_grants set effective_to=clock_timestamp()+interval '5 minutes' where profile_id=fixture_id(81) and permission='platform.controlplane.admin';
select set_config('fixture.separation_person',(select entity_id::text from public.learn_business_input_links where tenant_id=fixture_id(1) and collection='propertyContacts' and external_id='511'),true);
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='92000000-0000-4000-8000-000000000081';set local role authenticated;
do $$declare d jsonb;r jsonb;target uuid:=current_setting('fixture.separation_person')::uuid;begin
 d:=public.learn_operator_identity_review_detail(public.fixture_id(1),public.fixture_id(800),target);
 assert d->>'hold_reason'='person_ambiguous' and d->'can_apply'='true';
 r:=public.learn_operator_identity_review(public.fixture_id(1),public.fixture_id(81),public.fixture_id(2900),public.fixture_id(800),jsonb_build_object('action','attribute_contact','person_id',target,'reason','Synthetic named person checked against the retained communication','revision',d->>'revision'));
 assert r->>'state'='recorded' and r->>'card_processing'='committed';
end$$;
reset role;
do $$begin
 assert (select related_person_id=current_setting('fixture.separation_person')::uuid and processing_status='enriched' from public.interactions where id=fixture_id(800));
 assert (select not verified and primary_phone is null and primary_email is null from public.people where id=current_setting('fixture.separation_person')::uuid);
 assert (select actor_id=fixture_id(81) from public.learn_identity_operator_reviews where id=fixture_id(2900));
end$$;
