/** Emit a disposable PostgreSQL test for the projected, cursor-paged job reader. */
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const bootstrap = read('scripts/verify/new-dawn-open-job-page-bootstrap.sql');
const original = read('supabase/migrations/20261110180000_new_dawn_job_creation_attention.sql');
const filtered = read('supabase/migrations/20261112230000_new_dawn_open_job_status_filter.sql');
const projection = read('supabase/migrations/20261113000000_new_dawn_commusoft_current_job_source.sql');
const candidate = read('supabase/migrations/20261113030000_new_dawn_open_job_page_current_source.sql');
const synthetic = read('scripts/verify/new-dawn-open-job-page-synthetic.sql');
const firstFunction = original.indexOf('create or replace function public.new_dawn_open_job_page_base(');
const seedStart = synthetic.indexOf('insert into auth.users(');
const assertStart = synthetic.indexOf("set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';");
if (firstFunction < 0 || seedStart < 0 || assertStart < seedStart)
  throw Error('synthetic_fixture_changed');

process.stdout.write([
  '\\set ON_ERROR_STOP on',
  'create role anon; create role authenticated; create role service_role;',
  bootstrap,
  'alter table public.learn_business_input_pages add primary key(id);',
  'alter table public.learn_business_input_versions add primary key(id);',
  synthetic.slice(0, seedStart),
  original.slice(firstFunction),
  filtered,
  projection,
  synthetic.slice(seedStart, assertStart),
  candidate,
  synthetic.slice(assertStart),
  `update public.feature_flags set value='true'::jsonb
   where flag='new_dawn.open_job_page';
   do $$
   declare first_page jsonb; later_page jsonb; anchor timestamptz;
   begin
    first_page:=public.new_dawn_open_job_page(
     '11111111-1111-4111-8111-111111111111',null,null,null,1);
    anchor:=(first_page->>'snapshot_at')::timestamptz;
    insert into public.learn_business_input_pages
     (id,tenant_id,provider,collection,connection_id,committed_at)
     values('90000000-0000-4000-8000-000000000003',
      '11111111-1111-4111-8111-111111111111','commusoft','jobs',
      '22222222-2222-4222-8222-222222222222',anchor+interval '1 second');
    insert into public.learn_business_input_versions
     (id,tenant_id,connection_id,provider,collection,external_id,payload)
     values('30000000-0000-4000-8000-000000000021',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222','commusoft','jobs','20',
      '{"id":20,"status":"Closed","propertyID":101}');
    insert into public.learn_business_input_observations(page_id,version_id)
     values('90000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000021');
    later_page:=public.new_dawn_open_job_page(
     '11111111-1111-4111-8111-111111111111',null,
     first_page->>'next_cursor',null,1);
    if later_page#>>'{rows,0,external_id}'<>'20'
     or later_page#>>'{rows,0,status}'<>'pending' then
     raise exception 'snapshot page failed %',later_page; end if;
   end $$;
   select 'page_current_source_synthetic_pass' result;`,
].join('\n'));
