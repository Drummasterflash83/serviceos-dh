-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_provider_hardening.test.sql
--
-- Proves Marketing Phase 10A (migration 20260907120000) — provider sync
-- hardening — with SYNTHETIC fixtures only. The 'connected' fixtures go
-- through the adapter seam exactly as the deterministic test provider's
-- worker path does; NO real provider exists or is contacted:
--   VOCABULARY — 'serviceos_test_provider' is accepted structurally,
--   'webhook' still refused; the four real providers unchanged.
--   ADAPTER-AWARE CONNECT — adapter_implemented=false keeps the recorded
--   Phase-9 truth (error/'no_adapter'); true enters 'connecting' and queues
--   ONE idempotent validation job; a failed validation lands honestly in
--   error; only the evidence-bearing seam reaches connected; a verified
--   result stores the bounded discovered-account list, queues the initial
--   sync exactly once and one drain job.
--   EXTERNAL SELECTION — governed, versioned, only from the discovered list
--   of a genuinely connected account; replay converges; MK409; 42501.
--   CANONICAL FACTS — recorded ONLY by a RUNNING run; strict shape; honest
--   time bounds (no future, no beyond-horizon); identical re-records
--   converge with ZERO new rows; changed values append a superseding
--   revision; append-only in both directions; spend requires currency.
--   REPORTING — every number reconciles to fixture facts; mixed currencies
--   ⇒ totals.spend null + 'mixed_currencies'; zero leads ⇒ CPL null +
--   'zero_leads'; no facts ⇒ null + reason, NEVER zero; degraded = failed
--   metrics with a usable feed; a later success clears only the error.
--   REVOCATION — queued work retired to failed/'account_revoked'
--   immediately; the account leaves every scheduling surface.
--   SCHEDULED ENQUEUE — two invocations can never double-queue; exactly one
--   drain job; due excludes active/revoked/disconnected.
--   LOCKS — the Phase-10 tables carry RLS + zero browser writes; the FULL
--   marketing_provider_% catalog (17) is locked in BOTH directions.
begin;

create temp table p10_ctx (key text primary key, val text);

insert into tenants (id, slug, display_name, industry) values
  ('aaaa1000-0000-0000-0000-0000000000f1','p10-t1','Phase10 Tenant 1','hvac'),
  ('aaaa1000-0000-0000-0000-0000000000f2','p10-t2','Phase10 Tenant 2','hvac');
insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb1000-0000-0000-0000-000000000001','p10-owner@x.test',false,false),
  ('bbbb1000-0000-0000-0000-000000000003','p10-viewer@x.test',false,false),
  ('bbbb1000-0000-0000-0000-000000000005','p10-admin-b@x.test',false,false);
update profiles set role='owner',  tenant_id='aaaa1000-0000-0000-0000-0000000000f1' where id='bbbb1000-0000-0000-0000-000000000001';
update profiles set role='viewer', tenant_id='aaaa1000-0000-0000-0000-0000000000f1' where id='bbbb1000-0000-0000-0000-000000000003';
update profiles set role='admin',  tenant_id='aaaa1000-0000-0000-0000-0000000000f2' where id='bbbb1000-0000-0000-0000-000000000005';
select marketing_materialise_defaults('aaaa1000-0000-0000-0000-0000000000f1','bbbb1000-0000-0000-0000-000000000001');
select marketing_materialise_defaults('aaaa1000-0000-0000-0000-0000000000f2','bbbb1000-0000-0000-0000-000000000005');

