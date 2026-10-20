create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('test.actor',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$
 select current_setting('test.role',true) $$;
create table auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
create table public.profiles(id uuid,tenant_id uuid,role text);
create table public.tenants(id uuid,status text);
create table public.view_as_context(actor_user_id uuid,ended_at timestamptz,expires_at timestamptz);
create table public.platform_authority_grants(profile_id uuid,permission text,effective_from timestamptz,effective_to timestamptz);
create table public.feature_flags(tenant_id uuid,flag text,value jsonb);
alter table public.learn_business_input_versions add column tenant_id uuid;
alter table public.learn_business_input_versions add column connection_id uuid;
alter table public.learn_business_input_versions add column provider text;
alter table public.learn_business_input_versions add column collection text;
alter table public.learn_business_input_versions add column external_id text;
create table public.learn_business_input_observations(page_id uuid,version_id uuid);
create table public.learn_business_input_current_links(
 tenant_id uuid,connection_id uuid,provider text,collection text,external_id text,
 entity_kind text,entity_table text,entity_id uuid,source_version_id uuid
);
create table public.jobs(id uuid,tenant_id uuid,metadata jsonb);
create table public.controlplane_change_log(
 id uuid,tenant_id uuid,actor text,action text,resource_type text,resource_id text,
 after jsonb,reason text,correlation_id text,view_as_active boolean,source text
);
create function public.learn_operator_input_access(uuid,uuid,boolean)
returns boolean language sql as $$select true$$;
create function public.learn_business_input_latest(uuid,uuid,text,text,text)
returns public.learn_business_input_versions language sql as $$
 select v from public.learn_business_input_versions v
 where v.tenant_id=$1 and v.connection_id=$2 and v.provider=$3
  and v.collection=$4 and v.external_id=$5 order by v.id limit 1 $$;

insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.tenants values('11111111-1111-4111-8111-111111111111','active');
insert into public.profiles values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner');
insert into public.feature_flags values
 ('11111111-1111-4111-8111-111111111111','new_dawn.open_job_page','true'),
 ('11111111-1111-4111-8111-111111111111','new_dawn.open_job_page.operator_preview','true');
insert into public.learn_business_input_pages(id,tenant_id,provider,collection,connection_id,committed_at)
 values
 ('90000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','commusoft','jobs','22222222-2222-4222-8222-222222222222','2026-10-20 05:00+00'),
 ('90000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','commusoft','properties','22222222-2222-4222-8222-222222222222','2026-10-20 05:00+00');
insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,payload)
values
 ('30000000-0000-4000-8000-000000000010','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','commusoft','jobs','10','{"id":10,"status":"Open","propertyID":101,"description":"Repair"}'),
 ('30000000-0000-4000-8000-000000000020','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','commusoft','jobs','20','{"id":20,"status":"pending","propertyID":101,"description":"Check"}'),
 ('30000000-0000-4000-8000-000000000030','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','commusoft','jobs','30','{"id":30,"status":"Closed","propertyID":101}'),
 ('30000000-0000-4000-8000-000000000040','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','commusoft','jobs','40','{"id":40,"status":"on_hold","propertyID":101}'),
 ('30000000-0000-4000-8000-000000000100','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','commusoft','properties','100','{"id":100,"type":"customer","companyName":"Synthetic customer"}'),
 ('30000000-0000-4000-8000-000000000101','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','commusoft','properties','101','{"id":101,"type":"workaddress","parentPropertyID":100,"addressLine1":"1 Example Road","postcode":"AB1 2CD"}');
insert into public.learn_business_input_observations(page_id,version_id)
select '90000000-0000-4000-8000-000000000001',id from public.learn_business_input_versions where collection='jobs';
insert into public.learn_business_input_observations(page_id,version_id)
select '90000000-0000-4000-8000-000000000002',id from public.learn_business_input_versions where collection='properties';
insert into public.jobs values('44444444-4444-4444-8444-444444444444',
 '11111111-1111-4111-8111-111111111111',
 '{"learn_business_input":{"source_version_id":"30000000-0000-4000-8000-000000000010"}}');
insert into public.learn_business_input_current_links values(
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 'commusoft','jobs','10','job','jobs','44444444-4444-4444-8444-444444444444',
 '30000000-0000-4000-8000-000000000010');

set test.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set test.role='authenticated';
do $$
declare first_page jsonb;second_page jsonb;third_page jsonb;
begin
 first_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,null,1);
 if first_page#>>'{rows,0,external_id}'<>'40'
  or first_page->>'next_cursor' is null
  or first_page#>>'{rows,0,identity_state}'<>'awaiting_review' then
  raise exception 'first page failed %',first_page;end if;
 second_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,
  first_page->>'next_cursor',null,1);
 if second_page#>>'{rows,0,external_id}'<>'20'
  or second_page->>'next_cursor' is null
  or second_page#>>'{rows,0,source_customer}'<>'Synthetic customer' then
  raise exception 'second page failed %',second_page;end if;
 third_page:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,
  second_page->>'next_cursor',null,1);
 if third_page#>>'{rows,0,external_id}'<>'10'
  or third_page->>'next_cursor' is not null
  or third_page#>>'{rows,0,identity_state}'<>'reviewed_link' then
  raise exception 'third page failed %',third_page;end if;
 if (select count(*) from public.controlplane_change_log where action='client_jobs.open_page_read')<>3
  then raise exception 'audit count failed';end if;
end $$;
do $$
begin
 begin
  perform public.new_dawn_open_job_page(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null,null,null,1);
  raise exception 'wrong tenant passed';
 exception when insufficient_privilege then null;end;
 begin
  perform public.new_dawn_open_job_page(
   '11111111-1111-4111-8111-111111111111',null,'bad cursor',null,1);
  raise exception 'bad cursor passed';
 exception when invalid_parameter_value then null;end;
end $$;
do $$
declare filtered jsonb;preview jsonb;
begin
 filtered:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,'open',40);
 if jsonb_array_length(filtered->'rows')<>1
  or filtered#>>'{rows,0,external_id}'<>'10'
  or filtered->>'next_cursor' is not null then
  raise exception 'saved status filter failed';end if;
 preview:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111','Synthetic operator preview',null,null,40);
 if jsonb_array_length(preview->'rows')<>3
  or (select count(*) from public.controlplane_change_log
   where action='client_jobs.open_page_preview')<>1 then
  raise exception 'operator read/audit failed';end if;
end $$;
insert into public.learn_business_input_versions(id,tenant_id,connection_id,provider,collection,external_id,payload)
values('30000000-0000-4000-8000-000000000011',
 '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 'commusoft','jobs','10','{"id":10,"status":"Closed","propertyID":101}');
insert into public.learn_business_input_observations(page_id,version_id)
values('90000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000011');
do $$
declare filtered jsonb;
begin
 filtered:=public.new_dawn_open_job_page(
  '11111111-1111-4111-8111-111111111111',null,null,'open',40);
 if jsonb_array_length(filtered->'rows')<>0 then
  raise exception 'equal-time conflicting latest source was exposed';end if;
end $$;
update public.feature_flags set value='false'::jsonb
where flag='new_dawn.open_job_page';
do $$
begin
 begin
  perform public.new_dawn_open_job_page(
   '11111111-1111-4111-8111-111111111111',null,null,null,40);
  raise exception 'client flag denial failed';
 exception when insufficient_privilege then null;end;
end $$;
