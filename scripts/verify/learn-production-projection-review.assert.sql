-- Real production references exist for retained attribution.
-- Synthetic assertions only; caller must rollback hosted fixtures.
set local plpgsql.check_asserts=on;
create function pg_temp.review_id(n integer) returns uuid language sql immutable as $$select ('b3870214-dddd-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.review_id(integer) to authenticated,service_role,anon;
insert into tenants(id,slug,display_name,status) values(pg_temp.review_id(1),'projection-review-a','Synthetic review A','active'),(pg_temp.review_id(2),'projection-review-b','Synthetic review B','active');
insert into auth.users(id,email,banned_until) values(pg_temp.review_id(10),'projection-review-admin@example.invalid','infinity'),(pg_temp.review_id(11),'projection-review-viewer@example.invalid','infinity'),(pg_temp.review_id(12),'projection-review-member@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.review_id(10),null,'viewer'),(pg_temp.review_id(11),null,'viewer'),(pg_temp.review_id(12),pg_temp.review_id(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into platform_authority_grants(profile_id,permission,effective_from,effective_to,granted_by,reason) values
 (pg_temp.review_id(10),'platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour','rollback-only','Synthetic assertion'),
 (pg_temp.review_id(11),'platform.controlplane.view',now()-interval '1 hour',now()+interval '1 hour','rollback-only','Synthetic assertion');
insert into people(id,tenant_id,display_name) values(pg_temp.review_id(900),pg_temp.review_id(1),'Synthetic retained attribution');
create function pg_temp.seed_review(n integer,kind text default 'email') returns void language plpgsql as $$declare v text;begin
 if kind='email' then
  insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,to_emails,cc_emails,snippet,direction,received_at,raw_payload) values(pg_temp.review_id(n),pg_temp.review_id(1),'gmail','synthetic-'||n,'customer@example.invalid','["office@example.invalid"]','[]','Retained source preview','inbound','2026-10-11T13:00:00Z','{"PRIVATE_PROVIDER_CANARY":true}');
  insert into interactions(tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,body_preview,related_person_id,metadata) values(pg_temp.review_id(1),'gmail','email','email_messages',pg_temp.review_id(n),'email_message','inbound','2026-10-11T13:00:00Z','Previous canonical preview',pg_temp.review_id(900),'{"PRIVATE_METADATA_CANARY":true}');
  select learn_projection_revision(learn_email_source_fields(m),'') into v from email_messages m where id=pg_temp.review_id(n);
 else
  insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,from_number,to_number,started_at,duration_seconds) values(pg_temp.review_id(n),pg_temp.review_id(1),'sipcentric','synthetic-'||n,'IN','+441632960000','+441632960001','2026-10-11T13:00:00Z',12);
  insert into interactions(tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,body_preview,metadata) values(pg_temp.review_id(1),'sipcentric','phone','phone_calls',pg_temp.review_id(n),'phone_call','inbound','2026-10-11T13:00:00Z','Old phone preview','{"PRIVATE_METADATA_CANARY":true}');
  select learn_projection_revision(learn_phone_source_fields(c),null) into v from phone_calls c where id=pg_temp.review_id(n);
 end if;
 perform learn_project_interaction(pg_temp.review_id(1),pg_temp.review_id(n+1000),kind,pg_temp.review_id(n),v,'publish');
end$$;
select pg_temp.seed_review(20);select pg_temp.seed_review(21,'phone');select pg_temp.seed_review(22);select pg_temp.seed_review(23);select pg_temp.seed_review(24);
create temporary table review_definitions(hold_id uuid primary key,definition jsonb);
insert into review_definitions select pg_temp.review_id(n+1000),jsonb_build_object('action','apply_source','revision',learn_projection_review_state(pg_temp.review_id(1),pg_temp.review_id(n+1000))->>'revision','reason','Synthetic reviewed comparison') from generate_series(20,24)n;
grant select on review_definitions to authenticated;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='b3870214-dddd-4000-8000-000000000010';set local role authenticated;
do $$declare p jsonb;d jsonb;r jsonb;begin
 p:=learn_operator_projection_reviews(pg_temp.review_id(1));assert jsonb_array_length(p->'rows')=5;assert p::text not like '%CANARY%';
 d:=learn_operator_projection_review_detail(pg_temp.review_id(1),pg_temp.review_id(1020));assert d->'can_apply'='true';assert d->'source_fields'->>'body_preview'='Retained source preview';assert d->'canonical_fields'->>'body_preview'='Previous canonical preview';assert d::text not like '%CANARY%';
 assert learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2000),pg_temp.review_id(1020),(select definition from review_definitions where hold_id=pg_temp.review_id(1020)),'check')->>'state'='pending';
 r:=learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2000),pg_temp.review_id(1020),(select definition from review_definitions where hold_id=pg_temp.review_id(1020)));
 assert r->>'state'='recorded' and r->>'card_processing'='pending';
 assert r=learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2000),pg_temp.review_id(1020),(select definition from review_definitions where hold_id=pg_temp.review_id(1020)),'check');
 assert jsonb_array_length(learn_operator_projection_reviews(pg_temp.review_id(1))->'rows')=4;
 begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2000),pg_temp.review_id(1020),(select definition||'{"reason":"Different"}' from review_definitions where hold_id=pg_temp.review_id(1020)));raise exception 'Conflicting replay';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_projection_review_detail(pg_temp.review_id(2),pg_temp.review_id(1021));raise exception 'Cross tenant hold';exception when insufficient_privilege then null;end;
 r:=learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2001),pg_temp.review_id(1021),(select definition from review_definitions where hold_id=pg_temp.review_id(1021)),'cancel');
 assert r->>'state'='cancelled';assert r=learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2001),pg_temp.review_id(1021),(select definition from review_definitions where hold_id=pg_temp.review_id(1021)));
