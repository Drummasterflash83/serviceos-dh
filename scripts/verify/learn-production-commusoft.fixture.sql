-- Offline restored production schema only, inside a rolled-back transaction.
-- Reuse real auth, operator authority and encrypted Vault; never replace them.
create function fixture_id(n integer) returns uuid language sql immutable as $$
 select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
do $$begin
 assert not exists(select 1 from tenants where id in(fixture_id(100),fixture_id(101)));
 assert not exists(select 1 from auth.users where id in(fixture_id(180),fixture_id(181),fixture_id(182)));
end$$;
insert into tenants(id,slug,display_name,status) values
 (fixture_id(100),'commusoft-offline-one','Synthetic Commusoft company','active'),
 (fixture_id(101),'commusoft-offline-two','Synthetic other company','active');
insert into auth.users(id,banned_until) values(fixture_id(180),'infinity'),(fixture_id(181),'infinity'),(fixture_id(182),'infinity');
update profiles set tenant_id=fixture_id(101),role='owner' where id=fixture_id(180);
update profiles set tenant_id=fixture_id(100),role='owner' where id=fixture_id(181);
update profiles set tenant_id=fixture_id(101),role='viewer' where id=fixture_id(182);
do $$begin
 perform vault.create_secret('SYNTHETIC_NO_NETWORK','provider_secret:'||fixture_id(100)||':commusoft:api_key');
end$$;
insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,updated_at,non_secret_config,configured_fields,secret_refs)
 values(fixture_id(105),fixture_id(100),'commusoft','configured','private_api_key','2026-01-01Z','2026-01-01Z',
 '{"region":"uk","account_key":"synthetic-account"}',array['api_key'],
 jsonb_build_object('api_key',(select id from vault.secrets where name='provider_secret:'||fixture_id(100)||':commusoft:api_key')));
create table fixture_input_definitions(name text primary key,definition jsonb);
insert into fixture_input_definitions values('enable',jsonb_build_object('kind','set_modules','reason','Synthetic setup',
 'expected',jsonb_build_object('learn.enabled',null,'learn.inputs.commusoft.enabled',null),
 'values',jsonb_build_object('learn.enabled',true,'learn.inputs.commusoft.enabled',true)));
insert into fixture_input_definitions values('start',jsonb_build_object('kind','start_commusoft','reason','Synthetic approval','connection_id',fixture_id(105),
 'revision','2026-01-01T00:00:00Z','resource','properties','max_pages',10,'page_size',50,'expires_at',clock_timestamp()+interval '1 hour'));
grant select on fixture_input_definitions to authenticated;
create function fixture_definition(n text) returns jsonb language sql stable as $$select definition from fixture_input_definitions where name=n$$;
grant execute on function fixture_id(integer),fixture_definition(text) to authenticated;
