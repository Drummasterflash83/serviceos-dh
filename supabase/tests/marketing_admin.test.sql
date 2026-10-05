-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/marketing_admin.test.sql
--
-- Proves Marketing Phase 3 (migration 20260831120000) AFTER the correction
-- pass: settings validation (strict JSON types, explicit-null rejection,
-- quiet-hours key allowlist, whole-operation no-op rejection) + REAL
-- append-only history STRUCTURALLY BOUND to the tenant's settings row +
-- version conflicts; lifecycle invariants (atomic dual-representation default,
-- per-op argument allowlists, concurrency evidence for set_default/reorder,
-- ACTIVE-ONLY retirement that preserves historical rows + per-relationship
-- events + card refresh, honest retire_preview); access administration
-- (restricted owner/admin-only + VIEWER READ CEILING enforced in the resolver
-- AND the grant RPC, hostile raw grant rows inert, lockout protection,
-- idempotent no-ops, stale-state conflicts, cross-tenant rejection); tag
-- governance no-ops + bulk tagging with unambiguous duplicate-safe counts and
-- a checked preflight→apply contract; segment AST validation (depth enforced
-- BEFORE descending, node budget DURING traversal, unknown-key/mixed-shape/
-- strict-type/range/duplicate-tag rejection — identical for stored and ad-hoc)
-- + status-change concurrency + update no-ops + saved-evaluation version
-- capture + strict typed cursors with next_cursor; contact imports
-- (EVIDENCE-CONVERGED identity across external id + primary/secondary email/
-- phone, invalid-endpoint evidence respected, honest invalid rows — never
-- silent defaults, safe company resolution, sealed-contract enforcement,
-- durable per-row outcomes, retryable state machine with cumulative counts via
-- marketing_import_finalize); the STRUCTURAL row-results transition guard
-- (identity/lineage pinned on every update, failed retries counted by exactly
-- one, terminal immutability with a genuine single-reference FK set-null as
-- the only exception, cascade cleanup intact) + the vanished-person retryable
-- contract (40001 raise, never an unrecorded successful invalid); single-
-- contact tag assignment parity (inactive tags rejected, removal + history
-- preserved, reactivation restores assignability); TRUE keyset audit
-- pagination over equal timestamps with safe detail projection;
-- service-role-only RPC boundaries.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa3000-0000-0000-0000-0000000000f1','p3-t1','Phase3 Tenant 1','hvac'),
  ('aaaa3000-0000-0000-0000-0000000000f2','p3-t2','Phase3 Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb3000-0000-0000-0000-0000000000f1','owner-a@p3.test',false,false),
  ('bbbb3000-0000-0000-0000-0000000000f2','admin-a@p3.test',false,false),
  ('bbbb3000-0000-0000-0000-0000000000f3','ops-a@p3.test',false,false),
  ('bbbb3000-0000-0000-0000-0000000000f4','viewer-a@p3.test',false,false),
  ('bbbb3000-0000-0000-0000-0000000000f5','admin-b@p3.test',false,false);
update profiles set role='owner',  tenant_id='aaaa3000-0000-0000-0000-0000000000f1' where id='bbbb3000-0000-0000-0000-0000000000f1';
update profiles set role='admin',  tenant_id='aaaa3000-0000-0000-0000-0000000000f1' where id='bbbb3000-0000-0000-0000-0000000000f2';
update profiles set role='ops',    tenant_id='aaaa3000-0000-0000-0000-0000000000f1' where id='bbbb3000-0000-0000-0000-0000000000f3';
update profiles set role='viewer', tenant_id='aaaa3000-0000-0000-0000-0000000000f1' where id='bbbb3000-0000-0000-0000-0000000000f4';
update profiles set role='admin',  tenant_id='aaaa3000-0000-0000-0000-0000000000f2' where id='bbbb3000-0000-0000-0000-0000000000f5';

select marketing_materialise_defaults('aaaa3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f1');
select marketing_materialise_defaults('aaaa3000-0000-0000-0000-0000000000f2','bbbb3000-0000-0000-0000-0000000000f5');

insert into companies (id, tenant_id, name) values
  ('dddd3000-0000-0000-0000-0000000000f1','aaaa3000-0000-0000-0000-0000000000f1','P3 Co'),
  ('dddd3000-0000-0000-0000-0000000000f2','aaaa3000-0000-0000-0000-0000000000f2','Foreign Co'),
  ('dddd3000-0000-0000-0000-0000000000f3','aaaa3000-0000-0000-0000-0000000000f1','Dup Co'),
  ('dddd3000-0000-0000-0000-0000000000f4','aaaa3000-0000-0000-0000-0000000000f1','Dup Co');

insert into people (id, tenant_id, display_name, primary_email, primary_phone, company_id) values
  ('cccc3000-0000-0000-0000-0000000000f1','aaaa3000-0000-0000-0000-0000000000f1','Ada Match','ada@p3.test','+441111000001','dddd3000-0000-0000-0000-0000000000f1'),
  ('cccc3000-0000-0000-0000-0000000000f2','aaaa3000-0000-0000-0000-0000000000f1','Ben Blank',null,null,null),
  ('cccc3000-0000-0000-0000-0000000000f3','aaaa3000-0000-0000-0000-0000000000f1','Cara Classified','cara@p3.test',null,null),
  ('cccc3000-0000-0000-0000-0000000000f4','aaaa3000-0000-0000-0000-0000000000f1','Dave Invalid','dave@p3.test',null,null),
  ('cccc3000-0000-0000-0000-0000000000f9','aaaa3000-0000-0000-0000-0000000000f2','Zoe Foreign','zoe@p3.test',null,null);

insert into contact_relationships (id, tenant_id, person_id, relationship_type, lifecycle_stage_key, status, source) values
  ('abcd3000-0000-0000-0000-0000000000f1','aaaa3000-0000-0000-0000-0000000000f1','cccc3000-0000-0000-0000-0000000000f3','customer','won','active','manual'),
  -- HISTORICAL rows sharing the stage: must NEVER be remapped by retirement
  ('abcd3000-0000-0000-0000-0000000000f2','aaaa3000-0000-0000-0000-0000000000f1','cccc3000-0000-0000-0000-0000000000f2','prospect','won','inactive','manual'),
  ('abcd3000-0000-0000-0000-0000000000f3','aaaa3000-0000-0000-0000-0000000000f1','cccc3000-0000-0000-0000-0000000000f1','other','won','archived','manual');

insert into interactions (tenant_id, source_connector_id, source_type, source_table, source_id,
                          interaction_type, direction, occurred_at, related_person_id) values
  ('aaaa3000-0000-0000-0000-0000000000f1','gmail','email','email_messages', gen_random_uuid(),
   'email_message','inbound', now() - interval '3 days', 'cccc3000-0000-0000-0000-0000000000f1');

-- ── (1) SETTINGS: strict validation, no-ops, bound history, conflicts ───────
do $$
declare r jsonb; v int; hn int; sid uuid; other_sid uuid;
begin
  select version, id into v, sid from marketing_settings where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  select id into other_sid from marketing_settings where tenant_id='aaaa3000-0000-0000-0000-0000000000f2';
  -- unknown key rejected
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"nonsense": true}'::jsonb, v);
    assert false, 'unknown settings key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- EXPLICIT NULL for a required boolean rejected (never "keep current")
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"marketing_enabled": null}'::jsonb, v);
    assert false, 'explicit null boolean must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"reply_handling": null}'::jsonb, v);
    assert false, 'explicit null enum must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- EXACT JSON scalar types validated before any text cast
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"tracking_enabled": "true"}'::jsonb, v);
    assert false, 'string "true" for a boolean must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"default_relationship_type": 5}'::jsonb, v);
    assert false, 'number for an enum must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- fake timezone rejected against REAL IANA data
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"timezone":"Mars/Olympus"}'::jsonb, v);
    assert false, 'fake timezone must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- quiet_hours permits ONLY start/end; incoherent/fractional values rejected
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1',
      '{"quiet_hours":{"start":9,"end":17,"sneaky":1}}'::jsonb, v);
    assert false, 'unknown quiet_hours key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"quiet_hours":{"start":9,"end":8.5}}'::jsonb, v);
    assert false, 'fractional quiet hour must raise 22023, never truncate';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"quiet_hours":{"start":9,"end":9}}'::jsonb, v);
    assert false, 'start=end quiet hours must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"quiet_hours":{"start":25,"end":8}}'::jsonb, v);
    assert false, 'out-of-range quiet hours must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- markup in footer rejected (plain text only)
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1',
      '{"unsubscribe_footer":{"footer_text":"<script>x</script>"}}'::jsonb, v);
    assert false, 'markup in footer must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- inactive/unknown default stage rejected
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1',
      '{"default_lifecycle_stage_key":"no_such_stage"}'::jsonb, v);
    assert false, 'unknown default stage must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- non-admin actor rejected
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f3', '{"tracking_enabled":true}'::jsonb, v);
    assert false, 'ops actor must raise 42501';
  exception when insufficient_privilege then null;
  end;
  -- WHOLE-OPERATION NO-OP rejected before any history/audit/event: supplying
  -- only current values changes nothing
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"timezone":"UTC"}'::jsonb, v);
    assert false, 'same-value update must raise 22023 (no effective changes)';
  exception when sqlstate '22023' then null;
  end;
  assert (select count(*) from marketing_settings_history
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = 0,
    'rejected no-op wrote no history';
  -- valid update → version bump + REAL history snapshot + audit + event
  r := marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"timezone":"Europe/London","quiet_hours":{"start":21,"end":8},
          "unsubscribe_footer":{"company_name":"P3 Ltd","footer_text":"You are receiving this because you asked."},
          "guardrails":{"max_bulk_recipients":500}}'::jsonb, v);
  assert (r->>'version')::int = v + 1, 'version incremented';
  select count(*) into hn from marketing_settings_history
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and version = v;
  assert hn = 1, 'previous row snapshotted into append-only history';
  assert (select (snapshot->>'timezone') from marketing_settings_history
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and version = v) = 'UTC',
    'history reconstructs the PREVIOUS value';
  -- history is immutable: updates raise, and NO client role holds delete
  -- (tenant CASCADE cleanup stays possible — a tenant is never undeletable)
  begin
    update marketing_settings_history set version = 999
     where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
    assert false, 'history update must be blocked';
  exception when others then null;
  end;
  assert not has_table_privilege('authenticated', 'marketing_settings_history', 'delete')
     and not has_table_privilege('service_role', 'marketing_settings_history', 'delete'),
    'no client role can hard-delete settings history';
  assert not has_table_privilege('authenticated', 'marketing_segment_versions', 'delete')
     and not has_table_privilege('service_role', 'marketing_segment_versions', 'delete'),
    'no client role can hard-delete segment versions';
  -- history is STRUCTURALLY BOUND to the same tenant's settings row
  begin
    insert into marketing_settings_history (tenant_id, settings_id, version, snapshot)
    values ('aaaa3000-0000-0000-0000-0000000000f1', other_sid, 999, '{}'::jsonb);
    assert false, 'cross-tenant settings_id must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into marketing_settings_history (tenant_id, settings_id, version, snapshot)
    values ('aaaa3000-0000-0000-0000-0000000000f1', sid, v, '{}'::jsonb);
    assert false, 'duplicate history for the same superseded version must be rejected';
  exception when unique_violation then null;
  end;
  -- stale expected version → MK409
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', '{"tracking_enabled":true}'::jsonb, v);
    assert false, 'stale version must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  assert exists (select 1 from audit_logs
                  where tenant_id='aaaa3000-0000-0000-0000-0000000000f1'
                    and action='marketing.settings.updated'), 'settings update audited';
  assert exists (select 1 from platform_events
                  where tenant_id='aaaa3000-0000-0000-0000-0000000000f1'
                    and event_type='marketing.settings.updated' and status='pending'),
    'settings update evented';
