\set ON_ERROR_STOP on
-- Run after new-dawn-open-identity-triage-synthetic.mjs in an isolated DB.
-- This checks gross history-scan regression; local timing is not LIVE latency.
create index triage_perf_versions_scope on public.learn_business_input_versions
 (tenant_id,connection_id,provider,collection,external_id);
create index triage_perf_observations_version on public.learn_business_input_observations(version_id);

insert into public.learn_business_input_pages
 (id,tenant_id,provider,collection,connection_id,committed_at)
select md5('triage-synthetic-page-'||n)::uuid,
 '11111111-1111-4111-8111-111111111111','commusoft','jobs',
 '22222222-2222-4222-8222-222222222222',
 timestamptz '2026-10-20 06:00:00+00'+n*interval '1 minute'
from generate_series(1,8) n;

insert into public.learn_business_input_versions
 (id,tenant_id,connection_id,provider,collection,external_id,payload)
select md5('triage-synthetic-job-'||n)::uuid,
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222','commusoft','jobs',
 (n+1000)::text,
 jsonb_build_object('id',n+1000,
  'status',case when n<=70 then 'on_hold' when n<=78 then 'pending'
   when n<=335 then 'Open' else 'Closed' end,
  'propertyID',101,'description','Synthetic job '||n)
from generate_series(1,15000) n;

alter table public.learn_business_input_observations
 disable trigger new_dawn_commusoft_current_job_source_observe;
insert into public.learn_business_input_observations(page_id,version_id)
select md5('triage-synthetic-page-'||p)::uuid,
 md5('triage-synthetic-job-'||n)::uuid
from generate_series(1,7) p cross join generate_series(1,15000) n;
alter table public.learn_business_input_observations
 enable trigger new_dawn_commusoft_current_job_source_observe;
insert into public.learn_business_input_observations(page_id,version_id)
select md5('triage-synthetic-page-8')::uuid,
 md5('triage-synthetic-job-'||n)::uuid
from generate_series(1,15000) n;

analyze public.learn_business_input_pages;
analyze public.learn_business_input_versions;
analyze public.learn_business_input_observations;
analyze public.new_dawn_commusoft_current_job_source;
set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set test.role='authenticated';

select (select count(*) from public.new_dawn_commusoft_current_job_source)
 as projected_keys,
 (select count(*) from public.learn_business_input_observations)
 as observations;

do $$
declare first_page jsonb; second_page jsonb;
 t0 timestamptz; first_ms numeric; second_ms numeric;
begin
 t0:=clock_timestamp();
 first_page:=public.new_dawn_open_identity_review_page(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Synthetic source review',null,40);
 first_ms:=extract(epoch from clock_timestamp()-t0)*1000;
 if jsonb_array_length(first_page->'rows')<>40 or
  first_page->>'next_cursor' is null or
  (first_page->>'total_unlinked')::int<300
 then raise exception 'triage_load_first_page_incomplete';end if;
 t0:=clock_timestamp();
 second_page:=public.new_dawn_open_identity_review_page(
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'Synthetic source review',first_page->>'next_cursor',40);
 second_ms:=extract(epoch from clock_timestamp()-t0)*1000;
 if jsonb_array_length(second_page->'rows')<>40
 then raise exception 'triage_load_second_page_incomplete';end if;
 raise notice 'triage_synthetic_paging_ms first=% second=%',
  round(first_ms,1),round(second_ms,1);
end $$;
