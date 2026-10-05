begin;
-- Chris explicitly approved ONE additional 12-scenario Vapi run on 2 October.
-- Keep the original allowance, its two consumed IDs and the normal 8/24h limit.
alter table public.receptionist_test_launch_allowances
  add column additional_approval_at timestamptz,
  add column additional_approval_reason text;

alter table public.receptionist_test_launch_allowances
  drop constraint receptionist_test_launch_allowances_max_runs_check,
  drop constraint receptionist_test_launch_allowances_used_run_ids_check,
  add constraint receptionist_test_launch_allowances_max_runs_check check (
    max_runs=2 or (
      max_runs=3 and tenant_id='00000000-0000-0000-0000-000000000001' and
      assistant_id='dcfc2e66-a438-43ab-b863-467f5a5089df' and
      starts_at='2026-10-01T23:00:00Z' and ends_at='2026-10-02T23:00:00Z' and
      additional_approval_at is not null and additional_approval_reason is not null
    )
  ),
  add constraint receptionist_test_launch_allowances_used_run_ids_check
    check(cardinality(used_run_ids)<=max_runs);

do $$
declare a public.receptionist_test_launch_allowances; chris uuid;
begin
  select id into strict chris from auth.users where lower(email)='chris@openfolk.ai';
  perform public.care_release_actor(chris);
  select * into strict a from public.receptionist_test_launch_allowances
    where tenant_id='00000000-0000-0000-0000-000000000001' for update;
  if a.actor_id<>chris or a.assistant_id<>'dcfc2e66-a438-43ab-b863-467f5a5089df' or
     a.starts_at<>'2026-10-01T23:00:00Z' or a.ends_at<>'2026-10-02T23:00:00Z' or
     now()<a.starts_at or now()>=a.ends_at or a.max_runs<>2 or cardinality(a.used_run_ids)<>2 or
     a.additional_approval_at is not null then
    raise exception 'Original two consumed launch slots must match the explicit one-run approval';
  end if;
  update public.receptionist_test_launch_allowances set
    max_runs=3, additional_approval_at=now(),
    additional_approval_reason='Chris explicitly answered yes to one additional 12-scenario Vapi run using existing credits, beyond the current test cap. One extra run only; no main-number switch or staff calls.'
    where tenant_id=a.tenant_id and max_runs=2 and used_run_ids=a.used_run_ids;
  if not found then raise exception 'Allowance changed; no additional slot granted'; end if;
  insert into public.phone_operations_audit(
    tenant_id,actor_user_id,actor_label,action,resource_type,resource_ref,before_state,after_state,reason
  ) values(
    a.tenant_id,chris,'OpenFolk authorised launch retest','one_additional_launch_test_approved',
    'receptionist_test_launch_allowances',a.tenant_id::text,
    jsonb_build_object('maximum',a.max_runs,'usedRunIds',a.used_run_ids,'expiresAt',a.ends_at),
    jsonb_build_object('maximum',3,'usedRunIds',a.used_run_ids,'expiresAt',a.ends_at,'additionalRuns',1),
    'Explicit user approval: 1. Yes. Existing funded credits; exactly one additional isolated twelve-scenario test. Original reservations and all normal safeguards retained.'
  );
end $$;
commit;