end $$;

-- ── (2) LIFECYCLE: atomic default, honest retirement, concurrency evidence ──
do $$
declare r jsonb; s record; n int; v int; won_id uuid; nur_id uuid; eng_id uuid; qua_id uuid;
        ids uuid[]; toks timestamptz[]; card_ctx jsonb;
begin
  select id into won_id from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and stage_key='won';
  select id into nur_id from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and stage_key='nurture';
  select id into eng_id from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and stage_key='engaged';
  select id into qua_id from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and stage_key='qualified';

  -- per-op argument allowlists: unknown args rejected, never ignored
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','add',
      '{"stage_key":"x_y","label":"X","sneaky":1}'::jsonb);
    assert false, 'unknown add argument must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- add: slug validated; label bounded
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','add','{"stage_key":"Bad Key!","label":"X"}'::jsonb);
    assert false, 'invalid stage key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','add',
        '{"stage_key":"follow_up","label":"Follow up","tone":"info"}'::jsonb);
  assert r->'stage'->>'stage_key' = 'follow_up', 'stage added';
  -- duplicate key → 23505
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','add',
      '{"stage_key":"follow_up","label":"Again"}'::jsonb);
    assert false, 'duplicate stage key must raise unique violation';
  exception when unique_violation then null;
  end;

  -- rename with stale token → MK409; same-label rename is a rejected no-op
  select * into s from marketing_lifecycle_stages where id = won_id;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','rename',
      jsonb_build_object('stage_id', won_id, 'label', 'Won!',
                         'expected_updated_at', s.updated_at - interval '1 second'));
    assert false, 'stale stage token must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','rename',
      jsonb_build_object('stage_id', won_id, 'label', s.label,
                         'expected_updated_at', s.updated_at));
    assert false, 'same-label rename is a rejected no-op';
  exception when sqlstate '22023' then null;
  end;
  perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','rename',
    jsonb_build_object('stage_id', won_id, 'label', 'Won ✔',
                       'expected_updated_at', s.updated_at));
  assert (select label from marketing_lifecycle_stages where id = won_id) = 'Won ✔',
    'rename applied; stage_key untouched';
  assert (select stage_key from marketing_lifecycle_stages where id = won_id) = 'won',
    'stage keys are immutable';
  assert (select label from marketing_lifecycle_stages
           where tenant_id is null and stage_key='won') = 'Won',
    'platform template never mutated by tenant admin';

  -- set_default: concurrency evidence + ONE ATOMIC INVARIANT across BOTH
  -- representations (stage flags AND the settings default key + history)
  select * into s from marketing_lifecycle_stages where id = eng_id;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','set_default',
      jsonb_build_object('stage_id', eng_id));
    assert false, 'set_default without concurrency evidence must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  select version into v from marketing_settings where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','set_default',
    jsonb_build_object('stage_id', eng_id, 'expected_updated_at', s.updated_at));
  select count(*) into n from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and is_default;
  assert n = 1, 'exactly one default stage';
  assert (select is_default from marketing_lifecycle_stages where id = eng_id), 'default moved';
  assert (select default_lifecycle_stage_key from marketing_settings
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = 'engaged',
    'settings default key moved ATOMICALLY with the flag';
  assert (select version from marketing_settings
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = v + 1,
    'set_default is a versioned settings change';
  assert exists (select 1 from marketing_settings_history
                  where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and version = v),
    'set_default wrote settings history';
  -- repeat set_default is a rejected no-op
  select * into s from marketing_lifecycle_stages where id = eng_id;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','set_default',
      jsonb_build_object('stage_id', eng_id, 'expected_updated_at', s.updated_at));
    assert false, 'repeat set_default is a rejected no-op';
  exception when sqlstate '22023' then null;
  end;
  -- the SETTINGS path keeps the SAME invariant: changing the default key
  -- through marketing_update_settings flips the stage flags atomically
  select version into v from marketing_settings where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1',
    '{"default_lifecycle_stage_key":"qualified"}'::jsonb, v);
  assert (select is_default from marketing_lifecycle_stages where id = qua_id)
     and not (select is_default from marketing_lifecycle_stages where id = eng_id)
     and (select count(*) from marketing_lifecycle_stages
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and is_default) = 1,
    'settings-path default change keeps exactly one stage flagged';

  -- retiring the EFFECTIVE default is rejected (both representations checked)
  select * into s from marketing_lifecycle_stages where id = qua_id;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','retire',
      jsonb_build_object('stage_id', qua_id, 'expected_updated_at', s.updated_at));
    assert false, 'default stage cannot be retired';
  exception when sqlstate '22023' then null;
  end;

  -- retire_preview: HONEST counts — active-only remap; historical reported
  -- separately (fixture: 1 active + 2 historical rows on 'won')
  r := marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','retire_preview',
        jsonb_build_object('stage_id', won_id));
  assert (r->>'active_in_use')::int = 1, 'retire preview counts ACTIVE relationships only';
  assert (r->>'historical_relationships')::int = 2,
    'historical (inactive/archived) rows reported separately, never remapped';

  -- retiring an in-use stage without a replacement is rejected
  select * into s from marketing_lifecycle_stages where id = won_id;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','retire',
      jsonb_build_object('stage_id', won_id, 'expected_updated_at', s.updated_at));
    assert false, 'in-use retirement requires a replacement';
  exception when sqlstate '22023' then null;
  end;
  -- cross-tenant replacement rejected
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','retire',
      jsonb_build_object('stage_id', won_id, 'expected_updated_at', s.updated_at,
        'replacement_stage_id', (select id from marketing_lifecycle_stages
                                  where tenant_id='aaaa3000-0000-0000-0000-0000000000f2'
                                    and stage_key='nurture')));
    assert false, 'cross-tenant replacement must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- valid retirement: remaps ONLY the active row with a version transition +
  -- per-relationship lifecycle event + card refresh; historical rows keep the
  -- retired key; the retired stage row remains for their labels
  select version into n from contact_relationships where id='abcd3000-0000-0000-0000-0000000000f1';
  r := marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','retire',
        jsonb_build_object('stage_id', won_id, 'expected_updated_at', s.updated_at,
                           'replacement_stage_id', nur_id));
  assert (r->>'remapped_active_relationships')::int = 1, 'exactly the active row remapped';
  assert (select lifecycle_stage_key from contact_relationships
           where id='abcd3000-0000-0000-0000-0000000000f1') = 'nurture',
    'active relationship carries the replacement stage';
  assert (select version from contact_relationships
           where id='abcd3000-0000-0000-0000-0000000000f1') = n + 1,
    'remap is a proper version transition';
  assert (select lifecycle_stage_key from contact_relationships
           where id='abcd3000-0000-0000-0000-0000000000f2') = 'won'
     and (select lifecycle_stage_key from contact_relationships
           where id='abcd3000-0000-0000-0000-0000000000f3') = 'won',
    'HISTORICAL relationships retain the retired stage key (history preserved)';
  assert not (select active from marketing_lifecycle_stages where id = won_id),
    'stage retired, never deleted — permanently available for historical labels';
  assert exists (select 1 from platform_events
                  where tenant_id='aaaa3000-0000-0000-0000-0000000000f1'
                    and event_type='marketing.contact.lifecycle_changed'
                    and subject_id='cccc3000-0000-0000-0000-0000000000f3'),
    'remapped relationship received a canonical lifecycle event';
  assert exists (select 1 from audit_logs
                  where tenant_id='aaaa3000-0000-0000-0000-0000000000f1'
                    and action='marketing.lifecycle.retire'
                    and detail->'remap'->'relationship_ids' ? 'abcd3000-0000-0000-0000-0000000000f1'),
    'durable mapping evidence records exactly which relationships were remapped';

  -- reorder requires parallel concurrency evidence; stale token → MK409
  select array_agg(id order by sort_order), array_agg(updated_at order by sort_order)
    into ids, toks
    from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','reorder',
      jsonb_build_object('stage_ids', to_jsonb(ids)));
    assert false, 'reorder without expected_updated_ats must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','reorder',
      jsonb_build_object('stage_ids', to_jsonb(ids[1:2]),
                         'expected_updated_ats', to_jsonb(toks[1:2])));
    assert false, 'partial reorder must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','reorder',
      jsonb_build_object('stage_ids', to_jsonb(ids),
        'expected_updated_ats', to_jsonb(array(
          select x - interval '1 hour' from unnest(toks) x))));
    assert false, 'stale reorder tokens must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  -- exact no-op ordering rejected
  begin
    perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','reorder',
      jsonb_build_object('stage_ids', to_jsonb(ids),
                         'expected_updated_ats', to_jsonb(toks)));
    assert false, 'no-op reorder must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','reorder',
    jsonb_build_object(
      'stage_ids', to_jsonb(array(select ids[i] from generate_subscripts(ids,1) i order by i desc)),
      'expected_updated_ats', to_jsonb(array(select toks[i] from generate_subscripts(toks,1) i order by i desc))));
  select count(distinct sort_order) into n from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  assert n = coalesce(array_length(ids, 1), 0), 'reorder leaves unique sort orders';
  assert exists (select 1 from audit_logs
                  where action like 'marketing.lifecycle.%'
                    and tenant_id='aaaa3000-0000-0000-0000-0000000000f1'),
    'lifecycle changes audited';
end $$;

