-- Synthetic operator port for this isolated fixture. Production uses the
-- already-installed platform grant checker; this stub only exercises the new
-- reader's exact source join, response and audit path.
create function public.learn_operator_input_access(p_tenant uuid,p_actor uuid,p_write boolean)
returns void language plpgsql as $$begin
 if auth.role()<>'authenticated' or auth.uid() is distinct from p_actor
  or p_actor is distinct from public.fixture_id(80) or p_tenant is distinct from public.fixture_id(1)
  or p_write is distinct from true then raise exception 'synthetic_operator_forbidden' using errcode='42501';end if;
end$$;
create view public.learn_business_input_current_links as select * from public.learn_business_input_links;
create table public.controlplane_change_log (
 id uuid,tenant_id uuid,actor text,action text,resource_type text,resource_id text,
 after jsonb,reason text,correlation_id text,view_as_active boolean,source text
);
grant select on public.controlplane_change_log to authenticated;
grant select on public.jobs to authenticated;
-- The production reader's nested source read calls this existing review gate.
-- Fixture 80 is an authorised local source reviewer.
-- Reader assertions
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
set role authenticated;
do $$declare j uuid;r jsonb;begin
 select id into j from public.jobs where tenant_id=public.fixture_id(1) and external_id='111';
 assert j is not null,'Fixture linked job missing';
 r:=public.new_dawn_operator_job_source(public.fixture_id(1),j,'Inspect exact source');
 assert r->>'state'='linked','Linked source unavailable';
 assert r->'source'->>'version'='commusoft-job-detail/2','Wrong source contract';
 assert r->'source'->>'external_id'='111','Wrong Commusoft job selected';
 assert r->'source'->>'tenant_id'=public.fixture_id(1)::text,'Source crossed tenant';
 assert exists(select 1 from public.controlplane_change_log where action='client_jobs.source_detail'
  and resource_id=j::text and reason='Inspect exact source'),'Read audit missing';
 begin perform public.new_dawn_operator_job_source(public.fixture_id(2),j,'Inspect exact source');
  raise exception 'Foreign tenant admitted';exception when insufficient_privilege then null;end;
 begin perform public.new_dawn_operator_job_source(public.fixture_id(1),public.fixture_id(999),'Inspect exact source');
  raise exception 'Unknown job admitted';exception when insufficient_privilege then null;end;
end$$;
reset role;
begin;
update public.jobs set metadata='{}'::jsonb where tenant_id=public.fixture_id(1) and external_id='111';
set role authenticated;
do $$declare j uuid;r jsonb;begin
 select id into j from public.jobs where tenant_id=public.fixture_id(1) and external_id='111';
 r:=public.new_dawn_operator_job_source(public.fixture_id(1),j,'Review changed link');
 assert r->>'state'='review_required' and r->'source'='null'::jsonb,'Mismatched job metadata exposed source';
end$$;
reset role;
rollback;
select 'PASS: exact canonical/source join, denied scope, changed-link hold and audited read' as result;
