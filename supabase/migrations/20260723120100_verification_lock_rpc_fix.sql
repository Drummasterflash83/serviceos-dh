-- ============================================================================
-- Verification lock RPC repair (additive; the original 20260723120000 is applied)
-- ============================================================================
-- Root cause: verification_acquire_lock declared a RETURNS TABLE OUT column named
-- `expires_at`, which collided with verification_locks.expires_at in the unqualified
-- reclaim `... and expires_at < now()`, raising "column reference expires_at is
-- ambiguous" on the FIRST statement (before any INSERT) — so no lock was created; the
-- harness then mis-reported the thrown RPC error as lease contention.
--
-- Fix: fully qualify every column via the `vl` alias, rename parameters to `p_*`, and
-- rename the OUT column to `lock_expires_at` so no identifier is ambiguous. Because the
-- return type / parameter names change, the functions are DROPPED and recreated (this
-- only replaces two functions — no table/data change). Do NOT edit the original file.
-- ============================================================================

-- ── Narrow, idempotent cleanup for the exact failed live run (belt-and-braces). ─
-- The failed run threw before INSERT (and a function error rolls back its statement),
-- so it should not have left a lock. This releases only that one run's lock IF one
-- somehow exists; it is a no-op everywhere else. The repaired acquire also reclaims
-- any expired lease automatically.
update verification_locks as vl
   set released_at = now()
 where vl.verification_run_id = 'verify-20260715-7a8afa6e'
   and vl.released_at is null;

-- ── verification_acquire_lock (fully qualified; unambiguous). ────────────────
drop function if exists verification_acquire_lock(uuid, text, text, int);
create function verification_acquire_lock(
  p_tenant_id uuid, p_suite text, p_verification_run_id text, p_ttl_seconds int
) returns table (acquired boolean, holder text, lock_expires_at timestamptz)
language plpgsql as $$
declare
  v_row verification_locks%rowtype;
  v_exp timestamptz;
begin
  -- reclaim any expired-but-unreleased lease (every column qualified via vl)
  update verification_locks as vl
     set released_at = now()
   where vl.tenant_id = p_tenant_id
     and vl.suite = p_suite
     and vl.released_at is null
     and vl.expires_at < now();

  select vl.* into v_row from verification_locks as vl
   where vl.tenant_id = p_tenant_id and vl.suite = p_suite and vl.released_at is null
   limit 1 for update;
  if found then
    acquired := (v_row.verification_run_id = p_verification_run_id); -- idempotent for same run
    holder := v_row.verification_run_id;
    lock_expires_at := v_row.expires_at;
    return next; return;
  end if;

  v_exp := now() + make_interval(secs => greatest(p_ttl_seconds, 1));
  begin
    insert into verification_locks (tenant_id, suite, verification_run_id, expires_at)
      values (p_tenant_id, p_suite, p_verification_run_id, v_exp);
  exception when unique_violation then
    select vl.* into v_row from verification_locks as vl
      where vl.tenant_id = p_tenant_id and vl.suite = p_suite and vl.released_at is null limit 1;
    acquired := false;
    holder := coalesce(v_row.verification_run_id, 'unknown');
    lock_expires_at := v_row.expires_at;
    return next; return;
  end;

  acquired := true;
  holder := p_verification_run_id;
  lock_expires_at := v_exp;
  return next;
end;
$$;

-- ── verification_release_lock (owner-only; fully qualified). ─────────────────
drop function if exists verification_release_lock(uuid, text, text);
create function verification_release_lock(
  p_tenant_id uuid, p_suite text, p_verification_run_id text
) returns boolean language plpgsql as $$
declare v_n int;
begin
  update verification_locks as vl
     set released_at = now()
   where vl.tenant_id = p_tenant_id
     and vl.suite = p_suite
     and vl.verification_run_id = p_verification_run_id
     and vl.released_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
