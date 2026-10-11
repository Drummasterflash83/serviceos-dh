insert into profiles(id) values(fixture_id(800)),(fixture_id(801)),(fixture_id(802));
insert into platform_authority_grants(profile_id,permission,effective_from,effective_to) values
 (fixture_id(800),'platform.controlplane.admin',now()-interval '1 hour',now()+interval '1 hour'),
 (fixture_id(801),'platform.controlplane.view',now()-interval '1 hour',now()+interval '1 hour');
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000800';
set role service_role;
select fixture_derived(107,'claim');select fixture_derived(107,'dispatch');select fixture_derived(107,'prepare');
reset role;
set role authenticated;
do $$declare p jsonb;r jsonb;begin
 p:=learn_operator_phone_attempts(fixture_id(1));
 assert jsonb_array_length(p->'rows')=1;
 assert p->'rows'->0->>'run_id'=fixture_id(107)::text;
 assert p->'rows'->0->'can_reconcile'='true';
 assert not(p::text like '%New retained transcript%');assert not(p::text like '%original.wav%');
 assert learn_operator_phone_reconcile(fixture_id(1),fixture_id(900),fixture_id(800),fixture_id(107),'Synthetic review','check')->>'state'='pending';
 r:=learn_operator_phone_reconcile(fixture_id(1),fixture_id(900),fixture_id(800),fixture_id(107),'Synthetic review');
 assert r->>'state'='recorded';assert r->'already_completed'='false';
 assert r=learn_operator_phone_reconcile(fixture_id(1),fixture_id(900),fixture_id(800),fixture_id(107),'Synthetic review');
 assert jsonb_array_length(learn_operator_phone_attempts(fixture_id(1))->'rows')=0;
 begin perform learn_operator_phone_reconcile(fixture_id(1),fixture_id(900),fixture_id(800),fixture_id(107),'Changed reason');raise exception 'Request conflict admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_phone_attempts(fixture_id(2),fixture_id(5));raise exception 'Foreign recording admitted';exception when insufficient_privilege then null;end;
 begin perform learn_operator_phone_reconcile(fixture_id(2),fixture_id(901),fixture_id(800),fixture_id(107),'Foreign');raise exception 'Foreign run admitted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin assert (select count(*) from learn_phone_operator_reconciliations)=1;assert (select count(*) from learn_phone_result_versions where run_id=fixture_id(107))=1;end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000801';set role authenticated;
do $$begin
 perform learn_operator_phone_attempts(fixture_id(1),null,null,false);
 begin perform learn_operator_phone_reconcile(fixture_id(1),fixture_id(901),fixture_id(801),fixture_id(107),'Viewer');raise exception 'Viewer mutation admitted';exception when insufficient_privilege then null;end;
end$$;reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000802';set role authenticated;
do $$begin begin perform learn_operator_phone_attempts(fixture_id(1));raise exception 'Tenant user read admitted';exception when insufficient_privilege then null;end;end$$;reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000800';
set role service_role;select fixture_derived(108,'claim');select fixture_derived(108,'dispatch');select fixture_derived(108,'prepare');reset role;
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_operator_phone_reconcile(fixture_id(1),fixture_id(902),fixture_id(800),fixture_id(108),'Cancel before apply','cancel');assert r->>'state'='cancelled';
 assert learn_operator_phone_reconcile(fixture_id(1),fixture_id(902),fixture_id(800),fixture_id(108),'Cancel before apply')=r;
end$$;reset role;
do $$begin assert (select state from learn_phone_processing_attempts where run_id=fixture_id(108))='prepared';end$$;
update feature_flags set value='false' where tenant_id=fixture_id(1);
set role authenticated;do $$begin
 assert (learn_operator_phone_attempts(fixture_id(1))->'rows'->0->'can_reconcile')='false';
 begin perform learn_operator_phone_reconcile(fixture_id(1),fixture_id(903),fixture_id(800),fixture_id(108),'Paused');raise exception 'Paused publish';exception when sqlstate 'PT409' then assert SQLERRM='learn_capture_paused';end;
end$$;reset role;update feature_flags set value='true' where tenant_id=fixture_id(1);
update phone_recordings set storage_path='changed-source.wav' where id=fixture_id(5);
set role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(fixture_id(1),fixture_id(903),fixture_id(800),fixture_id(108),'Changed source');raise exception 'Changed source published';exception when sqlstate 'PT409' then assert SQLERRM='phone_attempt_source_changed';end;
end$$;reset role;update phone_recordings set storage_path='original.wav' where id=fixture_id(5);
set role authenticated;select learn_operator_phone_reconcile(fixture_id(1),fixture_id(904),fixture_id(800),fixture_id(108),'Verified unchanged source');reset role;
set role service_role;select fixture_derived(109,'claim');select fixture_derived(109,'dispatch');select fixture_derived(109,'fail','{"code":"processing_unconfirmed"}');reset role;
set role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(fixture_id(1),fixture_id(905),fixture_id(800),fixture_id(109),'Unknown paid outcome');raise exception 'Unknown request released';exception when sqlstate 'PT409' then assert SQLERRM='phone_saved_result_unavailable';end;
end$$;reset role;
update platform_authority_grants set effective_to=now()-interval '1 second' where profile_id=fixture_id(800);
set role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(fixture_id(1),fixture_id(900),fixture_id(800),fixture_id(107),'Synthetic review','check');raise exception 'Revoked actor checked receipt';exception when insufficient_privilege then null;end;
end$$;reset role;
do $$begin
 assert not has_table_privilege('authenticated','learn_phone_operator_reconciliations','select');
 assert not has_function_privilege('service_role','learn_operator_phone_reconcile(uuid,uuid,uuid,uuid,text,text)','execute');
 assert not exists(select 1 from learn_phone_operator_reconciliations where id in(fixture_id(901),fixture_id(903),fixture_id(905)));
 assert (select state from learn_phone_processing_attempts where run_id=fixture_id(109))='needs_review';
end$$;
select 'PASS: operator authority, redacted history, atomic publication, exact replay, cancellation tombstone, pause, source change, unknown outcome and revoked access';
-- Release only the offline fixture hold before the separate concurrency test.
update learn_phone_processing_attempts set state='failed' where run_id=fixture_id(109);

update platform_authority_grants set effective_to=now()+interval '1 hour' where profile_id=fixture_id(800);
set role service_role;select fixture_derived(110,'claim');select fixture_derived(110,'dispatch');select fixture_derived(110,'prepare');reset role;
create function fixture_operator_audit_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure' using errcode='P0002';end$$;
create trigger fixture_operator_audit_failure before insert on learn_phone_operator_reconciliations for each row when(new.id=fixture_id(906)) execute function fixture_operator_audit_failure();
set role authenticated;do $$begin
 begin perform learn_operator_phone_reconcile(fixture_id(1),fixture_id(906),fixture_id(800),fixture_id(110),'Atomic audit');raise exception 'Partial publication admitted';exception when sqlstate 'P0002' then null;end;
end$$;reset role;
do $$begin
 assert not exists(select 1 from learn_phone_result_versions where run_id=fixture_id(110));
 assert (select state from learn_phone_processing_attempts where run_id=fixture_id(110))='prepared';
 assert (select processing_run_id from phone_transcripts where id=fixture_id(6))=fixture_id(108);
end$$;
drop trigger fixture_operator_audit_failure on learn_phone_operator_reconciliations;
set role authenticated;select learn_operator_phone_reconcile(fixture_id(1),fixture_id(906),fixture_id(800),fixture_id(110),'Atomic audit');reset role;
select 'PASS: failed operator audit insertion rolls back result publication and preserves the prepared output';
