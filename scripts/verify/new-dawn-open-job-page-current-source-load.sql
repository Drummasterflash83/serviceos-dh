\set ON_ERROR_STOP on
create index perf_versions_scope on public.learn_business_input_versions
 (tenant_id,connection_id,provider,collection,external_id);
create index perf_observations_version on public.learn_business_input_observations(version_id);

insert into public.learn_business_input_pages
 (id,tenant_id,provider,collection,connection_id,committed_at)
select md5('synthetic-page-'||n)::uuid,
 '11111111-1111-4111-8111-111111111111','commusoft','jobs',
 '22222222-2222-4222-8222-222222222222',
 timestamptz '2026-10-20 06:00:00+00'+n*interval '1 minute'
from generate_series(1,8) n;

insert into public.learn_business_input_versions
 (id,tenant_id,connection_id,provider,collection,external_id,payload)
select md5('synthetic-job-'||n)::uuid,
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222','commusoft','jobs',
 (n+1000)::text,
 jsonb_build_object('id',n+1000,
  'status',case when n<=70 then 'on_hold' when n<=78 then 'pending'
   when n<=335 then 'Open' else 'Closed' end,
  'propertyID',101,'description','Synthetic job '||n,
  'createdOnDateTime',to_char(timestamp '2026-01-01'+(n%250)*interval '1 day',
   'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
from generate_series(1,15000) n;

alter table public.learn_business_input_observations
 disable trigger new_dawn_commusoft_current_job_source_observe;
insert into public.learn_business_input_observations(page_id,version_id)
select md5('synthetic-page-'||p)::uuid,md5('synthetic-job-'||n)::uuid
from generate_series(1,7) p cross join generate_series(1,15000) n;
alter table public.learn_business_input_observations
 enable trigger new_dawn_commusoft_current_job_source_observe;
insert into public.learn_business_input_observations(page_id,version_id)
select md5('synthetic-page-8')::uuid,md5('synthetic-job-'||n)::uuid
from generate_series(1,15000) n;

analyze public.learn_business_input_pages;
analyze public.learn_business_input_versions;
analyze public.learn_business_input_observations;
analyze public.new_dawn_commusoft_current_job_source;
update public.feature_flags set value='true'::jsonb
where flag='new_dawn.open_job_page';
set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set test.role='authenticated';

select (select count(*) from public.new_dawn_commusoft_current_job_source)
 as projected_keys,
 (select count(*) from public.learn_business_input_observations)
 as observations;

do $$
declare first_page jsonb; second_page jsonb; hold_page jsonb;
 t0 timestamptz; first_ms numeric; second_ms numeric; hold_ms numeric;
begin
 t0:=clock_timestamp();
 first_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,null,40);
 first_ms:=extract(epoch from clock_timestamp()-t0)*1000;
 if jsonb_array_length(first_page->'rows')<>40 or first_page->>'next_cursor' is null
 then raise exception 'synthetic_first_page_incomplete';end if;
 t0:=clock_timestamp();
 second_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,first_page->>'next_cursor',null,40);
 second_ms:=extract(epoch from clock_timestamp()-t0)*1000;
 if jsonb_array_length(second_page->'rows')<>40
 then raise exception 'synthetic_second_page_incomplete';end if;
 t0:=clock_timestamp();
 hold_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,'on_hold',40);
 hold_ms:=extract(epoch from clock_timestamp()-t0)*1000;
 if jsonb_array_length(hold_page->'rows')<>40
  or exists(select 1 from jsonb_array_elements(hold_page->'rows') j
   where j->>'status'<>'on_hold')
 then raise exception 'synthetic_on_hold_page_incomplete';end if;
 raise notice 'synthetic_paging_ms first=% second=% on_hold=%',
  round(first_ms,1),round(second_ms,1),round(hold_ms,1);
end $$;