-- ── (3) ACCESS: restricted + VIEWER CEILING, lockout, no-ops, cross-tenant ──
do $$
declare r jsonb; perms jsonb; audits_before int; audits_after int;
begin
  -- grant of a RESTRICTED permission to ops is rejected by the RPC
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f3',
      'marketing.campaigns.launch','grant','none');
    assert false, 'restricted grant to ops must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- …and even a SNEAKY direct grant row is inert in the RESOLVER
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values ('aaaa3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f3',
          'marketing.senders.manage', true, 'bbbb3000-0000-0000-0000-0000000000f1');
  perms := marketing_effective_permissions('bbbb3000-0000-0000-0000-0000000000f3') -> 'permissions';
  assert not (perms ? 'marketing.senders.manage'),
    'restricted permission never flows to a non-owner/admin, even from a raw grant row';
  delete from marketing_access_grants
   where profile_id='bbbb3000-0000-0000-0000-0000000000f3' and permission='marketing.senders.manage';

  -- VIEWER CEILING (grant RPC): any write grant for a viewer is rejected
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
      'marketing.contacts.manage','grant','none');
    assert false, 'viewer write grant must be rejected by the RPC';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
      'marketing.tags.manage','grant','none');
    assert false, 'viewer tags.manage grant must be rejected by the RPC';
  exception when sqlstate '22023' then null;
  end;
  -- VIEWER CEILING (resolver): a HOSTILE raw write-grant row is inert
  insert into marketing_access_grants (tenant_id, profile_id, permission, granted, granted_by)
  values
    ('aaaa3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
     'marketing.contacts.manage', true, 'bbbb3000-0000-0000-0000-0000000000f1'),
    ('aaaa3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
     'marketing.tags.manage', true, 'bbbb3000-0000-0000-0000-0000000000f1'),
    ('aaaa3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
     'marketing.contacts.import', true, 'bbbb3000-0000-0000-0000-0000000000f1');
  perms := marketing_effective_permissions('bbbb3000-0000-0000-0000-0000000000f4') -> 'permissions';
  assert not (perms ? 'marketing.contacts.manage')
     and not (perms ? 'marketing.tags.manage')
     and not (perms ? 'marketing.contacts.import'),
    'hostile raw viewer write grants are INERT in the canonical resolver';
  -- …and the mutation RPCs fail closed for that viewer despite the raw rows
  begin
    perform marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f4','assign',
      (select id from marketing_tags where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' limit 1),
      array['cccc3000-0000-0000-0000-0000000000f1']::uuid[], 'preflight');
    assert false, 'viewer with hostile grant must still be 42501 at the bulk RPC';
  exception when insufficient_privilege or no_data_found then null;
  end;
  begin
    perform marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f4','create',
      '{"name":"x","definition":{"field":"search","value":"a"}}'::jsonb);
    assert false, 'viewer with hostile grant must still be 42501 at the segment RPC';
  exception when insufficient_privilege then null;
  end;
  -- EVERY tag mutation path enforces the canonical boundary: create, assign,
  -- remove and administration all refuse the hostile-grant viewer
  begin
    perform marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f4','create','{"label":"Hostile Tag"}'::jsonb);
    assert false, 'viewer with hostile grant must still be 42501 at tag create';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f4','assign',
      jsonb_build_object('tag_id', gen_random_uuid(),
                         'person_id', 'cccc3000-0000-0000-0000-0000000000f1'));
    assert false, 'viewer with hostile grant must still be 42501 at tag assign';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f4','remove',
      jsonb_build_object('tag_id', gen_random_uuid(),
                         'person_id', 'cccc3000-0000-0000-0000-0000000000f1'));
    assert false, 'viewer with hostile grant must still be 42501 at tag remove';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f4','rename',
      jsonb_build_object('tag_id', gen_random_uuid(),
                         'expected_updated_at', now(), 'label', 'X'));
    assert false, 'viewer with hostile grant must still be 42501 at tag admin';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1',
      gen_random_uuid(), 'bbbb3000-0000-0000-0000-0000000000f4', 2,
      '{"display_name":"x"}'::jsonb, '{"source":"csv_upload"}'::jsonb);
    assert false, 'viewer with hostile grant must still be 42501 at the import RPC';
  exception when insufficient_privilege then null;
  end;
  delete from marketing_access_grants
   where profile_id='bbbb3000-0000-0000-0000-0000000000f4';

  -- viewer granted a READ capability: works through the RPC
  r := marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
        'marketing.view','grant','none');
  assert (r->'effective') ? 'marketing.view', 'viewer gains marketing.view';
  -- an EXACT no-op access change returns idempotently, without duplicate audits
  select count(*) into audits_before from audit_logs
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and action='marketing.access.changed';
  r := marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
        'marketing.view','grant','granted');
  assert (r->>'no_op')::boolean, 'exact repeat grant reported as a no-op';
  select count(*) into audits_after from audit_logs
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and action='marketing.access.changed';
  assert audits_after = audits_before, 'no-op access change writes no duplicate audit';
  -- stale expected state → MK409
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f4',
      'marketing.view','deny','none');
    assert false, 'stale expected state must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  -- explicit deny beats a role default
  r := marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f3',
        'marketing.contacts.import','deny','none');
  assert not ((r->'effective') ? 'marketing.contacts.import'), 'explicit deny removes default';
  perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f3',
    'marketing.contacts.import','clear','denied');
  -- unknown permission rejected
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f3',
      'marketing.made_up','grant','none');
    assert false, 'unknown permission must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- cross-tenant target rejected WITHOUT foreign evidence
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f5',
      'marketing.view','grant','none');
    assert false, 'cross-tenant profile must be rejected';
  exception when sqlstate '22023' then null;
  end;
  -- LOCKOUT: denying access.manage for BOTH owner and admin must fail on the last one
  perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f2',
    'marketing.access.manage','deny','none');
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f1',
      'marketing.access.manage','deny','none');
    assert false, 'removing the last access manager must raise MK423';
  exception when sqlstate 'MK423' then null;
  end;
  -- clearing the admin deny restores the manager set
  perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f2',
    'marketing.access.manage','clear','denied');
  -- a denied-access.manage admin cannot administer
  perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f2',
    'marketing.access.manage','deny','none');
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f2','bbbb3000-0000-0000-0000-0000000000f4',
      'marketing.view','deny','granted');
    assert false, 'actor without effective access.manage must raise 42501';
  exception when insufficient_privilege then null;
  end;
  perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','bbbb3000-0000-0000-0000-0000000000f2',
    'marketing.access.manage','clear','denied');
  assert exists (select 1 from audit_logs
                  where action='marketing.access.changed'
                    and tenant_id='aaaa3000-0000-0000-0000-0000000000f1'),
    'access changes audited';
end $$;

-- ── (4) TAGS: governance no-ops + duplicate-safe bulk with checked contract ──
do $$
declare r jsonb; t record; tag uuid; ctr text;
begin
  -- tag_mutate enforces exact per-operation shapes and strict types
  begin
    perform marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','create',
      '{"label":"X","sneaky":true}'::jsonb);
    assert false, 'unknown create argument must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','create','{"label": 5}'::jsonb);
    assert false, 'non-string label must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','assign',
      jsonb_build_object('tag_id', gen_random_uuid(),
                         'person_id', 'cccc3000-0000-0000-0000-0000000000f1',
                         'sneaky', 1));
    assert false, 'unknown assign argument must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','create','{"label":"Bulk Probe","tone":"info"}');
  tag := (r->>'id')::uuid;
  select * into t from marketing_tags where id = tag;
  -- tag_admin enforces exact per-operation shapes: a rename cannot smuggle a
  -- tone; deactivate accepts nothing beyond its concurrency token
  begin
    perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','rename',
      jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at,
                         'label', 'X', 'tone', 'negative'));
    assert false, 'rename with a tone argument must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','deactivate',
      jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at,
                         'label', 'X'));
    assert false, 'deactivate with extra arguments must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- rename keeps the stable key; same-label rename is a rejected no-op
  begin
    perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','rename',
      jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at,
                         'label', t.label));
    assert false, 'same-label tag rename is a rejected no-op';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','rename',
        jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at,
                           'label', 'Bulk Probe Renamed'));
  assert r->>'key' = 'bulk_probe', 'tag key immutable across rename';
  -- stale token → MK409
  begin
    perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','rename',
      jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at - interval '1 hour',
                         'label', 'X'));
    assert false, 'stale tag token must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;

  -- bulk preflight: DUPLICATE ids collapse into "unique" — never "rejected";
  -- a foreign id is COUNTED as rejected, never echoed
  r := marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
        array['cccc3000-0000-0000-0000-0000000000f1',
              'cccc3000-0000-0000-0000-0000000000f1',   -- DUPLICATE
              'cccc3000-0000-0000-0000-0000000000f2',
              'cccc3000-0000-0000-0000-0000000000f9']::uuid[],  -- FOREIGN
        'preflight');
  assert (r->>'requested')::int = 4 and (r->>'unique')::int = 3
     and (r->>'applicable')::int = 2 and (r->>'rejected')::int = 1,
    'duplicates are unique-collapsed; only the foreign id is rejected';
  assert position('cccc3000-0000-0000-0000-0000000000f9' in r::text) = 0,
    'foreign Person id never echoed in bulk results';
  ctr := r->>'contract';
  assert ctr is not null, 'preflight issues a checked contract';
  -- apply WITHOUT the preflight contract is rejected
  begin
    perform marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
      array['cccc3000-0000-0000-0000-0000000000f1',
            'cccc3000-0000-0000-0000-0000000000f2']::uuid[], 'apply');
    assert false, 'apply without the preflight contract must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  -- apply with the contract for a DIFFERENT selection is rejected
  begin
    perform marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
      array['cccc3000-0000-0000-0000-0000000000f1']::uuid[], 'apply', ctr);
    assert false, 'apply with a mismatched selection must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  -- apply bound to its preflight (same selection incl. the duplicate/foreign)
  r := marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
        array['cccc3000-0000-0000-0000-0000000000f1',
              'cccc3000-0000-0000-0000-0000000000f1',
              'cccc3000-0000-0000-0000-0000000000f2',
              'cccc3000-0000-0000-0000-0000000000f9']::uuid[],
        'apply', ctr);
  assert (r->>'applied')::int = 2, 'bulk assign applied to the valid People';
  assert r->>'bulk_ref' is not null, 'apply carries a stable bulk-operation reference';
  assert (select count(*) from contact_tag_assignments
           where tag_id = tag and trigger_ref = (r->>'bulk_ref')
             and assigned_by = 'bbbb3000-0000-0000-0000-0000000000f1'
             and source = 'manual') = 2,
    'assignment rows retain actor, source and the bulk reference';
  -- idempotent re-apply (fresh preflight for the same selection)
  r := marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
        array['cccc3000-0000-0000-0000-0000000000f1',
              'cccc3000-0000-0000-0000-0000000000f2']::uuid[], 'preflight');
  r := marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
        array['cccc3000-0000-0000-0000-0000000000f1',
              'cccc3000-0000-0000-0000-0000000000f2']::uuid[], 'apply', r->>'contract');
  assert (r->>'applied')::int = 0 and (r->>'already_assigned')::int = 2,
    'bulk re-apply is idempotent';
  -- bounds enforced
  begin
    perform marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
      (select array_agg(gen_random_uuid()) from generate_series(1, 201)), 'preflight');
    assert false, '>200 People must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- deactivate; deactivating again is a rejected no-op; inactive assignment fails safely
  select * into t from marketing_tags where id = tag;
  perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','deactivate',
    jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at));
  select * into t from marketing_tags where id = tag;
  begin
    perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','deactivate',
      jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at));
    assert false, 'repeat deactivate is a rejected no-op';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','assign', tag,
      array['cccc3000-0000-0000-0000-0000000000f1']::uuid[], 'apply');
    assert false, 'inactive tag assignment must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- history preserved: assignments survive deactivation
  assert (select count(*) from contact_tag_assignments
           where tag_id = tag) = 2, 'assignments preserved after deactivation';
  -- SINGLE-CONTACT parity with bulk/imports: tag_mutate assign can never
  -- resurrect an inactive tag; remove stays legal so historical assignments
  -- can be cleaned up; reactivation restores assignability
  begin
    perform marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','assign',
      jsonb_build_object('tag_id', tag,
                         'person_id', 'cccc3000-0000-0000-0000-0000000000f3'));
    assert false, 'single-contact assignment of an inactive tag must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  assert (select count(*) from contact_tag_assignments where tag_id = tag) = 2,
    'rejected inactive single-contact assign wrote nothing';
  r := marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','remove',
        jsonb_build_object('tag_id', tag,
                           'person_id', 'cccc3000-0000-0000-0000-0000000000f2'));
  assert (r->>'removed')::boolean,
    'a historical assignment is removable while the tag is inactive';
  select * into t from marketing_tags where id = tag;
  perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','reactivate',
    jsonb_build_object('tag_id', tag, 'expected_updated_at', t.updated_at));
  r := marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','assign',
        jsonb_build_object('tag_id', tag,
                           'person_id', 'cccc3000-0000-0000-0000-0000000000f2'));
  assert (r->>'assigned')::boolean,
    'reactivation restores single-contact assignability';
  assert exists (select 1 from audit_logs where action = 'marketing.tag.bulk_assign'),
    'bulk assignment audited';
