-- Client-facing outcome programmes. Independent of operational ingestion/activation.
-- Portal membership never grants tenant/profile or Control Plane authority.
create table public.client_portal_access (
  tenant_id uuid not null references public.tenants(id),
  profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, profile_id)
);
alter table public.client_portal_access enable row level security;
revoke all on public.client_portal_access from anon, authenticated;
grant select on public.client_portal_access to authenticated;
grant all on public.client_portal_access to service_role;
create policy portal_access_self on public.client_portal_access for select to authenticated
using (profile_id = auth.uid() or public.current_user_is_openfolk_operator());

create table public.client_programmes (
  tenant_id uuid primary key references public.tenants(id),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) < 200000),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.client_programmes enable row level security;
revoke all on public.client_programmes from anon, authenticated;
grant select, insert, update on public.client_programmes to authenticated;
grant all on public.client_programmes to service_role;
create policy programme_read on public.client_programmes for select to authenticated
using (public.current_user_is_openfolk_operator() or exists (
  select 1 from public.client_portal_access a where a.tenant_id = client_programmes.tenant_id and a.profile_id = auth.uid()
));
create policy programme_insert on public.client_programmes for insert to authenticated
with check (public.current_user_is_openfolk_operator('platform.controlplane.admin'));
create policy programme_update on public.client_programmes for update to authenticated
using (public.current_user_is_openfolk_operator('platform.controlplane.admin'))
with check (public.current_user_is_openfolk_operator('platform.controlplane.admin'));

create table public.client_programme_revisions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id),
  version integer not null,
  content jsonb not null,
  actor_id uuid,
  recorded_at timestamptz not null default now(),
  unique(tenant_id, version)
);
alter table public.client_programme_revisions enable row level security;
revoke all on public.client_programme_revisions from anon, authenticated;
grant select on public.client_programme_revisions to authenticated;
grant all on public.client_programme_revisions to service_role;
create policy programme_revisions_operator on public.client_programme_revisions for select to authenticated
using (public.current_user_is_openfolk_operator());

create function public.client_programme_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id then raise exception 'Programme tenant cannot change'; end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger client_programme_stamp before insert or update on public.client_programmes
for each row execute function public.client_programme_stamp();
create function public.client_programme_record_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.client_programme_revisions(tenant_id,version,content,actor_id)
    values (new.tenant_id,new.version,new.content,auth.uid());
  return new;
end $$;
create trigger client_programme_revision after insert or update on public.client_programmes
for each row execute function public.client_programme_record_revision();
revoke all on function public.client_programme_stamp() from public, anon, authenticated;
revoke all on function public.client_programme_record_revision() from public, anon, authenticated;

create table public.client_programme_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.client_programmes(tenant_id),
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
alter table public.client_programme_notes enable row level security;
revoke all on public.client_programme_notes from anon, authenticated;
grant select on public.client_programme_notes to authenticated;
grant insert (tenant_id, body) on public.client_programme_notes to authenticated;
grant all on public.client_programme_notes to service_role;
create policy programme_notes_read on public.client_programme_notes for select to authenticated
using (exists (select 1 from public.client_programmes p where p.tenant_id = client_programme_notes.tenant_id));
create policy programme_notes_insert on public.client_programme_notes for insert to authenticated
with check (author_id = auth.uid() and exists (
  select 1 from public.client_programmes p where p.tenant_id = client_programme_notes.tenant_id
));