-- ── (1) vocabulary + adapter-aware connect ──────────────────────────────────
do $$
declare r jsonb; a uuid; n int;
begin
  -- the test identity is structurally accepted; webhook still refused
  begin
    perform marketing_provider_account_create('aaaa1000-0000-0000-0000-0000000000f1',
      'bbbb1000-0000-0000-0000-000000000001',
      '{"provider":"webhook","display_name":"X","request_id":"p10-acc-w1"}');
    assert false, 'webhook must stay unconnectable';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_provider_account_create('aaaa1000-0000-0000-0000-0000000000f1',
        'bbbb1000-0000-0000-0000-000000000001',
        '{"provider":"serviceos_test_provider","display_name":"Sim A","request_id":"p10-acc-c1"}');
  a := (r ->> 'id')::uuid;
  insert into p10_ctx values ('a1', a::text);
  assert (r ->> 'status') = 'preview', 'a new test-provider connection is preview';

  -- adapter_implemented=false: the Phase-9 recorded truth, byte-for-byte
  r := marketing_provider_account_connect_start(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, '{"request_id":"p10-con-f1","expected_version":1,"adapter_implemented":false}');
  assert (r ->> 'status') = 'error' and (r ->> 'status_reason') = 'no_adapter',
    'no adapter still means a recorded error';

  -- adapter_implemented=true: connecting + ONE queued validation job
  r := marketing_provider_account_connect_start(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, jsonb_build_object('request_id','p10-con-t1','expected_version',
         (select version from marketing_provider_accounts where id = a),
         'adapter_implemented', true));
  assert (r ->> 'status') = 'connecting' and (r ->> 'validation') = 'queued',
    'the adapter path enters connecting with a queued validation';
  select count(*) into n from platform_jobs
   where tenant_id = 'aaaa1000-0000-0000-0000-0000000000f1'
     and job_type = 'marketing.provider_connect' and job_key = 'mkconn:' || a;
  assert n = 1, 'exactly one validation job is queued';
  assert (select status from marketing_provider_accounts where id = a) = 'connecting',
    'the account is honestly connecting';
  -- a failed adapter validation lands in error with its reason
  r := marketing_provider_account_connect_result(
    'aaaa1000-0000-0000-0000-0000000000f1', a,
    '{"verified":false,"reason":"invalid_credential"}');
  assert (r ->> 'status') = 'error' and (r ->> 'status_reason') = 'invalid_credential',
    'a failed validation is an honest error';
  -- retry: connecting again reuses the SAME queued job (idempotent key)
  r := marketing_provider_account_connect_start(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, jsonb_build_object('request_id','p10-con-t2','expected_version',
         (select version from marketing_provider_accounts where id = a),
         'adapter_implemented', true));
  select count(*) into n from platform_jobs
   where tenant_id = 'aaaa1000-0000-0000-0000-0000000000f1'
     and job_type = 'marketing.provider_connect' and job_key = 'mkconn:' || a;
  assert n = 1, 'the validation job never duplicates';
end $$;

-- ── (2) seam: discovery bounds, connected, initial sync queued once ─────────
do $$
declare r jsonb; a uuid; n int; big jsonb;
begin
  a := (select val from p10_ctx where key = 'a1')::uuid;
  -- discovery bounds: 21 entries refuse; malformed entries refuse
  select jsonb_agg(jsonb_build_object('ref', 'acct-' || i, 'name', 'A' || i))
    into big from generate_series(1, 21) i;
  begin
    perform marketing_provider_account_connect_result(
      'aaaa1000-0000-0000-0000-0000000000f1', a,
      jsonb_build_object('verified', true, 'adapter_version', 'sim-1',
        'evidence', '{"probe":"x"}'::jsonb, 'accounts', big));
    assert false, 'more than 20 discovered accounts must refuse';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_provider_account_connect_result(
      'aaaa1000-0000-0000-0000-0000000000f1', a,
      '{"verified":true,"adapter_version":"sim-1","evidence":{"probe":"x"},
        "accounts":[{"ref":"r1","name":"N1","secret":"nope"}]}');
    assert false, 'unknown discovered-account keys must refuse';
  exception when sqlstate '22023' then null;
  end;
  -- verified with evidence + two accounts
  r := marketing_provider_account_connect_result(
    'aaaa1000-0000-0000-0000-0000000000f1', a,
    '{"verified":true,"adapter_version":"sim-1",
      "queue_initial_sync":true,
      "evidence":{"probe":"deterministic fixture"},
      "accounts":[{"ref":"acct-100","name":"Sim Account 100"},
                  {"ref":"acct-200","name":"Sim Account 200"}]}');
  assert (r ->> 'status') = 'connected', 'the seam connects with evidence';
  assert (select jsonb_array_length(discovered_accounts)
            from marketing_provider_accounts where id = a) = 2,
    'discovery is stored bounded';
  -- initial sync queued exactly once + one drain job
  select count(*) into n from marketing_provider_sync_runs
   where account_id = a and kind = 'initial' and status = 'queued';
  assert n = 1, 'the initial sync is queued exactly once';
  select count(*) into n from platform_jobs
   where tenant_id = 'aaaa1000-0000-0000-0000-0000000000f1'
     and job_type = 'marketing.provider_sync';
  assert n = 1, 'exactly one sync drain job exists';
