-- Verification lock RPCs — assertions (proves the ambiguous-column defect is fixed).
-- Run in a real environment: `supabase db execute < supabase/tests/verification_locks.test.sql`
-- Wrapped in a transaction and rolled back (non-destructive).
-- Requires migrations through 20260723120100 and the seeded Drummond tenant
-- (00000000-0000-0000-0000-000000000001).

begin;

-- 1) First acquire succeeds; holder + future expiry are returned (no ambiguity error).
do $$
declare r record;
begin
  select * into r from verification_acquire_lock('00000000-0000-0000-0000-000000000001','test_suite','run-A',600);
  if not r.acquired then raise exception 'FAIL: first acquire did not succeed'; end if;
  if r.holder <> 'run-A' then raise exception 'FAIL: holder wrong (%)', r.holder; end if;
  if r.lock_expires_at <= now() then raise exception 'FAIL: returned expiry is not in the future'; end if;
end $$;

-- 2) A second concurrent acquire (different run) is refused and reports the real holder.
do $$
declare r record;
begin
  select * into r from verification_acquire_lock('00000000-0000-0000-0000-000000000001','test_suite','run-B',600);
  if r.acquired then raise exception 'FAIL: concurrent acquire succeeded'; end if;
  if r.holder <> 'run-A' then raise exception 'FAIL: holder should be run-A (%)', r.holder; end if;
end $$;

-- 3) A wrong run id cannot release another run's lock.
do $$ begin
  if verification_release_lock('00000000-0000-0000-0000-000000000001','test_suite','run-B') then
    raise exception 'FAIL: a wrong run id released the lock';
  end if;
end $$;

-- 4) The owning run releases it.
do $$ begin
  if not verification_release_lock('00000000-0000-0000-0000-000000000001','test_suite','run-A') then
    raise exception 'FAIL: the owning run could not release the lock';
  end if;
end $$;

-- 5) After release, the next run acquires.
do $$
declare r record;
begin
  select * into r from verification_acquire_lock('00000000-0000-0000-0000-000000000001','test_suite','run-C',600);
  if not r.acquired then raise exception 'FAIL: acquire after release failed'; end if;
end $$;
perform verification_release_lock('00000000-0000-0000-0000-000000000001','test_suite','run-C');

-- 6) An EXPIRED-but-unreleased lease is reclaimed by the next acquire.
insert into verification_locks (tenant_id, suite, verification_run_id, acquired_at, expires_at)
  values ('00000000-0000-0000-0000-000000000001','test_suite2','run-old', now() - interval '2 hours', now() - interval '1 hour');
do $$
declare r record;
begin
  select * into r from verification_acquire_lock('00000000-0000-0000-0000-000000000001','test_suite2','run-new',600);
  if not r.acquired then raise exception 'FAIL: expired lease was not reclaimed'; end if;
  if r.holder <> 'run-new' then raise exception 'FAIL: reclaim holder wrong (%)', r.holder; end if;
end $$;

do $$ begin
  raise notice 'PASS: acquire/refuse/release/reclaim work; returned expiry correct; owner-only release; no ambiguous identifiers';
end $$;

rollback;
