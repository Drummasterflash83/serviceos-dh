-- Run after existing Microsoft source/card/discovery/worker fixtures, inside ROLLBACK.
create function pg_temp.status_id(n int) returns uuid language sql immutable as $$select ('ce790000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.status_id(int) to authenticated;
insert into tenants(id,slug,display_name,status) values(pg_temp.status_id(1),'microsoft-status-empty','Synthetic empty status company','active');
insert into auth.users(id,email,banned_until) values(pg_temp.status_id(10),'microsoft-status-rollback@example.invalid','infinity');
insert into profiles(id,tenant_id,role) values(pg_temp.status_id(10),pg_temp.status_id(1),'owner') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='ce790000-aaaa-4000-8000-000000000010';set local role authenticated;
do $$begin begin perform learn_operator_microsoft_status(pg_temp.status_id(1));raise exception 'Tenant owner gained operator access';exception when insufficient_privilege then null;end;end$$;
reset role;
insert into platform_authority_grants(profile_id,permission,granted_by,effective_to) values(pg_temp.status_id(10),'platform.controlplane.view','synthetic rollback only',clock_timestamp()+interval '5 minutes');
set local role authenticated;
do $$declare r jsonb;a jsonb;begin
 r:=learn_operator_microsoft_status('eb190660-aaaa-4000-8000-000000000001');a:=r->'accounts'->0;
 assert r->>'version'='learn-microsoft-status/1' and jsonb_array_length(r->'accounts')=1,'Microsoft status assertion 1';
 assert a->>'account_id'='eb190660-aaaa-4000-8000-000000000002','Microsoft status assertion 2';
 assert a->>'capture_allowed'='false' and a->>'account_active'='false' and a->>'coverage_complete'='false' and a->>'attachments_captured'='false','Microsoft status assertion 3';
 assert a->>'discovery_rounds'='2' and a->>'physical_folders'='2' and a->>'search_folders'='0','Microsoft status assertion 4';
 assert (a->>'saved_pages')::int>0 and (a->>'settled_pages')::int>0 and (a->>'published_observations')::int>0 and (a->>'held_observations')::int>0,'Microsoft status assertion 5';
 assert a->'jobs'->>'dead_letter'='1' and a->'jobs'->>'retrying'='1','Microsoft status assertion 6';
 assert r::text not like '%SYNTHETIC-NEW%' and r::text not like '%Synthetic worker recovery content%' and r::text not like '%graph.microsoft.com%' and r::text not like '%WorkerRehearsalFolder%','Microsoft status assertion 7';
 assert learn_operator_microsoft_status(pg_temp.status_id(1))->'accounts'='[]'::jsonb,'Microsoft status assertion 8';
 begin perform 1 from learn_microsoft_source_pages;raise exception 'Operator read raw messages';exception when insufficient_privilege then null;end;
end$$;
reset role;
update platform_jobs set error_code='PRIVATE_SECRET_OR_MESSAGE',last_error='PRIVATE_PROVIDER_BODY',updated_at=clock_timestamp() where id='eb190660-aaaa-4000-8000-000000000802';
set local role authenticated;
do $$declare r jsonb;begin
 r:=learn_operator_microsoft_status('eb190660-aaaa-4000-8000-000000000001');
 assert r#>>'{accounts,0,issue_code}'='microsoft_review_required','Microsoft status assertion 9';assert r::text not like '%PRIVATE_%','Microsoft status assertion 10';
end$$;reset role;
insert into email_accounts(id,tenant_id,provider,email_address,status,auth_state) select pg_temp.status_id(n),'eb190660-aaaa-4000-8000-000000000001','microsoft_365','page-'||n||'@example.invalid','disabled','revoked' from generate_series(101,121)n;
set local role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=learn_operator_microsoft_status('eb190660-aaaa-4000-8000-000000000001');
 b:=learn_operator_microsoft_status('eb190660-aaaa-4000-8000-000000000001',(a->>'next_after')::uuid);
 assert jsonb_array_length(a->'accounts')=20 and jsonb_array_length(b->'accounts')=2 and b->'next_after'='null'::jsonb,'Microsoft status assertion 11';
 assert a#>>'{accounts,0,saved_pages}'='0' and a#>>'{accounts,0,enabled_bindings}'='0','Microsoft status assertion 12';
end$$;reset role;
update platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.status_id(10);
set local role authenticated;
do $$begin begin perform learn_operator_microsoft_status(pg_temp.status_id(1));raise exception 'Revoked operator admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local request.jwt.claim.sub='';set local role authenticated;
do $$begin begin perform learn_operator_microsoft_status(pg_temp.status_id(1));raise exception 'Unsigned actor admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role anon;
do $$begin begin perform learn_operator_microsoft_status(null);raise exception 'Anon admitted';exception when insufficient_privilege then null;end;end$$;
reset role;set local role service_role;
do $$begin begin perform learn_operator_microsoft_status(null);raise exception 'Service impersonation admitted';exception when insufficient_privilege then null;end;end$$;reset role;
