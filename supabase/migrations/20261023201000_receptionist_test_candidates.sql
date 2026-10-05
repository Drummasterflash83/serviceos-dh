begin;
create table public.receptionist_test_candidates (
 tenant_id uuid primary key references public.tenants(id),
 actor_id uuid not null references auth.users(id),
 source_hash text not null,
 source_assistant jsonb not null,
 source_tools jsonb not null,
 state text not null default 'preparing',
 helper_id uuid,
 handoff_id uuid,
 candidate_id uuid,
 created_at timestamptz not null default now()
);
alter table public.receptionist_test_candidates enable row level security;
revoke all on public.receptionist_test_candidates from public,anon,authenticated;
grant all on public.receptionist_test_candidates to service_role;
commit;
