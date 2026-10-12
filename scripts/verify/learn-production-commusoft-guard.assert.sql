-- Caller wraps this synthetic scope in a transaction and rolls it back.
insert into public.tenants(id,slug,display_name) values
 ('fc900000-0000-4000-8000-000000000001','commusoft-guard-one','Synthetic guard one'),
 ('fc900000-0000-4000-8000-000000000002','commusoft-guard-two','Synthetic guard two');
insert into public.people(id,tenant_id,display_name) values
 ('fc900000-0000-4000-8000-000000000003','fc900000-0000-4000-8000-000000000001','Synthetic valid contact'),
 ('fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000002','Synthetic foreign contact');
-- A caller's temporary relation must not impersonate the canonical person table.
create temp table people(id uuid,tenant_id uuid);
insert into pg_temp.people values('fc900000-0000-4000-8000-000000000004','fc900000-0000-4000-8000-000000000001');
set local search_path=pg_temp,pg_catalog;
do $$begin
 insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value)
 values('fc900000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000003','email','valid@example.invalid','valid@example.invalid');
 begin
  insert into public.contact_points(tenant_id,person_id,channel,value,normalized_value)
  values('fc900000-0000-4000-8000-000000000001','fc900000-0000-4000-8000-000000000004','email','foreign@example.invalid','foreign@example.invalid');
  raise exception 'Foreign person was accepted';
 exception when integrity_constraint_violation then
  if sqlerrm<>'cross-tenant person reference' then raise;end if;
 end;
 assert not exists(select 1 from public.contact_points where tenant_id='fc900000-0000-4000-8000-000000000001' and person_id='fc900000-0000-4000-8000-000000000004');
end$$;
