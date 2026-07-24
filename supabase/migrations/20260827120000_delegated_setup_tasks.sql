-- OpenFolk Control Plane — generic delegated customer-admin setup tasks.
--
-- The ONE genuinely-new model for Tenant Connections: a secure, tenant-scoped, purpose-scoped
-- task that lets an OpenFolk operator ask a named customer admin to perform ONE setup action
-- (e.g. provide telephony inventory, confirm company domains) WITHOUT any Control Plane access.
-- Reuses the existing patterns: deny-all RLS + service_role-only like provider_oauth_states;
-- append-only events like provider_connection_events; secrets never stored (only a SHA-256
-- token hash + last-4 display hint). The RAW token is generated + hashed in the edge function
-- and returned to the operator exactly once; it NEVER reaches the database, logs or audit.
--
-- Nothing here sends an invitation or activates any processing. The public recipient route is
-- built separately and stays disabled until the security suite passes.

-- ── delegated_setup_tasks ────────────────────────────────────────────────────
create table if not exists public.delegated_setup_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- connection reference where one already exists; provider is always recorded for context.
  connection_id uuid references public.provider_connections (id) on delete set null,
  provider text,
  task_type text not null,
  requested_action text not null,
  allowed_fields text[] not null default '{}', -- purpose scope; field NAMES only, never secrets
  recipient_email text not null,               -- stored normalised (lower(trim())) by the issue RPC
  recipient_name text,
  token_hash text not null,                    -- SHA-256 hex of the raw token; RAW IS NEVER STORED
  token_last4 text,                            -- non-sensitive display hint for operator identification
  status text not null default 'created',
  single_use boolean not null default true,
  max_uses integer not null default 1,
  use_count integer not null default 0,
  submission jsonb,                            -- staged customer payload; NEVER canonical until operator approves
  failed_attempts integer not null default 0,  -- resolved-but-invalid attempts (rate-limit signal)
  last_attempt_at timestamptz,
  expires_at timestamptz not null,
  opened_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delegated_setup_tasks_task_type_chk check (
    task_type in (
      'authorise_google_workspace',
      'authorise_microsoft_365',
      'provide_telephony_inventory',
      'authorise_slack',
      'provide_provider_admin_contact',
      'confirm_company_domains'
    )
  ),
  constraint delegated_setup_tasks_status_chk check (
    status in ('created', 'opened', 'submitted', 'completed', 'expired', 'revoked')
  ),
  constraint delegated_setup_tasks_email_normalised_chk check (recipient_email = lower(recipient_email)),
  constraint delegated_setup_tasks_max_uses_chk check (max_uses >= 1 and use_count >= 0 and use_count <= max_uses)
);

create unique index if not exists delegated_setup_tasks_token_uk
  on public.delegated_setup_tasks (token_hash);
create index if not exists delegated_setup_tasks_tenant_idx
  on public.delegated_setup_tasks (tenant_id, status, created_at desc);
create index if not exists delegated_setup_tasks_expiry_idx
  on public.delegated_setup_tasks (expires_at)
  where status in ('created', 'opened', 'submitted');

comment on table public.delegated_setup_tasks is
  'Generic delegated customer-admin setup task. Deny-all RLS; service_role only. Raw token never stored (hash + last4 only). No Control Plane access. Submission is staged, never canonical without operator approval.';

-- ── delegated_setup_events (append-only) ─────────────────────────────────────
create table if not exists public.delegated_setup_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  task_id uuid not null references public.delegated_setup_tasks (id) on delete cascade,
  event text not null,
  actor_id uuid,
  detail jsonb not null default '{}', -- NEVER token/credential/secret values
  created_at timestamptz not null default now(),
  constraint delegated_setup_events_event_chk check (
    event in (
      'created', 'opened', 'submitted', 'completed', 'expired', 'revoked',
      'invalid_token', 'replay_blocked', 'rate_limited', 'validation_failed'
    )
  )
);
create index if not exists delegated_setup_events_task_idx
  on public.delegated_setup_events (task_id, created_at desc);
create index if not exists delegated_setup_events_tenant_idx
  on public.delegated_setup_events (tenant_id, created_at desc);

-- ── updated_at trigger ───────────────────────────────────────────────────────
drop trigger if exists delegated_setup_tasks_set_updated_at on public.delegated_setup_tasks;
create trigger delegated_setup_tasks_set_updated_at
  before update on public.delegated_setup_tasks
  for each row execute function public.set_updated_at();

-- ── RLS: DENY-ALL (no authenticated policy). service_role only. ───────────────
alter table public.delegated_setup_tasks enable row level security;
alter table public.delegated_setup_events enable row level security;
-- Belt-and-suspenders: strip any inherited grants; only service_role gets direct access.
revoke all on public.delegated_setup_tasks from anon, authenticated;
revoke all on public.delegated_setup_events from anon, authenticated;
grant select, insert, update, delete on public.delegated_setup_tasks to service_role;
grant select, insert, update, delete on public.delegated_setup_events to service_role;

