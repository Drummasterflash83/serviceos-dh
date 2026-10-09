-- Transactional (begin/rollback). Run:
--   docker exec -i supabase_db_serviceos-dh psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/commusoft_import.test.sql
--
-- Proves the GOVERNED universal import engine (migration 20260912120000):
-- structural row-RPC validation (tenant binding, actor authority, entity
-- type, sealed-contract equality, row range); customer identity — new
-- person / new company / unique strong-channel convergence (email, raw-vs-
-- canonical UK phone) / SHARED channels across two source accounts NEVER
-- merge / ambiguous endpoint → blocking conflict with zero mutation /
-- email-phone disagreement → conflict with zero mutation / name evidence
-- never queried; external-ID idempotency (same row → already_applied; new
-- import + same external id → linked, zero new entities); fill-blanks-only
-- linking that never overwrites or touches verified/created_source; sites —
-- creation, customer linking, replay, held on missing/conflicted customer,
-- cross-tenant refusal, link immutability; jobs — person XOR company
-- customer, open/completed/aborted preservation, aborted-only rows,
-- deterministic site resolution (unique postcode / ambiguous → reviewable
-- conflict / honest unlinked), orphan refusal; ledger — terminal outcomes
-- immutable, failed/held retry advances attempt by exactly one, recorder
-- never downgrades, provenance repair; finalisation honesty (completed vs
-- needs_review vs failed); MARKETING SAFETY — zero communication_preferences,
-- imported endpoints resolve 'unknown', pre-existing suppressions keep
-- precedence; RLS + privilege boundaries.
begin;

insert into tenants (id, slug, display_name, industry) values
  ('aaaa0000-0000-0000-0000-0000000000a1','ci-t1','Import Tenant 1','hvac'),
  ('aaaa0000-0000-0000-0000-0000000000a2','ci-t2','Import Tenant 2','hvac');

insert into auth.users (id, email, is_sso_user, is_anonymous) values
  ('bbbb0000-0000-0000-0000-0000000000a1','owner-a@ci.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000a2','viewer-a@ci.test',false,false),
  ('bbbb0000-0000-0000-0000-0000000000a3','owner-b@ci.test',false,false);
update profiles set role='owner',  tenant_id='aaaa0000-0000-0000-0000-0000000000a1' where id='bbbb0000-0000-0000-0000-0000000000a1';
update profiles set role='viewer', tenant_id='aaaa0000-0000-0000-0000-0000000000a1' where id='bbbb0000-0000-0000-0000-0000000000a2';
update profiles set role='owner',  tenant_id='aaaa0000-0000-0000-0000-0000000000a2' where id='bbbb0000-0000-0000-0000-0000000000a3';

-- interaction-created people (the live-production shape being reconciled)
insert into people (id, tenant_id, display_name, primary_email, primary_phone, created_source, verified) values
  ('dddd0000-0000-0000-0000-0000000000e1','aaaa0000-0000-0000-0000-0000000000a1','Email Match','unique1@ci.test',null,'interaction',false),
  ('dddd0000-0000-0000-0000-0000000000e2','aaaa0000-0000-0000-0000-0000000000a1','Raw Phone Match',null,'0161 496 0001','interaction',false),
  ('dddd0000-0000-0000-0000-0000000000e3','aaaa0000-0000-0000-0000-0000000000a1','Shared A','shared@ci.test',null,'interaction',false),
  ('dddd0000-0000-0000-0000-0000000000e4','aaaa0000-0000-0000-0000-0000000000a1','Shared B','shared@ci.test',null,'interaction',false),
  ('dddd0000-0000-0000-0000-0000000000e5','aaaa0000-0000-0000-0000-0000000000a1','Disagree Email','dis@ci.test',null,'interaction',false),
  ('dddd0000-0000-0000-0000-0000000000e6','aaaa0000-0000-0000-0000-0000000000a1','Disagree Phone',null,'0161 496 0002','interaction',false),
  ('dddd0000-0000-0000-0000-0000000000e7','aaaa0000-0000-0000-0000-0000000000a1','Verified Person','ver@ci.test',null,'interaction',true);

