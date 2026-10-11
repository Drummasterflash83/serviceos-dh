-- Synthetic transaction; caller rolls back or uses an offline disposable database.
set local plpgsql.check_asserts=on;
create function pg_temp.identity_id(n integer) returns uuid language sql immutable as $$select ('b671cd32-bbbb-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into tenants(id,slug,display_name,metadata) values(pg_temp.identity_id(1),'identity-delivery-synthetic-a','Synthetic identity delivery A','{"synthetic":true}'),(pg_temp.identity_id(2),'identity-delivery-synthetic-b','Synthetic identity delivery B','{"synthetic":true}');
create function pg_temp.identity_seed(n integer,contact text default '+441632960000') returns void language sql as $$
 insert into public.interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,phone_from,phone_to,summary,processing_status,metadata)
 values(pg_temp.identity_id(n),pg_temp.identity_id(1),'simwood','phone','phone_calls',pg_temp.identity_id(n+1000),'phone_call','inbound','2026-10-11T10:00:00Z',contact,'+441632960001','Synthetic useful summary','ready',jsonb_build_object('phone_handoff',jsonb_build_object('version','learn-phone-handoff/1','sourceFingerprint',repeat('a',64))));
 insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,status,payload)
 values(pg_temp.identity_id(1),'interaction.ready','interaction',pg_temp.identity_id(n),'pending',jsonb_build_object('source_fingerprint',repeat('a',64)));
$$;
create function pg_temp.identity_apply(n integer,r integer) returns jsonb language sql as $$
 select public.learn_identity_deliver(pg_temp.identity_id(1),pg_temp.identity_id(r),pg_temp.identity_id(n),public.learn_identity_revision(i),'publish') from public.interactions i where id=pg_temp.identity_id(n)
$$;
-- Wrapper is invoker; explicit test grants do not extend beyond transaction.
grant execute on function pg_temp.identity_id(integer) to service_role,authenticated;
select pg_temp.identity_seed(10);
create temporary table expected as select id,public.learn_identity_revision(i) as revision from public.interactions i where id=pg_temp.identity_id(10);
grant select on expected to service_role;
set local role service_role;
select public.learn_identity_deliver(pg_temp.identity_id(1),pg_temp.identity_id(100),pg_temp.identity_id(10),(select revision from expected),'publish');
reset role;
do $$declare r jsonb;begin
 select receipt into r from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(100);
 assert r->>'state'='committed' and (r->>'cardEnriched')::boolean and (r->>'personCreated')::boolean;
 assert (r->>'eventsConsumed')::int=1;
 assert (select processing_status from interactions where id=pg_temp.identity_id(10))='enriched';
 assert (select count(*) from customer_cards where tenant_id=pg_temp.identity_id(1))=1;
 assert (select summary from customer_cards where tenant_id=pg_temp.identity_id(1))='Synthetic useful summary';
 assert (select count(*) from recommendations where tenant_id=pg_temp.identity_id(1) and type='review_new_contact')=1;
 assert (select status from platform_events where subject_id=pg_temp.identity_id(10))='consumed';
 assert public.learn_identity_deliver(pg_temp.identity_id(1),pg_temp.identity_id(100),pg_temp.identity_id(10),(select revision from expected),'publish')=r;
 assert public.learn_identity_deliver(pg_temp.identity_id(1),pg_temp.identity_id(100),pg_temp.identity_id(10),(select revision from expected),'inspect')=r;
 begin perform public.learn_identity_deliver(pg_temp.identity_id(2),pg_temp.identity_id(100),pg_temp.identity_id(10),(select revision from expected),'inspect');raise exception 'Foreign receipt accepted';exception when sqlstate 'PT409' then assert SQLERRM='identity_receipt_conflict';end;
