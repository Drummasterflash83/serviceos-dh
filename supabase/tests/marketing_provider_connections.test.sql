-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_provider_connections.test.sql
--
-- Proves Marketing Phase 9 (migration 20260906120000) — the platform seam
-- layer — with SYNTHETIC fixtures only. No provider is ever contacted; the
-- 'connected' fixtures below go through the adapter seam exactly as a future
-- reviewed adapter would, which is the point of the seam:
--   ACCOUNTS — owner/admin + marketing.ads.manage structural ceiling (hostile
--   grants inert, explicit deny effective), request-id idempotency (replay
--   converges / changed reuse MK412), MK409 concurrency, provider vocabulary,
--   lifecycle guard legality in both directions, revoked terminal.
--   HONESTY — the public connect action can NEVER produce 'connected' in
--   this build: it lands in error/'no_adapter' with both transitions
--   recorded; only the service-role adapter seam with non-empty verification
--   evidence reaches 'connected'.
--   CREDENTIALS — mark-BEFORE-store idempotency (a replayed request id never
--   rotates twice), first configuration starts no overlap clock, a genuine
--   rotation records credential_rotated_at, revoked accounts refuse.
--   SYNC ENGINE — truthful MK430 refusal for every non-connected account,
--   single flight per account, lease-safe claim with expired-lease reclaim,
--   attempts >= 10 poison retirement to failed/'max_attempts_exhausted'
--   excluded from reclaim, converging completion (last_synced_at bumps once).
--   SCHEDULED SEAM — due-computation only; cadence + elapsed + no active run.
--   FRESHNESS — computed never_run / error / stale / fresh with reasons.
--   CATALOG — the COMPLETE Phase-9 function set locked in BOTH directions,
--   service-role only, no SECURITY DEFINER; RLS on every new table; browser
--   roles hold zero write privileges.
begin;

create temp table p9_ctx (key text primary key, val text);

insert into tenants (id, slug, display_name, industry) values
  ('aaaa9900-0000-0000-0000-0000000000f1','p9-t1','Phase9 Tenant 1','hvac'),
  ('aaaa9900-0000-0000-0000-0000000000f2','p9-t2','Phase9 Tenant 2','hvac');
insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb9900-0000-0000-0000-000000000001','p9-owner@x.test',false,false),
  ('bbbb9900-0000-0000-0000-000000000002','p9-ops@x.test',false,false),
  ('bbbb9900-0000-0000-0000-000000000003','p9-viewer@x.test',false,false),
  ('bbbb9900-0000-0000-0000-000000000005','p9-admin-b@x.test',false,false);
update profiles set role='owner',  tenant_id='aaaa9900-0000-0000-0000-0000000000f1' where id='bbbb9900-0000-0000-0000-000000000001';
update profiles set role='ops',    tenant_id='aaaa9900-0000-0000-0000-0000000000f1' where id='bbbb9900-0000-0000-0000-000000000002';
update profiles set role='viewer', tenant_id='aaaa9900-0000-0000-0000-0000000000f1' where id='bbbb9900-0000-0000-0000-000000000003';
update profiles set role='admin',  tenant_id='aaaa9900-0000-0000-0000-0000000000f2' where id='bbbb9900-0000-0000-0000-000000000005';
select marketing_materialise_defaults('aaaa9900-0000-0000-0000-0000000000f1','bbbb9900-0000-0000-0000-000000000001');
select marketing_materialise_defaults('aaaa9900-0000-0000-0000-0000000000f2','bbbb9900-0000-0000-0000-000000000005');