-- sealed governed import fixtures (the Edge Function normally writes these)
insert into data_imports (id, tenant_id, source_system, entity_type, file_checksum, status, row_count, preview) values
  ('cccc0000-0000-0000-0000-0000000000c1','aaaa0000-0000-0000-0000-0000000000a1','commusoft','customers','sha-c1','previewed',50,
   jsonb_build_object('sealed', jsonb_build_object(
     'profile', jsonb_build_object('id','00000000-0000-0000-0000-00000000000f'),
     'import_options', jsonb_build_object('source','commusoft'),
     'provenance_source','commusoft'))),
  ('cccc0000-0000-0000-0000-0000000000c2','aaaa0000-0000-0000-0000-0000000000a1','commusoft','sites','sha-c2','previewed',50,
   jsonb_build_object('sealed', jsonb_build_object(
     'profile', jsonb_build_object('id','00000000-0000-0000-0000-00000000000f'),
     'import_options', jsonb_build_object('source','commusoft'),
     'provenance_source','commusoft'))),
  ('cccc0000-0000-0000-0000-0000000000c3','aaaa0000-0000-0000-0000-0000000000a1','commusoft','jobs','sha-c3','previewed',50,
   jsonb_build_object('sealed', jsonb_build_object(
     'profile', jsonb_build_object('id','00000000-0000-0000-0000-00000000000f'),
     'import_options', jsonb_build_object('source','commusoft'),
     'provenance_source','commusoft'))),
  ('cccc0000-0000-0000-0000-0000000000c4','aaaa0000-0000-0000-0000-0000000000a1','commusoft','customers','sha-c4','previewed',50,
   jsonb_build_object('sealed', jsonb_build_object(
     'profile', jsonb_build_object('id','00000000-0000-0000-0000-00000000000f'),
     'import_options', jsonb_build_object('source','commusoft'),
     'provenance_source','commusoft'))),
  ('cccc0000-0000-0000-0000-0000000000c5','aaaa0000-0000-0000-0000-0000000000a1','commusoft','customers','sha-c5','previewed',50, '{}'::jsonb),
  ('cccc0000-0000-0000-0000-0000000000b1','aaaa0000-0000-0000-0000-0000000000a2','commusoft','customers','sha-b1','previewed',50,
   jsonb_build_object('sealed', jsonb_build_object(
     'profile', jsonb_build_object('id','00000000-0000-0000-0000-00000000000f'),
     'import_options', jsonb_build_object('source','commusoft'),
     'provenance_source','commusoft'))),
  ('cccc0000-0000-0000-0000-0000000000b2','aaaa0000-0000-0000-0000-0000000000a2','commusoft','sites','sha-b2','previewed',50,
   jsonb_build_object('sealed', jsonb_build_object(
     'profile', jsonb_build_object('id','00000000-0000-0000-0000-00000000000f'),
     'import_options', jsonb_build_object('source','commusoft'),
     'provenance_source','commusoft'))),
  ('cccc0000-0000-0000-0000-0000000000b3','aaaa0000-0000-0000-0000-0000000000a2','commusoft','jobs','sha-b3','previewed',50,
   jsonb_build_object('sealed', jsonb_build_object(
     'profile', jsonb_build_object('id','00000000-0000-0000-0000-00000000000f'),
     'import_options', jsonb_build_object('source','commusoft'),
     'provenance_source','commusoft')));

-- ── (1) structural row-RPC validation ───────────────────────────────────────
do $$
declare v_err boolean;
begin
  -- foreign-tenant import id → P0002
  v_err := false;
  begin
    perform import_customer_row('aaaa0000-0000-0000-0000-0000000000a2',
      'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a3',
      2, '{"external_id":"1","record_kind":"person","display_name":"X"}'::jsonb,
      '{"source":"commusoft"}'::jsonb);
  exception when others then v_err := sqlstate = 'P0002'; end;
  assert v_err, 'foreign-tenant import must raise P0002';

  -- cross-tenant actor → integrity violation
  v_err := false;
  begin
    perform import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a3',
      2, '{"external_id":"1","record_kind":"person","display_name":"X"}'::jsonb,
      '{"source":"commusoft"}'::jsonb);
  exception when others then v_err := true; end;
  assert v_err, 'cross-tenant actor must be rejected';

  -- viewer actor → 42501
  v_err := false;
  begin
    perform import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a2',
      2, '{"external_id":"1","record_kind":"person","display_name":"X"}'::jsonb,
      '{"source":"commusoft"}'::jsonb);
  exception when others then v_err := sqlstate = '42501'; end;
  assert v_err, 'viewer actor must raise 42501';

  -- row number outside the sealed file → 22023
  v_err := false;
  begin
    perform import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
      99, '{"external_id":"1","record_kind":"person","display_name":"X"}'::jsonb,
      '{"source":"commusoft"}'::jsonb);
  exception when others then v_err := sqlstate = '22023'; end;
  assert v_err, 'out-of-range row must raise 22023';

  -- options that do not equal the sealed contract → 22023
  v_err := false;
  begin
    perform import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
      2, '{"external_id":"1","record_kind":"person","display_name":"X"}'::jsonb,
      '{"source":"other"}'::jsonb);
  exception when others then v_err := sqlstate = '22023'; end;
  assert v_err, 'sealed-options mismatch must raise 22023';

  -- import with NO sealed contract → 22023
  v_err := false;
  begin
    perform import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000c5','bbbb0000-0000-0000-0000-0000000000a1',
      2, '{"external_id":"1","record_kind":"person","display_name":"X"}'::jsonb,
      '{"source":"commusoft"}'::jsonb);
  exception when others then v_err := sqlstate = '22023'; end;
  assert v_err, 'unsealed import must raise 22023';

  -- wrong entity type (sites RPC against a customers import) → 22023
  v_err := false;
  begin
    perform import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
      2, '{"external_id":"S1","customer_external_id":"1"}'::jsonb,
      '{"source":"commusoft"}'::jsonb);
  exception when others then v_err := sqlstate = '22023'; end;
  assert v_err, 'entity-type mismatch must raise 22023';