end$$;
-- Same existing contact: no duplicate identities/cards, manually locked fields and
-- newer activity/summary survive an older historical source.
update customer_cards set title='Manual contact title',summary='Newer retained summary',priority='critical',priority_score=99,locked_fields=array['title','priority','priority_score'],latest_activity_at='2026-10-12T10:00:00Z' where tenant_id=pg_temp.identity_id(1);
select pg_temp.identity_seed(11);
select pg_temp.identity_apply(11,101);
do $$begin
 assert (select count(*) from people where tenant_id=pg_temp.identity_id(1))=1;
 assert (select count(*) from customer_cards where tenant_id=pg_temp.identity_id(1))=1;
 assert (select title='Manual contact title' and summary='Newer retained summary' and priority='critical' and priority_score=99 and latest_activity_at='2026-10-12T10:00:00Z'::timestamptz from customer_cards where tenant_id=pg_temp.identity_id(1));
end$$;
-- Source changes after selection invalidate the request, leaving the newer event pending.
select pg_temp.identity_seed(12,'+441632960012');
insert into expected select id,public.learn_identity_revision(i) from interactions i where id=pg_temp.identity_id(12);
update interactions set summary='Newer synthetic revision' where id=pg_temp.identity_id(12);
do $$begin
 begin perform public.learn_identity_deliver(pg_temp.identity_id(1),pg_temp.identity_id(102),pg_temp.identity_id(12),(select revision from expected where id=pg_temp.identity_id(12)),'publish');raise exception 'Stale revision accepted';exception when sqlstate 'PT409' then assert SQLERRM='identity_source_changed';end;
 assert (select processing_status from interactions where id=pg_temp.identity_id(12))='ready';
 assert (select status from platform_events where subject_id=pg_temp.identity_id(12))='pending';
 assert not exists(select 1 from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(102));
end$$;
-- Roll back every identity/card/link/recommendation when a late event write fails.
select pg_temp.identity_seed(13,'+441632960013');
create function pg_temp.identity_fail_event() returns trigger language plpgsql as $$begin raise exception 'synthetic event failure' using errcode='P0002';end$$;
create trigger identity_fail_event before update on platform_events for each row when(new.subject_id='b671cd32-bbbb-4000-8000-000000000013') execute function pg_temp.identity_fail_event();
do $$begin
 begin perform pg_temp.identity_apply(13,103);raise exception 'Late event failure ignored';exception when sqlstate 'P0002' then null;end;
 assert not exists(select 1 from people where primary_phone='+441632960013');
 assert (select processing_status='ready' and related_person_id is null from interactions where id=pg_temp.identity_id(13));
 assert not exists(select 1 from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(103));
end$$;
drop trigger identity_fail_event on platform_events;
select pg_temp.identity_apply(13,104);
-- A card write error likewise leaves the complete input retryable.
select pg_temp.identity_seed(14,'+441632960014');
create function pg_temp.identity_fail_card() returns trigger language plpgsql as $$begin raise exception 'synthetic card failure' using errcode='P0002';end$$;
create trigger identity_fail_card before update on customer_cards for each row execute function pg_temp.identity_fail_card();
do $$begin
 begin perform pg_temp.identity_apply(14,105);raise exception 'Card write failure ignored';exception when sqlstate 'P0002' then null;end;
 assert not exists(select 1 from people where primary_phone='+441632960014');
 assert (select processing_status from interactions where id=pg_temp.identity_id(14))='ready';
 assert (select status from platform_events where subject_id=pg_temp.identity_id(14))='pending';
end$$;
drop trigger identity_fail_card on customer_cards;
-- No arbitrary first match or customer attribution for internal/unknown traffic.
insert into people(tenant_id,primary_phone) values(pg_temp.identity_id(1),'+441632960015'),(pg_temp.identity_id(1),'+441632960015');
select pg_temp.identity_seed(15,'+441632960015');
select pg_temp.identity_apply(15,106);
select pg_temp.identity_seed(16,'+441632960016');
update interactions set direction='internal' where id=pg_temp.identity_id(16);
select pg_temp.identity_apply(16,107);
do $$begin
 assert (select receipt->>'reason' from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(106))='person_ambiguous';
 assert (select receipt->>'reason' from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(107))='internal_interaction';
 assert (select count(*) from interactions where id in(pg_temp.identity_id(15),pg_temp.identity_id(16)) and processing_status='identity_review')=2;
 assert (select count(*) from platform_events where subject_id in(pg_temp.identity_id(15),pg_temp.identity_id(16)) and status='pending')=2;
 assert not exists(select 1 from people where primary_phone='+441632960016');
 assert not exists(select 1 from public.learn_identity_pending(pg_temp.identity_id(1),50) where interaction_id in(pg_temp.identity_id(15),pg_temp.identity_id(16)));