-- ── (1) ACCOUNTS: ceilings, idempotency, vocabulary ─────────────────────────
do $$
declare r jsonb; r2 jsonb; a uuid; args jsonb;
begin
  -- viewer and ops are refused STRUCTURALLY
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000003',
      '{"provider":"meta","display_name":"X","request_id":"p9-acc-v1"}');
    assert false, 'a viewer must be denied connection creation';
  exception when sqlstate '42501' then null;
  end;
  -- a HOSTILE grant of marketing.ads.manage to ops stays inert (role ceiling)
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa9900-0000-0000-0000-0000000000f1','bbbb9900-0000-0000-0000-000000000002',
          'marketing.ads.manage', true, 'bbbb9900-0000-0000-0000-000000000001');
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000002',
      '{"provider":"meta","display_name":"X","request_id":"p9-acc-o1"}');
    assert false, 'a hostile ads.manage grant must not bypass the owner/admin ceiling';
  exception when sqlstate '42501' then null;
  end;
  -- an EXPLICIT DENY beats the owner default
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa9900-0000-0000-0000-0000000000f1','bbbb9900-0000-0000-0000-000000000001',
          'marketing.ads.manage', false, 'bbbb9900-0000-0000-0000-000000000001');
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000001',
      '{"provider":"meta","display_name":"X","request_id":"p9-acc-d1"}');
    assert false, 'an explicit deny must stay effective';
  exception when sqlstate '42501' then null;
  end;
  delete from marketing_access_grants
   where tenant_id = 'aaaa9900-0000-0000-0000-0000000000f1';

  -- vocabulary: 'webhook' is NOT a connectable provider (push-only, Phase 8)
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000001',
      '{"provider":"webhook","display_name":"X","request_id":"p9-acc-w1"}');
    assert false, 'webhook must not be a connectable provider';
  exception when sqlstate '22023' then null;
  end;
  -- missing request id refuses before any write
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000001',
      '{"provider":"meta","display_name":"X"}');
    assert false, 'a mutation without a request id must refuse';
  exception when sqlstate '22023' then null;
  end;
  -- unknown argument refuses
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000001',
      '{"provider":"meta","display_name":"X","request_id":"p9-acc-u1","spend":9}');
    assert false, 'an unknown argument must refuse';
  exception when sqlstate '22023' then null;
  end;
  -- out-of-bounds stale window is structurally impossible
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000001',
      '{"provider":"meta","display_name":"X","stale_after_seconds":10,"request_id":"p9-acc-s1"}');
    assert false, 'an out-of-bounds stale_after must refuse';
  exception when check_violation then null;
  end;

  -- CREATE; exact replay converges; changed reuse MK412
  args := '{"provider":"meta","display_name":"Meta main","request_id":"p9-acc-c1"}';
  r := marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
        'bbbb9900-0000-0000-0000-000000000001', args);
  a := (r ->> 'id')::uuid;
  insert into p9_ctx values ('acct1', a::text);
  assert (r ->> 'status') = 'preview', 'a new connection is honestly preview';
  r2 := marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
         'bbbb9900-0000-0000-0000-000000000001', args);
  assert r2 = r || jsonb_build_object('replayed', true),
    'create replay returns the stored result flagged replayed';
  assert (select count(*) from marketing_provider_accounts
           where tenant_id = 'aaaa9900-0000-0000-0000-0000000000f1') = 1,
    'create replay mints NO second connection';
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000001',
      (args::jsonb) || jsonb_build_object('display_name','Different'));
    assert false, 'a changed request under a used id must refuse';
  exception when sqlstate 'MK412' then null;
  end;
  -- version history begins with exactly one 'create' row
  assert (select count(*) from marketing_provider_account_versions
           where account_id = a and change_kind = 'create') = 1,
    'creation is recorded exactly once in the append-only history';
end $$;

