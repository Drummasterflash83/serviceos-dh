-- Synthetic only; caller MUST roll the entire transaction back.
set local plpgsql.check_asserts=on;
insert into tenants(id,slug,display_name,metadata)
 values('ef6422bc-aaaa-4000-8000-000000000001','phone-handoff-rollback','Synthetic Phone handoff rollback','{"synthetic":true}');
insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,started_at,duration_seconds)
 values('ef6422bc-aaaa-4000-8000-000000000002','ef6422bc-aaaa-4000-8000-000000000001','simwood','synthetic-call','IN','2026-10-11T10:00:00Z',30);
insert into phone_ai_insights(id,tenant_id,call_id,summary,sentiment)
 values('ef6422bc-aaaa-4000-8000-000000000003','ef6422bc-aaaa-4000-8000-000000000001','ef6422bc-aaaa-4000-8000-000000000002','Synthetic retained analysis','neutral');
set local role service_role;
do $$declare v text;iid uuid;eid uuid;begin
 v:=phone_projection_version('ef6422bc-aaaa-4000-8000-000000000001','ef6422bc-aaaa-4000-8000-000000000002');
 assert v ~ '^[a-f0-9]{32}$';
 assert phone_projection_version('ef6422bc-aaaa-4000-8000-000000000099','ef6422bc-aaaa-4000-8000-000000000002') is null;
 assert (select count(*) from phone_select_projectable('ef6422bc-aaaa-4000-8000-000000000001',10))=1;
 insert into interactions(tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,direction,occurred_at,summary,source_version,processing_status)
 values('ef6422bc-aaaa-4000-8000-000000000001','simwood','phone','phone_calls','ef6422bc-aaaa-4000-8000-000000000002','phone_call','inbound','2026-10-11T10:00:00Z','Synthetic retained analysis',v,'ready') returning id into iid;
 insert into platform_events(tenant_id,event_type,subject_type,subject_id,source,payload)
 values('ef6422bc-aaaa-4000-8000-000000000001','interaction.ready','interaction',iid,'phone-process-pipeline','{"synthetic":true}') returning id into eid;
 assert (select count(*) from phone_select_projectable('ef6422bc-aaaa-4000-8000-000000000001',10))=0;
 assert (select dirty_reason from phone_projection_diagnostics('ef6422bc-aaaa-4000-8000-000000000001',10))='clean';
 begin
  insert into platform_events(tenant_id,event_type,subject_type,subject_id)
   values('ef6422bc-aaaa-4000-8000-000000000001','interaction.ready','interaction',iid);
  raise exception 'Duplicate pending event accepted';
 exception when unique_violation then null;end;
 update platform_events set status='consumed',consumed_at=clock_timestamp() where id=eid;
 assert (select status from platform_events where id=eid)='consumed';
end$$;
reset role;
update phone_calls set updated_at=clock_timestamp() where id='ef6422bc-aaaa-4000-8000-000000000002';
do $$begin assert (select count(*) from phone_select_projectable('ef6422bc-aaaa-4000-8000-000000000001',10))=0;end$$;
update phone_ai_insights set summary='Synthetic revised analysis' where id='ef6422bc-aaaa-4000-8000-000000000003';
do $$begin
 assert (select count(*) from phone_select_projectable('ef6422bc-aaaa-4000-8000-000000000001',10))=1;
 assert (select dirty_reason from phone_projection_diagnostics('ef6422bc-aaaa-4000-8000-000000000001',10))='version_changed';
 assert not has_function_privilege('authenticated','phone_projection_version(uuid,uuid)','execute');
 assert not has_function_privilege('anon','phone_projection_version(uuid,uuid)','execute');
 assert not has_table_privilege('authenticated','platform_events','insert');
end$$;