end $$;

-- ── (5) SEGMENT AST: depth-first + budgeted validation, strict shapes ────────
do $$
declare r jsonb; big jsonb; deep jsonb; i int;
begin
  -- unsupported concepts → clear error (stay Preview)
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"campaign_engagement","value":"opened"}'::jsonb);
    assert false, 'campaign_engagement must be an explicit unsupported error';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"made_up"}'::jsonb);
    assert false, 'unknown field must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"op":"and","children":[]}'::jsonb);
    assert false, 'empty group must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- DEPTH enforced BEFORE descending: a 5+-deep chain is rejected
  deep := '{"field":"search","value":"x"}'::jsonb;
  for i in 1..5 loop
    deep := jsonb_build_object('op', 'not', 'child', deep);
  end loop;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1', deep);
    assert false, 'depth 5 must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- NODE BUDGET enforced DURING traversal: a wide legal-depth tree (111 nodes)
  -- that previously recursed to completion before any count check
  big := jsonb_build_object('op','and','children', (
    select jsonb_agg(jsonb_build_object('op','and','children', (
      select jsonb_agg(jsonb_build_object('field','search','value','x'))
        from generate_series(1,10))))
      from generate_series(1,10)));
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1', big);
    assert false, '>32 nodes must raise 22023 during traversal';
  exception when sqlstate '22023' then null;
  end;
  -- unknown keys rejected at EVERY node level
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"op":"and","children":[{"field":"search","value":"x"}],"sneaky":1}'::jsonb);
    assert false, 'unknown group key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"search","value":"x","sneaky":1}'::jsonb);
    assert false, 'unknown leaf key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- mixed op+field objects rejected
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"op":"and","field":"search","children":[{"field":"search","value":"x"}],"value":"x"}'::jsonb);
    assert false, 'mixed group+leaf node must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- strict JSON scalar types: string "true" is NOT a boolean
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"last_contact","never":"true"}'::jsonb);
    assert false, 'string "true" for never must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"search","value":5}'::jsonb);
    assert false, 'numeric search value must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"company","value":5}'::jsonb);
    assert false, 'numeric company value must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- reversed date ranges rejected
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"created","from":"2026-02-01T00:00:00Z","to":"2026-01-01T00:00:00Z"}'::jsonb);
    assert false, 'reversed created range must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"last_contact","from":"2026-02-01T00:00:00Z","to":"2026-01-01T00:00:00Z"}'::jsonb);
    assert false, 'reversed last_contact range must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- duplicate tag ids rejected (would silently break "all" semantics)
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      jsonb_build_object('field','tag','mode','all','tag_ids', jsonb_build_array(
        (select id from marketing_tags where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' limit 1),
        (select id from marketing_tags where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' limit 1))));
    assert false, 'duplicate tag ids must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- foreign tag id rejected without evidence
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      jsonb_build_object('field','tag','mode','any','tag_ids',
        jsonb_build_array(gen_random_uuid())));
    assert false, 'unknown tag must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- relationship vocabularies validated
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"relationship","match":{"sneaky":"x"}}'::jsonb);
    assert false, 'unknown relationship predicate must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
      '{"field":"relationship","match":{"type":"nonsense_type"}}'::jsonb);
    assert false, 'unknown relationship type must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- the AD-HOC evaluation path applies the SAME limits (no bypass)
  begin
    perform marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', jsonb_build_object('definition', big));
    assert false, 'ad-hoc oversized definition must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1', jsonb_build_object('definition', deep));
    assert false, 'ad-hoc over-deep definition must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- a valid nested composite validates
  r := to_jsonb(marketing_segment_validate('aaaa3000-0000-0000-0000-0000000000f1',
    '{"op":"and","children":[
       {"field":"search","value":"ada"},
       {"op":"not","child":{"field":"eligibility","channel":"email","value":"suppressed"}}
     ]}'::jsonb));
  assert (r::text)::int >= 3, 'composite AST validates with node count';
end $$;

-- ── (6) SEGMENTS: evaluation, versions, status concurrency, cursors ─────────
do $$
declare r jsonb; seg jsonb; segid uuid; tag uuid; s record; p1 uuid;
begin
  select id into tag from marketing_tags
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and key='bulk_probe';

  -- search
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"search","value":"ada"}}'::jsonb);
  assert (r->>'count')::int = 1, 'search filter evaluates';
  assert r->>'evaluated_at' is null and not (r->>'stored')::boolean,
    'ad-hoc evaluation stores nothing and says so';
  -- relationship SINGLE-ROW: customer+won was remapped to nurture in (2)
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"relationship","match":{"type":"customer","lifecycle":"nurture","status":"active"}}}'::jsonb);
  assert (r->>'count')::int = 1, 'relationship composite matches one row';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"relationship","match":{"type":"customer","lifecycle":"engaged"}}}'::jsonb);
  assert (r->>'count')::int = 0,
    'single-row semantics: predicates can never be satisfied by different rows';
  -- company + created + last_contact + tags + eligibility + composition
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        jsonb_build_object('definition', jsonb_build_object(
          'field','company','value','dddd3000-0000-0000-0000-0000000000f1')));
  assert (r->>'count')::int = 1, 'company filter evaluates';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"created","from":"2000-01-01T00:00:00Z"}}'::jsonb);
  assert (r->>'count')::int = 4, 'created range covers the tenant people';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"last_contact","from":"2000-01-01T00:00:00Z"}}'::jsonb);
  assert (r->>'count')::int = 1, 'last_contact range finds the contacted person';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"last_contact","never":true}}'::jsonb);
  assert (r->>'count')::int = 3, 'never-contacted evaluates';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        jsonb_build_object('definition', jsonb_build_object(
          'field','tag','mode','any','tag_ids', jsonb_build_array(tag))));
  assert (r->>'count')::int = 2, 'tag any evaluates';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        jsonb_build_object('definition', jsonb_build_object(
          'field','tag','mode','none','tag_ids', jsonb_build_array(tag))));
  assert (r->>'count')::int = 2, 'tag none evaluates tenant-safely';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"eligibility","channel":"email","value":"no_contact_point"}}'::jsonb);
  assert (r->>'count')::int = 1, 'eligibility filter delegates to the canonical fn';
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"op":"or","children":[
            {"field":"search","value":"ada"},{"field":"search","value":"ben"}]}}'::jsonb);
  assert (r->>'count')::int = 2, 'or composition evaluates';

  -- STRICT typed cursor + next_cursor
  begin
    perform marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1',
      '{"definition":{"field":"created","from":"2000-01-01T00:00:00Z"},"cursor":{"v":1,"id":"x"}}'::jsonb);
    assert false, 'malformed cursor must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        '{"definition":{"field":"created","from":"2000-01-01T00:00:00Z"},"limit":1}'::jsonb);
  assert r->'next_cursor' is not null and jsonb_typeof(r->'next_cursor') = 'object',
    'full page returns next_cursor';
  p1 := (r->'items'->0->>'person_id')::uuid;
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        jsonb_build_object(
          'definition', '{"field":"created","from":"2000-01-01T00:00:00Z"}'::jsonb,
          'limit', 1, 'cursor', r->'next_cursor'));
  assert (r->'items'->0->>'person_id')::uuid is distinct from p1,
    'cursor advances without repeating the boundary row';

  -- ── lifecycle: create → immutable version → stale/no-op update → race ──
  seg := marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
          'bbbb3000-0000-0000-0000-0000000000f1','create',
          '{"name":"Never contacted","definition":{"field":"last_contact","never":true}}'::jsonb);
  segid := (seg->>'id')::uuid;
  assert (seg->>'definition_version')::int = 1, 'segment starts at v1';
  assert (select count(*) from marketing_segment_versions
           where segment_id = segid) = 1, 'v1 version record written';
  -- stale update → MK409
  begin
    perform marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','update',
      jsonb_build_object('segment_id', segid, 'expected_version', 99, 'name', 'X'));
    assert false, 'stale segment update must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  -- EXACT repeat update is a rejected no-op (no misleading version/audit)
  begin
    perform marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','update',
      jsonb_build_object('segment_id', segid, 'expected_version', 1,
        'name', 'Never contacted',
        'definition', '{"field":"last_contact","never":true}'::jsonb));
    assert false, 'identical update must be rejected as a no-op';
  exception when sqlstate '22023' then null;
  end;
  assert (select count(*) from marketing_segment_versions where segment_id = segid) = 1,
    'rejected no-op minted no version record';
  -- saved evaluation captures the version; store lands on the SAME version
  r := marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1',
        jsonb_build_object('segment_id', segid));
  assert (r->>'stored')::boolean and (r->>'segment_version')::int = 1
     and r->>'evaluated_at' is not null,
    'saved evaluation stored against its captured version';
  assert (select estimated_count from marketing_segments where id = segid) = 3,
    'evaluated count persisted';
  assert (select evaluated_at from marketing_segments where id = segid) is not null,
    'the returned timestamp is the ACTUAL stored timestamp';
  -- definition change bumps version + clears the stale count
  seg := marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
          'bbbb3000-0000-0000-0000-0000000000f1','update',
          jsonb_build_object('segment_id', segid, 'expected_version', 1,
            'definition', '{"field":"search","value":"ada"}'::jsonb));
  assert (seg->>'definition_version')::int = 2
     and (seg->>'estimated_count') is null,
    'definition change bumps version and clears the stale count';
  assert (select count(*) from marketing_segment_versions where segment_id = segid) = 2,
    'every accepted definition is an immutable version record';
  -- SAVED-EVALUATION VERSION RACE: an evaluation pinned to the superseded
  -- version conflicts and leaves the stored count untouched
  begin
    perform marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1',
      jsonb_build_object('segment_id', segid, 'expected_version', 1));
    assert false, 'stale expected_version must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  assert (select estimated_count from marketing_segments where id = segid) is null,
    'conflicted evaluation left the stored count untouched';
  -- version rows immutable
  begin
    update marketing_segment_versions set name = 'tamper' where segment_id = segid;
    assert false, 'segment versions must be immutable';
  exception when others then null;
  end;

  -- ARCHIVE/REACTIVATE: observable concurrency token + no-op rejection
  select * into s from marketing_segments where id = segid;
  begin
    perform marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','archive',
      jsonb_build_object('segment_id', segid,
                         'expected_updated_at', s.updated_at - interval '1 minute'));
    assert false, 'stale archive token must raise MK409';
  exception when sqlstate 'MK409' then null;
  end;
  perform marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','archive',
    jsonb_build_object('segment_id', segid, 'expected_updated_at', s.updated_at));
  assert (select status from marketing_segments where id = segid) = 'archived', 'archived';
  select * into s from marketing_segments where id = segid;
  begin
    perform marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f1','archive',
      jsonb_build_object('segment_id', segid, 'expected_updated_at', s.updated_at));
    assert false, 'repeat archive is a rejected no-op';
  exception when sqlstate '22023' then null;
  end;
  perform marketing_segment_mutate('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','reactivate',
    jsonb_build_object('segment_id', segid, 'expected_updated_at', s.updated_at));
  assert (select status from marketing_segments where id = segid) = 'active', 'reactivated';