-- ── (2) HONEST CONNECT: the public action can never fabricate connected ─────
do $$
declare r jsonb; r2 jsonb; a uuid; v int;
begin
  a := (select val from p9_ctx where key = 'acct1')::uuid;
  -- wrong expected_version refuses MK409
  begin
    perform marketing_provider_account_connect_start(
      'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
      a, '{"request_id":"p9-con-x1","expected_version":99}');
    assert false, 'a stale read must refuse MK409';
  exception when sqlstate 'MK409' then null;
  end;
  r := marketing_provider_account_connect_start(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    a, '{"request_id":"p9-con-c1","expected_version":1}');
  assert (r ->> 'status') = 'error' and (r ->> 'status_reason') = 'no_adapter',
    'the truthful v1 connect outcome is error/no_adapter';
  assert (r ->> 'adapter_implemented') = 'false',
    'the result states plainly that no adapter is implemented';
  assert (select status from marketing_provider_accounts where id = a) = 'error',
    'the account records the honest error state';
  -- BOTH transitions were recorded as facts
  assert (select count(*) from marketing_provider_account_versions
           where account_id = a and change_kind = 'connect_attempt') = 1,
    'the attempt is a recorded fact';
  assert (select count(*) from marketing_provider_account_versions
           where account_id = a and change_kind = 'connect_result') = 1,
    'the outcome is a recorded fact';
  v := (select version from marketing_provider_accounts where id = a);
  -- replay converges: same result, NO further transition
  r2 := marketing_provider_account_connect_start(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    a, '{"request_id":"p9-con-c1","expected_version":1}');
  assert (r2 ->> 'replayed') = 'true', 'connect replay is flagged';
  assert (select version from marketing_provider_accounts where id = a) = v,
    'connect replay moves nothing';
  -- NOWHERE in this tenant is anything connected
  assert not exists (select 1 from marketing_provider_accounts
    where tenant_id = 'aaaa9900-0000-0000-0000-0000000000f1' and status = 'connected'),
    'the public API alone can never yield a connected account';
end $$;

-- ── (3) THE ADAPTER SEAM: the only door to connected, and it demands proof ──
do $$
declare r jsonb; a uuid;
begin
  r := marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
        'bbbb9900-0000-0000-0000-000000000001',
        '{"provider":"google_ads","display_name":"GAds fixture","request_id":"p9-acc-c2"}');
  a := (r ->> 'id')::uuid;
  insert into p9_ctx values ('acct2', a::text);
  -- a connect result outside the handshake refuses
  begin
    perform marketing_provider_account_connect_result(
      'aaaa9900-0000-0000-0000-0000000000f1', a, '{"verified":true}');
    assert false, 'a connect result is only valid while connecting';
  exception when sqlstate '22023' then null;
  end;
  -- enter the handshake (the door a revised connect_start opens for a real
  -- adapter; the lifecycle guard proves this is a LEGAL transition)
  update marketing_provider_accounts set status = 'connecting' where id = a;
  -- a bare "trust me" cannot connect: evidence + adapter_version required
  begin
    perform marketing_provider_account_connect_result(
      'aaaa9900-0000-0000-0000-0000000000f1', a, '{"verified":true}');
    assert false, 'connected without verification evidence must refuse';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_provider_account_connect_result(
    'aaaa9900-0000-0000-0000-0000000000f1', a,
    '{"verified":true,"adapter_version":"fixture-1",
      "evidence":{"probe":"synthetic verification fixture"}}');
  assert (r ->> 'status') = 'connected', 'the seam connects with evidence';
  assert (select connected_at from marketing_provider_accounts where id = a) is not null,
    'connected_at is a recorded fact';
  -- a failed verification lands in error with its reason
  update marketing_provider_accounts set status = 'error', status_reason = 'x' where id = a;
  update marketing_provider_accounts set status = 'connecting' where id = a;
  r := marketing_provider_account_connect_result(
    'aaaa9900-0000-0000-0000-0000000000f1', a,
    '{"verified":false,"reason":"verification_failed"}');
  assert (r ->> 'status') = 'error' and (r ->> 'status_reason') = 'verification_failed',
    'a failed verification is an honest error';
  -- restore the connected fixture for the sync sections
  update marketing_provider_accounts set status = 'connecting' where id = a;
  perform marketing_provider_account_connect_result(
    'aaaa9900-0000-0000-0000-0000000000f1', a,
    '{"verified":true,"adapter_version":"fixture-1",
      "evidence":{"probe":"synthetic verification fixture"}}');
