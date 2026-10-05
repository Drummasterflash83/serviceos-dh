-- ServiceOS — reusable phone-operations control and monitoring foundation.
--
-- Additive and inert by default:
--   • extends the existing health registry with phone-system components;
--   • stores tenant-scoped alert policy + alert occurrences;
--   • stores one audited active assignment per operational phone role;
--   • performs no provider writes and sends no notifications.
--
-- Provider adapters (Vapi, Twilio, Birchills/Sipcentric, other VoIP systems)
-- consume this canonical state. Secrets remain in the existing provider-secret
-- broker / Edge Function environment and are never stored in these tables.

insert into system_health_components (component, label, category, sort_order) values
  ('phone_ingress',       'Phone ingress',       'telephony', 31),
  ('ai_receptionist',     'AI receptionist',     'telephony', 32),
  ('phone_transfers',     'Call transfers',      'telephony', 33),
  ('phone_destinations',  'Staff destinations', 'telephony', 34),
  ('phone_notifications', 'Phone alerts',        'telephony', 35)
on conflict (component) do update set
  label = excluded.label,
  category = excluded.category,
  sort_order = excluded.sort_order;

create table if not exists phone_alert_policies (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  enabled               boolean not null default false,
  slack_enabled         boolean not null default false,
  email_enabled         boolean not null default false,
  escalation_enabled    boolean not null default false,
  consecutive_failures  integer not null default 2 check (consecutive_failures between 1 and 20),
  reminder_minutes      integer not null default 15 check (reminder_minutes between 5 and 1440),
  daily_digest_time     time not null default '08:00',
  timezone              text not null default 'Europe/London',
  non_secret_config     jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tenant_id)
);

create table if not exists phone_alert_events (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  provider              text not null,
  alert_key             text not null,
  severity              text not null check (severity in ('info','warning','critical')),
  status                text not null default 'open'
                          check (status in ('open','acknowledged','resolved')),
  title                 text not null,
  detail                text,
  provider_event_ref    text,
  occurrence_count      integer not null default 1,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  acknowledged_at       timestamptz,
  acknowledged_by       uuid,
  resolved_at           timestamptz,
  resolution_note       text,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists phone_alert_events_open_key_uk
  on phone_alert_events (tenant_id, provider, alert_key)
  where status in ('open','acknowledged');
create index if not exists phone_alert_events_tenant_seen_idx
  on phone_alert_events (tenant_id, last_seen_at desc);
create index if not exists phone_alert_events_tenant_status_idx
  on phone_alert_events (tenant_id, status, severity, last_seen_at desc);

create table if not exists phone_on_call_assignments (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  role_key              text not null,
  display_label         text not null,
  team_member_id        uuid references team_members(id) on delete set null,
  destination_ref       text not null,
  provider              text not null,
  effective_from        timestamptz not null default now(),
  effective_to          timestamptz,
  active                boolean not null default true,
  version               integer not null default 1,
  change_reason         text not null,
  changed_by            uuid,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (length(trim(role_key)) > 0),
  check (length(trim(destination_ref)) > 0),
  check (length(trim(change_reason)) >= 3)
);
create unique index if not exists phone_on_call_assignments_active_role_uk
  on phone_on_call_assignments (tenant_id, role_key)
  where active and effective_to is null;
create index if not exists phone_on_call_assignments_tenant_idx
  on phone_on_call_assignments (tenant_id, role_key, created_at desc);

create table if not exists phone_operations_audit (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  actor_user_id         uuid,
  actor_label           text not null,
  action                text not null,
  resource_type         text not null,
  resource_ref          text,
  before_state          jsonb,
  after_state           jsonb,
  reason                text,
  created_at            timestamptz not null default now()
);
create index if not exists phone_operations_audit_tenant_idx
  on phone_operations_audit (tenant_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'phone_alert_policies',
    'phone_alert_events',
    'phone_on_call_assignments',
    'phone_operations_audit'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select_tenant', t);
    execute format(
      'create policy %I on %I for select to authenticated
       using (tenant_id = current_tenant_id() or is_openfolk())',
      t || '_select_tenant', t
    );
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

drop trigger if exists phone_alert_policies_set_updated_at on phone_alert_policies;
create trigger phone_alert_policies_set_updated_at
  before update on phone_alert_policies
  for each row execute function set_updated_at();

drop trigger if exists phone_alert_events_set_updated_at on phone_alert_events;
create trigger phone_alert_events_set_updated_at
  before update on phone_alert_events
  for each row execute function set_updated_at();

drop trigger if exists phone_on_call_assignments_set_updated_at on phone_on_call_assignments;
create trigger phone_on_call_assignments_set_updated_at
  before update on phone_on_call_assignments
  for each row execute function set_updated_at();

create or replace function phone_operations_set_on_call(
  p_tenant_id       uuid,
  p_actor_user_id   uuid,
  p_actor_label     text,
  p_role_key        text,
  p_display_label   text,
  p_team_member_id  uuid,
  p_destination_ref text,
  p_provider        text,
  p_reason          text,
  p_metadata        jsonb default '{}'::jsonb
) returns phone_on_call_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_row phone_on_call_assignments;
  new_row phone_on_call_assignments;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A meaningful change reason is required' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_role_key, 0));

  select * into previous_row
  from phone_on_call_assignments
  where tenant_id = p_tenant_id
    and role_key = p_role_key
    and active
    and effective_to is null
  for update;

  if previous_row.id is not null then
    update phone_on_call_assignments
    set active = false, effective_to = now(), updated_at = now()
    where id = previous_row.id;
  end if;

  insert into phone_on_call_assignments (
    tenant_id, role_key, display_label, team_member_id, destination_ref,
    provider, effective_from, active, version, change_reason, changed_by, metadata
  ) values (
    p_tenant_id, trim(p_role_key), trim(p_display_label), p_team_member_id,
    trim(p_destination_ref), trim(p_provider), now(), true,
    coalesce(previous_row.version, 0) + 1, trim(p_reason), p_actor_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into new_row;

  insert into phone_operations_audit (
    tenant_id, actor_user_id, actor_label, action, resource_type,
    resource_ref, before_state, after_state, reason
  ) values (
    p_tenant_id, p_actor_user_id, p_actor_label, 'phone.on_call.changed',
    'phone_on_call_assignment', p_role_key,
    case when previous_row.id is null then null else to_jsonb(previous_row) end,
    to_jsonb(new_row), p_reason
  );

  return new_row;
end
$$;

revoke all on function phone_operations_set_on_call(
  uuid, uuid, text, text, text, uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function phone_operations_set_on_call(
  uuid, uuid, text, text, text, uuid, text, text, text, jsonb
) to service_role;

-- Browser clients never mutate this operational state directly. The phone-operations
-- Edge Function owns validated writes and audit entries.