end $$;

-- ── (7) IMPORTS: sealed contract, converged evidence, durable outcomes ───────
do $$
declare imp uuid; imp2 uuid; r jsonb; n int; nia uuid; conflict uuid;
        tag2 uuid; opts jsonb; opts2 jsonb;
begin
  assert exists (select 1 from import_profiles
                  where tenant_id is null and source_system='generic'
                    and entity_type='contacts'),
    'platform generic/contacts profile seeded';

  -- an active tag for sealed options
  r := marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','create','{"label":"Import Tag"}');
  tag2 := (r->>'id')::uuid;

  -- SEALED options carry the EXPLICIT resolved defaults (never live settings)
  opts := '{"source":"csv_upload","lifecycle_stage_key":"new_lead","relationship_type":"lead"}'::jsonb;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'deadbeef', 20,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts)))
  returning id into imp;

  -- sealed defaults are MANDATORY: an import sealed without them (a legacy or
  -- tampered contract) demands a NEW preview — never a live-settings fallback
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'nodefaults', 5,
          jsonb_build_object('sealed', jsonb_build_object('contact_options',
            '{"source":"csv_upload"}'::jsonb)))
  returning id into imp2;
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp2,
      'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":"X"}'::jsonb, '{"source":"csv_upload"}'::jsonb);
    assert false, 'sealed options without resolved defaults must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  -- ── STRUCTURAL validation of the row RPC ──
  -- foreign import id: rejected with no evidence
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1',
      gen_random_uuid(), 'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":"X"}'::jsonb, opts);
    assert false, 'unknown/foreign import must raise P0002';
  exception when no_data_found or sqlstate 'P0002' then null;
  end;
  -- options that do not match the SEALED contract are rejected
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":"X"}'::jsonb, '{"source":"other_source"}'::jsonb);
    assert false, 'unsealed options must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- row number outside the sealed file is rejected
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 99,
      '{"display_name":"X"}'::jsonb, opts);
    assert false, 'row number outside the import must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- unknown record keys / malformed scalar types are rejected
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":"X","sneaky_key":"y"}'::jsonb, opts);
    assert false, 'unknown record key must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":["array"]}'::jsonb, opts);
    assert false, 'non-string record value must raise 22023';
  exception when sqlstate '22023' then null;
  end;

  -- ── preview matcher = apply decision (shared validation + convergence) ──
  r := marketing_import_match_contact('aaaa3000-0000-0000-0000-0000000000f1',
        '{"primary_email":"ADA@p3.test","display_name":"Ada M","__source":"csv_upload"}'::jsonb);
  assert r->>'action' = 'matched' and r->>'strategy' = 'email', 'preview matcher matches by email';
  r := marketing_import_match_contact('aaaa3000-0000-0000-0000-0000000000f1',
        '{"display_name":"Totally New"}'::jsonb);
  assert r->>'action' = 'new', 'name-only never matches';
  -- an INVALID row-supplied lifecycle is classified invalid in PREVIEW too
  r := marketing_import_match_contact('aaaa3000-0000-0000-0000-0000000000f1',
        '{"display_name":"Bad Stage","lifecycle_stage":"No Such Stage"}'::jsonb);
  assert r->>'action' = 'invalid', 'preview classifies an unknown lifecycle as INVALID';

  -- row 2: strong match — fills BLANKS only, conflicts recorded for differing
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 2,
        '{"primary_email":"ada@p3.test","display_name":"Ada DIFFERENT","postcode":"AB1 2CD"}'::jsonb,
        opts);
  assert r->>'action' = 'conflict' and (r->>'field_conflicts')::int = 1,
    'differing display name is a recorded conflict, never a clobber';
  assert (select display_name from people where id='cccc3000-0000-0000-0000-0000000000f1')
         = 'Ada Match', 'existing value never overwritten';
  assert (select postcode from people where id='cccc3000-0000-0000-0000-0000000000f1')
         = 'AB1 2CD', 'blank field filled';
  assert exists (select 1 from marketing_import_row_results
                  where import_id = imp and row_number = 2 and outcome = 'conflict'),
    'durable row outcome recorded';
  -- idempotent per-row retry
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 2,
        '{"primary_email":"ada@p3.test","display_name":"Ada DIFFERENT"}'::jsonb, opts);
  assert r->>'action' = 'already_applied', 'per-row retry is idempotent';

  -- row 3: NEW person with points, relationship, tag through a SEALED options
  -- import (row supplies nothing → sealed defaults apply)
  opts2 := jsonb_build_object('source', 'csv_upload',
             'lifecycle_stage_key', 'engaged', 'relationship_type', 'prospect',
             'tag_id', tag2);
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'cafebabe', 20,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts2)))
  returning id into imp2;
  select count(*) into n from people where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp2,
        'bbbb3000-0000-0000-0000-0000000000f1', 3,
        '{"display_name":"Nia New","primary_email":"nia@p3.test","primary_phone":"07700 900321","company_name":"P3 Co"}'::jsonb,
        opts2);
  assert r->>'action' = 'created', 'new canonical person created';
  nia := (r->>'person_id')::uuid;
  assert (select count(*) from people
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = n + 1, 'one person added';
  assert (select count(*) from contact_points where person_id = nia) = 2,
    'canonical contact points created for email + phone';
  assert (select count(*) from contact_points where person_id = nia and is_primary) = 2,
    'primaries assigned when none existed';
  assert exists (select 1 from contact_relationships
                  where person_id = nia
                    and relationship_type='prospect' and lifecycle_stage_key='engaged'
                    and source='import'), 'relationship created with sealed defaults';
  assert exists (select 1 from contact_tag_assignments
                  where person_id = nia and source='import'),
    'import tag through the canonical assignment table';
  assert exists (select 1 from import_row_provenance
                  where import_id = imp2 and source_row_number = 3 and action='created'),
    'provenance recorded';
  assert (select company_id from people where id = nia) = 'dddd3000-0000-0000-0000-0000000000f1',
    'single exact-name company linked (no duplicate created)';
  -- RE-RUNNING the same row cannot duplicate the person (partial-retry safety)
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp2,
        'bbbb3000-0000-0000-0000-0000000000f1', 3,
        '{"display_name":"Nia New","primary_email":"nia@p3.test"}'::jsonb, opts2);
  assert r->>'action' = 'already_applied'
     and (select count(*) from people
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = n + 1,
    'partial retry never duplicates a Person';

  -- row 4: existing ACTIVE classification is never overwritten by defaults
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 4,
        '{"primary_email":"cara@p3.test","display_name":"Cara Classified"}'::jsonb, opts);
  assert (select relationship_type from contact_relationships
           where id='abcd3000-0000-0000-0000-0000000000f1') = 'customer',
    'import defaults never overwrite an established classification';

  -- ── (7b) EVIDENCE CONVERGENCE — the hardened identity contract ──
  -- email→Ada AND phone→Nia: CONFLICTING identifiers → ONE conflict, ZERO mutation
  select count(*) into n from people where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 5,
        '{"display_name":"Split Row","primary_email":"ada@p3.test","primary_phone":"07700900321"}'::jsonb,
        opts);
  assert r->>'action' = 'conflict',
    'email→A + phone→B must be a conflict, never a silent selection of A';
  conflict := (r->>'conflict_id')::uuid;
  assert (select count(*) from people
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = n, 'no person mutation';
  assert not exists (select 1 from contact_points
                      where person_id='cccc3000-0000-0000-0000-0000000000f1'
                        and channel='phone' and normalized_value='07700900321'),
    'the other person''s phone was NOT attached to the email match';
  -- evidence entries carry their OWN channel/value (never mislabelled)
  assert exists (select 1 from marketing_identity_conflicts c,
                        jsonb_array_elements(c.identifiers) e
                  where c.id = conflict
                    and e->>'channel' = 'email' and e->>'value' = 'ada@p3.test'),
    'email evidence labelled email with the email value';
  assert exists (select 1 from marketing_identity_conflicts c,
                        jsonb_array_elements(c.identifiers) e
                  where c.id = conflict
                    and e->>'channel' = 'phone' and e->>'value' = '07700900321'),
    'phone evidence labelled phone with the phone value';
  assert (select array_length(candidate_person_ids, 1)
            from marketing_identity_conflicts where id = conflict) = 2,
    'candidate union bounded and tenant-joined';

  -- external id→(seeded person) AND email→Ada: conflicting — external id can
  -- never silently outrank a disagreeing email
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 6,
        '{"display_name":"Ext Seed","external_id":"EXT-9","primary_email":"ext9@p3.test"}'::jsonb,
        opts);
  assert r->>'action' = 'created', 'external-id seed person created';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 7,
        '{"display_name":"Ext Split","external_id":"EXT-9","primary_email":"ada@p3.test"}'::jsonb,
        opts);
  assert r->>'action' = 'conflict',
    'external→A + email→B must be a conflict, never first-match-wins';

  -- one AMBIGUOUS identifier + one UNIQUE identifier → conflict, no merge
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value) values
    ('aaaa3000-0000-0000-0000-0000000000f1','cccc3000-0000-0000-0000-0000000000f1','email','shared@p3.test','shared@p3.test'),
    ('aaaa3000-0000-0000-0000-0000000000f1','cccc3000-0000-0000-0000-0000000000f2','email','shared@p3.test','shared@p3.test');
  select count(*) into n from people where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 8,
        '{"display_name":"Shared Row","primary_email":"shared@p3.test","primary_phone":"+441111000001"}'::jsonb,
        opts);
  assert r->>'action' = 'conflict',
    'ambiguous email + unique phone is a conflict — the unique identifier never wins alone';
  assert (select count(*) from people
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = n,
    'no person created for an ambiguous row';
  assert exists (select 1 from import_row_provenance
                  where import_id = imp and source_row_number = 8
                    and entity_table='marketing_identity_conflicts'),
    'conflict row keeps provenance';

  -- INVALID endpoint evidence respected: Dave's email endpoint is marked
  -- invalid, so the same value is NOT usable match evidence → safe new person
  insert into contact_points (tenant_id, person_id, channel, value, normalized_value, verification_state)
  values ('aaaa3000-0000-0000-0000-0000000000f1','cccc3000-0000-0000-0000-0000000000f4',
          'email','dave@p3.test','dave@p3.test','invalid');
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 9,
        '{"display_name":"Dave Two","primary_email":"dave@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'created'
     and (r->>'person_id')::uuid <> 'cccc3000-0000-0000-0000-0000000000f4',
    'an explicitly-invalid endpoint is never match evidence';

  -- SECONDARY identifiers resolved independently: secondary_email → Ada
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 10,
        '{"display_name":"Ada Match","secondary_email":"ada@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'updated' and (r->>'person_id')::uuid = 'cccc3000-0000-0000-0000-0000000000f1',
    'secondary email is independent strong evidence';

  -- INVALID row values are honest outcomes, never silent defaults
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 11,
        '{"display_name":"Bad Stage","lifecycle_stage":"No Such Stage"}'::jsonb, opts);
  assert r->>'action' = 'invalid', 'unknown row lifecycle is an INVALID outcome';
  assert (select fields from marketing_import_row_results
           where import_id = imp and row_number = 11) = array['lifecycle_stage'],
    'invalid outcome names the offending field';
  assert not exists (select 1 from people
                      where tenant_id='aaaa3000-0000-0000-0000-0000000000f1'
                        and display_name='Bad Stage'),
    'no person created with a silently-defaulted stage';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 12,
        '{"display_name":"Bad Type","relationship_type":"nonsense"}'::jsonb, opts);
  assert r->>'action' = 'invalid', 'unknown row relationship type is an INVALID outcome';

  -- CONFLICTING company evidence: matched person already linked elsewhere
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 13,
        '{"primary_email":"ada@p3.test","company_name":"Somewhere Else Ltd"}'::jsonb, opts);
  assert r->>'action' = 'conflict', 'differing company for a linked person is conflict evidence';
  assert not exists (select 1 from companies
                      where tenant_id='aaaa3000-0000-0000-0000-0000000000f1'
                        and name='Somewhere Else Ltd'),
    'NO orphan company created for a person that will not be linked';
  -- ambiguous company name (two exact matches) → person created, NO guess
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 14,
        '{"display_name":"Dup Co Person","primary_email":"dup@p3.test","company_name":"Dup Co"}'::jsonb,
        opts);
  assert r->>'action' = 'created'
     and (select company_id from people where id = (r->>'person_id')::uuid) is null,
    'name-only company ambiguity never merges — no link, evidence only';

  -- VERIFIED person identity fields protected
  update people set verified = true where id='cccc3000-0000-0000-0000-0000000000f3';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 15,
        '{"primary_email":"cara@p3.test","display_name":"Cara Overwrite","primary_phone":"07700 900999"}'::jsonb,
        opts);
  assert (select display_name from people where id='cccc3000-0000-0000-0000-0000000000f3')
         = 'Cara Classified', 'verified identity never overwritten';
  assert (select primary_phone from people where id='cccc3000-0000-0000-0000-0000000000f3')
         = '07700 900999', 'blank on a verified person may still be filled';
  update people set verified = false where id='cccc3000-0000-0000-0000-0000000000f3';

  -- nothing-usable row → durable invalid outcome
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 16, '{}'::jsonb, opts);
  assert r->>'action' = 'invalid', 'unusable row reported invalid, not created';
  assert exists (select 1 from marketing_import_row_results
                  where import_id = imp and row_number = 16 and outcome = 'invalid'),
    'EVERY row leaves a durable outcome — including invalid ones';