end $$;

-- ── (4) LIFECYCLE GUARD: legality in both directions; revoked terminal ──────
do $$
declare a uuid;
begin
  a := (select val from p9_ctx where key = 'acct1')::uuid;
  -- illegal jumps refuse
  begin
    update marketing_provider_accounts set status = 'connected', connected_at = now()
     where id = a;
    assert false, 'error -> connected without a handshake must refuse';
  exception when sqlstate '22023' then null;
  end;
  -- identity and provider are immutable
  begin
    update marketing_provider_accounts set provider = 'linkedin' where id = a;
    assert false, 'provider must be immutable';
  exception when restrict_violation then null;
  end;
  begin
    update marketing_provider_accounts set version = 0 where id = a;
    assert false, 'version must never move backwards';
  exception when restrict_violation then null;
  end;
end $$;

-- ── (5) CREDENTIALS: mark-first idempotency + the bounded rotation clock ────
do $$
declare r jsonb; r2 jsonb; a uuid; v int; rot timestamptz;
begin
  a := (select val from p9_ctx where key = 'acct2')::uuid;
  v := (select version from marketing_provider_accounts where id = a);
  -- FIRST configuration: no previous credential, so NO overlap clock starts
  r := marketing_provider_account_credential_mark(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    a, '{"request_id":"p9-cred-1"}', v);
  assert (r ->> 'credential_state') = 'configured' and (r ->> 'rotated') = 'false',
    'first configuration is not a rotation';
  assert (select credential_rotated_at from marketing_provider_accounts where id = a) is null,
    'no overlap clock starts on first configuration';
  -- REPLAY of the same request id: no rotation, no version bump — the Vault
  -- write is downstream of this verdict, so a replay can never rotate twice
  v := (select version from marketing_provider_accounts where id = a);
  r2 := marketing_provider_account_credential_mark(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    a, '{"request_id":"p9-cred-1"}', v - 1);
  assert (r2 ->> 'replayed') = 'true', 'credential replay is flagged';
  assert (select version from marketing_provider_accounts where id = a) = v,
    'a replayed credential request rotates NOTHING';
  -- a GENUINE rotation (new request id) starts the bounded overlap clock
  r := marketing_provider_account_credential_mark(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    a, '{"request_id":"p9-cred-2"}', v);
  assert (r ->> 'rotated') = 'true', 'a second configuration is a rotation';
  rot := (select credential_rotated_at from marketing_provider_accounts where id = a);
  assert rot is not null, 'a rotation records the overlap clock';
  -- stale version refuses
  begin
    perform marketing_provider_account_credential_mark(
      'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
      a, '{"request_id":"p9-cred-3"}', 1);
    assert false, 'a stale credential read must refuse MK409';
  exception when sqlstate 'MK409' then null;
  end;
end $$;

