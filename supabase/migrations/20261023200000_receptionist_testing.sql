begin;
create table public.receptionist_test_settings (
 tenant_id uuid primary key references public.tenants(id),
 suite_id uuid not null,
 assistant_id uuid not null,
 label text not null,
 updated_at timestamptz not null default now()
);
create table public.receptionist_test_runs (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references auth.users(id),
 suite_id uuid not null,
 assistant_id uuid not null,
 assistant_hash text not null,
 provider_id uuid unique,
 state text not null check(state in ('preparing','running','passed','failed','cancelled','uncertain')),
 report jsonb not null default '{}'::jsonb,
 slack_state text not null default 'pending',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index receptionist_test_one_active on public.receptionist_test_runs(tenant_id)
 where state in ('preparing','running','uncertain');
alter table public.receptionist_test_settings enable row level security;
alter table public.receptionist_test_runs enable row level security;
revoke all on public.receptionist_test_settings,public.receptionist_test_runs from public,anon,authenticated;
grant select on public.receptionist_test_settings,public.receptionist_test_runs to authenticated;
grant all on public.receptionist_test_settings,public.receptionist_test_runs to service_role;
create policy test_settings_operator on public.receptionist_test_settings for select to authenticated using(public.care_desk_operator());
create policy test_runs_operator on public.receptionist_test_runs for select to authenticated using(public.care_desk_operator());
insert into public.receptionist_test_settings(tenant_id,suite_id,assistant_id,label) values
 ('00000000-0000-0000-0000-000000000001','22cfc666-9480-4b1b-bffb-de358dc11f7c','4eb2bee8-ac25-47c9-b962-409ed250ceb6','Emma launch checks');
create function public.receptionist_test_reserve(p_tenant uuid,p_actor uuid,p_hash text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.receptionist_test_settings; n uuid;
begin
 perform public.notification_require_actor(p_actor);
 select * into strict s from public.receptionist_test_settings where tenant_id=p_tenant for update;
 if (select count(*) from public.receptionist_test_runs where tenant_id=p_tenant and created_at>now()-interval '24 hours')>=8 then
  raise exception 'Daily test safeguard reached'; end if;
 if exists(select 1 from public.receptionist_test_runs where tenant_id=p_tenant and created_at>now()-interval '2 minutes') then
  raise exception 'Please wait two minutes before another run'; end if;
 insert into public.receptionist_test_runs(tenant_id,actor_id,suite_id,assistant_id,assistant_hash,state)
 values(p_tenant,p_actor,s.suite_id,s.assistant_id,p_hash,'preparing') returning id into n;
 return n;
end $$;
revoke all on function public.receptionist_test_reserve(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.receptionist_test_reserve(uuid,uuid,text) to service_role;
commit;
