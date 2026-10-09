"""Controlled workspace admission races in disposable PostgreSQL only."""
def verify_pacing_races(run, Held, refused):
    run("""update platform_jobs set status='cancelled' where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying');
insert into connector_accounts(id,tenant_connector_id,tenant_id,account_key,settings) values
 (verify.id(1230),verify.id(1200),verify.id(902),'synthetic-new-workspace','{"slack_history":{"teamId":"TNEW"}}'),
 (verify.id(1231),verify.id(1200),verify.id(902),'synthetic-parallel-workspace','{"slack_history":{"teamId":"TPARALLEL"}}');
insert into platform_jobs(id,tenant_id,connector_id,job_type,job_key,payload,priority) values
 (verify.id(1240),verify.id(902),'slack','slack.history_sync','pace-first',jsonb_build_object('connector_account_id',verify.id(1230)),1),
 (verify.id(1241),verify.id(902),'slack','slack.history_sync','pace-second',jsonb_build_object('connector_account_id',verify.id(1230)),2),
 (verify.id(1242),verify.id(902),'slack','slack.history_sync','pace-other-workspace',jsonb_build_object('connector_account_id',verify.id(1231)),3);""")
    with Held("select id from learn_slack_claim_jobs(verify.id(1250),1);"):
        # The first workspace row is still invisible to this session. Its advisory
        # lock prevents duplicate admission without blocking a different workspace.
        result=run("set role service_role;select id from learn_slack_claim_jobs(verify.id(1251),5);")
        assert result.stdout.strip().endswith(b'f0000000-0000-0000-0000-000000001242'),result.stdout
    assert run("select not exists(select 1 from slack_workspace_pacing where team_id='TNEW') and (select status='queued' and attempt_count=0 from platform_jobs where id=verify.id(1240))").stdout.strip()==b't','Rolled-back claim consumed budget'
    with Held("select id from learn_slack_claim_jobs(verify.id(1252),1);") as held:
        assert run("set role service_role;select count(*)=0 from learn_slack_claim_jobs(verify.id(1253),5)").stdout.strip().endswith(b't')
        held.commit()
    assert run("select count(*)=1 from platform_jobs where id in(verify.id(1240),verify.id(1241)) and status='running'").stdout.strip()==b't'
    run("update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=verify.id(1240)")
    assert run("set role service_role;select count(*)=0 from learn_slack_claim_jobs(verify.id(1253),5)").stdout.strip().endswith(b't'),'Expired unpublished work bypassed hold-down'
    assert run("select attempt_count=1 from platform_jobs where id=verify.id(1240)").stdout.strip()==b't'
    run("update slack_workspace_pacing set next_allowed_at=clock_timestamp()-interval '1 second' where team_id='TNEW';update platform_jobs set available_at='-infinity' where id in(verify.id(1240),verify.id(1241));")
    assert run("set role service_role;select id from learn_slack_claim_jobs(verify.id(1254),1)").stdout.strip().endswith(b'f0000000-0000-0000-0000-000000001240')
    refused(run("set role service_role;select learn_slack_finish_job(verify.id(902),verify.id(1240),'learn-slack:'||verify.id(1252),1,'{\"success\":false,\"code\":\"slack_history_rate_limited\",\"retryable\":true,\"retry_after_seconds\":120}')",False),'slack_queue_not_owned')
    refused(run("begin isolation level repeatable read;set role service_role;select id from learn_slack_claim_jobs(verify.id(1255),1)",False),'slack_queue_snapshot')
    print('Concurrent first admission, distinct-workspace progress, rollback, expired-lease hold-down and stale-fence refusal: PASS',flush=True)
