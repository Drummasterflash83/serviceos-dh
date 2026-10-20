-- Run in a disposable database after the open-page bootstrap, 092000 base,
-- 101700 status-evidence migration, its synthetic fixture, and 101800 migration.
set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set test.role='authenticated';
update public.learn_business_input_versions
 set payload=payload||'{"createdOnDateTime":"2026-10-20T04:00:00Z"}'::jsonb
 where id='30000000-0000-4000-8000-000000000040';
update public.learn_business_input_versions
 set payload=payload||'{"createdOnDateTime":"2026-09-20T04:00:00Z"}'::jsonb
 where id='30000000-0000-4000-8000-000000000020';
insert into public.learn_business_input_versions
 (id,tenant_id,connection_id,provider,collection,external_id,payload) values
 ('30000000-0000-4000-8000-000000000050',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','commusoft','jobs','50',
  '{"id":50,"status":"on_hold","propertyID":101,"createdOnDateTime":"2023-07-03T20:51:01Z"}'),
 ('30000000-0000-4000-8000-000000000060',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','commusoft','jobs','60',
  '{"id":60,"status":"on_hold","propertyID":101,"createdOnDateTime":"2026-06-26T08:42:02Z"}'),
 ('30000000-0000-4000-8000-000000000070',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','commusoft','jobs','70',
  '{"id":70,"status":"on_hold","propertyID":101,"createdOnDateTime":""}'),
 ('30000000-0000-4000-8000-000000000080',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222','commusoft','jobs','80',
  '{"id":80,"status":"on_hold","propertyID":101,"createdOnDateTime":"2026-02-30T00:00:00Z"}');
insert into public.learn_business_input_observations(page_id,version_id)
 select '90000000-0000-4000-8000-000000000004',id
 from public.learn_business_input_versions where external_id in('50','60','70','80');
do $$
declare first_page jsonb; next_page jsonb; cursor_value text;
 ids text[]:=array[]::text[]; i integer; page jsonb;
begin
 first_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,null,1);
 if first_page->>'version'<>'new-dawn-open-job-page/3'
  or first_page#>>'{rows,0,external_id}'<>'50'
  or first_page#>>'{rows,0,job_created_at}' is null then
  raise exception 'oldest On-hold creation not first %',first_page;end if;
 cursor_value:=first_page->>'next_cursor';
 ids:=array_append(ids,first_page#>>'{rows,0,external_id}');
 for i in 2..6 loop
  next_page:=public.new_dawn_open_job_page(
   '11111111-1111-4111-8111-111111111111',null,cursor_value,null,1);
  ids:=array_append(ids,next_page#>>'{rows,0,external_id}');
  cursor_value:=next_page->>'next_cursor';
 end loop;
 if ids<>array['50','60','40','70','80','20'] or cursor_value is not null then
  raise exception 'keyset page boundary wrong %',ids;end if;
 if (select count(*) from public.controlplane_change_log
  where action='client_jobs.open_page_read')<6 then
  raise exception 'paged reads lost audit';end if;
 begin
  perform public.new_dawn_open_job_page(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,'on_hold',1);
  raise exception 'wrong tenant passed';
 exception when insufficient_privilege then null;end;
 begin
  perform public.new_dawn_open_job_page(
   '11111111-1111-4111-8111-111111111111',null,
   encode(convert_to('{"v":1}'::text,'utf8'),'base64'),null,1);
  raise exception 'old cursor passed';
 exception when invalid_parameter_value then null;end;
end $$;
do $$
declare first_page jsonb; later_page jsonb; fresh_page jsonb;
 source_at timestamptz;
begin
 first_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,'on_hold',1);
 insert into public.learn_business_input_pages
  (id,tenant_id,provider,collection,connection_id,committed_at) values
  ('90000000-0000-4000-8000-000000000009',
   '11111111-1111-4111-8111-111111111111','commusoft','jobs',
   '22222222-2222-4222-8222-222222222222',clock_timestamp())
  returning committed_at into source_at;
 if source_at<=(first_page->>'snapshot_at')::timestamptz then
  raise exception 'fixture source must arrive after page anchor';end if;
 insert into public.learn_business_input_versions
  (id,tenant_id,connection_id,provider,collection,external_id,payload) values
  ('30000000-0000-4000-8000-000000000090',
   '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222','commusoft','jobs','90',
   '{"id":90,"status":"on_hold","propertyID":101,"createdOnDateTime":"2020-01-01T00:00:00Z"}');
 insert into public.learn_business_input_observations(page_id,version_id) values
  ('90000000-0000-4000-8000-000000000009',
   '30000000-0000-4000-8000-000000000090');
 later_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,
  first_page->>'next_cursor','on_hold',1);
 if later_page#>>'{rows,0,external_id}'<>'60' then
  raise exception 'post-anchor job disturbed existing page %',later_page;end if;
 fresh_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,'on_hold',1);
 if fresh_page#>>'{rows,0,external_id}'<>'90' then
  raise exception 'new snapshot failed to include new oldest job %',fresh_page;end if;
end $$;
