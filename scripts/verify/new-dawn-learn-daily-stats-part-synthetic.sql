-- Run only in a disposable database after the daily-stats bootstrap and both
-- daily-stats migrations. Never execute this fixture on LIVE.
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
do $$
declare c jsonb; s jsonb; b jsonb;
begin
  c := public.new_dawn_learn_daily_stats_part(
    '00000000-0000-0000-0000-000000000001', 'communications');
  s := public.new_dawn_learn_daily_stats_part(
    '00000000-0000-0000-0000-000000000001', 'slack');
  b := public.new_dawn_learn_daily_stats_part(
    '00000000-0000-0000-0000-000000000001', 'business');
  if c#>>'{counts,calls,total}' <> '1'
    or c#>>'{counts,emails,total}' <> '1'
    or c->'counts' ? 'jobs'
    or s#>>'{counts,slack,total}' <> '1'
    or s->'counts' ? 'emails'
    or b#>>'{counts,jobs,total}' <> '2'
    or b#>>'{latest_saved_job,number}' <> '002'
    or b->'counts' ? 'slack'
  then raise exception 'split_counts_failed'; end if;
  if (select count(*) from public.controlplane_change_log
      where id in ((c->>'audit_id')::uuid, (s->>'audit_id')::uuid, (b->>'audit_id')::uuid)
        and action = 'learn.daily_stats_part_read') <> 3 then
    raise exception 'split_audit_missing';
  end if;
  begin
    perform public.new_dawn_learn_daily_stats_part(
      '00000000-0000-0000-0000-000000000002', 'business');
    raise exception 'cross_tenant_allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.new_dawn_learn_daily_stats_part(
      '00000000-0000-0000-0000-000000000001', null);
    raise exception 'null_part_allowed';
  exception when invalid_parameter_value then null; end;
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000033';
do $$
declare r jsonb;
begin
  r := public.new_dawn_learn_daily_stats_part(
    '00000000-0000-0000-0000-000000000001', 'business', 'Reviewing daily ledger');
  if r#>>'{counts,jobs,total}' <> '2' or not exists(
    select 1 from public.controlplane_change_log
    where id = (r->>'audit_id')::uuid and action = 'learn.daily_stats_part_preview'
      and reason = 'Reviewing daily ledger' and after->>'part' = 'business'
  ) then raise exception 'split_operator_audit_failed'; end if;
end $$;