end $$;

-- ── (2) customer identity: creation, convergence, no-merge rules ────────────
do $$
declare
  r jsonb; v_people_before int; v_pid uuid; v_pid2 uuid; v_cid uuid;
begin
  -- 2a: person with NO channels (the 124 no-channel customers) → created
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    2, '{"external_id":"100","record_kind":"person","display_name":"No Channel","address_text":"1 Bare St","postcode":"M1 1AA","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2a: no-channel person must be created';
  select entity_id into v_pid from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='100';
  assert v_pid is not null, '2a: link row must exist';
  assert (select created_source from people where id = v_pid) = 'import:customers:commusoft',
    '2a: created_source must carry import lineage';
  assert (select count(*) from contact_points where person_id = v_pid) = 0,
    '2a: no contact points for a channel-less person';

  -- 2b: person with email+phone, no existing candidate → created + unverified
  -- contact points + eligibility stays the safe unknown state
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    3, '{"external_id":"101","record_kind":"person","display_name":"Fresh Person","primary_email":"fresh@ci.test","primary_phone":"+441614969901","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2b: created';
  select entity_id into v_pid from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='101';
  assert (select count(*) from contact_points where person_id = v_pid) = 2,
    '2b: email + phone contact points';
  assert (select bool_and(verification_state = 'unverified' and source = 'import')
            from contact_points where person_id = v_pid),
    '2b: contact points are unverified import endpoints';
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000a1', v_pid, 'email') = 'unknown',
    '2b: imported endpoint must resolve to the safe unknown state';

  -- 2c: unique existing person via EMAIL → linked, blanks filled, lineage kept
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    4, '{"external_id":"102","record_kind":"person","display_name":"Different Name","primary_email":"unique1@ci.test","postcode":"M2 2BB","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'linked', '2c: linked';
  assert (r ->> 'entity_id')::uuid = 'dddd0000-0000-0000-0000-0000000000e1', '2c: linked to the email person';
  assert (select postcode from people where id='dddd0000-0000-0000-0000-0000000000e1') = 'M2 2BB',
    '2c: blank postcode filled';
  assert (select display_name from people where id='dddd0000-0000-0000-0000-0000000000e1') = 'Email Match',
    '2c: non-blank display name NEVER overwritten';
  assert (select created_source from people where id='dddd0000-0000-0000-0000-0000000000e1') = 'interaction',
    '2c: created_source untouched on link';
  assert exists (select 1 from import_row_results rr, unnest(rr.fields) f
    where rr.import_id='cccc0000-0000-0000-0000-0000000000c1' and rr.row_number=4
      and f = 'display_name'),
    '2c: differing field recorded in the ledger';

  -- 2d: unique existing person via RAW-form phone → canonical forms converge
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    5, '{"external_id":"103","record_kind":"person","display_name":"Phone Person","primary_phone":"0044 161 496 0001","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'linked', '2d: linked via canonical UK phone';
  assert (r ->> 'entity_id')::uuid = 'dddd0000-0000-0000-0000-0000000000e2', '2d: correct person';

  -- 2e: AMBIGUOUS endpoint (email matches two people) → blocking conflict,
  -- ZERO canonical writes
  select count(*) into v_people_before from people where tenant_id='aaaa0000-0000-0000-0000-0000000000a1';
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    6, '{"external_id":"104","record_kind":"person","display_name":"Shared Row","primary_email":"shared@ci.test","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'conflict', '2e: conflict';
  assert (select count(*) from people where tenant_id='aaaa0000-0000-0000-0000-0000000000a1') = v_people_before,
    '2e: zero canonical writes on conflict';
  assert (select blocking from import_conflicts
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and external_id='104' and status='open'),
    '2e: blocking conflict recorded';
  assert (select conflict_type from import_conflicts
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and external_id='104' and status='open') = 'ambiguous_channel',
    '2e: ambiguous_channel type';
  assert (select jsonb_array_length(candidates) from import_conflicts
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and external_id='104' and status='open') = 2,
    '2e: both candidates recorded';

  -- 2f: email and phone pointing at DIFFERENT people → conflict, no mutation
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    7, '{"external_id":"105","record_kind":"person","display_name":"Torn","primary_email":"dis@ci.test","primary_phone":"01614960002","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'conflict', '2f: conflict';
  assert (select conflict_type from import_conflicts
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and external_id='105' and status='open') = 'channel_disagreement',
    '2f: channel_disagreement type';
  assert (select postcode is null and display_name = 'Disagree Email'
            from people where id='dddd0000-0000-0000-0000-0000000000e5'),
    '2f: neither person mutated';

  -- 2g: SHARED EMAIL across two source accounts NEVER merges — the second
  -- account creates a NEW person even though the email now matches
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    8, '{"external_id":"106","record_kind":"person","display_name":"House A","primary_email":"house@ci.test","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2g: first account created';
  select entity_id into v_pid from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='106';
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    9, '{"external_id":"107","record_kind":"person","display_name":"House B","primary_email":"house@ci.test","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2g: second account must CREATE, never merge';
  select entity_id into v_pid2 from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='107';
  assert v_pid is distinct from v_pid2, '2g: two accounts → two distinct people';

  -- 2h: SHARED PHONE across two source accounts NEVER merges
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    10, '{"external_id":"108","record_kind":"person","display_name":"Line A","primary_phone":"0161 496 7777","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2h: first phone account created';
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    11, '{"external_id":"109","record_kind":"person","display_name":"Line B","primary_phone":"+44 161 496 7777","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2h: second phone account must CREATE, never merge';
  assert (select count(distinct entity_id) from import_entity_links
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and external_id in ('108','109')) = 2,
    '2h: distinct people';

  -- 2i: COMPANY customer → canonical company, NO named individual invented;
  -- channels matching an existing person → NON-blocking overlap conflict
  select count(*) into v_people_before from people where tenant_id='aaaa0000-0000-0000-0000-0000000000a1';
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    12, '{"external_id":"110","record_kind":"company_contact","company_name":"Overlap Ltd","primary_email":"dis@ci.test","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2i: company created';
  assert r ->> 'entity_table' = 'companies', '2i: canonical company';
  assert (select count(*) from people where tenant_id='aaaa0000-0000-0000-0000-0000000000a1') = v_people_before,
    '2i: no person invented for a company customer';
  select entity_id into v_cid from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='110';
  assert (select created_source from companies where id = v_cid) = 'import:commusoft',
    '2i: company lineage';
  assert (select blocking from import_conflicts
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and external_id='110'
      and conflict_type='company_person_overlap' and status='open') = false,
    '2i: overlap evidence is a NON-blocking review conflict';

  -- 2j: INACTIVE customer preserved as inactive, never a fresh active record
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    13, '{"external_id":"111","record_kind":"person","display_name":"Gone Away","active":false}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2j: created';
  select entity_id into v_pid from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='111';
  assert (select (metadata -> 'import' ->> 'active')::boolean from people where id = v_pid) = false,
    '2j: inactive state preserved';

  -- 2k: VERIFIED person: link may fill blanks but the verified flag and
  -- existing values survive untouched
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    14, '{"external_id":"112","record_kind":"person","display_name":"Someone Else","primary_email":"ver@ci.test","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'linked', '2k: linked';
  assert (select verified and display_name = 'Verified Person'
            from people where id='dddd0000-0000-0000-0000-0000000000e7'),
    '2k: verified person untouched';

  -- 2l: name-only "collision" with an existing person NEVER matches — names
  -- are not identity evidence at all
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    15, '{"external_id":"113","record_kind":"person","display_name":"Email Match","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '2l: name-only row creates a NEW person';
  assert (select count(*) from people
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and display_name='Email Match') = 2,
    '2l: original person untouched, distinct new person';
