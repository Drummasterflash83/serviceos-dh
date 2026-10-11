-- Only inside a rollback/savepoint rehearsal. No login, password or session.
create function pg_temp.scheduler_id(n int) returns uuid language sql immutable as $$select ('eb190661-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.scheduler_id(int) to authenticated;
do $$begin
 assert not exists(select 1 from tenants where id in(pg_temp.scheduler_id(1),pg_temp.scheduler_id(2)));
 assert not exists(select 1 from auth.users where id in(pg_temp.scheduler_id(10),pg_temp.scheduler_id(11),pg_temp.scheduler_id(12)));
end$$;
insert into tenants(id,slug,display_name,status) values
 (pg_temp.scheduler_id(1),'scheduler-rollback-a','Synthetic scheduler A','active'),
 (pg_temp.scheduler_id(2),'scheduler-rollback-b','Synthetic scheduler B','active');
insert into auth.users(id,email,banned_until) values
 (pg_temp.scheduler_id(10),'scheduler-rollback-owner@example.invalid','infinity'),
 (pg_temp.scheduler_id(11),'scheduler-rollback-viewer@example.invalid','infinity'),
 (pg_temp.scheduler_id(12),'scheduler-rollback-operator@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values
 (pg_temp.scheduler_id(10),pg_temp.scheduler_id(1),'owner'),
 (pg_temp.scheduler_id(11),pg_temp.scheduler_id(1),'viewer'),
 (pg_temp.scheduler_id(12),null,'viewer')
 on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into email_sync_runs(id,tenant_id,provider,sync_type,status,started_at,metadata,error_message) values
 (pg_temp.scheduler_id(20),pg_temp.scheduler_id(1),'gmail','scheduled_sync','success',now()-interval '10 minutes','{}',null),
 (pg_temp.scheduler_id(21),pg_temp.scheduler_id(1),'gmail','scheduled_sync','failed',now()-interval '1 minute','{"enqueue_unconfirmed":1,"private":"PRIVATE_CANARY"}','PRIVATE_CANARY'),
 (pg_temp.scheduler_id(22),pg_temp.scheduler_id(2),'gmail','scheduled_sync','success',now(),'{}','FOREIGN_CANARY'),
 (pg_temp.scheduler_id(23),pg_temp.scheduler_id(1),'gmail','workspace_scheduled_sync','success',now()-interval '1 minute','{"capture_paused":2,"private":"PRIVATE_CANARY"}',null),
 (pg_temp.scheduler_id(24),pg_temp.scheduler_id(1),'gmail','workspace_backfill_scheduled','success',now()-interval '1 minute','{"capture_paused":"PRIVATE_CANARY","enqueue_unconfirmed":-1,"inventory_unavailable":"PRIVATE_CANARY"}',null);
insert into phone_sync_runs(id,tenant_id,provider,sync_type,status,started_at,error_message) values
 (pg_temp.scheduler_id(30),pg_temp.scheduler_id(1),'simwood','scheduled_sync','failed',now()-interval '1 minute','PRIVATE_CANARY');
insert into platform_jobs(id,tenant_id,job_type,job_key,status,payload,created_at) values
 (pg_temp.scheduler_id(40),pg_temp.scheduler_id(1),'interactions.sync','scheduler-rollback-40','retrying','{"private":"PRIVATE_CANARY"}',now()-interval '1 minute'),
 (pg_temp.scheduler_id(41),pg_temp.scheduler_id(1),'identity.resolve','scheduler-rollback-41','queued','{}',now()-interval '1 minute');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='eb190661-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare p jsonb;r jsonb;begin
 p:=public.learn_scheduler_health_read(pg_temp.scheduler_id(1));
 assert p->>'version'='learn-scheduler-health/1' and p->>'tenant_id'=pg_temp.scheduler_id(1)::text;
 assert jsonb_array_length(p->'rows')=10;
 assert (select count(distinct x->>'name') from jsonb_array_elements(p->'rows')x)=10;
 assert p::text not like '%CANARY%' and p::text not like '%payload%' and p::text not like '%error_message%';
 select x into r from jsonb_array_elements(p->'rows')x where x->>'name'='email-scheduled-sync';
 assert r->>'status'='failed' and r->>'enqueue_unconfirmed'='1';
 select x into r from jsonb_array_elements(p->'rows')x where x->>'name'='email-workspace-scheduled-sync';
 assert r->>'capture_paused'='2';
 select x into r from jsonb_array_elements(p->'rows')x where x->>'name'='email-workspace-backfill-scheduled-sync';
 assert r->'capture_paused'='null' and r->'enqueue_unconfirmed'='null' and r->'inventory_unavailable'='null';
 select x into r from jsonb_array_elements(p->'rows')x where x->>'name'='recommendation-scheduled-sync';
 assert r->'observed_at'='null' and r->'status'='null';
 begin perform public.learn_scheduler_health_read(pg_temp.scheduler_id(2));raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
 begin perform public.learn_scheduler_health_read(null);raise exception 'Null tenant admitted';exception when insufficient_privilege then null;end;
end$$;
-- Return the exact bounded, synthetic SQL output for the application's parser.
select public.learn_scheduler_health_read(pg_temp.scheduler_id(1)) as synthetic_summary;
reset role;
set local request.jwt.claim.sub='eb190661-aaaa-4000-8000-000000000011';set local role authenticated;
do $$begin
 assert jsonb_array_length(public.learn_scheduler_health_read(pg_temp.scheduler_id(1))->'rows')=10;
 begin perform public.learn_scheduler_health_read(pg_temp.scheduler_id(2));raise exception 'Foreign viewer admitted';exception when insufficient_privilege then null;end;
end$$;reset role;
-- Removing membership takes effect without issuing a different JWT.
update profiles set tenant_id=null where id=pg_temp.scheduler_id(11);
set local role authenticated;
do $$begin begin perform public.learn_scheduler_health_read(pg_temp.scheduler_id(1));raise exception 'Removed member admitted';exception when insufficient_privilege then null;end;end$$;reset role;
insert into platform_authority_grants(profile_id,permission,effective_from,effective_to,granted_by,reason)
 values(pg_temp.scheduler_id(12),'platform.controlplane.view',now()-interval '1 minute',now()+interval '1 hour','rollback-only','Synthetic scheduler assertion');
set local request.jwt.claim.sub='eb190661-aaaa-4000-8000-000000000012';set local role authenticated;
do $$begin
 assert jsonb_array_length(public.learn_scheduler_health_read(pg_temp.scheduler_id(1))->'rows')=10;
 assert jsonb_array_length(public.learn_scheduler_health_read(pg_temp.scheduler_id(2))->'rows')=10;
end$$;reset role;
insert into view_as_context(tenant_id,actor_user_id,subject_kind,reason)
 values(pg_temp.scheduler_id(1),pg_temp.scheduler_id(12),'unassigned','Synthetic scheduler assertion');
set local role authenticated;
do $$begin begin perform public.learn_scheduler_health_read(pg_temp.scheduler_id(1));raise exception 'Preview admitted';exception when insufficient_privilege then null;end;end$$;reset role;
update view_as_context set ended_at=clock_timestamp() where actor_user_id=pg_temp.scheduler_id(12);
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.scheduler_id(12);
set local role authenticated;
do $$begin begin perform public.learn_scheduler_health_read(pg_temp.scheduler_id(1));raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;reset role;
set local request.jwt.claim.sub='eb190661-aaaa-4000-8000-000000000010';
set local request.jwt.claim.role='service_role';set local role service_role;
do $$begin begin perform public.learn_scheduler_health_read('eb190661-aaaa-4000-8000-000000000001');raise exception 'Service impersonation admitted';exception when insufficient_privilege then null;end;end$$;reset role;
set local request.jwt.claim.role='anon';set local role anon;
do $$begin begin perform public.learn_scheduler_health_read('eb190661-aaaa-4000-8000-000000000001');raise exception 'Anonymous admitted';exception when insufficient_privilege then null;end;end$$;reset role;
do $$begin
 assert not has_function_privilege('anon','public.learn_scheduler_health_read(uuid)','execute');
 assert not has_function_privilege('service_role','public.learn_scheduler_health_read(uuid)','execute');
 assert not has_column_privilege('authenticated','public.email_sync_runs','metadata','select');
 assert not has_column_privilege('authenticated','public.platform_jobs','payload','select');
end$$;
