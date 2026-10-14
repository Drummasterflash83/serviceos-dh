-- Runs after the existing business-context fixture; all changes roll back.
reset role;
update public.profiles set role='owner' where id=pg_temp.bcid(10);
-- UUID order deliberately differs from creation order; ties and missing dates span pages.
update public.jobs set created_date=case
 when id in(pg_temp.bcid(125),pg_temp.bcid(126)) then null
 when id=pg_temp.bcid(101) then '2026-10-01T10:00:00Z'::timestamptz
 when id=pg_temp.bcid(102) then '2026-10-01T11:00:00+01:00'::timestamptz
 else '2026-09-01T00:00:00Z'::timestamptz+make_interval(days=>right(id::text,3)::integer-100) end
 where tenant_id=pg_temp.bcid(1) and customer_company_id=pg_temp.bcid(20);
set local role authenticated;
do $$declare a jsonb;b jsonb;legacy jsonb;begin
 a:=public.learn_customer_jobs_recent(pg_temp.bcid(1),pg_temp.bcid(30),'jobs');
 assert a->>'version'='learn-customer-jobs-recent/1' and a->>'order'='created_desc';
 assert a#>>'{rows,0,id}'=pg_temp.bcid(101)::text and a#>>'{rows,1,id}'=pg_temp.bcid(102)::text;
 assert a#>>'{rows,2,id}'=pg_temp.bcid(124)::text and a#>>'{rows,24,id}'=pg_temp.bcid(125)::text;
 assert jsonb_array_length(a->'rows')=25 and (a->>'total')::integer=26;
 assert a->>'next_after'=pg_temp.bcid(125)::text;
 assert a#>>'{rows,0,sources,0,version_id}'=pg_temp.bcid(400)::text;
 assert a::text not like '%NEVER_RETURN%' and a::text not like '%Foreign%' and a::text not like '%Unrelated%';
 b:=public.learn_customer_jobs_recent(pg_temp.bcid(1),pg_temp.bcid(30),'jobs',(a->>'next_after')::uuid);
 assert b#>>'{rows,0,id}'=pg_temp.bcid(126)::text and jsonb_array_length(b->'rows')=1 and b->'next_after'='null';
 b:=public.learn_customer_jobs_recent(pg_temp.bcid(1),pg_temp.bcid(30),'jobs',pg_temp.bcid(102));
 assert b#>>'{rows,0,id}'=pg_temp.bcid(124)::text and jsonb_array_length(b->'rows')=24;
 legacy:=public.learn_customer_business_context(pg_temp.bcid(1),pg_temp.bcid(30),'jobs');
 assert legacy->>'version'='learn-customer-business-context/1' and legacy#>>'{rows,2,id}'=pg_temp.bcid(103)::text;
 begin perform public.learn_customer_jobs_recent(pg_temp.bcid(1),pg_temp.bcid(30),'jobs',pg_temp.bcid(200));raise exception 'Foreign cursor';exception when invalid_parameter_value then assert sqlerrm='recent_jobs_cursor_unavailable';end;
 begin perform public.learn_customer_jobs_recent(pg_temp.bcid(1),pg_temp.bcid(30),'jobs',pg_temp.bcid(201));raise exception 'Unrelated cursor';exception when invalid_parameter_value then assert sqlerrm='recent_jobs_cursor_unavailable';end;
 begin perform public.learn_customer_jobs_recent(pg_temp.bcid(1),pg_temp.bcid(30),'sites');raise exception 'Wrong collection';exception when invalid_parameter_value then null;end;
 begin perform public.learn_customer_jobs_recent(pg_temp.bcid(2),pg_temp.bcid(31),'jobs');raise exception 'Foreign tenant';exception when insufficient_privilege then null;end;
end$$;
reset role;update public.profiles set role='viewer' where id=pg_temp.bcid(10);set local role authenticated;
do $$begin begin perform public.learn_customer_jobs_recent(pg_temp.bcid(1),pg_temp.bcid(30),'jobs');raise exception 'Viewer';exception when insufficient_privilege then null;end;end$$;
reset role;update public.platform_authority_grants set effective_to=clock_timestamp()+interval '5 minutes' where profile_id=pg_temp.bcid(10);set local role authenticated;
do $$declare a jsonb;begin
 a:=public.learn_customer_jobs_recent(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'Review selected client recent jobs');
 assert a->'operator_mode'='true' and a->>'audit_id' is not null and a#>>'{rows,0,id}'=pg_temp.bcid(200)::text;
end$$;
reset role;
do $$begin assert (select count(*)=1 from public.controlplane_change_log where actor=pg_temp.bcid(10)::text and source='learn-customer-jobs-recent');end$$;
create trigger synthetic_context_audit_failure before insert on public.controlplane_change_log for each row execute function pg_temp.reject_context_audit();set local role authenticated;
do $$begin begin perform public.learn_customer_jobs_recent(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'Audit failure');raise exception 'Audit failure leaked data' using errcode='XX000';exception when raise_exception then assert sqlerrm='synthetic_context_audit_failure';end;end$$;
reset role;drop trigger synthetic_context_audit_failure on public.controlplane_change_log;
update public.platform_authority_grants set effective_to=clock_timestamp()-interval '1 second' where profile_id=pg_temp.bcid(10);set local role authenticated;
do $$begin begin perform public.learn_customer_jobs_recent(pg_temp.bcid(2),pg_temp.bcid(31),'jobs',null,'Expired authority');raise exception 'Expired authority';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$begin
 assert not has_function_privilege('anon','public.learn_customer_jobs_recent(uuid,uuid,text,uuid,text)','execute');
 assert not has_function_privilege('service_role','public.learn_customer_jobs_recent(uuid,uuid,text,uuid,text)','execute');
end$$;