end $$;

-- ── (3) external-ID idempotency + ledger state machine ──────────────────────
do $$
declare r jsonb; v_people int; v_prior_attempt int;
begin
  -- same import + same row → already_applied
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    2, '{"external_id":"100","record_kind":"person","display_name":"No Channel","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'already_applied', '3a: terminal row never re-applied';

  -- NEW import, same external id → linked via the authoritative map, zero creates
  select count(*) into v_people from people where tenant_id='aaaa0000-0000-0000-0000-0000000000a1';
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c4','bbbb0000-0000-0000-0000-0000000000a1',
    2, '{"external_id":"100","record_kind":"person","display_name":"No Channel","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'linked', '3b: rerun resolves to the SAME entity';
  assert (select count(*) from people where tenant_id='aaaa0000-0000-0000-0000-0000000000a1') = v_people,
    '3b: zero additional creates on rerun';

  -- recorder: failed is retryable, terminal is never downgraded
  r := import_row_outcome('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1', 20, 'failed', 'transient');
  assert (r ->> 'already')::boolean = false, '3c: failed recorded';
  r := import_row_outcome('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1', 20, 'failed', 'transient again');
  assert (select attempt from import_row_results
    where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=20) = 2,
    '3c: failed retry advances attempt';
  r := import_row_outcome('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1', 2, 'failed', 'late failure marker');
  assert (r ->> 'already')::boolean = true and r ->> 'outcome' = 'created',
    '3d: recorder returns the authoritative terminal outcome, never downgrades';

  -- failed row → row RPC retry succeeds with attempt+1
  select attempt into v_prior_attempt from import_row_results
   where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=20;
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    20, '{"external_id":"120","record_kind":"person","display_name":"Retry Person","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '3e: failed row retried';
  assert (select attempt from import_row_results
    where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=20) = v_prior_attempt + 1,
    '3e: attempt advanced by exactly one';
