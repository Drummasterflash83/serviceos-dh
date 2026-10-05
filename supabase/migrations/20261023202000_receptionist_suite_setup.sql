begin;
create table public.receptionist_test_suite_setups (
 tenant_id uuid not null references public.tenants(id),
 setup_key text not null,
 actor_id uuid not null references auth.users(id),
 state text not null,
 resources jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 primary key(tenant_id,setup_key)
);
alter table public.receptionist_test_suite_setups enable row level security;
revoke all on public.receptionist_test_suite_setups from public,anon,authenticated;
grant all on public.receptionist_test_suite_setups to service_role;
commit;
