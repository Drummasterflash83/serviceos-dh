-- ============================================================================
-- Remote Verification Harness — mutating-run lease lock (additive, tooling-only)
-- ============================================================================
-- Prevents two concurrent MUTATING verification runs from interfering on the same
-- (tenant, suite). A narrow lease table + two narrow RPCs — NOT a general-purpose
-- remote-control or SQL endpoint. Read-only for tenant/OpenFolk; writes are via the
-- service-role harness through the two functions below. Additive and idempotent; it
-- changes no product behaviour.
-- ============================================================================

create table if not exists verification_locks (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  suite               text not null,
  verification_run_id text not null,
  acquired_at         timestamptz not null default now(),
  expires_at          timestamptz not null,
  released_at         timestamptz
);
create index if not exists verification_locks_lookup on verification_locks (tenant_id, suite, released_at);
-- At most ONE active (unreleased) lease per (tenant, suite).
create unique index if not exists verification_locks_active_uk
  on verification_locks (tenant_id, suite) where released_at is null;

-- Atomic acquire: reclaim any expired-but-unreleased lease, then acquire iff none is
-- active. Re-acquiring your own lease is idempotent. A concurrent race loses cleanly.
create or replace function verification_acquire_lock(
  p_tenant uuid, p_suite text, p_run_id text, p_ttl_seconds int
) returns table (acquired boolean, holder text, expires_at timestamptz) language plpgsql as $$
declare v record; v_exp timestamptz;
begin
  update verification_locks set released_at = now()
    where tenant_id = p_tenant and suite = p_suite and released_at is null and expires_at < now();

  select * into v from verification_locks
    where tenant_id = p_tenant and suite = p_suite and released_at is null
    limit 1 for update;
  if found then
    acquired := (v.verification_run_id = p_run_id);  -- idempotent for the same run
    holder := v.verification_run_id;
    expires_at := v.expires_at;
    return next; return;
  end if;

  v_exp := now() + make_interval(secs => greatest(p_ttl_seconds, 1));
  begin
    insert into verification_locks (tenant_id, suite, verification_run_id, expires_at)
      values (p_tenant, p_suite, p_run_id, v_exp);
  exception when unique_violation then
    select * into v from verification_locks
      where tenant_id = p_tenant and suite = p_suite and released_at is null limit 1;
    acquired := false; holder := coalesce(v.verification_run_id, 'unknown'); expires_at := v.expires_at;
    return next; return;
  end;
  acquired := true; holder := p_run_id; expires_at := v_exp;
  return next;
end;
$$;

-- Owner-only release: only the run that holds the lease can release it.
create or replace function verification_release_lock(
  p_tenant uuid, p_suite text, p_run_id text
) returns boolean language plpgsql as $$
declare n int;
begin
  update verification_locks set released_at = now()
    where tenant_id = p_tenant and suite = p_suite
      and verification_run_id = p_run_id and released_at is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

alter table verification_locks enable row level security;
drop policy if exists verification_locks_select on verification_locks;
create policy verification_locks_select on verification_locks for select to authenticated
  using (tenant_id = current_tenant_id() or is_openfolk());