end $$;

-- ── (7c) IMPORT STATE MACHINE: durable outcomes, retry, cumulative counts ────
do $$
declare imp uuid; r jsonb; opts jsonb;
begin
  opts := '{"source":"csv_upload","lifecycle_stage_key":"new_lead","relationship_type":"lead"}'::jsonb;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'importing', 'feedface', 3,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts)))
  returning id into imp;

  -- row 2 applies; row 3 fails transiently (recorded by the edge as 'failed');
  -- row 4 is invalid
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 2,
        '{"display_name":"SM Row One","primary_email":"sm1@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'created', 'row 2 created';
  insert into marketing_import_row_results (tenant_id, import_id, row_number, outcome, reason)
  values ('aaaa3000-0000-0000-0000-0000000000f1', imp, 3, 'failed', 'transient row apply failure');
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 4, '{}'::jsonb, opts);
  assert r->>'action' = 'invalid', 'row 4 invalid';

  -- FINALISE: a retryable failure means the import is NOT completed
  r := marketing_import_finalize('aaaa3000-0000-0000-0000-0000000000f1', imp);
  assert r->>'status' = 'failed', 'a retryable row failure leaves the import retryable';
  assert (select status from data_imports where id = imp) = 'failed'
     and (select created_records from data_imports where id = imp) = 1
     and (select invalid_rows from data_imports where id = imp) = 1
     and (select completed_at from data_imports where id = imp) is null,
    'failed finalisation records durable counts without completing';

  -- RETRY processes ONLY the failed row; terminal rows stay idempotent
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 2,
        '{"display_name":"SM Row One","primary_email":"sm1@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'already_applied', 'terminal row is never re-applied on retry';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 3,
        '{"display_name":"SM Row Two","primary_email":"sm2@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'created', 'failed row reprocessed on retry';
  assert (select attempt from marketing_import_row_results
           where import_id = imp and row_number = 3) = 2,
    'retry recorded as a second attempt on the durable outcome';

  -- FINALISE again: cumulative counts SURVIVE the partial retry
  r := marketing_import_finalize('aaaa3000-0000-0000-0000-0000000000f1', imp);
  assert r->>'status' = 'completed', 'no retryable failures → completed';
  assert (select created_records from data_imports where id = imp) = 2
     and (select invalid_rows from data_imports where id = imp) = 1
     and (select skipped_records from data_imports where id = imp) = 0
     and (select completed_at from data_imports where id = imp) is not null,
    'cumulative totals computed from durable outcomes, never one invocation';

  -- COMPLETED import: further row applies and finalisation are idempotent/rejected
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":"SM Row One"}'::jsonb, opts);
    assert false, 'completed import must reject further row applies';
  exception when sqlstate '22023' then null;
  end;
  r := marketing_import_finalize('aaaa3000-0000-0000-0000-0000000000f1', imp);
  assert (r->>'already')::boolean, 'completed finalisation is idempotent';

  -- sealed-contract absence is rejected (a legacy/tampered import row)
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum, row_count)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'noseal', 3)
  returning id into imp;
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":"X"}'::jsonb, opts);
    assert false, 'an import without a sealed contract must require a new preview';
  exception when sqlstate '22023' then null;
  end;
  -- sealed FOREIGN tag id is rejected even when options match the seal
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'foreigntag', 3,
          jsonb_build_object('sealed', jsonb_build_object('contact_options',
            jsonb_build_object('source', 'csv_upload',
              'lifecycle_stage_key', 'new_lead', 'relationship_type', 'lead',
              'tag_id', gen_random_uuid()))))
  returning id into imp;
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2,
      '{"display_name":"X"}'::jsonb,
      (select preview->'sealed'->'contact_options' from data_imports where id = imp));
    assert false, 'a sealed foreign/unknown tag must raise 22023';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (7d) SEALED DEFAULTS ARE THE TRUTH: live settings can never leak in ─────
do $$
declare imp uuid; r jsonb; opts jsonb; v int; tag uuid; s record; stage_id uuid;
begin
  -- seal an import while the tenant default is 'qualified' (set in §2), with
  -- EXPLICIT resolved defaults new_lead/lead
  opts := '{"source":"csv_upload","lifecycle_stage_key":"new_lead","relationship_type":"lead"}'::jsonb;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'sealdefaults', 5,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts)))
  returning id into imp;
  -- CHANGE the tenant defaults AFTER preview
  select version into v from marketing_settings
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1',
    '{"default_relationship_type":"prospect","default_lifecycle_stage_key":"engaged"}'::jsonb, v);
  -- a row supplying nothing still receives the SEALED defaults, not the new
  -- live settings
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 2,
        '{"display_name":"Sealed Default Person","primary_email":"sealed.default@p3.test"}'::jsonb,
        opts);
  assert r->>'action' = 'created', 'row applied';
  assert exists (select 1 from contact_relationships cr
                  where cr.person_id = (r->>'person_id')::uuid
                    and cr.relationship_type = 'lead'
                    and cr.lifecycle_stage_key = 'new_lead'),
    'apply used the SEALED defaults — changing settings after preview changed nothing';
  -- ── REGRESSION LOCK (permission capture, migration 20260910120000): being
  --    imported NEVER subscribes anyone. An imported person has ZERO
  --    preference facts and stays 'unknown' (excluded from campaigns) until a
  --    genuine permission decision is recorded through the governed path. ──
  assert not exists (select 1 from communication_preferences pr
                      where pr.tenant_id = 'aaaa3000-0000-0000-0000-0000000000f1'
                        and pr.person_id = (r->>'person_id')::uuid),
    'IMPORT LOCK: importing a contact writes NO communication_preferences row';
  assert marketing_contact_eligibility('aaaa3000-0000-0000-0000-0000000000f1',
           (r->>'person_id')::uuid, 'email') = 'unknown',
    'IMPORT LOCK: an imported contact is NOT eligible until real permission is recorded';

  -- a SEALED stage that is later retired demands a NEW preview (22023), never
  -- a retryable row failure
  select id into stage_id from marketing_lifecycle_stages
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and stage_key='contact_attempted';
  opts := '{"source":"csv_upload","lifecycle_stage_key":"contact_attempted","relationship_type":"lead"}'::jsonb;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'sealretired', 5,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts)))
  returning id into imp;
  select * into s from marketing_lifecycle_stages where id = stage_id;
  perform marketing_lifecycle_admin('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','retire',
    jsonb_build_object('stage_id', stage_id, 'expected_updated_at', s.updated_at));
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2, '{"display_name":"X"}'::jsonb, opts);
    assert false, 'a retired sealed stage must raise 22023 (new preview required)';
  exception when sqlstate '22023' then null;
  end;
  assert not exists (select 1 from marketing_import_row_results
                      where import_id = imp and row_number = 2),
    'an unhonourable sealed contract never writes a failed row outcome';

  -- a SEALED tag that is later deactivated demands a NEW preview too
  r := marketing_tag_mutate('aaaa3000-0000-0000-0000-0000000000f1',
        'bbbb3000-0000-0000-0000-0000000000f1','create','{"label":"Seal Probe Tag"}');
  tag := (r->>'id')::uuid;
  opts := jsonb_build_object('source', 'csv_upload',
    'lifecycle_stage_key', 'new_lead', 'relationship_type', 'lead', 'tag_id', tag);
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'previewed', 'sealtag', 5,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts)))
  returning id into imp;
  select * into s from marketing_tags where id = tag;
  perform marketing_tag_admin('aaaa3000-0000-0000-0000-0000000000f1',
    'bbbb3000-0000-0000-0000-0000000000f1','deactivate',
    jsonb_build_object('tag_id', tag, 'expected_updated_at', s.updated_at));
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
      'bbbb3000-0000-0000-0000-0000000000f1', 2, '{"display_name":"X"}'::jsonb, opts);
    assert false, 'a deactivated sealed tag must raise 22023 (new preview required)';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- ── (7e) GOVERNED ROW LEDGER: no downgrades, repair, name collisions ────────
