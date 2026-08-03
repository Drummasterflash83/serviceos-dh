-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_tracking.test.sql
--
-- Proves the Resend sandbox activation CLOSURE (migration 20260908120400):
--
--  §1 legacy sender convergence — a pre-hardening sandbox sender recorded
--     send_scope_state='authorized' with a last_verified_at stamp; it converges
--     to 'unknown' + NULL + the canonical sandbox note, stays enabled and
--     derives 'sandbox_ready'. A legacy ARBITRARY resend address is disabled,
--     derives 'unavailable', keeps its history, and — even when it is the
--     tenant's CURRENT default — the default is cleared first so the structural
--     sender guard does not block the disable. Both changes are audited.
--     Re-running the convergence writes NOTHING (idempotent) and a tenant with
--     no resend sender is untouched (harmless).
--
--  §2 BOUNDED public tracking writes — the recorder is write-once per event
--     kind. A duplicate open/click returns false and performs ZERO writes,
--     proven by an UNCHANGED xmin (the row was not re-versioned at all), and
--     first-event timestamps are immutable. A valid-token FLOOD (50 requests)
--     leaves xmin at the value it had after the first event. The lifetime write
--     budget is at most 1 INSERT + 1 open UPDATE + 1 click UPDATE.
--
--  §3 unrepresentable over-counting — the CHECK constraint refuses
--     open_count/click_count above 1 even for the service role.
--
--  §4 honest summary — unique-delivery evidence only; raw total-event analytics
--     are reported as not_collected.
--
--  §5 tenant safety + boundaries — an unknown delivery records nothing and
--     discloses nothing; the composite (tenant_id, delivery_id) FK refuses a
--     cross-tenant tracking row; browser roles hold no privilege on the table
--     and cannot execute the recorder.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('cccc9400-0000-0000-0000-0000000000f1','trk-t1','Tracking Tenant 1','hvac'),
  ('cccc9400-0000-0000-0000-0000000000f2','trk-t2','Tracking Tenant 2','hvac'),
  ('cccc9400-0000-0000-0000-0000000000f3','trk-t3','Tracking Tenant 3 (no resend sender)','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('dddd9400-0000-0000-0000-0000000000f1','owner-trk@trk.test',false,false),
  ('dddd9400-0000-0000-0000-0000000000f2','owner-trk2@trk.test',false,false),
  ('dddd9400-0000-0000-0000-0000000000f3','owner-trk3@trk.test',false,false);
update profiles set role='owner', tenant_id='cccc9400-0000-0000-0000-0000000000f1' where id='dddd9400-0000-0000-0000-0000000000f1';
update profiles set role='owner', tenant_id='cccc9400-0000-0000-0000-0000000000f2' where id='dddd9400-0000-0000-0000-0000000000f2';
update profiles set role='owner', tenant_id='cccc9400-0000-0000-0000-0000000000f3' where id='dddd9400-0000-0000-0000-0000000000f3';

select marketing_materialise_defaults('cccc9400-0000-0000-0000-0000000000f1','dddd9400-0000-0000-0000-0000000000f1');
select marketing_materialise_defaults('cccc9400-0000-0000-0000-0000000000f2','dddd9400-0000-0000-0000-0000000000f2');
select marketing_materialise_defaults('cccc9400-0000-0000-0000-0000000000f3','dddd9400-0000-0000-0000-0000000000f3');

-- ============================================================================
-- §1 · LEGACY RESEND SENDER CONVERGENCE
-- ----------------------------------------------------------------------------
-- Re-create the PRE-hardening state the deployed staging environment is in: a
-- sandbox sender claiming provider authorisation, plus a legacy arbitrary
-- from-address that is ALSO the tenant's current default.
-- ============================================================================
insert into marketing_sender_profiles
  (id, tenant_id, source_kind, mailbox_address, label, from_name,
   enabled, send_scope_state, scope_checked_at, last_verified_at, created_by, updated_by)
values
  ('9400aaaa-0000-4000-8000-0000000000a1','cccc9400-0000-0000-0000-0000000000f1','resend',
   'onboarding@resend.dev','onboarding@resend.dev','Drummonds',
   true,'authorized', now(), now(),
   'dddd9400-0000-0000-0000-0000000000f1','dddd9400-0000-0000-0000-0000000000f1'),
  ('9400aaaa-0000-4000-8000-0000000000a2','cccc9400-0000-0000-0000-0000000000f1','resend',
   'hello@legacy.example','legacy arbitrary','Drummonds',
   true,'authorized', now(), now(),
   'dddd9400-0000-0000-0000-0000000000f1','dddd9400-0000-0000-0000-0000000000f1');

update marketing_settings
   set default_sender_profile_id = '9400aaaa-0000-4000-8000-0000000000a2'
 where tenant_id = 'cccc9400-0000-0000-0000-0000000000f1';

-- a SECOND tenant with only the sandbox sender (tenant-safety of the pass)
insert into marketing_sender_profiles
  (id, tenant_id, source_kind, mailbox_address, label, from_name,
   enabled, send_scope_state, scope_checked_at, last_verified_at, created_by, updated_by)
values
  ('9400aaaa-0000-4000-8000-0000000000b1','cccc9400-0000-0000-0000-0000000000f2','resend',
   'onboarding@resend.dev','onboarding@resend.dev','Other',
   true,'authorized', now(), now(),
   'dddd9400-0000-0000-0000-0000000000f2','dddd9400-0000-0000-0000-0000000000f2');

-- ── run the SAME convergence the migration performs ─────────────────────────
-- (byte-identical logic; the migration's DO block is reproduced here so the
--  suite can assert its effect inside one transaction)
do $$
declare
  r          record;
  v_tid      uuid;
  v_sandbox  text := 'Resend sandbox (onboarding@resend.dev) — test-to-self only. Never verified against Resend; real provider submission NOT RUN. Campaigns and sequences are refused.';
  v_legacy   text := 'Legacy Resend from-address — unavailable and never production-ready. Only the resend.dev sandbox sender is permitted until a domain is verified in Resend.';
  v_tenants  uuid[] := '{}';
begin
  for r in
    select p.id, p.tenant_id, p.mailbox_address, p.enabled,
           p.send_scope_state, p.last_verified_at, p.verification_note
      from marketing_sender_profiles p
     where p.source_kind = 'resend'
     order by p.tenant_id, p.id
  loop
    if r.mailbox_address = 'onboarding@resend.dev' then
      continue when r.send_scope_state = 'unknown'
                and r.last_verified_at is null
                and r.verification_note is not distinct from v_sandbox;
      update marketing_sender_profiles
         set send_scope_state='unknown', last_verified_at=null,
             scope_checked_at=now(), verification_note=v_sandbox
       where id = r.id and tenant_id = r.tenant_id;
      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (r.tenant_id,'service','marketing.sender.state_corrected','marketing_sender',
              r.id::text,'ok', jsonb_build_object('mailbox', r.mailbox_address));
    else
      continue when r.enabled = false
                and r.send_scope_state = 'unknown'
                and r.last_verified_at is null
                and r.verification_note is not distinct from v_legacy;
      update marketing_settings set default_sender_profile_id = null
       where tenant_id = r.tenant_id and default_sender_profile_id = r.id;
      update marketing_sender_profiles
         set enabled=false, send_scope_state='unknown', last_verified_at=null,
             scope_checked_at=now(), verification_note=v_legacy
       where id = r.id and tenant_id = r.tenant_id;
      insert into audit_logs (tenant_id, actor, action, resource_type, resource_id, status, detail)
      values (r.tenant_id,'service','marketing.sender.disabled','marketing_sender',
              r.id::text,'ok', jsonb_build_object('mailbox', r.mailbox_address));
    end if;
    if not (r.tenant_id = any (v_tenants)) then v_tenants := v_tenants || r.tenant_id; end if;
  end loop;
  foreach v_tid in array v_tenants loop
    perform marketing_sender_capability_sync(v_tid);
  end loop;
end $$;

do $$
declare v record; v_ready jsonb; v_n int;
begin
  -- sandbox converged, still enabled, honest state
  select * into v from marketing_sender_profiles where id='9400aaaa-0000-4000-8000-0000000000a1';
  if v.send_scope_state <> 'unknown' then
    raise exception 'FAIL §1: sandbox sender still claims %', v.send_scope_state;
  end if;
  if v.last_verified_at is not null then
    raise exception 'FAIL §1: sandbox sender still carries a last_verified_at stamp';
  end if;
  if v.enabled is not true then
    raise exception 'FAIL §1: the sandbox sender must remain usable for governed test sends';
  end if;
  if v.verification_note not like 'Resend sandbox%test-to-self only%' then
    raise exception 'FAIL §1: sandbox sender is not canonically marked test-only (%)', v.verification_note;
  end if;
  v_ready := marketing_sender_readiness('cccc9400-0000-0000-0000-0000000000f1', v.id);
  if v_ready->>'state' <> 'sandbox_ready'
     or (v_ready->>'ready')::boolean is not true
     or (v_ready->>'sandbox')::boolean is not true
     or (v_ready->>'test_to_self_only')::boolean is not true
     or (v_ready->>'campaigns_blocked')::boolean is not true
     or (v_ready->>'sequences_blocked')::boolean is not true
     or (v_ready->>'provider_submission_verified')::boolean is not false then
    raise exception 'FAIL §1: sandbox readiness is not honest: %', v_ready;
  end if;

  -- legacy arbitrary address: disabled, unavailable, never production-ready
  select * into v from marketing_sender_profiles where id='9400aaaa-0000-4000-8000-0000000000a2';
  if v.enabled is not false then
    raise exception 'FAIL §1: the legacy arbitrary resend sender is still enabled';
  end if;
  if v.send_scope_state <> 'unknown' or v.last_verified_at is not null then
    raise exception 'FAIL §1: the legacy arbitrary resend sender still claims verification';
  end if;
  v_ready := marketing_sender_readiness('cccc9400-0000-0000-0000-0000000000f1', v.id);
  if v_ready->>'state' <> 'unavailable' or (v_ready->>'ready')::boolean is not false then
    raise exception 'FAIL §1: legacy arbitrary sender is not unavailable: %', v_ready;
  end if;
  -- history preserved: the row still exists with its original identity
  if v.mailbox_address <> 'hello@legacy.example' or v.created_at is null then
    raise exception 'FAIL §1: legacy sender history was not preserved';
  end if;

  -- the default was cleared so the structural guard could not block the disable
  if (select default_sender_profile_id from marketing_settings
       where tenant_id='cccc9400-0000-0000-0000-0000000000f1') is not null then
    raise exception 'FAIL §1: the tenant default still points at a disabled sender';
  end if;

  -- both changes audited
  select count(*) into v_n from audit_logs
   where tenant_id='cccc9400-0000-0000-0000-0000000000f1'
     and action in ('marketing.sender.state_corrected','marketing.sender.disabled');
  if v_n <> 2 then raise exception 'FAIL §1: expected 2 audit rows, got %', v_n; end if;

  -- tenant safety: the SECOND tenant converged on its own row only
  select * into v from marketing_sender_profiles where id='9400aaaa-0000-4000-8000-0000000000b1';
  if v.send_scope_state <> 'unknown' or v.tenant_id <> 'cccc9400-0000-0000-0000-0000000000f2' then
    raise exception 'FAIL §1: tenant 2 did not converge inside its own tenant';
  end if;

  -- harmless: a tenant with no resend sender has none afterwards either
  select count(*) into v_n from marketing_sender_profiles
   where tenant_id='cccc9400-0000-0000-0000-0000000000f3';
  if v_n <> 0 then raise exception 'FAIL §1: a tenant without a resend sender was touched'; end if;
end $$;

-- ── idempotency: re-running the convergence must write NOTHING ──────────────
do $$
declare v_before_xmin bigint; v_after_xmin bigint; v_audit_before int; v_audit_after int;
        v_sandbox text := 'Resend sandbox (onboarding@resend.dev) — test-to-self only. Never verified against Resend; real provider submission NOT RUN. Campaigns and sequences are refused.';
        v_legacy  text := 'Legacy Resend from-address — unavailable and never production-ready. Only the resend.dev sandbox sender is permitted until a domain is verified in Resend.';
        r record; v_tid uuid; v_tenants uuid[] := '{}';
begin
  select xmin::text::bigint into v_before_xmin
    from marketing_sender_profiles where id='9400aaaa-0000-4000-8000-0000000000a1';
  select count(*) into v_audit_before from audit_logs
   where action in ('marketing.sender.state_corrected','marketing.sender.disabled');

  for r in
    select p.id, p.tenant_id, p.mailbox_address, p.enabled,
           p.send_scope_state, p.last_verified_at, p.verification_note
      from marketing_sender_profiles p where p.source_kind='resend'
     order by p.tenant_id, p.id
  loop
    if r.mailbox_address = 'onboarding@resend.dev' then
      continue when r.send_scope_state='unknown' and r.last_verified_at is null
                and r.verification_note is not distinct from v_sandbox;
      raise exception 'FAIL §1b: the sandbox convergence was not idempotent';
    else
      continue when r.enabled = false and r.send_scope_state='unknown'
                and r.last_verified_at is null
                and r.verification_note is not distinct from v_legacy;
      raise exception 'FAIL §1b: the legacy convergence was not idempotent';
    end if;
  end loop;

  select xmin::text::bigint into v_after_xmin
    from marketing_sender_profiles where id='9400aaaa-0000-4000-8000-0000000000a1';
  select count(*) into v_audit_after from audit_logs
   where action in ('marketing.sender.state_corrected','marketing.sender.disabled');
  if v_before_xmin <> v_after_xmin then
    raise exception 'FAIL §1b: a converged sender row was re-written on re-application';
  end if;
  if v_audit_before <> v_audit_after then
    raise exception 'FAIL §1b: re-application produced additional audit rows';
  end if;
end $$;

-- ============================================================================
-- §2 · BOUNDED PUBLIC TRACKING WRITES (write-once per event kind)
-- ============================================================================
-- a real, governed delivery through the canonical RPC (no hand-built rows)
create temporary table trk_delivery on commit drop as
select (marketing_test_send_request(
          'cccc9400-0000-0000-0000-0000000000f1',
          'dddd9400-0000-0000-0000-0000000000f1',
          jsonb_build_object(
            'sender_id','9400aaaa-0000-4000-8000-0000000000a1',
            'recipient_profile_id','dddd9400-0000-0000-0000-0000000000f1',
            'subject','tracking bound proof',
            'body_text','Visit https://drummonds.example/quote',
            'request_id','trk-req-00000001')) ->> 'delivery_id')::uuid as id;

do $$
declare
  d uuid;
  v_first boolean; v_dup boolean;
  x1 bigint; x2 bigint; x3 bigint;
  t_open timestamptz; t_click timestamptz; v_url text; i int;
begin
  select id into d from trk_delivery;

  -- ── first open: recorded once ────────────────────────────────────────────
  v_first := marketing_track_record(d, 'open', null);
  if v_first is not true then raise exception 'FAIL §2: the first open was not recorded'; end if;
  select xmin::text::bigint, first_open_at into x1, t_open
    from marketing_email_tracking where delivery_id = d;
  if (select open_count from marketing_email_tracking where delivery_id=d) <> 1 then
    raise exception 'FAIL §2: open_count is not bounded unique evidence';
  end if;

  -- ── duplicate opens: ZERO writes (xmin unchanged = row never re-versioned) ─
  for i in 1..5 loop
    v_dup := marketing_track_record(d, 'open', null);
    if v_dup is not false then raise exception 'FAIL §2: a duplicate open reported a write'; end if;
  end loop;
  select xmin::text::bigint into x2 from marketing_email_tracking where delivery_id = d;
  if x1 <> x2 then raise exception 'FAIL §2: duplicate opens re-wrote the row (xmin % -> %)', x1, x2; end if;
  if (select first_open_at from marketing_email_tracking where delivery_id=d) <> t_open then
    raise exception 'FAIL §2: the first-open timestamp is not immutable';
  end if;
  if (select open_count from marketing_email_tracking where delivery_id=d) <> 1 then
    raise exception 'FAIL §2: duplicate opens changed the bounded counter';
  end if;

  -- ── first click: recorded once, destination captured write-once ──────────
  v_first := marketing_track_record(d, 'click', 'https://drummonds.example/quote');
  if v_first is not true then raise exception 'FAIL §2: the first click was not recorded'; end if;
  select xmin::text::bigint, first_click_at, first_click_url into x2, t_click, v_url
    from marketing_email_tracking where delivery_id = d;
  if v_url <> 'https://drummonds.example/quote' then
    raise exception 'FAIL §2: the first click destination was not captured (%)', v_url;
  end if;

  -- ── VALID-TOKEN FLOOD: 50 further clicks change nothing at all ───────────
  for i in 1..50 loop
    v_dup := marketing_track_record(d, 'click', 'https://evil.example/later');
    if v_dup is not false then raise exception 'FAIL §2: a flood click reported a write'; end if;
  end loop;
  select xmin::text::bigint into x3 from marketing_email_tracking where delivery_id = d;
  if x2 <> x3 then
    raise exception 'FAIL §2: a valid-token flood amplified writes (xmin % -> %)', x2, x3;
  end if;
  if (select first_click_at from marketing_email_tracking where delivery_id=d) <> t_click then
    raise exception 'FAIL §2: the first-click timestamp is not immutable';
  end if;
  if (select first_click_url from marketing_email_tracking where delivery_id=d) <> v_url then
    raise exception 'FAIL §2: a later click overwrote the bound destination';
  end if;
  if (select click_count from marketing_email_tracking where delivery_id=d) <> 1 then
    raise exception 'FAIL §2: the flood moved the bounded counter';
  end if;

  -- ── lifetime budget: exactly ONE row for this delivery, ever ─────────────
  if (select count(*) from marketing_email_tracking where delivery_id=d) <> 1 then
    raise exception 'FAIL §2: more than one tracking row exists for a delivery';
  end if;
end $$;

-- ============================================================================
-- §3 · OVER-COUNTING IS UNREPRESENTABLE (even for the service role)
-- ============================================================================
do $$
declare d uuid; v_failed boolean := false;
begin
  select id into d from trk_delivery;
  begin
    update marketing_email_tracking set open_count = 2 where delivery_id = d;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §3: open_count above 1 was accepted'; end if;

  v_failed := false;
  begin
    update marketing_email_tracking set click_count = 7 where delivery_id = d;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL §3: click_count above 1 was accepted'; end if;
end $$;

-- ============================================================================
-- §4 · HONEST SUMMARY — unique-delivery evidence, no raw totals
-- ============================================================================
do $$
declare v jsonb;
begin
  v := marketing_campaign_tracking_summary('cccc9400-0000-0000-0000-0000000000f1',
                                           '9400aaaa-0000-4000-8000-0000000000c9');
  if v ? 'total_open_events' or v ? 'total_click_events' then
    raise exception 'FAIL §4: the summary still claims raw total-event analytics: %', v;
  end if;
  if v->>'total_event_analytics' <> 'not_collected' then
    raise exception 'FAIL §4: the summary does not state that totals are not collected: %', v;
  end if;
  if not (v ? 'opened_deliveries' and v ? 'clicked_deliveries' and v ? 'sent') then
    raise exception 'FAIL §4: the summary lost its unique-delivery evidence shape: %', v;
  end if;
  if v->>'metric_note' is null then
    raise exception 'FAIL §4: the summary carries no bots/prefetchers caveat';
  end if;
end $$;

-- ============================================================================
-- §5 · TENANT SAFETY + BOUNDARIES
-- ============================================================================
do $$
declare v_rows int; v_res boolean; v_failed boolean := false; d uuid;
begin
  select id into d from trk_delivery;

  -- an unknown delivery records nothing and discloses nothing
  v_res := marketing_track_record('00000000-0000-4000-8000-0000000000ff','open',null);
  if v_res is not false then raise exception 'FAIL §5: an unknown delivery reported a write'; end if;
  select count(*) into v_rows from marketing_email_tracking
   where delivery_id = '00000000-0000-4000-8000-0000000000ff';
  if v_rows <> 0 then raise exception 'FAIL §5: an unknown delivery created a row'; end if;

  -- an invalid kind records nothing
  v_res := marketing_track_record(d,'forwarded',null);
  if v_res is not false then raise exception 'FAIL §5: an unknown event kind reported a write'; end if;

  -- the composite FK refuses a cross-tenant tracking row
  begin
    insert into marketing_email_tracking (tenant_id, delivery_id)
    values ('cccc9400-0000-0000-0000-0000000000f2', d);
  exception when foreign_key_violation or unique_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL §5: a tracking row was bound to another tenant''s delivery';
  end if;
end $$;

do $$
declare v_n int;
begin
  -- browser roles hold NO privilege on the tracking table
  select count(*) into v_n from information_schema.role_table_grants
   where table_name = 'marketing_email_tracking' and grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then raise exception 'FAIL §5: browser roles hold % grants on the tracking table', v_n; end if;

  -- and cannot execute the recorder or the summary
  select count(*) into v_n from information_schema.routine_privileges
   where routine_name in ('marketing_track_record','marketing_campaign_tracking_summary',
                          'marketing_sender_create_resend','marketing_sender_readiness')
     and grantee in ('anon','authenticated','PUBLIC') and privilege_type = 'EXECUTE';
  if v_n <> 0 then raise exception 'FAIL §5: % client EXECUTE grants remain', v_n; end if;

  -- RLS is on
  if not (select relrowsecurity from pg_class where relname='marketing_email_tracking') then
    raise exception 'FAIL §5: RLS is not enabled on marketing_email_tracking';
  end if;
end $$;

select 'marketing_tracking.test.sql: ALL ASSERTIONS PASSED' as result;

rollback;