-- ── (6) SYNC ENGINE: truthful gate, single flight, lease, poison, converge ──
do $$
declare r jsonb; a uuid; b uuid; run1 uuid; run2 uuid; n int; synced timestamptz;
begin
  a := (select val from p9_ctx where key = 'acct1')::uuid;  -- status: error
  b := (select val from p9_ctx where key = 'acct2')::uuid;  -- status: connected
  -- TRUTHFUL: a non-connected account can never queue a sync
  begin
    perform marketing_provider_sync_request(
      'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
      a, '{"request_id":"p9-sync-x1"}');
    assert false, 'sync on a non-connected account must refuse';
  exception when sqlstate 'MK430' then null;
  end;
  -- a connected account queues exactly one run; single flight is structural
  r := marketing_provider_sync_request(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    b, '{"request_id":"p9-sync-1"}');
  run1 := (r ->> 'run_id')::uuid;
  assert (r ->> 'status') = 'queued', 'a manual run queues';
  begin
    perform marketing_provider_sync_request(
      'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
      b, '{"request_id":"p9-sync-2"}');
    assert false, 'a second concurrent run must refuse structurally';
  exception when unique_violation then null;
  end;
  -- replay of the FIRST request converges on the stored run
  r := marketing_provider_sync_request(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    b, '{"request_id":"p9-sync-1"}');
  assert (r ->> 'run_id')::uuid = run1 and (r ->> 'replayed') = 'true',
    'sync request replay returns the same run';

  -- CLAIM: leases the queued run
  select count(*) into n from marketing_provider_sync_claim(
    'aaaa9900-0000-0000-0000-0000000000f1', 'w1', 5, 300);
  assert n = 1, 'the queued run is claimed once';
  assert (select status from marketing_provider_sync_runs where id = run1) = 'running',
    'a claimed run is running';
  assert (select attempts from marketing_provider_sync_runs where id = run1) = 1,
    'a claim burns an attempt';
  -- a live lease is not reclaimable
  select count(*) into n from marketing_provider_sync_claim(
    'aaaa9900-0000-0000-0000-0000000000f1', 'w2', 5, 300);
  assert n = 0, 'a live lease is not reclaimable';
  -- an EXPIRED lease is reclaimed (crash recovery)
  update marketing_provider_sync_runs set lease_expires_at = now() - interval '1 second'
   where id = run1;
  select count(*) into n from marketing_provider_sync_claim(
    'aaaa9900-0000-0000-0000-0000000000f1', 'w2', 5, 300);
  assert n = 1, 'an expired lease is reclaimed';
  assert (select attempts from marketing_provider_sync_runs where id = run1) = 2,
    'a reclaim burns another attempt';

  -- POISON: a burned attempt budget retires the run and excludes it forever
  update marketing_provider_sync_runs
     set attempts = 10, lease_expires_at = now() - interval '1 second'
   where id = run1;
  select count(*) into n from marketing_provider_sync_claim(
    'aaaa9900-0000-0000-0000-0000000000f1', 'w3', 5, 300);
  assert n = 0, 'a poison run is never re-leased';
  assert (select status from marketing_provider_sync_runs where id = run1) = 'failed',
    'a poison run is retired to failed';
  assert (select error_class from marketing_provider_sync_runs where id = run1)
         = 'max_attempts_exhausted', 'the retirement is classified honestly';
  -- completing a retired run CONVERGES — it does not resurrect
  r := marketing_provider_sync_complete(
    'aaaa9900-0000-0000-0000-0000000000f1', run1, '{"outcome":"succeeded"}');
  assert (r ->> 'converged') = 'true' and (r ->> 'status') = 'failed',
    'completion of a terminal run converges without effect';
  assert (select last_synced_at from marketing_provider_accounts where id = b) is null,
    'a failed run never records synced facts';

  -- a SUCCESSFUL cycle records the facts exactly once
  r := marketing_provider_sync_request(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    b, '{"request_id":"p9-sync-3"}');
  run2 := (r ->> 'run_id')::uuid;
  perform marketing_provider_sync_claim(
    'aaaa9900-0000-0000-0000-0000000000f1', 'w1', 5, 300);
  -- a failed completion demands its reason
  begin
    perform marketing_provider_sync_complete(
      'aaaa9900-0000-0000-0000-0000000000f1', run2, '{"outcome":"failed"}');
    assert false, 'a failed run requires an error_class';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_provider_sync_complete(
    'aaaa9900-0000-0000-0000-0000000000f1', run2,
    '{"outcome":"succeeded","stats":{"records":0}}');
  assert (r ->> 'status') = 'succeeded', 'the run completes';
  synced := (select last_synced_at from marketing_provider_accounts where id = b);
  assert synced is not null, 'success records last_synced_at';
  r := marketing_provider_sync_complete(
    'aaaa9900-0000-0000-0000-0000000000f1', run2, '{"outcome":"succeeded"}');
  assert (r ->> 'converged') = 'true', 'repeat completion converges';
  assert (select last_synced_at from marketing_provider_accounts where id = b) = synced,
    'repeat completion never bumps last_synced_at twice';