-- ── Event helper (internal) ──────────────────────────────────────────────────
create or replace function public.delegated_event(
  p_task uuid, p_tenant uuid, p_event text, p_actor uuid, p_detail jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.delegated_setup_events (task_id, tenant_id, event, actor_id, detail)
  values (p_task, p_tenant, p_event, p_actor, coalesce(p_detail, '{}'::jsonb));
$$;

-- ── Issue a task. RAW token is generated + hashed in the edge function; this RPC receives
--    ONLY the hash + last4. Returns the new task id. ────────────────────────────
create or replace function public.delegated_task_issue(
  p_tenant uuid,
  p_task_type text,
  p_requested_action text,
  p_allowed_fields text[],
  p_recipient_email text,
  p_recipient_name text,
  p_provider text,
  p_connection_id uuid,
  p_token_hash text,
  p_token_last4 text,
  p_ttl_seconds integer,
  p_single_use boolean,
  p_max_uses integer,
  p_created_by uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := lower(trim(p_recipient_email));
begin
  if p_token_hash is null or length(p_token_hash) < 32 then
    raise exception 'invalid token hash';
  end if;
  if v_email is null or v_email = '' then
    raise exception 'recipient email required';
  end if;
  insert into public.delegated_setup_tasks (
    tenant_id, connection_id, provider, task_type, requested_action, allowed_fields,
    recipient_email, recipient_name, token_hash, token_last4,
    single_use, max_uses, expires_at, created_by
  ) values (
    p_tenant, p_connection_id, p_provider, p_task_type, p_requested_action,
    coalesce(p_allowed_fields, '{}'), v_email, p_recipient_name, p_token_hash, p_token_last4,
    coalesce(p_single_use, true), greatest(coalesce(p_max_uses, 1), 1),
    now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 604800), 60)), p_created_by
  ) returning id into v_id;
  perform public.delegated_event(v_id, p_tenant, 'created', p_created_by,
    jsonb_build_object('task_type', p_task_type, 'recipient_last4', p_token_last4));
  return v_id;
end;
$$;

-- ── Resolve a task by token hash. Returns a safe view (NO token, NO secrets) + a resolution
--    code so the caller can fail closed. Tracks resolved-but-invalid attempts for rate limiting. ──
create or replace function public.delegated_task_verify(p_token_hash text)
returns table (
  task_id uuid, tenant_id uuid, task_type text, requested_action text,
  allowed_fields text[], provider text, connection_id uuid, status text,
  resolution text -- valid | expired | revoked | completed | not_found
) language plpgsql security definer set search_path = '' as $$
declare
  r public.delegated_setup_tasks%rowtype;
begin
  select * into r from public.delegated_setup_tasks where token_hash = p_token_hash;
  if not found then
    return query select null::uuid, null::uuid, null::text, null::text, null::text[],
      null::text, null::uuid, null::text, 'not_found'::text;
    return;
  end if;
  -- lazily expire
  if r.status in ('created', 'opened', 'submitted') and r.expires_at < now() then
    update public.delegated_setup_tasks set status = 'expired' where id = r.id;
    perform public.delegated_event(r.id, r.tenant_id, 'expired', null, '{}'::jsonb);
    r.status := 'expired';
  end if;
  if r.status = 'revoked' then
    update public.delegated_setup_tasks
      set failed_attempts = failed_attempts + 1, last_attempt_at = now() where id = r.id;
    return query select r.id, r.tenant_id, r.task_type, r.requested_action, r.allowed_fields,
      r.provider, r.connection_id, r.status, 'revoked'::text; return;
  elsif r.status = 'expired' then
    return query select r.id, r.tenant_id, r.task_type, r.requested_action, r.allowed_fields,
      r.provider, r.connection_id, r.status, 'expired'::text; return;
  elsif r.status = 'completed' then
    return query select r.id, r.tenant_id, r.task_type, r.requested_action, r.allowed_fields,
      r.provider, r.connection_id, r.status, 'completed'::text; return;
  end if;
  return query select r.id, r.tenant_id, r.task_type, r.requested_action, r.allowed_fields,
    r.provider, r.connection_id, r.status, 'valid'::text;
end;
$$;