end $$;

-- ── (3) external selection ──────────────────────────────────────────────────
do $$
declare r jsonb; r2 jsonb; a uuid; v int;
begin
  a := (select val from p10_ctx where key = 'a1')::uuid;
  v := (select version from marketing_provider_accounts where id = a);
  begin
    perform marketing_provider_account_external_select(
      'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000003',
      a, jsonb_build_object('request_id','p10-sel-v1','expected_version',v,
                            'external_ref','acct-100'));
    assert false, 'a viewer must be denied selection';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform marketing_provider_account_external_select(
      'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
      a, jsonb_build_object('request_id','p10-sel-x1','expected_version',v,
                            'external_ref','acct-999'));
    assert false, 'selection outside the discovered list must refuse';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_provider_account_external_select(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, jsonb_build_object('request_id','p10-sel-c1','expected_version',v,
                          'external_ref','acct-100'));
  assert (r ->> 'external_account_name') = 'Sim Account 100',
    'selection stores the discovered name';
  r2 := marketing_provider_account_external_select(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, jsonb_build_object('request_id','p10-sel-c1','expected_version',v,
                          'external_ref','acct-100'));
  assert (r2 ->> 'replayed') = 'true', 'selection replay converges';
  begin
    perform marketing_provider_account_external_select(
      'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
      a, '{"request_id":"p10-sel-x2","expected_version":1,"external_ref":"acct-200"}');
    assert false, 'a stale selection read must refuse MK409';
  exception when sqlstate 'MK409' then null;
  end;
  assert (select count(*) from marketing_provider_account_versions
           where account_id = a and change_kind = 'external_select') = 1,
    'selection is one recorded fact';
end $$;