end$$;reset role;
do $$begin
 assert (select previous_interaction->>'body_preview' from learn_projection_operator_reviews where id=pg_temp.review_id(2000))='Previous canonical preview';
 assert (select body_preview='Retained source preview' and related_person_id=pg_temp.review_id(900) and metadata->'PRIVATE_METADATA_CANARY'='true' from interactions where source_id=pg_temp.review_id(20));
 assert (select count(*) from platform_events where tenant_id=pg_temp.review_id(1) and status='pending')=1;
 assert (select body_preview from interactions where source_id=pg_temp.review_id(21))='Old phone preview';
end$$;
-- Reviewed canonical/source changes invalidate the opaque comparison revision.
update interactions set body_preview='Changed during review' where source_id=pg_temp.review_id(22);
update email_messages set snippet='Source changed during review' where id=pg_temp.review_id(23);
set local role authenticated;
do $$begin
 begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2002),pg_temp.review_id(1022),(select definition from review_definitions where hold_id=pg_temp.review_id(1022)));raise exception 'Stale canonical applied';exception when sqlstate 'PT409' then assert SQLERRM='projection_review_changed';end;
 begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2003),pg_temp.review_id(1023),(select definition from review_definitions where hold_id=pg_temp.review_id(1023)));raise exception 'Stale source applied';exception when sqlstate 'PT409' then assert SQLERRM='projection_review_changed';end;
 assert learn_operator_projection_review_detail(pg_temp.review_id(1),pg_temp.review_id(1023))->'can_apply'='false';
end$$;reset role;
-- Audit insertion and publication are a single transaction.
create function pg_temp.review_audit_fail() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure' using errcode='P0002';end$$;
create trigger review_audit_fail before insert on learn_projection_operator_reviews for each row when(new.id='b3870214-dddd-4000-8000-000000002004') execute function pg_temp.review_audit_fail();
set local role authenticated;
do $$begin begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2004),pg_temp.review_id(1024),(select definition from review_definitions where hold_id=pg_temp.review_id(1024)));raise exception 'Ignored audit failure';exception when sqlstate 'P0002' then null;end;end$$;reset role;
do $$begin
 assert (select body_preview='Previous canonical preview' and not(metadata?'source_projection') from interactions where source_id=pg_temp.review_id(24));
 assert not exists(select 1 from learn_interaction_projection_receipts where request_id=pg_temp.review_id(2004));
 assert not exists(select 1 from learn_projection_operator_reviews where id in(pg_temp.review_id(2002),pg_temp.review_id(2003),pg_temp.review_id(2004)));
end$$;drop trigger review_audit_fail on learn_projection_operator_reviews;
-- Pause, viewer, tenant-only, actor mismatch, View-As and revoked grant deny mutation.
insert into feature_flags(tenant_id,flag,value) values(pg_temp.review_id(1),'learn.inputs.email.enabled','false');
set local role authenticated;do $$begin
 assert learn_operator_projection_review_detail(pg_temp.review_id(1),pg_temp.review_id(1024))->'can_apply'='false';
 begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2004),pg_temp.review_id(1024),(select definition from review_definitions where hold_id=pg_temp.review_id(1024)));raise exception 'Paused mutation';exception when sqlstate 'PT409' then null;end;
end$$;reset role;
set local request.jwt.claim.sub='b3870214-dddd-4000-8000-000000000011';set local role authenticated;do $$begin
 perform learn_operator_projection_reviews(pg_temp.review_id(1));
 begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(11),pg_temp.review_id(2004),pg_temp.review_id(1024),(select definition from review_definitions where hold_id=pg_temp.review_id(1024)));raise exception 'Viewer mutation';exception when insufficient_privilege then null;end;
