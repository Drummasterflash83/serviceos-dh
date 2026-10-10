set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';
set role authenticated;
do $$declare r jsonb;begin
 r:=fixture_health_email();
 assert (r->>'last_success_at')::timestamptz<clock_timestamp()-interval '30 seconds';
 assert (r->>'last_success_at')::timestamptz>clock_timestamp()-interval '3 minutes';
 assert r->'last_failure_at'='null'::jsonb;
 assert r::text not like '%PRIVATE%' and r::text not like '%DO_NOT_EXPOSE%';
end$$;
reset role;
-- A newer mailbox failure must override an older success; raw diagnostics stay private.
insert into email_sync_runs(id,tenant_id,sync_type,status,started_at,completed_at,error_message,metadata) values
 (fixture_id(606),fixture_id(100),'workspace_messages','failed',clock_timestamp()-interval '20 seconds',clock_timestamp()-interval '10 seconds','DO_NOT_EXPOSE_PROVIDER_ERROR',jsonb_build_object('email_account_id',fixture_id(301)));
set role authenticated;
do $$declare r jsonb;begin r:=fixture_health_email();assert r->'last_success_at'='null'::jsonb;assert r->>'last_failure_at' is not null;assert r::text not like '%DO_NOT_EXPOSE%';end$$;
reset role;
-- A later-started successful run supersedes the failure, even when zero messages changed.
insert into email_sync_runs(id,tenant_id,sync_type,status,started_at,completed_at,metadata) values
 (fixture_id(607),fixture_id(100),'workspace_messages','success',clock_timestamp()-interval '5 seconds',clock_timestamp()-interval '4 seconds',jsonb_build_object('email_account_id',fixture_id(301)));
set role authenticated;
do $$declare r jsonb;begin r:=fixture_health_email();assert r->>'last_success_at' is not null;assert r->'last_failure_at'='null'::jsonb;end$$;
reset role;
-- A malformed success cannot be promoted to successful capture.
update email_sync_runs set completed_at=null where id=fixture_id(607);
set role authenticated;
do $$declare r jsonb;begin r:=fixture_health_email();assert r->'last_success_at'='null'::jsonb;assert r->>'last_failure_at' is not null;end$$;
reset role;
update email_sync_runs set completed_at=started_at+interval '1 second' where id=fixture_id(607);
-- OAuth evidence is a distinct capture path, never a Workspace run or a scheduler heartbeat.
update email_accounts set status='active',auth_state='ok' where id=fixture_id(301);
update email_sync_runs set started_at='2026-01-01T00:00:00Z',completed_at='2026-01-01T00:00:01Z' where id=fixture_id(605);
set role authenticated;
do $$declare r jsonb;begin r:=fixture_health_email();assert (r->>'last_success_at')::timestamptz='2026-01-01T00:00:01Z'::timestamptz;end$$;
reset role;
select 'Mailbox-specific run evidence, failure precedence, provider-path separation and redaction passed';