-- ── (4) canonical facts: bounds, convergence, supersession, append-only ─────
do $$
declare r jsonb; a uuid; run uuid; n int;
begin
  a := (select val from p10_ctx where key = 'a1')::uuid;
  run := (select id from marketing_provider_sync_runs
           where account_id = a and kind = 'initial');
  -- facts refuse while the run is still queued
  begin
    perform marketing_provider_fact_record(
      'aaaa1000-0000-0000-0000-0000000000f1', run,
      '{"facts":[{"fact_kind":"campaign","external_ref":"c1","name":"C1"}]}');
    assert false, 'a queued run must not record facts';
  exception when sqlstate '22023' then null;
  end;
  perform marketing_provider_sync_claim(
    'aaaa1000-0000-0000-0000-0000000000f1', 'w1', 5, 300);
  insert into p10_ctx values ('run1', run::text);

  -- strict shape and honest time bounds
  begin
    perform marketing_provider_fact_record(
      'aaaa1000-0000-0000-0000-0000000000f1', run,
      '{"facts":[{"fact_kind":"campaign","external_ref":"c1","secret":"x"}]}');
    assert false, 'unknown fact keys must refuse';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_provider_fact_record(
      'aaaa1000-0000-0000-0000-0000000000f1', run,
      jsonb_build_object('facts', jsonb_build_array(jsonb_build_object(
        'fact_kind','metric','external_ref','c1',
        'window_start', (current_date + 5)::text,
        'window_end', (current_date + 5)::text,
        'currency','GBP','spend',1,'leads',1))));
    assert false, 'a future-dated fact must refuse';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_provider_fact_record(
      'aaaa1000-0000-0000-0000-0000000000f1', run,
      jsonb_build_object('facts', jsonb_build_array(jsonb_build_object(
        'fact_kind','metric','external_ref','c1',
        'window_start', (current_date - 500)::text,
        'window_end', (current_date - 500)::text,
        'currency','GBP','spend',1,'leads',1))));
    assert false, 'a fact beyond the 400-day horizon must refuse';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_provider_fact_record(
      'aaaa1000-0000-0000-0000-0000000000f1', run,
      jsonb_build_object('facts', jsonb_build_array(jsonb_build_object(
        'fact_kind','metric','external_ref','c1',
        'window_start', (current_date - 1)::text,
        'window_end', (current_date - 1)::text,
        'spend', 5, 'leads', 1))));
    assert false, 'spend without a currency must be structurally impossible';
  exception when check_violation then null;
  end;

  -- the deterministic fixture batch: 2 campaigns + 2 GBP daily metrics
  r := marketing_provider_fact_record(
    'aaaa1000-0000-0000-0000-0000000000f1', run,
    jsonb_build_object('facts', jsonb_build_array(
      jsonb_build_object('fact_kind','campaign','external_ref','camp-1',
                         'name','Spring Boilers'),
      jsonb_build_object('fact_kind','campaign','external_ref','camp-2',
                         'name','Servicing Plans'),
      jsonb_build_object('fact_kind','metric','external_ref','camp-1',
        'window_start',(current_date - 2)::text,'window_end',(current_date - 2)::text,
        'currency','GBP','spend',95.50,'impressions',1000,'clicks',50,'leads',4),
      jsonb_build_object('fact_kind','metric','external_ref','camp-2',
        'window_start',(current_date - 2)::text,'window_end',(current_date - 2)::text,
        'currency','GBP','spend',4.50,'impressions',200,'clicks',10,'leads',1))));
  assert (r ->> 'inserted')::int = 4, 'the fixture batch inserts four facts';

  -- identical replay: ZERO new rows, full convergence
  r := marketing_provider_fact_record(
    'aaaa1000-0000-0000-0000-0000000000f1', run,
    jsonb_build_object('facts', jsonb_build_array(
      jsonb_build_object('fact_kind','campaign','external_ref','camp-1',
                         'name','Spring Boilers'),
      jsonb_build_object('fact_kind','campaign','external_ref','camp-2',
                         'name','Servicing Plans'),
      jsonb_build_object('fact_kind','metric','external_ref','camp-1',
        'window_start',(current_date - 2)::text,'window_end',(current_date - 2)::text,
        'currency','GBP','spend',95.50,'impressions',1000,'clicks',50,'leads',4),
      jsonb_build_object('fact_kind','metric','external_ref','camp-2',
        'window_start',(current_date - 2)::text,'window_end',(current_date - 2)::text,
        'currency','GBP','spend',4.50,'impressions',200,'clicks',10,'leads',1))));
  assert (r ->> 'converged')::int = 4 and (r ->> 'inserted')::int = 0,
    'an identical replay converges with zero new rows';
  select count(*) into n from marketing_provider_facts where account_id = a;
  assert n = 4, 'no duplicate fact rows exist';

  -- a CHANGED value appends a superseding revision (incremental sync)
  r := marketing_provider_fact_record(
    'aaaa1000-0000-0000-0000-0000000000f1', run,
    jsonb_build_object('facts', jsonb_build_array(
      jsonb_build_object('fact_kind','metric','external_ref','camp-2',
        'window_start',(current_date - 2)::text,'window_end',(current_date - 2)::text,
        'currency','GBP','spend',6.00,'impressions',220,'clicks',11,'leads',1))));
  assert (r ->> 'superseded')::int = 1, 'a changed value supersedes';
  select max(revision) into n from marketing_provider_facts
   where account_id = a and external_ref = 'camp-2' and fact_kind = 'metric';
  assert n = 2, 'the superseding fact is revision 2';

  -- append-only in both directions
  begin
    update marketing_provider_facts set spend = 0 where account_id = a;
    assert false, 'facts must be immutable';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    delete from marketing_provider_facts where account_id = a;
    assert false, 'facts must be undeletable';
  exception when sqlstate 'P0001' then null;
  end;

  -- close the run honestly
  perform marketing_provider_sync_complete(
    'aaaa1000-0000-0000-0000-0000000000f1', run,
    '{"outcome":"succeeded","stats":{"facts":4}}');
end $$;

