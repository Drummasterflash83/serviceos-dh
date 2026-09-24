begin;
do $$begin
 if not exists(select 1 from public.receptionist_workspaces w join public.tenants t on t.id=w.tenant_id where w.tenant_id='00000000-0000-0000-0000-000000000001' and t.slug='drummonds' and w.assistant_id='4eb2bee8-ac25-47c9-b962-409ed250ceb6') then raise exception 'Production binding mismatch';end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261020120000') then raise exception 'Migration already recorded; inspect instead of replay';end if;
end $$;
-- Emma V1: additive, tenant-scoped practice. No main-line/provider routing change.
alter table public.receptionist_workspaces add column if not exists phone_snapshot jsonb;
alter table public.receptionist_workspaces add column practice_enabled boolean not null default false;
alter table public.receptionist_workspaces drop constraint receptionist_workspaces_launch_stage_check;
alter table public.receptionist_workspaces add constraint receptionist_workspaces_launch_stage_check
 check(launch_stage in ('Testing','Ready','Live','Paused'));

create table public.receptionist_practice_sessions (
 id uuid primary key,
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 author_id uuid not null references public.profiles(id),
 call_id uuid unique,
 source_version text,
 state text not null default 'starting' check(state in ('starting','active','ended','failed')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '5 minutes'
);
create index receptionist_practice_tenant on public.receptionist_practice_sessions(tenant_id,created_at desc);
alter table public.receptionist_practice_sessions enable row level security;
revoke all on public.receptionist_practice_sessions from anon,authenticated;
grant select on public.receptionist_practice_sessions to authenticated;
grant all on public.receptionist_practice_sessions to service_role;
create policy receptionist_practice_read on public.receptionist_practice_sessions for select to authenticated using (
 exists(select 1 from public.receptionist_workspaces w where w.tenant_id=receptionist_practice_sessions.tenant_id)
 and (author_id=auth.uid() or public.current_user_is_openfolk_operator('platform.controlplane.admin'))
);

-- Database lock, not a per-function in-memory limit. Failed/ambiguous attempts consume quota.
create function public.reserve_receptionist_practice(p_tenant uuid,p_actor uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,12));
 if not exists(select 1 from public.receptionist_workspaces where tenant_id=p_tenant and practice_enabled) then
  raise exception 'Practice not enabled';
 end if;
 if exists(select 1 from public.receptionist_practice_sessions where id=p_id) then return false; end if;
 if exists(select 1 from public.receptionist_practice_sessions where tenant_id=p_tenant and expires_at>now()
   and state in ('starting','active')) then raise exception 'A practice conversation is already reserved'; end if;
 if (select count(*) from public.receptionist_practice_sessions where tenant_id=p_tenant and created_at>now()-interval '24 hours')>=30
 or (select count(*) from public.receptionist_practice_sessions where tenant_id=p_tenant and author_id=p_actor and created_at>now()-interval '24 hours')>=10
 then raise exception 'Practice daily limit reached'; end if;
 insert into public.receptionist_practice_sessions(id,tenant_id,author_id) values(p_id,p_tenant,p_actor);
 return true;
