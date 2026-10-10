-- Synthetic operational metadata; no message content or real credentials.
create table email_sync_runs(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,provider text not null default 'gmail',sync_type text not null,status text not null default 'running',started_at timestamptz not null default now(),completed_at timestamptz,records_processed integer not null default 0,error_message text,metadata jsonb not null default '{}');
alter table email_sync_runs enable row level security;
revoke all on email_sync_runs from public,anon,authenticated,service_role;
update email_accounts set last_incremental_success_at=null,last_incremental_attempt_at=null,last_sync_error=null where id=fixture_id(301);
insert into email_sync_runs(id,tenant_id,sync_type,status,started_at,completed_at,metadata) values
 (fixture_id(600),fixture_id(100),'workspace_messages','success',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',jsonb_build_object('email_account_id',fixture_id(301),'mailbox','PRIVATE_ADDRESS','token','DO_NOT_EXPOSE')),
 (fixture_id(601),fixture_id(101),'workspace_messages','success',clock_timestamp(),clock_timestamp(),jsonb_build_object('email_account_id',fixture_id(301))),
 (fixture_id(602),fixture_id(100),'workspace_messages','success',clock_timestamp(),clock_timestamp(),jsonb_build_object('email_account_id',fixture_id(302))),
 (fixture_id(603),fixture_id(100),'workspace_scheduled_sync','success',clock_timestamp(),clock_timestamp(),jsonb_build_object('email_account_id',fixture_id(301))),
 (fixture_id(604),fixture_id(100),'workspace_backfill','success',clock_timestamp(),clock_timestamp(),jsonb_build_object('email_account_id',fixture_id(301))),
 (fixture_id(605),fixture_id(100),'messages','success',clock_timestamp(),clock_timestamp(),jsonb_build_object('email_account_id',fixture_id(301)));
create function fixture_health_email() returns jsonb language sql as $$select x from jsonb_array_elements(learn_operator_capture_health(fixture_id(100))->'rows') x where x->>'id'=fixture_id(301)::text$$;
grant execute on function fixture_health_email() to authenticated;