-- ── (5) reporting: every number reconciles to the fixture ───────────────────
do $$
declare rep jsonb; r jsonb; a uuid; run uuid;
begin
  a := (select val from p10_ctx where key = 'a1')::uuid;
  rep := marketing_provider_account_report('aaaa1000-0000-0000-0000-0000000000f1', a);
  -- 95.50 + 6.00 (revision 2 replaced 4.50) = 101.50; leads 4 + 1 = 5
  assert (rep -> 'totals' ->> 'spend')::numeric = 101.50,
    'total spend reconciles to the LATEST fixture facts';
  assert (rep -> 'totals' ->> 'leads')::int = 5, 'leads reconcile';
  assert (rep -> 'cpl' ->> 'value')::numeric = 20.30,
    'CPL = 101.50 / 5 exactly';
  assert jsonb_array_length(rep -> 'campaigns') = 2, 'both campaigns project';
  assert rep -> 'metrics_status' ->> 'state' = 'available', 'metrics available';
  assert rep ->> 'health' = 'healthy', 'a succeeded run reads healthy';

  -- mixed currencies: totals.spend and CPL become null WITH the reason
  r := marketing_provider_sync_request(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, '{"request_id":"p10-sync-m1"}');
  run := (r ->> 'run_id')::uuid;
  perform marketing_provider_sync_claim(
    'aaaa1000-0000-0000-0000-0000000000f1', 'w1', 5, 300);
  perform marketing_provider_fact_record(
    'aaaa1000-0000-0000-0000-0000000000f1', run,
    jsonb_build_object('facts', jsonb_build_array(
      jsonb_build_object('fact_kind','metric','external_ref','camp-1',
        'window_start',(current_date - 1)::text,'window_end',(current_date - 1)::text,
        'currency','EUR','spend',10.00,'leads',1))));
  perform marketing_provider_sync_complete(
    'aaaa1000-0000-0000-0000-0000000000f1', run, '{"outcome":"succeeded"}');
  rep := marketing_provider_account_report('aaaa1000-0000-0000-0000-0000000000f1', a);
  assert rep -> 'totals' ->> 'spend' is null, 'mixed currencies are never added';
  assert rep -> 'totals' ->> 'spend_unavailable_reason' = 'mixed_currencies',
    'the reason is exact';
  assert rep -> 'cpl' ->> 'value' is null
     and rep -> 'cpl' ->> 'unavailable_reason' = 'mixed_currencies',
    'CPL is honestly unavailable under mixed currencies';

  -- degraded: metrics fail but the feed stays usable; recovery clears it
  r := marketing_provider_sync_request(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, '{"request_id":"p10-sync-d1"}');
  run := (r ->> 'run_id')::uuid;
  perform marketing_provider_sync_claim(
    'aaaa1000-0000-0000-0000-0000000000f1', 'w1', 5, 300);
  perform marketing_provider_sync_complete(
    'aaaa1000-0000-0000-0000-0000000000f1', run,
    '{"outcome":"failed","error_class":"metrics_unavailable"}');
  rep := marketing_provider_account_report('aaaa1000-0000-0000-0000-0000000000f1', a);
  assert rep ->> 'health' = 'degraded',
    'failed metrics with a usable feed reads degraded';
  assert rep -> 'metrics_status' ->> 'reason' = 'metrics_unavailable',
    'the metrics error is specific';
  assert jsonb_array_length(rep -> 'campaigns') = 2,
    'the campaign feed survives a metrics failure';
  r := marketing_provider_sync_request(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    a, '{"request_id":"p10-sync-r1"}');
  run := (r ->> 'run_id')::uuid;
  perform marketing_provider_sync_claim(
    'aaaa1000-0000-0000-0000-0000000000f1', 'w1', 5, 300);
  perform marketing_provider_sync_complete(
    'aaaa1000-0000-0000-0000-0000000000f1', run, '{"outcome":"succeeded"}');
  rep := marketing_provider_account_report('aaaa1000-0000-0000-0000-0000000000f1', a);
  assert rep ->> 'health' = 'healthy', 'a later success clears the error';
end $$;

