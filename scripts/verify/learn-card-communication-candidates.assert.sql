-- Run in a networkless production-schema clone, inside a rolled-back transaction.
-- The harness supplies the exact prior reader with the same restricted owner.
create function pg_temp.cc(n int) returns uuid language sql immutable as $$select ('ce180000-aaaa-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
grant execute on function pg_temp.cc(int) to authenticated,learn_card_communication_reader;
insert into tenants(id,slug,display_name) values(pg_temp.cc(1),'candidate-reader','Synthetic reader');
insert into auth.users(id,email,banned_until) values(pg_temp.cc(10),'candidate-reader@example.invalid','infinity');
update profiles set tenant_id=pg_temp.cc(1),role='owner' where id=pg_temp.cc(10);
insert into people(id,tenant_id,display_name) values(pg_temp.cc(20),pg_temp.cc(1),'Synthetic person');
insert into companies(id,tenant_id,name) values(pg_temp.cc(21),pg_temp.cc(1),'Synthetic company');
insert into interactions(id,tenant_id,source_connector_id,source_type,source_table,source_id,interaction_type,occurred_at,related_person_id,related_company_id,body_preview)
select pg_temp.cc(100+n),pg_temp.cc(1),'gmail','email','email_messages',gen_random_uuid(),'email_message','2026-10-01T10:00:00Z'::timestamptz-n*interval '1 second',case when n<=3 then pg_temp.cc(20) end,case when n between 3 and 5 then pg_temp.cc(21) end,'Synthetic retained excerpt'
from generate_series(1,5000)n;
analyze interactions;
set local request.jwt.claim.sub='ce180000-aaaa-4000-8000-000000000010';
set local request.jwt.claim.role='authenticated';
set local role authenticated;
set local plan_cache_mode=force_generic_plan;
do $$declare a jsonb;b jsonb;begin
 a:=learn_card_communications_read(pg_temp.cc(1),p_person=>pg_temp.cc(20));
 b:=verify_communication_reader_baseline(pg_temp.cc(1),p_person=>pg_temp.cc(20));
 assert a=b and jsonb_array_length(a->'rows')=3,'Person reader changed';
 a:=learn_card_communications_read(pg_temp.cc(1),p_person=>pg_temp.cc(20),p_company=>pg_temp.cc(21));
 b:=verify_communication_reader_baseline(pg_temp.cc(1),p_person=>pg_temp.cc(20),p_company=>pg_temp.cc(21));
 assert a=b and jsonb_array_length(a->'rows')=5,'Overlapping scopes changed or duplicated';
 a:=learn_card_communications_read(pg_temp.cc(1),p_ids=>array[pg_temp.cc(101),pg_temp.cc(5000)]);
 b:=verify_communication_reader_baseline(pg_temp.cc(1),p_ids=>array[pg_temp.cc(101),pg_temp.cc(5000)]);
 assert a=b and jsonb_array_length(a->'rows')=2,'ID reader changed';
end$$;
reset role;
-- Fault injection makes unnecessary source inspection observable instead of
-- relying on a machine-specific elapsed-time threshold.
do $$declare d text;begin
 d:=pg_get_functiondef('public.learn_interaction_is_draft(uuid,text,uuid)'::regprocedure);
 execute replace(d,'public.learn_interaction_is_draft(', 'public.verify_candidate_draft_baseline(');
end$$;
grant execute on function public.verify_candidate_draft_baseline(uuid,text,uuid) to learn_card_communication_reader;
create or replace function public.learn_interaction_is_draft(p_tenant uuid,p_table text,p_source uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.interactions where tenant_id='ce180000-aaaa-4000-8000-000000000001' and source_id=p_source and related_person_id is null and related_company_id is null) then
  raise exception 'Unrelated source inspected';
 end if;
 return public.verify_candidate_draft_baseline(p_tenant,p_table,p_source);
end$$;
set local role authenticated;
do $$declare failed boolean:=false;r jsonb;begin
 begin perform verify_communication_reader_baseline(pg_temp.cc(1),p_person=>pg_temp.cc(20));
 exception when raise_exception then
  if sqlerrm<>'Unrelated source inspected' then raise;end if;failed:=true;
 end;
 assert failed,'Baseline did not reproduce unrelated source scan';
 r:=learn_card_communications_read(pg_temp.cc(1),p_person=>pg_temp.cc(20));
 assert jsonb_array_length(r->'rows')=3,'Scoped reader lost evidence';
end$$;
reset role;
