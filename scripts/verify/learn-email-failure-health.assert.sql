-- Exercise the actual operator reader: no provider data, credentials or network.
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';
update email_accounts set status='active_dwd',last_incremental_success_at=null,last_incremental_attempt_at=null,last_sync_error=null where id=fixture_id(301);
insert into email_sync_runs(id,tenant_id,sync_type,status,started_at,completed_at,error_message,metadata)
values(fixture_id(970),fixture_id(100),'workspace_messages','failed',clock_timestamp()-interval '2 seconds',clock_timestamp()-interval '1 second','delegation_grant_invalid',jsonb_build_object('email_account_id',fixture_id(301),'provider_body','PRIVATE_TOKEN'));
set role authenticated;
do $$declare r jsonb;begin
 r:=fixture_health_email();
 assert r#>>'{email_failure,code}'='delegation_grant_invalid';
 assert r#>>'{email_failure,attempt_id}'=fixture_id(970)::text;
 assert (r#>>'{email_failure,occurred_at}')::timestamptz=(r->>'last_failure_at')::timestamptz;
 assert (select count(*) from jsonb_object_keys(r->'email_failure'))=3;
 assert r::text not like '%PRIVATE%';
end $$;
reset role;
-- Unknown provider text is never echoed to the operator.
update email_sync_runs set error_message='PRIVATE_TOKEN_WITH_ADDRESS' where id=fixture_id(970);
set role authenticated;
do $$declare r jsonb;begin r:=fixture_health_email();assert r#>>'{email_failure,code}'='capture_failed';assert r::text not like '%PRIVATE%';end$$;
reset role;
-- A foreign company's attempt cannot replace this mailbox's diagnostic.
insert into email_sync_runs(tenant_id,sync_type,status,error_message,metadata) values(fixture_id(101),'workspace_messages','failed','scopes_missing',jsonb_build_object('email_account_id',fixture_id(301)));
set role authenticated;
do $$begin assert fixture_health_email()#>>'{email_failure,code}'='capture_failed';end$$;
reset role;
-- A later successful capture clears the diagnostic; a scheduler success cannot.
update email_sync_runs set status='success',error_message=null where id=fixture_id(970);
set role authenticated;
do $$begin assert fixture_health_email()->'email_failure'='null'::jsonb;end$$;
reset role;
-- Restore an actionable fixture for SQL-to-application-parser acceptance.
update email_sync_runs set status='failed',error_message='delegation_grant_invalid' where id=fixture_id(970);
select 'Safe diagnostic scope, unknown-error redaction and later-success clearing passed';