end $$;
revoke all on function public.reserve_receptionist_practice(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_receptionist_practice(uuid,uuid,uuid) to service_role;

alter table public.receptionist_feedback add column practice_session_id uuid references public.receptionist_practice_sessions(id);
alter table public.receptionist_feedback add column submission_key uuid;
create unique index receptionist_feedback_submission on public.receptionist_feedback(tenant_id,author_id,submission_key) where submission_key is not null;
grant insert(practice_session_id,submission_key) on public.receptionist_feedback to authenticated;
create function public.validate_receptionist_practice_feedback() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.practice_session_id is not null and not exists(
  select 1 from public.receptionist_practice_sessions s where s.id=new.practice_session_id
  and s.tenant_id=new.tenant_id and s.author_id=new.author_id and s.call_id is not distinct from new.call_id
 ) then raise exception 'Practice feedback scope mismatch'; end if;
 return new;
end $$;
revoke all on function public.validate_receptionist_practice_feedback() from public,anon,authenticated;
create trigger receptionist_practice_feedback_check before insert on public.receptionist_feedback
 for each row execute function public.validate_receptionist_practice_feedback();

insert into supabase_migrations.schema_migrations(version,name,statements) values('20261020120000','receptionist_practice',array[$migration$-- Emma V1: additive, tenant-scoped practice. No main-line/provider routing change.
alter table public.receptionist_workspaces add column if not exists phone_snapshot jsonb;
alter table public.receptionist_workspaces add column practice_enabled boolean not null default false;
alter table public.receptionist_workspaces drop constraint receptionist_workspaces_launch_stage_check;
alter table public.receptionist_workspaces add constraint receptionist_workspaces_launch_stage_check
 check(launch_stage in ('Testing','Ready','Live','Paused'));

create table public.receptionist_practice_sessions (
 id uuid primary key,
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 author_id uuid not null references public.profiles(id),
 call_id uuid unique,
 source_version text,
 state text not null default 'starting' check(state in ('starting','active','ended','failed')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '5 minutes'
);
create index receptionist_practice_tenant on public.receptionist_practice_sessions(tenant_id,created_at desc);
alter table public.receptionist_practice_sessions enable row level security;
revoke all on public.receptionist_practice_sessions from anon,authenticated;
grant select on public.receptionist_practice_sessions to authenticated;
grant all on public.receptionist_practice_sessions to service_role;
create policy receptionist_practice_read on public.receptionist_practice_sessions for select to authenticated using (
 exists(select 1 from public.receptionist_workspaces w where w.tenant_id=receptionist_practice_sessions.tenant_id)
 and (author_id=auth.uid() or public.current_user_is_openfolk_operator('platform.controlplane.admin'))
);

-- Database lock, not a per-function in-memory limit. Failed/ambiguous attempts consume quota.
create function public.reserve_receptionist_practice(p_tenant uuid,p_actor uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,12));
 if not exists(select 1 from public.receptionist_workspaces where tenant_id=p_tenant and practice_enabled) then
  raise exception 'Practice not enabled';
 end if;
 if exists(select 1 from public.receptionist_practice_sessions where id=p_id) then return false; end if;
 if exists(select 1 from public.receptionist_practice_sessions where tenant_id=p_tenant and expires_at>now()
   and state in ('starting','active')) then raise exception 'A practice conversation is already reserved'; end if;
 if (select count(*) from public.receptionist_practice_sessions where tenant_id=p_tenant and created_at>now()-interval '24 hours')>=30
 or (select count(*) from public.receptionist_practice_sessions where tenant_id=p_tenant and author_id=p_actor and created_at>now()-interval '24 hours')>=10
 then raise exception 'Practice daily limit reached'; end if;
 insert into public.receptionist_practice_sessions(id,tenant_id,author_id) values(p_id,p_tenant,p_actor);
 return true;
end $$;
revoke all on function public.reserve_receptionist_practice(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_receptionist_practice(uuid,uuid,uuid) to service_role;

alter table public.receptionist_feedback add column practice_session_id uuid references public.receptionist_practice_sessions(id);
alter table public.receptionist_feedback add column submission_key uuid;
create unique index receptionist_feedback_submission on public.receptionist_feedback(tenant_id,author_id,submission_key) where submission_key is not null;
grant insert(practice_session_id,submission_key) on public.receptionist_feedback to authenticated;
create function public.validate_receptionist_practice_feedback() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.practice_session_id is not null and not exists(
  select 1 from public.receptionist_practice_sessions s where s.id=new.practice_session_id
  and s.tenant_id=new.tenant_id and s.author_id=new.author_id and s.call_id is not distinct from new.call_id
 ) then raise exception 'Practice feedback scope mismatch'; end if;
 return new;
end $$;
revoke all on function public.validate_receptionist_practice_feedback() from public,anon,authenticated;
create trigger receptionist_practice_feedback_check before insert on public.receptionist_feedback
 for each row execute function public.validate_receptionist_practice_feedback();
$migration$]);
update public.receptionist_workspaces set launch_stage='Ready',launch_note='Testing completed per Chris. Main-number activation is a separate step. Browser practice cannot ring staff or change customer records.', practice_enabled=true where tenant_id='00000000-0000-0000-0000-000000000001' and launch_stage='Testing';
commit;