end$$;reset role;
set local request.jwt.claim.sub='b3870214-dddd-4000-8000-000000000012';set local role authenticated;do $$begin
 begin perform learn_operator_projection_reviews(pg_temp.review_id(1));raise exception 'Tenant only read';exception when insufficient_privilege then null;end;
 begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2000),pg_temp.review_id(1020),(select definition from review_definitions where hold_id=pg_temp.review_id(1020)),'check');raise exception 'Actor impersonation';exception when insufficient_privilege then null;end;
end$$;reset role;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,reason) values(pg_temp.review_id(1),pg_temp.review_id(10),'unassigned','Synthetic review');
set local request.jwt.claim.sub='b3870214-dddd-4000-8000-000000000010';set local role authenticated;do $$begin begin perform learn_operator_projection_reviews(pg_temp.review_id(1));raise exception 'View As read';exception when insufficient_privilege then null;end;end$$;reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.review_id(10);
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.review_id(10);
set local role authenticated;do $$begin begin perform learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2000),pg_temp.review_id(1020),(select definition from review_definitions where hold_id=pg_temp.review_id(1020)),'check');raise exception 'Revoked receipt read';exception when insufficient_privilege then null;end;end$$;reset role;
do $$begin
 assert not has_table_privilege('authenticated','learn_projection_operator_reviews','select');
 assert not has_table_privilege('service_role','learn_projection_operator_reviews','select');
 assert not has_function_privilege('service_role','learn_operator_projection_review(uuid,uuid,uuid,uuid,jsonb,text)','execute');
 assert not has_function_privilege('anon','learn_operator_projection_reviews(uuid,uuid)','execute');
end$$;
-- Positive Phone reconciliation after cancelling a separate request; bounded pagination.
update platform_authority_grants set effective_to=now()+interval '1 hour' where profile_id=pg_temp.review_id(10);
set local role authenticated;
select learn_operator_projection_review(pg_temp.review_id(1),pg_temp.review_id(10),pg_temp.review_id(2005),pg_temp.review_id(1021),(select definition from review_definitions where hold_id=pg_temp.review_id(1021)));
reset role;
do $$begin assert (select source_connector_id='sipcentric' and body_preview='Call · 12s' from interactions where source_id=pg_temp.review_id(21));end$$;
update feature_flags set value='true' where tenant_id=pg_temp.review_id(1) and flag='learn.inputs.email.enabled';
select pg_temp.seed_review(n) from generate_series(100,124)n;
set local role authenticated;
do $$declare first_page jsonb;second_page jsonb;begin
 first_page:=learn_operator_projection_reviews(pg_temp.review_id(1));assert jsonb_array_length(first_page->'rows')=20;
 assert first_page->>'next_cursor'=first_page->'rows'->19->>'hold_id';
 second_page:=learn_operator_projection_reviews(pg_temp.review_id(1),(first_page->>'next_cursor')::uuid);
 assert jsonb_array_length(second_page->'rows')>0 and jsonb_array_length(second_page->'rows')<=20;
 assert not exists(select 1 from jsonb_array_elements(first_page->'rows')a,jsonb_array_elements(second_page->'rows')b where a->>'hold_id'=b->>'hold_id');
end$$;reset role;
-- The comparison must not imply consent to hidden Marketing linkage or an
-- unexpected canonical type that the communication publisher does not replace.
select pg_temp.seed_review(125);
update interactions set interaction_type='unknown' where tenant_id=pg_temp.review_id(1) and source_id=pg_temp.review_id(125);
set local role authenticated;
do $$declare d jsonb;begin d:=learn_operator_projection_review_detail(pg_temp.review_id(1),pg_temp.review_id(1125));assert d->>'reason'='canonical_shape_unverified' and d->'can_apply'='false';end$$;reset role;
-- Production already has this column and a tenant-scoped campaign foreign key.
insert into marketing_campaigns(id,tenant_id,name) values(pg_temp.review_id(4000),pg_temp.review_id(1),'Synthetic retained campaign');
select pg_temp.seed_review(126);
update email_messages set origin_campaign_id=pg_temp.review_id(4000) where id=pg_temp.review_id(126);
select learn_project_interaction(pg_temp.review_id(1),pg_temp.review_id(3126),'email',pg_temp.review_id(126),(select learn_projection_revision(learn_email_source_fields(m),origin_campaign_id::text) from email_messages m where id=pg_temp.review_id(126)),'publish');
set local role authenticated;
do $$declare d jsonb;begin d:=learn_operator_projection_review_detail(pg_temp.review_id(1),pg_temp.review_id(3126));assert d->>'reason'='campaign_review_required' and d->'can_apply'='false';end$$;reset role;