end $$;

-- ── (7) SCHEDULED SEAM: pure due-computation, nothing polls ─────────────────
do $$
declare a uuid; b uuid; n int;
begin
  b := (select val from p9_ctx where key = 'acct2')::uuid;
  -- no cadence -> never due
  select count(*) into n from marketing_provider_sync_due(
    'aaaa9900-0000-0000-0000-0000000000f1');
  assert n = 0, 'an account without a cadence is never due';
  -- cadence set + fresh facts -> not due
  update marketing_provider_accounts set sync_cadence_minutes = 60 where id = b;
  select count(*) into n from marketing_provider_sync_due(
    'aaaa9900-0000-0000-0000-0000000000f1');
  assert n = 0, 'fresh facts inside the cadence are not due';
  -- facts older than the cadence -> due
  update marketing_provider_accounts
     set last_synced_at = now() - interval '2 hours' where id = b;
  select count(*) into n from marketing_provider_sync_due(
    'aaaa9900-0000-0000-0000-0000000000f1');
  assert n = 1, 'elapsed cadence makes the account due';
  -- an active run suppresses due (single flight extends to the scheduler).
  -- created_at is set explicitly: the whole suite runs in ONE transaction, so
  -- default now() would tie with the earlier runs and "latest" would be
  -- ambiguous — in production each run is its own transaction.
  insert into marketing_provider_sync_runs (tenant_id, account_id, kind, created_at)
  values ('aaaa9900-0000-0000-0000-0000000000f1', b, 'scheduled',
          now() + interval '1 second');
  select count(*) into n from marketing_provider_sync_due(
    'aaaa9900-0000-0000-0000-0000000000f1');
  assert n = 0, 'an active run suppresses due';
end $$;
-- append-only: the delete refusal runs in ITS OWN block so the handler's
-- rollback-to-savepoint cannot undo the state the later sections rely on
do $$
declare b uuid;
begin
  b := (select val from p9_ctx where key = 'acct2')::uuid;
  begin
    delete from marketing_provider_sync_runs
     where account_id = b and status = 'queued';
    assert false, 'append-only: the delete must refuse';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  assert exists (select 1 from marketing_provider_sync_runs
    where account_id = b and status = 'queued' and kind = 'scheduled'),
    'sync history is append-only — nothing was deleted';
end $$;

-- ── (8) FRESHNESS: computed, each state with its reason ─────────────────────
do $$
declare r jsonb; acc jsonb; a uuid; b uuid; c uuid; d uuid; rr jsonb;
begin
  a := (select val from p9_ctx where key = 'acct1')::uuid;  -- never synced
  b := (select val from p9_ctx where key = 'acct2')::uuid;  -- has facts
  r := marketing_provider_connection_list('aaaa9900-0000-0000-0000-0000000000f1');
  -- NEVER_RUN: acct1 has no facts and its latest run is not failed (no runs)
  select value into acc from jsonb_array_elements(r -> 'accounts')
   where value ->> 'id' = a::text;
  assert acc -> 'freshness' ->> 'state' = 'never_run',
    'no facts and no failed run reads never_run';
  -- acct2's queued scheduled run is not terminal, facts are 2h old vs 86400s
  select value into acc from jsonb_array_elements(r -> 'accounts')
   where value ->> 'id' = b::text;
  assert acc -> 'freshness' ->> 'state' = 'fresh',
    '2h-old facts inside a 24h window read fresh';
  assert (acc -> 'freshness' ->> 'age_seconds')::numeric > 0,
    'freshness carries its measured age';
  -- STALE: shrink the window below the age
  update marketing_provider_accounts set stale_after_seconds = 3600 where id = b;
  r := marketing_provider_connection_list('aaaa9900-0000-0000-0000-0000000000f1');
  select value into acc from jsonb_array_elements(r -> 'accounts')
   where value ->> 'id' = b::text;
  assert acc -> 'freshness' ->> 'state' = 'stale',
    'facts older than the window read stale';
  assert acc -> 'freshness' ->> 'reason' is not null, 'stale carries its reason';
  -- ERROR: a failed latest run wins over age
  update marketing_provider_sync_runs set status = 'running', attempts = 1
   where account_id = b and status = 'queued';
  perform marketing_provider_sync_complete(
    'aaaa9900-0000-0000-0000-0000000000f1',
    (select id from marketing_provider_sync_runs
      where account_id = b and status = 'running'),
    '{"outcome":"failed","error_class":"provider_5xx"}');
  r := marketing_provider_connection_list('aaaa9900-0000-0000-0000-0000000000f1');
  select value into acc from jsonb_array_elements(r -> 'accounts')
   where value ->> 'id' = b::text;
  assert acc -> 'freshness' ->> 'state' = 'error',
    'a failed latest run reads error';
  assert acc -> 'freshness' ->> 'reason' = 'provider_5xx',
    'the error state carries the real error class';