create or replace function public.delegated_task_mark_opened(p_token_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.delegated_setup_tasks%rowtype;
begin
  select * into r from public.delegated_setup_tasks where token_hash = p_token_hash for update;
  if not found or r.status <> 'created' then return false; end if;
  if r.expires_at < now() then return false; end if;
  update public.delegated_setup_tasks set status = 'opened', opened_at = now() where id = r.id;
  perform public.delegated_event(r.id, r.tenant_id, 'opened', null, '{}'::jsonb);
  return true;
end;
$$;

-- ── Submit a STAGED payload. Rejects any field not in allowed_fields. Never canonical. ──
create or replace function public.delegated_task_submit(p_token_hash text, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r public.delegated_setup_tasks%rowtype;
  k text;
begin
  select * into r from public.delegated_setup_tasks where token_hash = p_token_hash for update;
  if not found then return false; end if;
  if r.status not in ('created', 'opened', 'submitted') or r.expires_at < now() then
    perform public.delegated_event(r.id, r.tenant_id, 'replay_blocked', null,
      jsonb_build_object('status', r.status)); return false;
  end if;
  -- Enforce purpose scope: every payload key MUST be in allowed_fields.
  for k in select jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)) loop
    if not (k = any (r.allowed_fields)) then
      perform public.delegated_event(r.id, r.tenant_id, 'validation_failed', null,
        jsonb_build_object('rejected_field', k));
      raise exception 'field % is not permitted for this task', k;
    end if;
  end loop;
  update public.delegated_setup_tasks
    set submission = p_payload, status = 'submitted', submitted_at = now() where id = r.id;
  perform public.delegated_event(r.id, r.tenant_id, 'submitted', null,
    jsonb_build_object('field_count', (select count(*) from jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)))));
  return true;
end;
$$;

-- ── Complete: transactional single-use / max-use with replay protection. ──────
create or replace function public.delegated_task_complete(p_token_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.delegated_setup_tasks%rowtype;
begin
  -- FOR UPDATE serialises concurrent completes → a race cannot consume twice.
  select * into r from public.delegated_setup_tasks where token_hash = p_token_hash for update;
  if not found then return false; end if;
  if r.status in ('completed', 'revoked', 'expired') or r.use_count >= r.max_uses then
    perform public.delegated_event(r.id, r.tenant_id, 'replay_blocked', null,
      jsonb_build_object('status', r.status, 'use_count', r.use_count)); return false;
  end if;
  if r.expires_at < now() then
    update public.delegated_setup_tasks set status = 'expired' where id = r.id;
    perform public.delegated_event(r.id, r.tenant_id, 'expired', null, '{}'::jsonb); return false;
  end if;
  update public.delegated_setup_tasks
    set use_count = r.use_count + 1,
        status = case when r.single_use or (r.use_count + 1) >= r.max_uses then 'completed' else r.status end,
        completed_at = case when r.single_use or (r.use_count + 1) >= r.max_uses then now() else completed_at end
    where id = r.id;
  perform public.delegated_event(r.id, r.tenant_id, 'completed', null,
    jsonb_build_object('use_count', r.use_count + 1));
  return true;
end;
$$;

create or replace function public.delegated_task_revoke(p_task_id uuid, p_actor uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r public.delegated_setup_tasks%rowtype;
begin
  select * into r from public.delegated_setup_tasks where id = p_task_id for update;
  if not found or r.status = 'revoked' then return false; end if;
  update public.delegated_setup_tasks
    set status = 'revoked', revoked_at = now(), revoked_by = p_actor where id = r.id;
  perform public.delegated_event(r.id, r.tenant_id, 'revoked', p_actor, '{}'::jsonb);
  return true;
end;
$$;

create or replace function public.delegated_task_expire_stale()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with expired as (
    update public.delegated_setup_tasks set status = 'expired'
      where status in ('created', 'opened', 'submitted') and expires_at < now()
      returning id, tenant_id
  )
  insert into public.delegated_setup_events (task_id, tenant_id, event)
    select id, tenant_id, 'expired' from expired;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Governed access: RPCs are the ONLY path; execute is service_role only (edge function
-- authorises platform authority before calling; public token actions are purpose-scoped).
revoke all on function
  public.delegated_event(uuid, uuid, text, uuid, jsonb),
  public.delegated_task_issue(uuid, text, text, text[], text, text, text, uuid, text, text, integer, boolean, integer, uuid),
  public.delegated_task_verify(text),
  public.delegated_task_mark_opened(text),
  public.delegated_task_submit(text, jsonb),
  public.delegated_task_complete(text),
  public.delegated_task_revoke(uuid, uuid),
  public.delegated_task_expire_stale()
  from public, anon, authenticated;
grant execute on function
  public.delegated_task_issue(uuid, text, text, text[], text, text, text, uuid, text, text, integer, boolean, integer, uuid),
  public.delegated_task_verify(text),
  public.delegated_task_mark_opened(text),
  public.delegated_task_submit(text, jsonb),
  public.delegated_task_complete(text),
  public.delegated_task_revoke(uuid, uuid),
  public.delegated_task_expire_stale()
  to service_role;
