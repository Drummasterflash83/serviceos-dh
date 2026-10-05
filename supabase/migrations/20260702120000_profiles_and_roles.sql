-- ServiceOS — Auth-0: profiles + role model.
--
-- One profile row per auth.users id, carrying the user's role and tenant.
-- Roles: owner | admin | ops | viewer (default viewer). `tenant_id` is set
-- later (invite/admin); it stays a bare uuid until a `tenants` table exists.
--
-- Security: RLS enabled. A user may read ONLY their own profile. No insert /
-- update / role-escalation policies are granted to end users — role/tenant
-- changes are performed by the service role (admin tooling), and new rows are
-- created by the trigger below. Reuses set_updated_at() from the Phone-0
-- migration.

create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  tenant_id  uuid,
  email      text,
  full_name  text,
  role       text not null default 'viewer' check (role in ('owner', 'admin', 'ops', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_tenant_id_idx on profiles (tenant_id);
create index if not exists profiles_role_idx on profiles (role);

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

alter table profiles enable row level security;

-- A user can read their own profile (needed to resolve role/tenant in the app).
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

-- Auto-provision a profile row when a new auth user is created. SECURITY DEFINER
-- so it can insert regardless of the caller's RLS context.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
