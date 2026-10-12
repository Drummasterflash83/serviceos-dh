-- Caller-permission search against actual production RLS, no source imports.
create function pg_temp.cs(n int) returns uuid language sql immutable as $$select ('ce121100-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.cs(int) to authenticated;
insert into tenants(id,slug,display_name) values(pg_temp.cs(1),'card-search-a','Synthetic A'),(pg_temp.cs(2),'card-search-b','Synthetic B');
insert into auth.users(id,email,banned_until) values(pg_temp.cs(10),'production-card-search@example.invalid','infinity');
update profiles set tenant_id=pg_temp.cs(1),role='owner' where id=pg_temp.cs(10);
insert into customer_cards(id,tenant_id,title) select pg_temp.cs(n),pg_temp.cs(1),'Synthetic searchable card '||n from generate_series(100,130)n;
insert into customer_cards(id,tenant_id,title) values(pg_temp.cs(200),pg_temp.cs(2),'Synthetic searchable foreign'),(pg_temp.cs(201),pg_temp.cs(1),'Literal %_ search');
insert into jobs(id,tenant_id,title,job_number) values(pg_temp.cs(300),pg_temp.cs(1),'Synthetic visit','JOB-SEARCH-123');
insert into org_units(id,tenant_id,name,kind) values(pg_temp.cs(400),pg_temp.cs(1),'Synthetic search team','team');
insert into team_members(id,tenant_id,display_name,formal_role,org_unit_id) values(pg_temp.cs(401),pg_temp.cs(1),'Synthetic search member','Engineer',pg_temp.cs(400));
set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='ce121100-aaaa-4000-8000-000000000010';set local role authenticated;
do $$declare a jsonb;b jsonb;begin
 a:=learn_card_search(pg_temp.cs(1),'customer','searchable',0);b:=learn_card_search(pg_temp.cs(1),'customer','searchable',1);
 assert jsonb_array_length(a->'rows')=24 and a->'hasMore'='true';
 assert jsonb_array_length(b->'rows')=7 and b->'hasMore'='false';
 assert not exists(select 1 from jsonb_array_elements(a->'rows')x join jsonb_array_elements(b->'rows')y on x->>'id'=y->>'id');
 assert jsonb_array_length(learn_card_search(pg_temp.cs(1),'customer','%_')->'rows')=1;
 assert jsonb_array_length(learn_card_search(pg_temp.cs(2),'customer','searchable')->'rows')=0;
 assert jsonb_array_length(learn_card_search(pg_temp.cs(1),'job','JOB-SEARCH')->'rows')=1;
 assert jsonb_array_length(learn_card_search(pg_temp.cs(1),'team','search',0,pg_temp.cs(400))->'rows')=1;
 assert jsonb_array_length(learn_card_search(pg_temp.cs(1),'member','Engineer',0,pg_temp.cs(400))->'rows')=1;
 assert jsonb_array_length(learn_card_search(pg_temp.cs(1),'member','Engineer',0,pg_temp.cs(999))->'rows')=0;
 begin perform learn_card_search(pg_temp.cs(1),'customer','');raise exception 'Empty query accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_card_search(pg_temp.cs(1),'customer','search',-1);raise exception 'Negative page accepted';exception when invalid_parameter_value then null;end;
end$$;reset role;
update profiles set tenant_id=null where id=pg_temp.cs(10);
set local role authenticated;
do $$begin assert jsonb_array_length(learn_card_search(pg_temp.cs(1),'customer','searchable')->'rows')=0;end$$;reset role;
