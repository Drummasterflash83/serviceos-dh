-- A real captured predecessor near the 2 MiB retained-history bound.
create table working_http_fixture(starts timestamptz,ends timestamptz);
grant select on working_http_fixture to authenticated;
insert into intelligence_objects(id,tenant_id,domain,object_type,object_class,subject,status,responsible_ref,attributes) values
 ('eee50000-0000-4000-8000-000000090001','aaa50000-0000-4000-8000-000000000001','serviceos','Action','action','Synthetic large source','ready',
 '{"kind":"member","ref":"ddd50000-0000-4000-8000-000000000001"}',jsonb_build_object('synthetic',repeat('z',900000)));
insert into working_http_fixture(starts) values(clock_timestamp());
select pg_sleep(.01);
update working_http_fixture set ends=clock_timestamp();
