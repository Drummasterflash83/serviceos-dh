/** Emit a disposable PostgreSQL 17 proof for the audited open-job review v2. */
import { readFileSync } from 'node:fs';
import { releaseSql } from './new-dawn-open-identity-triage-release.mjs';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sample = read('scripts/verify/new-dawn-open-job-page-synthetic.sql');
const seedStart = sample.indexOf('insert into auth.users(');
const assertionsStart = sample.indexOf("set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';");
if (seedStart < 0 || assertionsStart < seedStart) throw Error('triage_fixture_changed');

process.stdout.write([
  '\\set ON_ERROR_STOP on',
  `do $$ begin
     if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
     if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
     if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
   end $$;`,
  read('scripts/verify/new-dawn-open-job-page-bootstrap.sql'),
  `create schema supabase_migrations;
   create table supabase_migrations.schema_migrations(
     version text primary key,name text not null,statements text[] not null);`,
  'alter table public.learn_business_input_pages add primary key(id);',
  'alter table public.learn_business_input_versions add primary key(id);',
  sample.slice(0, seedStart),
  read('supabase/migrations/20261113000000_new_dawn_commusoft_current_job_source.sql'),
  sample.slice(seedStart, assertionsStart),
  `create table public.provider_connections (
     id uuid,tenant_id uuid,provider text,status text,revoked_at timestamptz);
   insert into public.provider_connections values(
     '22222222-2222-4222-8222-222222222222',
     '11111111-1111-4111-8111-111111111111','commusoft','configured',null);
   insert into public.feature_flags values(
     '11111111-1111-4111-8111-111111111111',
     'new_dawn.m2_link_review_queue','true');
   insert into public.feature_flags values(
     '00000000-0000-0000-0000-000000000001',
     'new_dawn.m2_link_review_queue','true');
   create function public.new_dawn_commusoft_exact_link_candidate(uuid,uuid,text)
   returns jsonb language sql as $$
     select '{"state":"review","reason":"site_mapping_missing_or_ambiguous"}'::jsonb $$;`,
  read('supabase/migrations/20261111170000_new_dawn_open_identity_priority.sql'),
  releaseSql(),
  `set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   set test.role='authenticated';
   do $$ declare page jsonb;begin
    page:=public.new_dawn_open_identity_review_page(
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222','Synthetic source review',null,1);
    if page->>'version'<>'new-dawn-open-identity-review/2'
     or page#>>'{rows,0,external_id}'<>'40'
     or page#>>'{rows,0,source_company_name}'<>'Synthetic customer'
     or page#>>'{rows,0,source_site_address}'<>'1 Example Road'
     or page#>>'{rows,0,source_site_postcode}'<>'AB1 2CD'
     or page#>>'{rows,0,hold_reason}'<>'site_mapping_missing_or_ambiguous'
    then raise exception 'triage source labels failed %',page;end if;
    if (select count(*) from supabase_migrations.schema_migrations
      where version='20261113040000'
       and name='new_dawn_open_identity_triage')<>1
    then raise exception 'triage release ledger missing';end if;
   end $$;`,
  read('supabase/release/new-dawn-open-identity-triage/rollback.sql'),
  read('supabase/migrations/20261113040000_new_dawn_open_identity_triage.sql'),
  `set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
   set test.role='authenticated';
   insert into public.learn_business_input_pages
    (id,tenant_id,provider,collection,connection_id,committed_at)
   values('90000000-0000-4000-8000-000000000050',
    '11111111-1111-4111-8111-111111111111','commusoft','jobs',
    '22222222-2222-4222-8222-222222222222',clock_timestamp()-interval '1 second');
   insert into public.learn_business_input_versions
    (id,tenant_id,connection_id,provider,collection,external_id,payload)
   values('30000000-0000-4000-8000-000000000050',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222','commusoft','jobs','50',
    '{"id":50,"status":"pending","propertyID":101}');
   insert into public.learn_business_input_observations(page_id,version_id)
   values('90000000-0000-4000-8000-000000000050',
    '30000000-0000-4000-8000-000000000050');
   do $$ declare first_page jsonb;next_page jsonb;begin
    begin
     perform public.new_dawn_open_identity_review_page(
      '33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222','Synthetic source review',null,1);
     raise exception 'wrong tenant admitted';
    exception when insufficient_privilege then null;end;
    begin
     perform public.new_dawn_open_identity_review_page(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222','Synthetic source review','bad cursor',1);
     raise exception 'bad cursor admitted';
    exception when invalid_parameter_value then null;end;
    first_page:=public.new_dawn_open_identity_review_page(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222','Synthetic source review',null,1);
    if first_page->>'next_cursor' is null then raise exception 'cursor missing';end if;
    insert into public.learn_business_input_pages
     (id,tenant_id,provider,collection,connection_id,committed_at)
    values('90000000-0000-4000-8000-000000000099',
     '11111111-1111-4111-8111-111111111111','commusoft','jobs',
     '22222222-2222-4222-8222-222222222222',clock_timestamp()+interval '1 minute');
    insert into public.learn_business_input_versions
     (id,tenant_id,connection_id,provider,collection,external_id,payload)
    values('30000000-0000-4000-8000-000000000099',
     '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222','commusoft','jobs','50',
     '{"id":50,"status":"Closed","propertyID":101}');
    insert into public.learn_business_input_observations(page_id,version_id)
    values('90000000-0000-4000-8000-000000000099',
     '30000000-0000-4000-8000-000000000099');
    next_page:=public.new_dawn_open_identity_review_page(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222','Synthetic source review',
      first_page->>'next_cursor',1);
    if next_page#>>'{rows,0,external_id}'='20' then
     next_page:=public.new_dawn_open_identity_review_page(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222','Synthetic source review',
      next_page->>'next_cursor',1);
    end if;
    if next_page#>>'{rows,0,external_id}'<>'50'
     or next_page#>>'{rows,0,status}'<>'pending'
     or (select count(*) from public.controlplane_change_log
      where action='client_jobs.open_identity_review_page')<3
    then raise exception 'snapshot or audit failed %',next_page;end if;
   end $$;
   select 'identity_triage_synthetic_pass' result;`,
].join('\n'));
