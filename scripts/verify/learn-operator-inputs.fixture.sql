-- Isolated fixture extensions only. No TEST/production execution.
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table profiles(id uuid primary key,tenant_id uuid,role text);
create table authority_permissions(permission text primary key);
insert into authority_permissions values('platform.controlplane.view'),('platform.controlplane.admin');
create table view_as_context(actor_user_id uuid,expires_at timestamptz,ended_at timestamptz);
create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=clock_timestamp();return new;end$$;
alter table feature_flags alter column id set default gen_random_uuid();
alter table tenant_connectors alter column id set default gen_random_uuid();
alter table tenant_connectors add column category text,add column settings jsonb default '{}';
alter table tenant_connectors add unique(tenant_id,connector_id);
alter table connector_accounts alter column id set default gen_random_uuid();
alter table connector_accounts alter column settings set default '{}';
alter table connector_accounts alter column sync_cursor set default '{}';
alter table connector_accounts add column display_name text;
alter table connector_accounts add unique(tenant_connector_id,account_key);
alter table platform_jobs add column created_by uuid;
create view vault.secrets as select id,name from vault.decrypted_secrets;
insert into tenants values(fixture_id(100),'active'),(fixture_id(101),'active');
insert into profiles values(fixture_id(180),fixture_id(101),'owner'),(fixture_id(181),fixture_id(100),'owner'),(fixture_id(182),fixture_id(101),'viewer');
insert into provider_connections values(fixture_id(105),fixture_id(100),'commusoft','configured','private_api_key',null,'2026-01-01Z','2026-01-01Z',
 '{"region":"uk","account_key":"synthetic-account"}',array['api_key'],jsonb_build_object('api_key',fixture_id(107)));
update platform_jobs set status='dead_letter';
create table fixture_input_definitions(name text primary key,definition jsonb);
insert into fixture_input_definitions values('enable',jsonb_build_object('kind','set_modules','reason','Synthetic setup',
 'expected',jsonb_build_object('learn.enabled',null,'learn.inputs.commusoft.enabled',null),
 'values',jsonb_build_object('learn.enabled',true,'learn.inputs.commusoft.enabled',true)));
insert into fixture_input_definitions values('start',jsonb_build_object('kind','start_commusoft','reason','Synthetic approval','connection_id',fixture_id(105),
 'revision','2026-01-01T00:00:00Z','resource','properties','max_pages',10,'page_size',50,'expires_at',clock_timestamp()+interval '1 hour'));
grant select on fixture_input_definitions to authenticated;
create function fixture_definition(n text) returns jsonb language sql stable as $$select definition from fixture_input_definitions where name=n$$;
grant execute on function fixture_id(integer),fixture_definition(text) to authenticated;
