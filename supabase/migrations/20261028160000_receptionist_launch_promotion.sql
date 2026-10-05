begin;
-- Full provider snapshots may include webhook credentials. This table has NO
-- authenticated SELECT grant, unlike the operator-facing audit table.
create table public.receptionist_launch_promotions (
 tenant_id uuid primary key references public.tenants(id),
 actor_id uuid not null references auth.users(id),
 state text not null check(state in ('reserved','applied','conflict','uncertain')),
 run_id uuid not null references public.receptionist_test_runs(id),
 candidate_hash text not null, source_hash text not null, target_hash text not null, graph_hash text not null,
 before_config jsonb not null, target_config jsonb not null, provider_graph jsonb not null, run_evidence jsonb not null,
 provider_version text, created_at timestamptz not null default now(), finished_at timestamptz
);
alter table public.receptionist_launch_promotions enable row level security;
revoke all on public.receptionist_launch_promotions from public,anon,authenticated;
grant select,insert,update on public.receptionist_launch_promotions to service_role;

-- Serialise reservation against normal feedback publications using the same
-- workspace row. The lock spans the reservation transaction; the reserved or
-- uncertain row then prevents another publication during provider I/O.
create function public.receptionist_launch_interlock() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.receptionist_workspaces where tenant_id=new.tenant_id for update;
 if tg_table_name='receptionist_launch_promotions' then
  if exists(select 1 from public.receptionist_releases where tenant_id=new.tenant_id and state in ('publishing','rolling_back','uncertain')) then
   raise exception 'An existing feedback publication needs reconciliation'; end if;
 elsif new.state in ('publishing','rolling_back','uncertain') then
  if exists(select 1 from public.receptionist_launch_promotions where tenant_id=new.tenant_id and state in ('reserved','uncertain')) then
   raise exception 'The launch publication needs reconciliation'; end if;
 end if;
 return new;
end $$;
revoke all on function public.receptionist_launch_interlock() from public,anon,authenticated;
create trigger launch_publication_interlock before insert on public.receptionist_launch_promotions for each row execute function public.receptionist_launch_interlock();
create trigger feedback_launch_interlock before insert or update of state on public.receptionist_releases for each row execute function public.receptionist_launch_interlock();
commit;
