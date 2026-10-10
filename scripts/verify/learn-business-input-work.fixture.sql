-- Synthetic pages flow through the actual permit/page/settlement functions.
do $$declare d text;begin
 d:=pg_get_functiondef('public.fixture_expected(uuid)'::regprocedure);
 execute replace(d,'c.tenant_id=a.tenant_id','c.tenant_id=a.tenant_id and c.id::text=a.settings->''commusoft_import''->>''connectionId''');
end$$;
create function fixture_work_page(resource text,envelope jsonb,connection uuid default fixture_id(5)) returns void language plpgsql as $$
declare job uuid:=gen_random_uuid();approval uuid:=gen_random_uuid();permit uuid;old_role text;begin
 old_role:=current_setting('request.jwt.claim.role',true);perform set_config('request.jwt.claim.role','service_role',true);
 update connector_accounts set sync_cursor='{}',settings=jsonb_set(jsonb_set(jsonb_set(settings,
  '{commusoft_import,connectionId}',to_jsonb(connection::text)),'{commusoft_import,approvalId}',to_jsonb(approval::text)),'{commusoft_import,resource}',to_jsonb(resource));
 update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
 insert into platform_jobs(id,tenant_id,job_type,status,payload,claimed_by,attempt_count,lease_expires_at,metadata,job_key)
  values(job,fixture_id(1),'commusoft.source_sync','running',jsonb_build_object('connector_account_id',fixture_id(3)),'fixture-worker',1,clock_timestamp()+interval '1 hour','{}','commusoft.source:'||fixture_id(3)||':'||approval);
 permit:=(fixture_acquire(jsonb_set(fixture_expected(job),'{request,resource}',to_jsonb(resource)),job)->>'permitId')::uuid;
 if permit is null then raise exception 'Synthetic work permit missing';end if;
 perform learn_commusoft_commit_page(fixture_id(1),job,'fixture-worker',1,permit,envelope);
 perform learn_commusoft_finish_job(fixture_id(1),job,'fixture-worker',1,'{"success":true}');
 perform set_config('request.jwt.claim.role',coalesce(old_role,''),true);
end $$;
create function fixture_work_version(collection text,external_id text) returns uuid language sql security definer set search_path=pg_catalog as $$
 select id from public.learn_business_input_versions v where v.tenant_id=public.fixture_id(1) and v.connection_id=public.fixture_id(5)
  and v.collection=$1 and v.external_id=$2 order by first_seen_at desc limit 1;
$$;
grant execute on function fixture_work_version(text,text) to authenticated;
select fixture_work_page('jobs','{"data":[
 {"id":101,"propertyID":4,"description":"Synthetic site job","status":"Open","createdOnDateTime":"2026-10-01T09:00:00Z"},
 {"id":102,"propertyID":2,"description":"Synthetic company job","status":"Complete","completed":{"completedOnDateTime":"2026-10-02T10:00:00+01:00"}},
 {"id":103,"propertyID":999,"status":"Open"},
 {"id":104,"propertyID":3,"status":"Closed","closed":{"closedOutcome":"aborted"}},
 {"id":105,"propertyID":3,"status":"Mystery"},
 {"id":106,"propertyID":3,"status":"Complete","createdOnDateTime":"2026-02-30T00:00:00Z"},
 {"id":107,"propertyID":"3","status":"Open"},
 {"id":108,"propertyID":3,"status":"Open"},
 {"id":109,"propertyID":3,"status":"Open"},
 {"id":110,"propertyID":3,"status":"Open"},
 {"id":111,"propertyID":3,"status":"Open"},
 {"id":112,"propertyID":{"bad":true},"status":"Open"},
 {"id":113,"propertyID":3,"status":"Complete","createdOnDateTime":"2026-10-01T24:00:00Z"},
 {"id":114,"propertyID":3,"status":"Complete","completed":[]}
],"pagination":{"hasMore":false,"nextCursor":114}}');
insert into jobs(id,tenant_id,source_system,external_id,job_number,customer_person_id,title,status,verified,metadata)
 values(fixture_id(88),fixture_id(1),'commusoft','108','108',fixture_id(83),'Existing protected job','manual_status',true,'{"manual":true}'),
 (fixture_id(89),fixture_id(1),'native','other','other',fixture_id(84),'Different owner job','open',true,'{}');
create table fixture_job_baseline as select to_jsonb(j) as value from jobs j where id=fixture_id(88);
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000080';