end $$;

-- ── (4) ledger transition guard: structural immutability ────────────────────
do $$
declare v_err boolean;
begin
  v_err := false;
  begin
    update import_row_results set outcome = 'invalid'
     where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=2;
  exception when others then v_err := true; end;
  assert v_err, '4a: terminal outcomes are immutable';

  v_err := false;
  begin
    update import_row_results set row_number = 49
     where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=2;
  exception when others then v_err := true; end;
  assert v_err, '4b: identity/lineage is immutable';

  insert into import_row_results (tenant_id, import_id, row_number, outcome, reason)
  values ('aaaa0000-0000-0000-0000-0000000000a1','cccc0000-0000-0000-0000-0000000000c1',
          21,'failed','seed');
  v_err := false;
  begin
    update import_row_results set outcome = 'created'
     where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=21;
  exception when others then v_err := true; end;
  assert v_err, '4c: a failed retry that does not count itself is rejected';
  update import_row_results set outcome = 'skipped', attempt = 2
   where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=21;
  assert (select outcome from import_row_results
    where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=21) = 'skipped',
    '4d: counted retry transition is legal';
end $$;

-- ── (5) provenance repair (defence in depth) ────────────────────────────────
do $$
declare r jsonb;
begin
  delete from import_row_results
   where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=3;
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    3, '{"external_id":"101","record_kind":"person","display_name":"Fresh Person","primary_email":"fresh@ci.test","primary_phone":"+441614969901","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'already_applied' and (r ->> 'repaired')::boolean,
    '5: a lost ledger row is repaired from provenance, never re-applied';
  assert (select outcome from import_row_results
    where import_id='cccc0000-0000-0000-0000-0000000000c1' and row_number=3) = 'created',
    '5: repaired outcome restored';
end $$;