do $$
declare imp uuid; r jsonb; opts jsonb; n int; person uuid;
begin
  opts := '{"source":"csv_upload","lifecycle_stage_key":"new_lead","relationship_type":"lead"}'::jsonb;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'importing', 'ledgerproof', 5,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts)))
  returning id into imp;

  -- terminal result, then a LATE failed-marker attempt: the terminal outcome
  -- is authoritative and is NEVER downgraded
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 2,
        '{"display_name":"Ledger One","primary_email":"ledger1@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'created', 'row 2 created';
  person := (r->>'person_id')::uuid;
  r := marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 2,
        'failed', 'late failure marker');
  assert (r->>'already')::boolean and r->>'outcome' = 'created',
    'late failed-marker returns the authoritative terminal outcome';
  assert (select outcome from marketing_import_row_results
           where import_id = imp and row_number = 2) = 'created',
    'terminal outcome never downgraded to failed';
  -- direct downgrade attempts are structurally blocked too
  begin
    update marketing_import_row_results set outcome = 'failed'
     where import_id = imp and row_number = 2;
    assert false, 'terminal row update must be blocked';
  exception when others then null;
  end;
  -- the recorder accepts ONLY invalid|failed (terminal applies come from the
  -- row RPC alone)
  begin
    perform marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 3,
      'created', 'smuggled terminal');
    assert false, 'recorder must reject terminal outcomes';
  exception when sqlstate '22023' then null;
  end;
  -- deterministic mapping-invalid rows are TERMINAL invalid via the recorder
  r := marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 3,
        'invalid', 'row failed column validation', array['primary_email']);
  assert r->>'outcome' = 'invalid', 'mapping-invalid recorded';
  r := marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 3,
        'failed', 'late failure marker');
  assert (r->>'already')::boolean and r->>'outcome' = 'invalid',
    'invalid is terminal for the recorder too';

  -- PROVENANCE-WITH-MISSING-LEDGER recovery: if the durable row vanishes, the
  -- next apply REPAIRS it deterministically instead of stranding the import
  delete from marketing_import_row_results where import_id = imp and row_number = 2;
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 2,
        '{"display_name":"Ledger One","primary_email":"ledger1@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'already_applied' and (r->>'repaired')::boolean,
    'missing ledger row repaired from provenance';
  assert (select outcome from marketing_import_row_results
           where import_id = imp and row_number = 2) = 'created'
     and (select entity_id from marketing_import_row_results
           where import_id = imp and row_number = 2) = person,
    'reconstructed ledger row carries the correct outcome and entity';
  r := marketing_import_finalize('aaaa3000-0000-0000-0000-0000000000f1', imp);
  assert (r->>'created')::int = 1 and (r->>'invalid')::int = 1,
    'repaired ledger finalises with the true cumulative counts';

  -- NAME-ONLY COLLISION: a normalized name matching existing People routes to
  -- bounded review (conflict) with ZERO automatic merge — preview and apply
  -- classify identically; a genuinely new name still creates
  r := marketing_import_match_contact('aaaa3000-0000-0000-0000-0000000000f1',
        '{"display_name":"  ledger one ","__source":"csv_upload"}'::jsonb);
  assert r->>'action' = 'probable' and r->>'strategy' = 'name_collision',
    'preview classifies a name-only collision as reviewable';
  select count(*) into n from people where tenant_id='aaaa3000-0000-0000-0000-0000000000f1';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 4,
        '{"display_name":"  ledger one "}'::jsonb, opts);
  assert r->>'action' = 'conflict', 'apply routes the name collision to review';
  assert (select count(*) from people
           where tenant_id='aaaa3000-0000-0000-0000-0000000000f1') = n,
    'zero automatic merge or creation on a name collision';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 5,
        '{"display_name":"Genuinely Unseen Name"}'::jsonb, opts);
  assert r->>'action' = 'created',
    'no candidate evidence at all still creates a new Person';

  -- FULL STABLE FINALISATION CONTRACT for a COMPLETED import: complete the
  -- remaining row, finalize, then finalize again — same complete shape
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 6,
        '{"display_name":"Ledger Last","primary_email":"ledger6@p3.test"}'::jsonb, opts);
  r := marketing_import_finalize('aaaa3000-0000-0000-0000-0000000000f1', imp);
  assert r->>'status' = 'completed' and not (r->>'already')::boolean, 'completed';
  r := marketing_import_finalize('aaaa3000-0000-0000-0000-0000000000f1', imp);
  assert (r->>'already')::boolean
     and (r->>'created')::int = 3 and (r->>'invalid')::int = 1
     and (r->>'conflicts')::int = 1 and (r->>'failed')::int = 0
     and (r->>'unprocessed')::int = 0
     and (r->'import'->>'status') = 'completed',
    'already-completed finalisation returns the SAME complete totals/import shape';
end $$;

-- ── (7f) ROW-RESULTS STRUCTURAL TENANT BINDING ──────────────────────────────
do $$
declare imp1 uuid; imp2 uuid; conf2 uuid;
begin
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum, row_count)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'importing', 'bindproof1', 3)
  returning id into imp1;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum, row_count)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f2', 'csv_upload', 'contacts',
          'importing', 'bindproof2', 3)
  returning id into imp2;
  insert into marketing_identity_conflicts (tenant_id, identifiers, candidate_person_ids)
  values ('aaaa3000-0000-0000-0000-0000000000f2', '[]'::jsonb,
          array['cccc3000-0000-0000-0000-0000000000f9']::uuid[])
  returning id into conf2;

  -- tenant A + tenant B's import: STRUCTURALLY impossible
  begin
    insert into marketing_import_row_results (tenant_id, import_id, row_number, outcome, reason)
    values ('aaaa3000-0000-0000-0000-0000000000f1', imp2, 2, 'failed', 'x');
    assert false, 'cross-tenant import reference must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  -- tenant A + tenant B's conflict: impossible
  begin
    insert into marketing_import_row_results
      (tenant_id, import_id, row_number, outcome, reason, conflict_id)
    values ('aaaa3000-0000-0000-0000-0000000000f1', imp1, 2, 'conflict', 'x', conf2);
    assert false, 'cross-tenant conflict reference must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  -- tenant A + tenant B's person: impossible
  begin
    insert into marketing_import_row_results
      (tenant_id, import_id, row_number, outcome, reason, entity_id)
    values ('aaaa3000-0000-0000-0000-0000000000f1', imp1, 2, 'created', 'x',
            'cccc3000-0000-0000-0000-0000000000f9');
    assert false, 'cross-tenant person reference must violate the composite FK';
  exception when foreign_key_violation then null;
  end;
  -- same-tenant combination remains valid
  insert into marketing_import_row_results (tenant_id, import_id, row_number, outcome, reason)
  values ('aaaa3000-0000-0000-0000-0000000000f1', imp1, 2, 'failed', 'ok');
  -- no client role can delete/truncate the ledger
  assert not has_table_privilege('authenticated', 'marketing_import_row_results', 'delete')
     and not has_table_privilege('service_role', 'marketing_import_row_results', 'delete')
     and not has_table_privilege('service_role', 'marketing_import_row_results', 'truncate'),
    'row-results delete/truncate revoked from client roles';
end $$;

-- ── (7g) ROW-RESULTS TRANSITION GUARD: pinned lineage, counted retries ──────
-- The guard is STRUCTURAL: it cannot know its caller (a trigger cannot
-- distinguish a governed RPC from a direct service-role update) — what it
-- proves here is that NO update of any origin can move a row's identity or
-- lineage, skip the attempt counter, or rewrite a terminal outcome.
do $$
declare imp uuid; imp2 uuid; fimp uuid; timp uuid; opts jsonb; r jsonb;
        rid uuid; p_upd uuid; src text;