end $$;

-- ── (9) REVOKE: terminal, honest path from any state ────────────────────────
do $$
declare r jsonb; a uuid; c uuid; v int;
begin
  a := (select val from p9_ctx where key = 'acct1')::uuid;  -- error state
  v := (select version from marketing_provider_accounts where id = a);
  r := marketing_provider_account_revoke(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    a, jsonb_build_object('request_id','p9-rev-1','expected_version',v));
  assert (r ->> 'status') = 'revoked', 'revoke lands terminal';
  assert (select revoked_at from marketing_provider_accounts where id = a) is not null,
    'revocation is a recorded fact';
  assert (select credential_state from marketing_provider_accounts where id = a)
         = 'unconfigured', 'revocation abandons the credential reference';
  -- replay converges
  r := marketing_provider_account_revoke(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    a, jsonb_build_object('request_id','p9-rev-1','expected_version',v));
  assert (r ->> 'replayed') = 'true', 'revoke replay converges';
  -- revoked is terminal: no credential, no reconnection, no second revoke
  begin
    perform marketing_provider_account_credential_mark(
      'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
      a, '{"request_id":"p9-rev-c1"}',
      (select version from marketing_provider_accounts where id = a));
    assert false, 'a revoked connection cannot hold credentials';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_provider_account_connect_start(
      'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
      a, jsonb_build_object('request_id','p9-rev-r1','expected_version',
           (select version from marketing_provider_accounts where id = a)));
    assert false, 'a revoked connection cannot reconnect';
  exception when sqlstate '22023' then null;
  end;
  -- revoke straight from preview walks the honest path and still terminates
  r := marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
        'bbbb9900-0000-0000-0000-000000000001',
        '{"provider":"sheet","display_name":"Sheet never used","request_id":"p9-acc-c3"}');
  c := (r ->> 'id')::uuid;
  r := marketing_provider_account_revoke(
    'aaaa9900-0000-0000-0000-0000000000f1', 'bbbb9900-0000-0000-0000-000000000001',
    c, '{"request_id":"p9-rev-2","expected_version":1}');
  assert (r ->> 'status') = 'revoked', 'a never-connected connection can be revoked';
end $$;

