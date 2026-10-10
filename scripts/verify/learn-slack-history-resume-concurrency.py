"""Checkpoint recovery races in the disposable verification database only."""
def verify_history_resume_races(run, Held, race_after, refused):
    actor="set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000911';"

    def review():
        run("set role authenticated;"+actor+"update verify.history_review set state=learn_slack_history_read(verify.id(901),(select account_id from verify.history_recovery));")

    def resume(request):
        return actor+f"select learn_slack_resume_history(verify.id(901),verify.id({request}),(select account_id from verify.history_recovery),(select state->>'stateVersion' from verify.history_review),'continue',1,'Controlled recovery race');"

    review()
    with Held("reset role;update profiles set role='viewer' where id=verify.id(911);") as held:
        refused(race_after(held,resume(1320),'authenticated'),'Company owner/admin access required')
    assert run("select not exists(select 1 from slack_history_imports where id=verify.id(1320))").stdout.strip()==b't'
    run("update profiles set role='owner' where id=verify.id(911)")

    # A connection edit can commit while approval waits on its row. The saved
    # review must be invalidated using the newly committed revision.
    review()
    with Held("update provider_connections set non_secret_config=non_secret_config||'{\"recovery_race\":true}' where id=verify.id(921);") as held:
        refused(race_after(held,resume(1321),'authenticated'),'Channel progress changed; reload review')
    assert run("select not exists(select 1 from slack_history_imports where id=verify.id(1321))").stdout.strip()==b't'

    review()
    with Held("set role authenticated;"+resume(1322)) as held:
        refused(race_after(held,resume(1323),'authenticated'),'Channel progress changed; reload review')
    assert run("select count(*)=1 from slack_history_imports where id in(verify.id(1322),verify.id(1323))").stdout.strip()==b't'
    assert run("select count(*)=1 from platform_jobs where job_type='slack.history_sync' and payload->>'connector_account_id'=(select account_id::text from verify.history_recovery) and status in ('queued','running','retrying')").stdout.strip()==b't'
    # An exact retry of the successful review resolves its retained receipt even
    # though that approval has replaced the current checkpoint and state hash.
    result=run("set role authenticated;"+resume(1322))
    assert b'"reused": true' in result.stdout,result.stdout
    assert run("select count(*)=2 from slack_messages where channel_id='CRESUME'").stdout.strip()==b't'
    print('Recovery races: revoked authority refused, changed connection invalidates review, two approvals queue once, exact retry retains receipt: PASS',flush=True)
