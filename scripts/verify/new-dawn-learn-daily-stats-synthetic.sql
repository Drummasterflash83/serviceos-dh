-- Run after the bootstrap and migration in a disposable PostgreSQL database.
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$declare r jsonb;begin
  r := public.new_dawn_learn_daily_stats('00000000-0000-0000-0000-000000000001');
  if r#>>'{counts,calls,total}' <> '1'
    or r#>>'{counts,recordings,total}' <> '1'
    or r#>>'{counts,emails,total}' <> '1'
    or r#>>'{counts,slack,total}' <> '1'
    or r#>>'{counts,jobs,total}' <> '2'
    or r#>>'{counts,jobs,today}' <> '1'
    or r#>>'{counts,customers,total}' <> '1'
    or r#>>'{counts,sites,total}' <> '1'
    or r#>>'{latest_saved_job,number}' <> '002'
    or r->>'provider_newest_state' <> 'not_checked'
  then raise exception 'daily_stats_counts_failed: %', r; end if;
  begin
    perform public.new_dawn_learn_daily_stats('00000000-0000-0000-0000-000000000002');
    raise exception 'cross_tenant_allowed';
  exception when insufficient_privilege then null; end;
  insert into public.view_as_context(actor_user_id)
    values ('00000000-0000-0000-0000-000000000011');
  begin
    perform public.new_dawn_learn_daily_stats('00000000-0000-0000-0000-000000000001');
    raise exception 'view_as_allowed';
  exception when insufficient_privilege then null; end;
  delete from public.view_as_context;
end$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000033';
do $$declare r jsonb;begin
  begin
    perform public.new_dawn_learn_daily_stats('00000000-0000-0000-0000-000000000001');
    raise exception 'operator_client_path_allowed';
  exception when insufficient_privilege then null; end;
  r := public.new_dawn_learn_daily_stats(
    '00000000-0000-0000-0000-000000000001', 'Reviewing daily ledger');
  if r#>>'{counts,jobs,total}' <> '2' then raise exception 'operator_count_failed'; end if;
  if not exists(select 1 from public.controlplane_change_log
    where id = (r->>'audit_id')::uuid and action = 'learn.daily_stats_preview'
      and reason = 'Reviewing daily ledger') then raise exception 'operator_audit_missing'; end if;
end$$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000022';
do $$declare r jsonb;begin
  r := public.new_dawn_learn_daily_stats('00000000-0000-0000-0000-000000000002');
  if r#>>'{counts,jobs,total}' <> '1' or r#>>'{counts,calls,total}' <> '1'
    or r#>>'{counts,slack,total}' <> '0'
    or r#>>'{latest_saved_job,number}' <> 'FOREIGN'
  then raise exception 'second_tenant_counts_failed: %', r; end if;
end$$;

update public.feature_flags set value = 'false'::jsonb
  where tenant_id = '00000000-0000-0000-0000-000000000002';
do $$begin
  begin
    perform public.new_dawn_learn_daily_stats('00000000-0000-0000-0000-000000000002');
    raise exception 'disabled_flag_allowed';
  exception when insufficient_privilege then null; end;
end$$;
