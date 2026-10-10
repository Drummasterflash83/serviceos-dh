"""Thread recovery races in the disposable verification database only."""
def verify_thread_resume_races(run, Held, race_after, refused):
    actor="set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';"
    def review():
        run("set role authenticated;"+actor+"update verify.thread_recovery_review set state=learn_slack_thread_recovery_read(verify.id(901),verify.id(1520));")
    def resume(request):
        return actor+f"select learn_slack_resume_thread(verify.id(901),verify.id({request}),verify.id(1520),(select state->>'stateVersion' from verify.thread_recovery_review),'continue',1,'Controlled thread recovery race');"
    review()
    with Held("reset role;update profiles set role='viewer' where id=verify.id(911);") as held:
        refused(race_after(held,resume(1521),'authenticated'),'Company owner/admin access required')
    assert run("select not exists(select 1 from slack_thread_imports where id=verify.id(1521))").stdout.strip()==b't'
    run("update profiles set role='owner' where id=verify.id(911)")
    review()
    with Held("update provider_connections set non_secret_config=non_secret_config||'{\"thread_recovery_race\":true}' where id=verify.id(921);") as held:
        refused(race_after(held,resume(1522),'authenticated'),'Thread progress changed; reload review')
    review()
    with Held("set role authenticated;"+resume(1523)) as held:
        refused(race_after(held,resume(1524),'authenticated'),'Thread progress changed; reload review')
    assert run("select count(*)=1 from slack_thread_imports where id in(verify.id(1523),verify.id(1524))").stdout.strip()==b't'
    assert run("select count(*)=1 from platform_jobs where payload->>'thread_import_id'=verify.id(1523)::text").stdout.strip()==b't'
    assert b'"reused": true' in run("set role authenticated;"+resume(1523)).stdout
    assert run("select count(*)=(select thread_message_count+2 from verify.thread_resume_before) from slack_messages where channel_id='CTHREAD'").stdout.strip()==b't'
    print('Thread recovery races: revoked owner, changed connection, competing reviews and exact retry: PASS',flush=True)
