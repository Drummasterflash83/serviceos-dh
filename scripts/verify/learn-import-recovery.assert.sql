-- Run inside the historical commusoft_import.test.sql transaction, before its
-- ROLLBACK. Its synthetic fixtures are reused; no production IDs are involved.
do $$
declare
  t uuid := 'aaaa0000-0000-0000-0000-0000000000a1';
  actor uuid := 'bbbb0000-0000-0000-0000-0000000000a1';
  customer_import uuid := 'cccc0000-0000-0000-0000-0000000000c1';
  job_import uuid := 'cccc0000-0000-0000-0000-0000000000c3';
  p uuid; site uuid; primary_endpoint uuid; r jsonb; record jsonb; signature text;
begin
  -- Historical defect B: two distinct phone numbers must survive one atomic
  -- customer import, with exactly one primary phone and one primary email.
  r := import_customer_row(t, customer_import, actor, 40,
    '{"external_id":"recovery-two-phones","record_kind":"person","display_name":"Synthetic Two Phones","primary_email":"two-phones@ci.test","primary_phone":"+441614967771","secondary_phone":"+441614967772","active":true}',
    '{"source":"commusoft"}');
  assert r->>'action' = 'created', 'two-phone customer imports successfully';
  p := (r->>'entity_id')::uuid;
  assert (select count(*) from contact_points where tenant_id=t and person_id=p and channel='phone') = 2,
    'both source phone numbers retained';
  assert (select count(*) from contact_points where tenant_id=t and person_id=p and is_primary) = 2,
    'independent phone and email primacy';
  select id into primary_endpoint from contact_points where tenant_id=t and person_id=p and channel='phone' and is_primary;
  perform import_person_contact_points(t, p,
    '{"primary_phone":"+441614967772","secondary_phone":"+441614967771"}');
  assert (select is_primary from contact_points where id=primary_endpoint),
    'reimport cannot swap an established primary';
  assert (select count(*) from contact_points where tenant_id=t and person_id=p and channel='phone') = 2,
    'reimport creates no duplicate endpoints';

  -- Historical defect D: exact external site identity beats weaker address
  -- evidence; an invalid exact identity must never fall back to an address.
  select entity_id into p from import_entity_links
    where tenant_id=t and entity_kind='customer' and external_id='101';
  select entity_id into site from import_entity_links
    where tenant_id=t and entity_kind='site' and external_id='S200';
  r := import_resolve_job_site_v2(t, 'commusoft', 'people', p, 'S200', 'WRONG', 'Wrong address');
  assert r->>'strategy' = 'exact_external_id' and (r->>'site_id')::uuid=site,
    'exact site reference wins over weaker address';
  r := import_resolve_job_site_v2(t, 'commusoft', 'people', p, 'MISSING', 'M5 5AA', '12 High Street');
  assert r->>'outcome'='error', 'missing exact site refuses address fallback';
  r := import_resolve_job_site_v2(t, 'commusoft', 'people', p, 'S201', 'M5 5AA', '12 High Street');
  assert r->>'outcome'='error', 'other customer exact site refuses fallback';
  r := import_resolve_job_site_v2('aaaa0000-0000-0000-0000-0000000000a2', 'commusoft', 'people', p, 'S200', null, null);
  assert r->>'outcome'='error', 'foreign tenant exact site is unavailable';
  r := import_resolve_job_site_v2(t, 'other-provider', 'people', p, 'S200', null, null);
  assert r->>'outcome'='error', 'foreign provider exact site is unavailable';

  record := '{"external_id":"79001","customer_external_id":"101","site_external_id":"S200","status":"completed","engineer":"A name alone","created_date":"2026-07-01T09:30:00+01:00","completed_date":"2026-07-01T13:42:00+01:00"}';
  r := import_match_job(t, 'commusoft', record);
  assert r->>'site_strategy'='exact_external_id', 'preview uses exact path';
  r := import_job_row(t, job_import, actor, 40, record, '{"source":"commusoft"}');
  assert r->>'action'='created', 'exact job imported';
  assert (select site_id=site and engineer_person_id is null
      and created_date='2026-07-01T08:30:00Z'::timestamptz
      and completed_date='2026-07-01T12:42:00Z'::timestamptz
    from jobs where id=(r->>'entity_id')::uuid),
    'job preserves exact site, full offset timestamps, and unassigned engineer';
  r := import_job_row(t, job_import, actor, 40, record, '{"source":"commusoft"}');
  assert r->>'action'='already_applied', 'job replay is idempotent';
  record := record || '{"external_id":"79002","site_external_id":"MISSING","site_postcode":"M5 5AA","site_address_text":"12 High Street"}'::jsonb;
  r := import_match_job(t, 'commusoft', record);
  assert r->>'strategy'='site_exact_unresolvable', 'preview exposes blocking site conflict';
  r := import_job_row(t, job_import, actor, 41, record, '{"source":"commusoft"}');
  assert r->>'action'='conflict', 'apply records blocking conflict';
  assert not exists(select 1 from jobs where tenant_id=t and external_id='79002'),
    'unresolved exact site cannot create a job';
  assert (select blocking from import_conflicts where id=(r->>'conflict_id')::uuid),
    'exact site conflict requires resolution';

  foreach signature in array array[
    'public.import_person_contact_points(uuid,uuid,jsonb)',
    'public.import_resolve_job_site_exact(uuid,text,text,uuid,text)',
    'public.import_resolve_job_site_v2(uuid,text,text,uuid,text,text,text)'
  ] loop
    assert not has_function_privilege('authenticated',signature,'EXECUTE'), 'client cannot invoke import helper';
    assert not has_function_privilege('anon',signature,'EXECUTE'), 'anonymous cannot invoke import helper';
    assert has_function_privilege('service_role',signature,'EXECUTE'), 'server can invoke import helper';
  end loop;
  assert not has_table_privilege('authenticated','import_row_results','SELECT'), 'row ledger remains private';
  raise notice 'LEARN IMPORT RECOVERY: supplemental assertions passed';
end $$;