end$$;
-- Existing human decisions and foreign attribution cannot be overwritten.
select pg_temp.identity_seed(17);
insert into interaction_match_suggestions(tenant_id,interaction_id,target_type,target_id,status) select pg_temp.identity_id(1),pg_temp.identity_id(17),'person',id,'rejected' from people where primary_phone='+441632960000';
select pg_temp.identity_apply(17,108);
do $$begin assert (select receipt->>'reason' from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(108))='reviewed_match_rejected';end$$;
-- Event coalesced to a different revision must never be acknowledged.
select pg_temp.identity_seed(18,'+441632960018');
update platform_events set payload=jsonb_build_object('source_fingerprint',repeat('b',64)) where subject_id=pg_temp.identity_id(18);
do $$begin begin perform pg_temp.identity_apply(18,109);raise exception 'Different event accepted';exception when sqlstate 'PT409' then assert SQLERRM='identity_event_changed';end;end$$;
-- Only service RPCs; no public/authenticated execution or raw receipt access.
set local role authenticated;
do $$begin
 begin perform public.learn_identity_pending(pg_temp.identity_id(1),20);raise exception 'Authenticated selection allowed';exception when insufficient_privilege then null;end;
 begin perform public.learn_identity_deliver(pg_temp.identity_id(1),pg_temp.identity_id(110),pg_temp.identity_id(18),repeat('a',64),'publish');raise exception 'Authenticated delivery allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
set local role service_role;
do $$begin begin perform 1 from public.learn_identity_delivery_receipts;raise exception 'Raw receipt read allowed';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$begin begin update learn_identity_delivery_receipts set source_revision=repeat('b',64);raise exception 'Receipt mutable';exception when sqlstate '55000' then null;end;end$$;

-- Outbound email attributes the recipient, and business-domain identities remain
-- explicitly provisional. Future runs reuse the same unique person and card.
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,from_address,from_name,to_addresses,occurred_at,summary,processing_status)
 values(pg_temp.identity_id(19),pg_temp.identity_id(1),'google_workspace','email','email_messages',pg_temp.identity_id(1019),'email_message','outbound','office@sender.invalid','Tenant sender',array['CUSTOMER@Example.invalid'],'2026-10-11T11:00:00Z','Synthetic outbound email','pending');
select pg_temp.identity_apply(19,111);
do $$begin
 assert (select count(*) from people where tenant_id=pg_temp.identity_id(1) and primary_email='customer@example.invalid' and display_name is null and not verified)=1;
 assert (select count(*) from companies where tenant_id=pg_temp.identity_id(1) and domain='example.invalid' and not verified)=1;
 assert (select title from customer_cards where person_id=(select id from people where primary_email='customer@example.invalid'))='customer@example.invalid';
 assert (select receipt->>'eventsConsumed' from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(111))='0';
end$$;
-- Foreign pre-existing identity links never cross tenant boundaries.
insert into people(id,tenant_id,primary_phone) values(pg_temp.identity_id(200),pg_temp.identity_id(2),'+441632960020');
select pg_temp.identity_seed(20,'+441632960020');
update interactions set related_person_id=pg_temp.identity_id(200) where id=pg_temp.identity_id(20);
select pg_temp.identity_apply(20,112);
do $$begin assert (select receipt->>'reason' from learn_identity_delivery_receipts where request_id=pg_temp.identity_id(112))='person_link_invalid';end$$;