-- ── (6) sites: creation, linking, held rows, replay, cross-tenant ──────────
do $$
declare r jsonb; v_site uuid; v_person uuid; v_company uuid;
begin
  select entity_id into v_person from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='101';
  select entity_id into v_company from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='110';

  -- 6a: site for a person customer
  r := import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c2','bbbb0000-0000-0000-0000-0000000000a1',
    2, '{"external_id":"S200","customer_external_id":"101","label":"Home","address_text":"12 High Street","postcode":"M5 5AA","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '6a: site created';
  select entity_id into v_site from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='site' and external_id='S200';
  assert (select person_id from sites where id = v_site) = v_person, '6a: linked to the person customer';
  assert (select company_id from sites where id = v_site) is null, '6a: XOR person/company';

  -- 6b: site for a company customer
  r := import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c2','bbbb0000-0000-0000-0000-0000000000a1',
    3, '{"external_id":"S201","customer_external_id":"110","label":"Office","address_text":"1 Works Yard","postcode":"M6 6BB","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '6b: created';
  select entity_id into v_site from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='site' and external_id='S201';
  assert (select company_id from sites where id = v_site) = v_company, '6b: linked to the company';

  -- 6c: duplicate site replay (same row) → already; new import same ext → linked
  r := import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c2','bbbb0000-0000-0000-0000-0000000000a1',
    2, '{"external_id":"S200","customer_external_id":"101","label":"Home","address_text":"12 High Street","postcode":"M5 5AA","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'already_applied', '6c: replay short-circuits';
  assert (select count(*) from sites where tenant_id='aaaa0000-0000-0000-0000-0000000000a1'
            and external_id='S200') = 1, '6c: exactly one site';

  -- 6d: unresolved customer → HELD with the honest reason, no site row
  r := import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c2','bbbb0000-0000-0000-0000-0000000000a1',
    4, '{"external_id":"S202","customer_external_id":"9999","label":"Lost","address_text":"9 Nowhere","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'held' and r ->> 'reason' = 'customer_not_imported',
    '6d: held with reason';
  assert not exists (select 1 from sites where tenant_id='aaaa0000-0000-0000-0000-0000000000a1'
    and external_id='S202'), '6d: no site created for a held row';

  -- 6e: CONFLICTED customer (open blocking conflict on 104) → held with
  -- customer_conflict_open — a conflict never lets dependants pretend success
  r := import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c2','bbbb0000-0000-0000-0000-0000000000a1',
    5, '{"external_id":"S203","customer_external_id":"104","label":"Blocked","address_text":"4 Held Rd","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'held' and r ->> 'reason' = 'customer_conflict_open',
    '6e: dependant of a conflicted customer is held';

  -- 6f: cross-tenant: tenant B importing the same external ids sees NOTHING of
  -- tenant A (held — its own tenant has no such customer)
  r := import_site_row('aaaa0000-0000-0000-0000-0000000000a2',
    'cccc0000-0000-0000-0000-0000000000b2','bbbb0000-0000-0000-0000-0000000000a3',
    2, '{"external_id":"S200","customer_external_id":"101","label":"Foreign","address_text":"12 High Street","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'held', '6f: tenant B cannot link tenant A customers';

  -- 6g: the link map is immutable and refuses cross-tenant entities
  declare v_err boolean;
  begin
    v_err := false;
    begin
      insert into import_entity_links (tenant_id, source_system, entity_kind,
        external_id, entity_table, entity_id, link_strategy)
      values ('aaaa0000-0000-0000-0000-0000000000a2','commusoft','customer','X1',
              'people','dddd0000-0000-0000-0000-0000000000e1','created');
    exception when others then v_err := true; end;
    assert v_err, '6g: cross-tenant link target rejected';
    v_err := false;
    begin
      update import_entity_links set external_id = 'HACKED'
       where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and external_id='S200';
    exception when others then v_err := true; end;
    assert v_err, '6g: links are immutable';
  end;
end $$;

-- ── (7) jobs: customers, statuses, deterministic site resolution ────────────
do $$
declare r jsonb; v_job uuid; v_person uuid; v_company uuid; v_site uuid;
begin
  select entity_id into v_person from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='101';
  select entity_id into v_company from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='110';

  -- 7a: completed job for a PERSON customer, site resolved by unique postcode
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c3','bbbb0000-0000-0000-0000-0000000000a1',
    2, '{"external_id":"7001","job_number":"7001","customer_external_id":"101","site_address_text":"12 High Street","site_postcode":"M5 5AA","title":"Boiler service","description":"Annual service","status":"completed","active":true,"created_date":"2024-05-01T09:30:00","completed_date":"2024-05-02T15:00:00","value_pennies":15000,"quoted_value_pennies":14000,"engineer":"Tom E"}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '7a: created';
  assert r ->> 'site_outcome' = 'resolved', '7a: site resolved';
  select entity_id into v_job from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='job' and external_id='7001';
  assert (select customer_person_id from jobs where id = v_job) = v_person, '7a: person customer';
  assert (select customer_company_id from jobs where id = v_job) is null, '7a: XOR';
  assert (select site_id from jobs where id = v_job) is not null, '7a: site linked';
  assert (select value_pennies from jobs where id = v_job) = 15000, '7a: value preserved';
  assert (select created_date from jobs where id = v_job) = '2024-05-01T09:30:00+00'::timestamptz,
    '7a: full timestamp preserved (time of day intact)';
  assert (select metadata -> 'import' ->> 'engineer_name' from jobs where id = v_job) = 'Tom E',
    '7a: engineer evidence preserved (never guessed into a person link)';
  assert (select engineer_person_id from jobs where id = v_job) is null,
    '7a: engineer NOT name-matched';

  -- 7b: open job for a COMPANY customer, honestly unlinked site
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c3','bbbb0000-0000-0000-0000-0000000000a1',
    3, '{"external_id":"7002","job_number":"7002","customer_external_id":"110","site_address_text":"Somewhere Unmatched","status":"open","active":true,"created_date":"2026-07-01T08:00:00"}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '7b: created';
  select entity_id into v_job from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='job' and external_id='7002';
  assert (select customer_company_id from jobs where id = v_job) = v_company, '7b: company customer';
  assert (select site_id from jobs where id = v_job) is null, '7b: honestly unlinked';
  assert (select status from jobs where id = v_job) = 'open', '7b: open preserved';
  assert (select metadata -> 'import' -> 'site_resolution' ->> 'outcome' from jobs where id = v_job) = 'none',
    '7b: unlinked reason recorded';

  -- 7c: ABORTED-ONLY job (no dates, no value)
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c3','bbbb0000-0000-0000-0000-0000000000a1',
    4, '{"external_id":"7003","job_number":"7003","customer_external_id":"101","site_address_text":"12 High Street","status":"aborted","active":false}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '7c: created';
  select entity_id into v_job from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='job' and external_id='7003';
  assert (select status = 'aborted' and active = false and created_date is null
            and value_pennies is null from jobs where id = v_job),
    '7c: aborted state honest (no fabricated dates or values)';

  -- 7d: AMBIGUOUS site (two sites, same postcode, same canonical address) →
  -- job created UNLINKED with a reviewable conflict
  perform import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c2','bbbb0000-0000-0000-0000-0000000000a1',
    6, '{"external_id":"S204","customer_external_id":"101","label":"Twin 1","address_text":"7 Twin Court","postcode":"M7 7CC","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  perform import_site_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c2','bbbb0000-0000-0000-0000-0000000000a1',
    7, '{"external_id":"S205","customer_external_id":"101","label":"Twin 2","address_text":"7, Twin Court","postcode":"M7 7CC","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c3','bbbb0000-0000-0000-0000-0000000000a1',
    5, '{"external_id":"7004","job_number":"7004","customer_external_id":"101","site_address_text":"7 Twin Court","site_postcode":"M7 7CC","status":"completed","active":true,"created_date":"2024-01-01T10:00:00","completed_date":"2024-01-01T12:00:00","value_pennies":5000}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created' and r ->> 'site_outcome' = 'ambiguous',
    '7d: ambiguity never guesses';
  select entity_id into v_job from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='job' and external_id='7004';
  assert (select site_id from jobs where id = v_job) is null, '7d: unlinked';
  assert exists (select 1 from import_conflicts
    where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='job'
      and external_id='7004' and conflict_type='site_ambiguous' and status='open'
      and blocking = false),
    '7d: reviewable site conflict recorded';

  -- 7e: ORPHAN job (unknown customer) → held, no job row
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c3','bbbb0000-0000-0000-0000-0000000000a1',
    6, '{"external_id":"7005","customer_external_id":"9999","status":"completed","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'held' and r ->> 'reason' = 'customer_not_imported', '7e: held';
  assert not exists (select 1 from jobs where tenant_id='aaaa0000-0000-0000-0000-0000000000a1'
    and external_id='7005'), '7e: no orphan job created';

  -- 7f: job replay → already; invalid status → honest invalid
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c3','bbbb0000-0000-0000-0000-0000000000a1',
    2, '{"external_id":"7001","job_number":"7001","customer_external_id":"101","site_address_text":"12 High Street","site_postcode":"M5 5AA","title":"Boiler service","description":"Annual service","status":"completed","active":true,"created_date":"2024-05-01T09:30:00","completed_date":"2024-05-02T15:00:00","value_pennies":15000,"quoted_value_pennies":14000,"engineer":"Tom E"}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'already_applied', '7f: replay short-circuits';
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c3','bbbb0000-0000-0000-0000-0000000000a1',
    7, '{"external_id":"7006","customer_external_id":"101","status":"cancelled","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'invalid', '7f: unknown status is an honest invalid';

  -- 7g: cross-tenant job refusal — tenant B cannot reach tenant A's customers
  r := import_job_row('aaaa0000-0000-0000-0000-0000000000a2',
    'cccc0000-0000-0000-0000-0000000000b3','bbbb0000-0000-0000-0000-0000000000a3',
    2, '{"external_id":"7001","customer_external_id":"101","status":"completed","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'held', '7g: cross-tenant relationship refused';
end $$;

-- ── (8) finalisation honesty ────────────────────────────────────────────────
do $$
declare r jsonb;
begin
  -- customers import: has terminal rows AND open conflicts → needs_review
  r := import_run_finalize('aaaa0000-0000-0000-0000-0000000000a1',
                           'cccc0000-0000-0000-0000-0000000000c1');
  assert r ->> 'status' = 'importing', '8a: unprocessed rows keep the import importing';
  -- (row_count=50 fixtures are deliberately larger than the rows applied)

  -- a fully-terminal import with conflicts must be needs_review, NEVER completed
  update data_imports set row_count = 1
   where id = 'cccc0000-0000-0000-0000-0000000000c4';
  r := import_run_finalize('aaaa0000-0000-0000-0000-0000000000a1',
                           'cccc0000-0000-0000-0000-0000000000c4');
  assert r ->> 'status' = 'completed', '8b: all-terminal no-conflict import completes';
  assert (r -> 'import' ->> 'status') = 'completed', '8b: durable status';

  -- an import with held rows finalises needs_review
  update data_imports set row_count = 4
   where id = 'cccc0000-0000-0000-0000-0000000000c2';
  r := import_run_finalize('aaaa0000-0000-0000-0000-0000000000a1',
                           'cccc0000-0000-0000-0000-0000000000c2');
  assert r ->> 'status' = 'needs_review',
    '8c: held rows can never be reported as completed';
  assert (r ->> 'held')::int >= 1, '8c: held count surfaced';

  -- an import with a failed row finalises failed
  perform import_row_outcome('aaaa0000-0000-0000-0000-0000000000a2',
    'cccc0000-0000-0000-0000-0000000000b1', 2, 'failed', 'boom');
  update data_imports set row_count = 1
   where id = 'cccc0000-0000-0000-0000-0000000000b1';
  r := import_run_finalize('aaaa0000-0000-0000-0000-0000000000a2',
                           'cccc0000-0000-0000-0000-0000000000b1');
  assert r ->> 'status' = 'failed', '8d: failed rows fail the import';
end $$;

-- ── (9) MARKETING SAFETY ────────────────────────────────────────────────────
do $$
declare r jsonb; v_pid uuid;
begin
  -- zero consent writes across the ENTIRE suite so far
  assert (select count(*) from communication_preferences
    where tenant_id in ('aaaa0000-0000-0000-0000-0000000000a1',
                        'aaaa0000-0000-0000-0000-0000000000a2')) = 0,
    '9a: importing writes ZERO communication_preferences rows';

  -- pre-existing suppression keeps precedence over a later import
  insert into contact_suppressions (tenant_id, channel, normalized_value, reason, active, source)
  values ('aaaa0000-0000-0000-0000-0000000000a1','email','suppressed@ci.test',
          'unsubscribe', true, 'test');
  r := import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
    'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
    22, '{"external_id":"130","record_kind":"person","display_name":"Suppressed Import","primary_email":"suppressed@ci.test","active":true}'::jsonb,
    '{"source":"commusoft"}'::jsonb);
  assert r ->> 'action' = 'created', '9b: import proceeds';
  select entity_id into v_pid from import_entity_links
   where tenant_id='aaaa0000-0000-0000-0000-0000000000a1' and entity_kind='customer' and external_id='130';
  assert marketing_endpoint_eligibility('aaaa0000-0000-0000-0000-0000000000a1',
    v_pid, 'email', null, 'suppressed@ci.test') = 'suppressed',
    '9b: pre-existing suppression retains precedence over the imported endpoint';
end $$;

-- ── (10) RLS + privilege boundaries ─────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000a1';
do $$
declare v_err boolean;
begin
  assert (select bool_and(tenant_id = 'aaaa0000-0000-0000-0000-0000000000a1')
            from import_entity_links), '10a: tenant A sees only its links';
  assert (select bool_and(tenant_id = 'aaaa0000-0000-0000-0000-0000000000a1')
            from import_conflicts), '10a: tenant A sees only its conflicts';
  v_err := false;
  begin
    perform count(*) from import_row_results;
  exception when insufficient_privilege then v_err := true; end;
  assert v_err, '10a: the row ledger is NEVER client-readable (no grant at all)';
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000a3';
do $$
begin
  assert not exists (select 1 from import_entity_links
    where tenant_id = 'aaaa0000-0000-0000-0000-0000000000a1'),
    '10b: tenant B sees none of tenant A';
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = 'bbbb0000-0000-0000-0000-0000000000a1';
do $$
declare v_err boolean;
begin
  v_err := false;
  begin
    insert into import_entity_links (tenant_id, source_system, entity_kind,
      external_id, entity_table, entity_id, link_strategy)
    values ('aaaa0000-0000-0000-0000-0000000000a1','commusoft','customer','H1',
            'people','dddd0000-0000-0000-0000-0000000000e1','created');
  exception when others then v_err := true; end;
  assert v_err, '10c: authenticated cannot write the link map';
  v_err := false;
  begin
    perform import_customer_row('aaaa0000-0000-0000-0000-0000000000a1',
      'cccc0000-0000-0000-0000-0000000000c1','bbbb0000-0000-0000-0000-0000000000a1',
      30, '{"external_id":"999","record_kind":"person","display_name":"H"}'::jsonb,
      '{"source":"commusoft"}'::jsonb);
  exception when others then v_err := true; end;
  assert v_err, '10c: authenticated cannot execute the row RPCs';
end $$;
reset role;

do $$ begin raise notice 'COMMUSOFT GOVERNED IMPORT: ALL ASSERTIONS PASSED'; end $$;

rollback;