begin
  opts := '{"source":"csv_upload","lifecycle_stage_key":"new_lead","relationship_type":"lead"}'::jsonb;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum,
                            row_count, preview)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'importing', 'guardproof', 9,
          jsonb_build_object('sealed', jsonb_build_object('contact_options', opts)))
  returning id into imp;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum, row_count)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1', 'csv_upload', 'contacts',
          'importing', 'guardproof2', 3)
  returning id into imp2;
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum, row_count)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f2', 'csv_upload', 'contacts',
          'importing', 'guardproofF', 3)
  returning id into fimp;

  -- a retryable failed row, exactly as the governed recorder writes it
  r := marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 2,
        'failed', 'transient row apply failure');
  assert (r->>'attempt')::int = 1, 'first failure recorded as attempt 1';
  select id into rid from marketing_import_row_results
   where import_id = imp and row_number = 2;

  -- ADVERSARIAL: a retry-shaped update cannot MOVE the row — not to another
  -- import of the same tenant…
  begin
    update marketing_import_row_results
       set import_id = imp2, attempt = attempt + 1 where id = rid;
    assert false, 'moving a failed row to another import must be rejected';
  exception when raise_exception then
    assert sqlerrm like '%immutable%', 'rejected by the lineage pin';
  end;
  -- …not to another tenant, even paired with that tenant's REAL import (a
  -- shape the composite FKs alone would accept)
  begin
    update marketing_import_row_results
       set tenant_id = 'aaaa3000-0000-0000-0000-0000000000f2', import_id = fimp,
           attempt = attempt + 1
     where id = rid;
    assert false, 'moving a failed row to another tenant must be rejected';
  exception when raise_exception then null;
  end;
  -- …and its row number, id and creation time are pinned
  begin
    update marketing_import_row_results set row_number = 7, attempt = attempt + 1
     where id = rid;
    assert false, 'renumbering a failed row must be rejected';
  exception when raise_exception then null;
  end;
  begin
    update marketing_import_row_results set id = gen_random_uuid(), attempt = attempt + 1
     where id = rid;
    assert false, 'rewriting the ledger row id must be rejected';
  exception when raise_exception then null;
  end;
  begin
    update marketing_import_row_results
       set created_at = now() - interval '1 day', attempt = attempt + 1 where id = rid;
    assert false, 'rewriting created_at must be rejected';
  exception when raise_exception then null;
  end;
  -- a retry that does not count itself — or over-counts — is rejected
  begin
    update marketing_import_row_results set outcome = 'invalid', reason = 'uncounted'
     where id = rid;
    assert false, 'a retry without attempt+1 must be rejected';
  exception when raise_exception then
    assert sqlerrm like '%exactly one%', 'rejected by the attempt rule';
  end;
  begin
    update marketing_import_row_results set outcome = 'invalid', attempt = attempt + 2
     where id = rid;
    assert false, 'attempt can only advance by exactly one';
  exception when raise_exception then null;
  end;

  -- GOVERNED transitions still work: failed→failed via the recorder counts…
  r := marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 2,
        'failed', 'still failing');
  assert r->>'outcome' = 'failed' and (r->>'attempt')::int = 2,
    'failed→failed retries with attempt+1';
  -- …failed→invalid via the recorder counts…
  r := marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 2,
        'invalid', 'row failed column validation', array['primary_email']);
  assert r->>'outcome' = 'invalid' and (r->>'attempt')::int = 3,
    'failed→invalid retries with attempt+1';

  -- failed→created via the row RPC — EXACTLY the vanished-person recovery
  -- path: the Edge records the durable 'failed' outcome on the 40001 raise, a
  -- later retry re-resolves identity and completes with attempt+1
  r := marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 3,
        'failed', 'transient row apply failure');
  assert (r->>'attempt')::int = 1, 'row 3 failure recorded';
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 3,
        '{"display_name":"Guard Created","primary_email":"guard.created@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'created', 'failed row completes on retry';
  assert (select outcome from marketing_import_row_results
           where import_id = imp and row_number = 3) = 'created'
     and (select attempt from marketing_import_row_results
           where import_id = imp and row_number = 3) = 2,
    'failed→created retried with attempt+1';

  -- failed→updated via the row RPC
  insert into people (id, tenant_id, display_name, primary_email)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f1',
          'Guard Update Person', 'guard.upd@p3.test')
  returning id into p_upd;
  perform marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 4,
    'failed', 'transient row apply failure');
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 4,
        '{"display_name":"Guard Update Person","primary_email":"guard.upd@p3.test"}'::jsonb, opts);
  assert r->>'action' = 'updated', 'failed→updated on retry';
  assert (select attempt from marketing_import_row_results
           where import_id = imp and row_number = 4) = 2,
    'failed→updated retried with attempt+1';

  -- failed→conflict via the row RPC (a name-only collision routes to review)
  perform marketing_import_row_outcome('aaaa3000-0000-0000-0000-0000000000f1', imp, 5,
    'failed', 'transient row apply failure');
  r := marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1', imp,
        'bbbb3000-0000-0000-0000-0000000000f1', 5,
        '{"display_name":"guard update person"}'::jsonb, opts);
  assert r->>'action' = 'conflict', 'failed→conflict on retry';
  assert (select attempt from marketing_import_row_results
           where import_id = imp and row_number = 5) = 2
     and (select conflict_id from marketing_import_row_results
           where import_id = imp and row_number = 5) is not null,
    'failed→conflict retried with attempt+1 and conflict evidence';

  -- TERMINAL rows: business fields are immutable, and a set-null cannot
  -- smuggle any other change
  begin
    update marketing_import_row_results set reason = 'tweaked'
     where import_id = imp and row_number = 3;
    assert false, 'terminal business fields are immutable';
  exception when raise_exception then null;
  end;
  begin
    update marketing_import_row_results set entity_id = null, row_number = 30
     where import_id = imp and row_number = 3;
    assert false, 'a set-null cannot move the row';
  exception when raise_exception then null;
  end;
  begin
    update marketing_import_row_results set entity_id = null, reason = 'scrubbed'
     where import_id = imp and row_number = 3;
    assert false, 'a set-null cannot change any other business field';
  exception when raise_exception then null;
  end;
  begin
    update marketing_import_row_results set entity_id = null, attempt = attempt + 1
     where import_id = imp and row_number = 3;
    assert false, 'a set-null cannot masquerade as a retry';
  exception when raise_exception then null;
  end;

  -- GENUINE FK-driven set-null still works: deleting the Person nulls
  -- entity_id and changes NOTHING else…
  delete from people where id = (select entity_id from marketing_import_row_results
                                  where import_id = imp and row_number = 3);
  assert (select entity_id from marketing_import_row_results
           where import_id = imp and row_number = 3) is null
     and (select outcome from marketing_import_row_results
           where import_id = imp and row_number = 3) = 'created'
     and (select attempt from marketing_import_row_results
           where import_id = imp and row_number = 3) = 2,
    'FK entity set-null preserved outcome, attempt and lineage';
  -- …and deleting the conflict evidence nulls conflict_id the same way
  delete from marketing_identity_conflicts where id =
    (select conflict_id from marketing_import_row_results
      where import_id = imp and row_number = 5);
  assert (select conflict_id from marketing_import_row_results
           where import_id = imp and row_number = 5) is null
     and (select outcome from marketing_import_row_results
           where import_id = imp and row_number = 5) = 'conflict',
    'FK conflict set-null preserved the terminal outcome';

  -- CASCADE cleanup still works: import delete removes its ledger rows…
  insert into marketing_import_row_results (tenant_id, import_id, row_number, outcome, reason)
  values ('aaaa3000-0000-0000-0000-0000000000f1', imp2, 2, 'failed', 'cascade probe');
  delete from data_imports where id = imp2;
  assert not exists (select 1 from marketing_import_row_results where import_id = imp2),
    'import delete cascades its ledger rows';
  -- …and tenant delete removes the tenant's ledger rows
  insert into tenants (id, slug, display_name, industry)
  values ('aaaa3000-0000-0000-0000-0000000000f3', 'p3-t3-cascade', 'Cascade T3', 'hvac');
  insert into data_imports (id, tenant_id, source_system, entity_type, status, file_checksum, row_count)
  values (gen_random_uuid(), 'aaaa3000-0000-0000-0000-0000000000f3', 'csv_upload', 'contacts',
          'importing', 'guardproofT', 3)
  returning id into timp;
  insert into marketing_import_row_results (tenant_id, import_id, row_number, outcome, reason)
  values ('aaaa3000-0000-0000-0000-0000000000f3', timp, 2, 'failed', 'cascade probe');
  delete from tenants where id = 'aaaa3000-0000-0000-0000-0000000000f3';
  assert not exists (select 1 from marketing_import_row_results
                      where tenant_id = 'aaaa3000-0000-0000-0000-0000000000f3'),
    'tenant delete cascades the ledger rows';

  -- CONTRACT: the vanished-person branch RAISES retryable 40001 — the row RPC
  -- can never return a successful 'invalid' for it without a ledger row
  select prosrc into src from pg_proc where proname = 'marketing_import_contact_row';
  assert src like '%matched person vanished%' and src like '%40001%',
    'vanished-person branch raises the retryable SQLSTATE';
  assert src not like '%''action'', ''invalid'', ''reason'', ''matched person vanished''%',
    'the unrecorded-invalid return shape is gone from the row RPC';
end $$;

-- ── (8) AUDIT: TRUE keyset over EQUAL timestamps + safe projection ──────────
do $$
declare r jsonb; total int; page1 jsonb; page2 jsonb; seen jsonb := '[]'::jsonb; cur jsonb;
        pages int := 0;
begin
  -- inside one transaction every audit row shares ONE created_at (now()), so
  -- this is exactly the equal-timestamp boundary the old before-cursor lost
  select count(*) into total from audit_logs
   where tenant_id='aaaa3000-0000-0000-0000-0000000000f1' and action like 'marketing.%';
  assert total > 6, 'fixture produced enough audit rows';
  r := marketing_audit_list('aaaa3000-0000-0000-0000-0000000000f1', '{"limit": 3}'::jsonb);
  assert jsonb_array_length(r->'items') = 3, 'audit list bounded to the requested limit';
  assert r->'next_cursor' is not null, 'full page returns a typed next_cursor';
  -- walk EVERY page; the union must be exactly the full set (no skips, no dups)
  cur := null;
  loop
    r := marketing_audit_list('aaaa3000-0000-0000-0000-0000000000f1',
          jsonb_build_object('limit', 3) ||
          case when cur is null then '{}'::jsonb else jsonb_build_object('cursor', cur) end);
    exit when jsonb_array_length(r->'items') = 0;
    seen := seen || (select coalesce(jsonb_agg(e->'id'), '[]'::jsonb)
                       from jsonb_array_elements(r->'items') e);
    cur := case when jsonb_typeof(r->'next_cursor') = 'object'
                then r->'next_cursor' else null end;
    pages := pages + 1;
    exit when cur is null;
    assert pages < 50, 'runaway pagination';
  end loop;
  assert jsonb_array_length(seen) = total,
    'keyset pagination over identical timestamps returns every row exactly once';
  assert (select count(distinct e) from jsonb_array_elements(seen) e)
         = jsonb_array_length(seen),
    'no duplicates across page boundaries';
  -- prefix filter + validation
  r := marketing_audit_list('aaaa3000-0000-0000-0000-0000000000f1',
        '{"action_prefix":"marketing.settings"}'::jsonb);
  assert jsonb_array_length(r->'items') >= 1
     and not exists (select 1 from jsonb_array_elements(r->'items') e
                      where e->>'action' not like 'marketing.settings%'),
    'audit prefix filter works';
  begin
    perform marketing_audit_list('aaaa3000-0000-0000-0000-0000000000f1',
      '{"action_prefix":"bad prefix!"}'::jsonb);
    assert false, 'invalid prefix must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform marketing_audit_list('aaaa3000-0000-0000-0000-0000000000f1',
      '{"cursor":{"t":"not a time","id":"nope"}}'::jsonb);
    assert false, 'malformed cursor must raise 22023';
  exception when sqlstate '22023' then null;
  end;
  -- SAFE PROJECTION: detail keys outside the allowlist never reach the reader
  insert into audit_logs (tenant_id, actor, action, resource_type, status, detail)
  values ('aaaa3000-0000-0000-0000-0000000000f1', 'test', 'marketing.test.pii_probe',
          'probe', 'ok',
          '{"changed":["x"],"raw_row":{"email":"secret@leak.test"},"destination":"+447700900000"}'::jsonb);
  r := marketing_audit_list('aaaa3000-0000-0000-0000-0000000000f1',
        '{"action_prefix":"marketing.test"}'::jsonb);
  assert position('secret@leak.test' in r::text) = 0
     and position('+447700900000' in r::text) = 0
     and (r->'items'->0->'detail') ? 'changed',
    'audit detail is a bounded allowlisted projection — no raw rows or destinations';
end $$;

-- ── (9) RPC + RLS boundaries: service-role only, gated history reads ────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb3000-0000-0000-0000-0000000000f3';
do $$
begin
  begin
    perform marketing_update_settings('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f3', '{}'::jsonb, 1);
    assert false, 'settings RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_access_set('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f3','bbbb3000-0000-0000-0000-0000000000f3',
      'marketing.view','grant','none');
    assert false, 'access RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_segment_evaluate('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f3', '{}'::jsonb);
    assert false, 'segment RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_import_contact_row('aaaa3000-0000-0000-0000-0000000000f1',
      gen_random_uuid(), 'bbbb3000-0000-0000-0000-0000000000f3', 1, '{}'::jsonb, '{}'::jsonb);
    assert false, 'import RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_import_finalize('aaaa3000-0000-0000-0000-0000000000f1', gen_random_uuid());
    assert false, 'finalize RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_import_resolve_contact('aaaa3000-0000-0000-0000-0000000000f1',
      '{}'::jsonb, 'csv_upload');
    assert false, 'resolver RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform marketing_tag_bulk('aaaa3000-0000-0000-0000-0000000000f1',
      'bbbb3000-0000-0000-0000-0000000000f3','assign', gen_random_uuid(),
      array[]::uuid[], 'preflight');
    assert false, 'bulk RPC must not be executable by authenticated';
  exception when insufficient_privilege then null;
  end;
  -- ops (no access.manage) reads ZERO settings history rows through RLS
  assert (select count(*) from marketing_settings_history) = 0,
    'settings history hidden without access.manage';
  -- row-results outcomes are service-role only: either no table privilege at
  -- all (permission denied) or RLS with no policy (zero rows) — both deny
  begin
    assert (select count(*) from marketing_import_row_results) = 0,
      'import row outcomes are not client-readable';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'marketing_admin.test.sql: ALL ASSERTIONS PASSED' as result;
rollback;
