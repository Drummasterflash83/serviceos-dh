-- Only synthetic rows in the disposable reproduction of TEST's actual schema.
create function fixture_id(n integer) returns uuid language sql immutable as $$select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into tenants(id,slug,display_name,status) values(fixture_id(100),'resume-client','Synthetic resume client','active'),(fixture_id(101),'resume-operator','Synthetic operator company','active');
insert into auth.users(id,email) values(fixture_id(180),'resume-admin@example.invalid'),(fixture_id(181),'resume-owner@example.invalid'),(fixture_id(182),'resume-viewer@example.invalid');
insert into profiles(id,tenant_id,role) values(fixture_id(180),fixture_id(101),'owner'),(fixture_id(181),fixture_id(100),'owner'),(fixture_id(182),fixture_id(101),'viewer');
insert into authority_permissions(permission,category,description) values('platform.controlplane.admin','platform','Synthetic administrator'),('platform.controlplane.view','platform','Synthetic viewer');
select vault.create_secret('SYNTHETIC_NO_NETWORK','provider_secret:'||fixture_id(100)||':commusoft:api_key','Disposable synthetic credential');
insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,updated_at,non_secret_config,configured_fields,secret_refs)
 values(fixture_id(105),fixture_id(100),'commusoft','configured','private_api_key','2026-01-01Z','2026-01-01Z','{"region":"uk","account_key":"synthetic-account"}',array['api_key'],jsonb_build_object('api_key',(select id from vault.secrets where name='provider_secret:'||fixture_id(100)||':commusoft:api_key')));
create table fixture_input_definitions(name text primary key,definition jsonb);
insert into fixture_input_definitions values('enable',jsonb_build_object('kind','set_modules','reason','Synthetic setup','expected',jsonb_build_object('learn.enabled',null,'learn.inputs.commusoft.enabled',null),'values',jsonb_build_object('learn.enabled',true,'learn.inputs.commusoft.enabled',true)));
insert into fixture_input_definitions values('start',jsonb_build_object('kind','start_commusoft','reason','Synthetic approval','connection_id',fixture_id(105),'revision','2026-01-01T00:00:00Z','resource','properties','max_pages',10,'page_size',50,'expires_at',clock_timestamp()+interval '1 hour'));
grant select on fixture_input_definitions to authenticated;
create function fixture_definition(n text) returns jsonb language sql stable as $$select definition from fixture_input_definitions where name=n$$;
grant execute on function fixture_id(integer),fixture_definition(text) to authenticated;
