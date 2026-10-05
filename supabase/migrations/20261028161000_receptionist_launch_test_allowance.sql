begin;
-- Chris authorised continuing today's isolated launch checks. Two extra
-- reservations only; the ordinary 8/rolling-24h safeguard is unchanged.
create table public.receptionist_test_launch_allowances (
 tenant_id uuid primary key references public.tenants(id),
 actor_id uuid not null references auth.users(id),
 assistant_id uuid not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 max_runs integer not null check(max_runs=2),
 used_run_ids uuid[] not null default '{}'::uuid[] check(cardinality(used_run_ids)<=2),
 reason text not null,
 created_at timestamptz not null default now(),
 check(ends_at>starts_at)
);
alter table public.receptionist_test_launch_allowances enable row level security;
revoke all on public.receptionist_test_launch_allowances from public,anon,authenticated;
grant select,insert,update on public.receptionist_test_launch_allowances to service_role;
do $$declare chris uuid; begin
 select id into strict chris from auth.users where lower(email)='chris@openfolk.ai';
 insert into public.receptionist_test_launch_allowances(tenant_id,actor_id,assistant_id,starts_at,ends_at,max_runs,reason)
 values('00000000-0000-0000-0000-000000000001',chris,'dcfc2e66-a438-43ab-b863-467f5a5089df',
 '2026-10-01T23:00:00Z','2026-10-02T23:00:00Z',2,
 'Explicit launch continuation on 2 October 2026: at most two additional isolated DH candidate simulation runs, using existing funded credits; no live calls, new processors or credit purchase. Normal concurrency and cooldown remain.');
end $$;

create function public.receptionist_test_reserve_launch(p_tenant uuid,p_actor uuid,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.receptionist_test_settings; a public.receptionist_test_launch_allowances; n uuid;
begin
 perform public.care_release_actor(p_actor);
 if p_tenant<>'00000000-0000-0000-0000-000000000001' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
  raise exception 'Unapproved launch test tenant or configuration'; end if;
 -- Same workspace lock as normal reservations: normal and extra runs cannot
 -- bypass each other's concurrency or cooldown.
 select * into strict s from public.receptionist_test_settings where tenant_id=p_tenant for update;
 if s.assistant_id<>'dcfc2e66-a438-43ab-b863-467f5a5089df' then raise exception 'Isolated launch candidate required'; end if;
 select * into strict a from public.receptionist_test_launch_allowances where tenant_id=p_tenant for update;
 if a.actor_id<>p_actor or a.assistant_id<>s.assistant_id or now()<a.starts_at or now()>=a.ends_at then
  raise exception 'Dated launch test allowance is unavailable'; end if;
 if exists(select 1 from public.receptionist_test_runs where tenant_id=p_tenant and state in ('preparing','running','uncertain')) then
  raise exception 'Another test is active or needs reconciliation'; end if;
 if exists(select 1 from public.receptionist_test_runs where tenant_id=p_tenant and created_at>now()-interval '2 minutes') then
  raise exception 'Please wait two minutes before another run'; end if;
 if (select count(*) from public.receptionist_test_runs where tenant_id=p_tenant and created_at>now()-interval '24 hours')<8 then
  -- If the normal rolling window frees up, do not consume a special slot.
  return public.receptionist_test_reserve(p_tenant,p_actor,p_hash);
 end if;
 if cardinality(a.used_run_ids)>=a.max_runs then raise exception 'Two extra launch test reservations have been used'; end if;
 insert into public.receptionist_test_runs(tenant_id,actor_id,suite_id,assistant_id,assistant_hash,state)
 values(p_tenant,p_actor,s.suite_id,s.assistant_id,p_hash,'preparing') returning id into n;
 update public.receptionist_test_launch_allowances set used_run_ids=array_append(used_run_ids,n) where tenant_id=p_tenant;
 return n;
end $$;
revoke all on function public.receptionist_test_reserve_launch(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.receptionist_test_reserve_launch(uuid,uuid,text) to service_role;
commit;