-- ── (6) zero-leads truth + no-facts truth on a second fixture account ───────
do $$
declare r jsonb; rep jsonb; b uuid; run uuid;
begin
  r := marketing_provider_account_create('aaaa1000-0000-0000-0000-0000000000f1',
        'bbbb1000-0000-0000-0000-000000000001',
        '{"provider":"serviceos_test_provider","display_name":"Sim B","request_id":"p10-acc-c2"}');
  b := (r ->> 'id')::uuid;
  insert into p10_ctx values ('a2', b::text);
  -- no facts, never connected: nulls with reasons, never zero
  rep := marketing_provider_account_report('aaaa1000-0000-0000-0000-0000000000f1', b);
  assert rep -> 'totals' ->> 'spend' is null
     and rep -> 'totals' ->> 'spend_unavailable_reason' = 'no_spend_facts',
    'no facts is null + reason, never zero';
  assert rep -> 'metrics_status' ->> 'reason' = 'no_metric_facts',
    'metrics honestly absent';
  -- fixture-connect and record a zero-lead metric
  perform marketing_provider_account_connect_start(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    b, '{"request_id":"p10-con-b1","expected_version":1,"adapter_implemented":true}');
  perform marketing_provider_account_connect_result(
    'aaaa1000-0000-0000-0000-0000000000f1', b,
    '{"verified":true,"adapter_version":"sim-1","queue_initial_sync":true,"evidence":{"probe":"x"},
      "accounts":[{"ref":"acct-b","name":"B"}]}');
  run := (select id from marketing_provider_sync_runs
           where account_id = b and kind = 'initial');
  perform marketing_provider_sync_claim(
    'aaaa1000-0000-0000-0000-0000000000f1', 'w1', 5, 300);
  perform marketing_provider_fact_record(
    'aaaa1000-0000-0000-0000-0000000000f1', run,
    jsonb_build_object('facts', jsonb_build_array(
      jsonb_build_object('fact_kind','metric','external_ref','camp-b',
        'window_start',(current_date - 1)::text,'window_end',(current_date - 1)::text,
        'currency','GBP','spend',10.00,'leads',0))));
  perform marketing_provider_sync_complete(
    'aaaa1000-0000-0000-0000-0000000000f1', run, '{"outcome":"succeeded"}');
  rep := marketing_provider_account_report('aaaa1000-0000-0000-0000-0000000000f1', b);
  assert (rep -> 'totals' ->> 'spend')::numeric = 10.00, 'spend reconciles';
  assert (rep -> 'totals' ->> 'leads')::int = 0, 'zero leads is a REAL zero';
  assert rep -> 'cpl' ->> 'value' is null
     and rep -> 'cpl' ->> 'unavailable_reason' = 'zero_leads',
    'a zero denominator never fabricates a CPL';
end $$;

-- ── (7) scheduled enqueue: idempotent, honest exclusions ────────────────────
do $$
declare r jsonb; b uuid; n int;
begin
  b := (select val from p10_ctx where key = 'a2')::uuid;
  update marketing_provider_accounts
     set sync_cadence_minutes = 5, last_synced_at = now() - interval '1 hour'
   where id = b;
  r := marketing_provider_sync_enqueue_due('aaaa1000-0000-0000-0000-0000000000f1');
  assert (r ->> 'queued')::int = 1, 'a due account queues one scheduled run';
  -- a second overlapping invocation queues NOTHING (single flight)
  r := marketing_provider_sync_enqueue_due('aaaa1000-0000-0000-0000-0000000000f1');
  assert (r ->> 'queued')::int = 0, 'two invocations never double-queue';
  select count(*) into n from marketing_provider_sync_runs
   where account_id = b and status in ('queued', 'running');
  assert n = 1, 'exactly one active run exists';
  select count(*) into n from platform_jobs
   where tenant_id = 'aaaa1000-0000-0000-0000-0000000000f1'
     and job_type = 'marketing.provider_sync'
     and status in ('queued', 'running', 'retrying');
  assert n = 1, 'exactly one active drain job exists';
end $$;

