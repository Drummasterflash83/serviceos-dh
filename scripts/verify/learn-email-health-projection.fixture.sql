-- Synthetic run metadata through the actual TEST attempt guard.
update email_accounts set last_incremental_success_at=null,last_incremental_attempt_at=null,last_sync_error=null where id=fixture_id(301);
insert into email_sync_runs(id,tenant_id,sync_type,status,started_at,completed_at,metadata) values
 (fixture_id(600),fixture_id(100),'workspace_messages','running',clock_timestamp()-interval '2 minutes',null,jsonb_build_object('email_account_id',fixture_id(301),'mailbox','PRIVATE_ADDRESS','token','DO_NOT_EXPOSE')),
 (fixture_id(601),fixture_id(101),'workspace_messages','running',clock_timestamp(),null,jsonb_build_object('email_account_id',fixture_id(301))),
 (fixture_id(602),fixture_id(100),'workspace_messages','running',clock_timestamp(),null,jsonb_build_object('email_account_id',fixture_id(302))),
 (fixture_id(603),fixture_id(100),'workspace_scheduled_sync','success',clock_timestamp(),clock_timestamp(),jsonb_build_object('email_account_id',fixture_id(301))),
 (fixture_id(604),fixture_id(100),'workspace_backfill','running',clock_timestamp(),null,jsonb_build_object('email_account_id',fixture_id(301))),
 (fixture_id(605),fixture_id(100),'messages','running','2026-01-01T00:00:00Z',null,jsonb_build_object('email_account_id',fixture_id(301)));
-- Real TEST guard permits terminal updates only by the protocol owner.
set role email_ingestion_protocol_owner;
update email_sync_runs set status='success',completed_at=started_at+case when id=fixture_id(600) then interval '1 minute' else interval '1 second' end where id in (fixture_id(600),fixture_id(601),fixture_id(602),fixture_id(604),fixture_id(605));
reset role;
create function fixture_health_email() returns jsonb language sql as $$select x from jsonb_array_elements(learn_operator_capture_health(fixture_id(100))->'rows') x where x->>'id'=fixture_id(301)::text$$;
grant execute on function fixture_health_email() to authenticated;
