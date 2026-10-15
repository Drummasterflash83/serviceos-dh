-- Restrict the operator account-health lookup to terminal message runs of the
-- selected sync type. The older account/time index traverses hundreds of
-- irrelevant runs per mailbox under large retained histories.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
do $$begin
 if to_regclass('public.learn_email_health_latest_runs_idx') is not null
  or md5(pg_get_functiondef('public.learn_operator_capture_health(uuid,text)'::regprocedure))
    is distinct from '7c52320c0d9f19a36af3909f51de0ff8'
  or md5(pg_get_functiondef('public.learn_phone_account_evidence(uuid,uuid)'::regprocedure))
    is distinct from '1a5cac8bfce4f2a8721d470fab9e0df1'
 then raise exception 'email_health_index_prerequisites_changed';end if;
end$$;
create index learn_email_health_latest_runs_idx on public.email_sync_runs
 (tenant_id,(metadata->>'email_account_id'),sync_type,started_at desc,id desc)
 where provider='gmail' and sync_type in ('messages','workspace_messages')
  and status in ('success','failed');
commit;