-- ── (8) revocation blocks queued work immediately ───────────────────────────
do $$
declare r jsonb; b uuid; v int; n int;
begin
  b := (select val from p10_ctx where key = 'a2')::uuid;
  v := (select version from marketing_provider_accounts where id = b);
  r := marketing_provider_account_revoke(
    'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
    b, jsonb_build_object('request_id','p10-rev-b1','expected_version',v));
  assert (r ->> 'status') = 'revoked', 'revocation lands terminal';
  select count(*) into n from marketing_provider_sync_runs
   where account_id = b and status = 'queued';
  assert n = 0, 'no queued run survives revocation';
  assert exists (select 1 from marketing_provider_sync_runs
    where account_id = b and status = 'failed' and error_class = 'account_revoked'),
    'queued work is retired honestly as account_revoked';
  select count(*) into n from marketing_provider_sync_due(
    'aaaa1000-0000-0000-0000-0000000000f1');
  assert n = 0, 'a revoked account leaves the scheduling surface';
  begin
    perform marketing_provider_sync_request(
      'aaaa1000-0000-0000-0000-0000000000f1', 'bbbb1000-0000-0000-0000-000000000001',
      b, '{"request_id":"p10-sync-x9"}');
    assert false, 'a revoked account must refuse sync';
  exception when sqlstate 'MK430' then null;
  end;
end $$;

-- ── (9) cross-tenant + locks on the Phase-10 surface ────────────────────────
do $$
declare a uuid; fn text;
begin
  a := (select val from p10_ctx where key = 'run1')::uuid;
  -- a foreign tenant cannot touch tenant A's run
  begin
    perform marketing_provider_fact_record(
      'aaaa1000-0000-0000-0000-0000000000f2', a,
      '{"facts":[{"fact_kind":"campaign","external_ref":"c1"}]}');
    assert false, 'a foreign tenant must read NOT FOUND';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform marketing_provider_account_report(
      'aaaa1000-0000-0000-0000-0000000000f2',
      (select val from p10_ctx where key = 'a1')::uuid);
    assert false, 'a foreign tenant report must read NOT FOUND';
  exception when sqlstate 'P0002' then null;
  end;

  perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'marketing_provider_facts'
     and not c.relrowsecurity;
  if found then
    raise exception 'FAIL: marketing_provider_facts is missing row level security';
  end if;
  if has_table_privilege('authenticated', 'marketing_provider_facts', 'insert')
     or has_table_privilege('authenticated', 'marketing_provider_facts', 'update')
     or has_table_privilege('authenticated', 'marketing_provider_facts', 'delete')
     or has_table_privilege('anon', 'marketing_provider_facts', 'insert') then
    raise exception 'FAIL: a browser role can write provider facts';
  end if;
  foreach fn in array array[
    'marketing_provider_account_external_select', 'marketing_provider_fact_record',
    'marketing_provider_account_report', 'marketing_provider_sync_enqueue_due'
  ] loop
    if exists (
      select 1 from information_schema.routine_privileges rp
       where rp.routine_name = fn and rp.grantee in ('anon', 'authenticated', 'PUBLIC')
         and rp.privilege_type = 'EXECUTE') then
      raise exception 'FAIL: Phase-10 function % is executable by a client role', fn;
    end if;
  end loop;
  perform 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname like 'marketing\_provider\_%';
  if found then
    raise exception 'FAIL: a marketing_provider function is SECURITY DEFINER';
  end if;
  -- the FULL catalog is exactly the 17 locked names (both directions)
  declare
    expected text[] := array[
      'marketing_provider_account_guard','marketing_provider_sync_run_guard',
      'marketing_provider_account_snapshot','marketing_provider_account_create',
      'marketing_provider_account_connect_start',
      'marketing_provider_account_connect_result',
      'marketing_provider_account_credential_mark',
      'marketing_provider_account_revoke','marketing_provider_sync_request',
      'marketing_provider_sync_claim','marketing_provider_sync_complete',
      'marketing_provider_sync_due','marketing_provider_connection_list',
      'marketing_provider_account_external_select',
      'marketing_provider_fact_record','marketing_provider_account_report',
      'marketing_provider_sync_enqueue_due'];
    found_set text[];
  begin
    select coalesce(array_agg(distinct p.proname order by p.proname), '{}')
      into found_set
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'marketing\_provider\_%';
    if exists (select 1 from unnest(expected) e where e <> all (found_set))
       or exists (select 1 from unnest(found_set) f where f <> all (expected)) then
      raise exception 'FAIL: the marketing_provider catalog drifted from the 17-name lock';
    end if;
  end;
end $$;

select 'marketing_provider_hardening.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