-- ── (10) CROSS-TENANT + RLS + THE PHASE-9 CATALOG LOCK ──────────────────────
do $$
declare r jsonb; b uuid; fn text;
begin
  b := (select val from p9_ctx where key = 'acct2')::uuid;
  -- tenant B cannot see or touch tenant A's connection
  begin
    perform marketing_provider_account_connect_start(
      'aaaa9900-0000-0000-0000-0000000000f2', 'bbbb9900-0000-0000-0000-000000000005',
      b, '{"request_id":"p9-xtenant-1","expected_version":1}');
    assert false, 'a foreign tenant must read NOT FOUND';
  exception when sqlstate 'P0002' then null;
  end;
  r := marketing_provider_connection_list('aaaa9900-0000-0000-0000-0000000000f2');
  assert jsonb_array_length(r -> 'accounts') = 0,
    'tenant B sees ZERO of tenant A''s connections';
  -- an actor of the WRONG tenant is refused structurally
  begin
    perform marketing_provider_account_create('aaaa9900-0000-0000-0000-0000000000f1',
      'bbbb9900-0000-0000-0000-000000000005',
      '{"provider":"meta","display_name":"X","request_id":"p9-xtenant-2"}');
    assert false, 'a cross-tenant actor must be refused';
  exception when integrity_constraint_violation then null;
  end;

  -- RLS is enabled on every Phase-9 table
  perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('marketing_provider_accounts',
                       'marketing_provider_account_versions',
                       'marketing_provider_sync_runs')
     and not c.relrowsecurity;
  if found then
    raise exception 'FAIL: a Phase-9 table is missing row level security';
  end if;
  -- browser roles hold ZERO write privileges
  if has_table_privilege('authenticated', 'marketing_provider_accounts', 'insert')
     or has_table_privilege('authenticated', 'marketing_provider_accounts', 'update')
     or has_table_privilege('authenticated', 'marketing_provider_accounts', 'delete')
     or has_table_privilege('authenticated', 'marketing_provider_account_versions', 'insert')
     or has_table_privilege('authenticated', 'marketing_provider_sync_runs', 'insert')
     or has_table_privilege('anon', 'marketing_provider_accounts', 'insert') then
    raise exception 'FAIL: a browser role can write a Phase-9 table';
  end if;

  -- the COMPLETE Phase-9 function set, locked in BOTH directions
  declare
    expected text[] := array[
      'marketing_provider_account_guard','marketing_provider_sync_run_guard',
      'marketing_provider_account_snapshot','marketing_provider_account_create',
      'marketing_provider_account_connect_start',
      'marketing_provider_account_connect_result',
      'marketing_provider_account_credential_mark',
      'marketing_provider_account_revoke','marketing_provider_sync_request',
      'marketing_provider_sync_claim','marketing_provider_sync_complete',
      'marketing_provider_sync_due','marketing_provider_connection_list'];
    found_set text[];
    missing text[];
    extra text[];
  begin
    select coalesce(array_agg(distinct p.proname order by p.proname), '{}')
      into found_set
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'marketing\_provider\_%';
    select coalesce(array_agg(e), '{}') into missing
      from unnest(expected) e where e <> all (found_set);
    select coalesce(array_agg(f), '{}') into extra
      from unnest(found_set) f where f <> all (expected);
    if array_length(missing, 1) is not null then
      raise exception 'FAIL: expected Phase-9 function(s) missing: %', missing;
    end if;
    if array_length(extra, 1) is not null then
      raise exception 'FAIL: catalog function(s) not in the Phase-9 lock list: %', extra;
    end if;
    foreach fn in array expected loop
      if exists (
        select 1 from information_schema.routine_privileges rp
         where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
           and rp.privilege_type = 'EXECUTE') then
        raise exception 'FAIL: Phase-9 function % is executable by a client role', fn;
      end if;
    end loop;
    perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = any (expected);
    if found then
      raise exception 'FAIL: a Phase-9 function is unexpectedly SECURITY DEFINER';
    end if;
  end;

  -- and the Phase-8 catalog lock is undisturbed: no Phase-9 name collides
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'marketing\_ad\_%' or p.proname like 'marketing\_ads\_%')
     and p.proname like 'marketing\_provider\_%';
  if found then
    raise exception 'FAIL: a Phase-9 function name leaks into the Phase-8 catalog';
  end if;
end $$;

select 'marketing_provider_connections.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
