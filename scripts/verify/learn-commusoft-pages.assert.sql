set request.jwt.claim.role='service_role';
create table public.fixture_page_state(permit uuid,receipt jsonb,envelope jsonb);
insert into public.fixture_page_state select (fixture_acquire()->>'permitId')::uuid,null,
  '{"meta":{"serverTime":"fixture","unknown":"retained"},"data":[{"id":1,"type":"customer","extra":{"original":true}},{"id":2,"type":"workaddress","parentPropertyID":1}],"pagination":{"hasMore":true,"nextCursor":2}}'::jsonb;
do $$declare p uuid; env jsonb; receipt jsonb; cp jsonb; original jsonb;begin
  select permit,envelope into p,env from fixture_page_state;
  if p is null then raise exception 'fixture permit missing';end if;
  if learn_commusoft_committed_page(fixture_id(1),fixture_id(2),'fixture-worker',1) is not null then raise exception 'uncommitted receipt invented';end if;
  if has_function_privilege('authenticated','learn_commusoft_commit_page(uuid,uuid,text,integer,uuid,jsonb)','execute')
    or has_table_privilege('authenticated','learn_business_input_versions','select')
    or has_table_privilege('service_role','learn_business_input_pages','insert') then raise exception 'source grants unsafe';end if;
  begin perform learn_commusoft_commit_page(fixture_id(99),fixture_id(2),'fixture-worker',1,p,env);raise exception 'foreign tenant accepted';exception when insufficient_privilege then null;end;
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'other-worker',1,p,env);raise exception 'foreign worker accepted';exception when insufficient_privilege then null;end;
  update feature_flags set value='false' where flag='learn.enabled';
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,env);raise exception 'disabled module accepted';exception when insufficient_privilege then null;end;
  update feature_flags set value='true' where flag='learn.enabled';
  update provider_connections set revoked_at=clock_timestamp();
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,env);raise exception 'revoked connection accepted';exception when insufficient_privilege then null;end;
  update provider_connections set revoked_at=null;
  update connector_accounts set sync_cursor='{"approvalId":"changed"}';
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,env);raise exception 'changed checkpoint accepted';exception when sqlstate 'PT409' then null;end;
  update connector_accounts set sync_cursor='{}';
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,jsonb_set(env,'{data,1,id}','1'));raise exception 'duplicate source accepted';exception when invalid_parameter_value then null;end;
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,jsonb_set(env,'{pagination,nextCursor}','99'));raise exception 'bad cursor accepted';exception when invalid_parameter_value then null;end;
  if exists(select 1 from learn_business_input_pages) or exists(select 1 from learn_business_input_versions)
    or (select sync_cursor from connector_accounts)<>'{}'::jsonb then raise exception 'denied writes left data';end if;
end $$;
-- Force a late failure after pages/versions are inserted: the transaction must undo all.
create function public.fixture_fail_checkpoint() returns trigger language plpgsql as $$begin raise exception 'injected checkpoint failure';end$$;
create trigger fixture_fail_checkpoint before update on connector_accounts for each row execute function public.fixture_fail_checkpoint();
do $$declare p uuid;env jsonb;begin
  select permit,envelope into p,env from fixture_page_state;
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,env);raise exception 'expected injected failure';
  exception when raise_exception then if sqlerrm<>'injected checkpoint failure' then raise;end if;end;
  if exists(select 1 from learn_business_input_pages) or exists(select 1 from learn_business_input_versions)
    or exists(select 1 from learn_business_input_observations) or (select metadata from platform_jobs where id=fixture_id(2))<>'{}'::jsonb then raise exception 'atomic rollback failed';end if;
end $$;
drop trigger fixture_fail_checkpoint on connector_accounts;
-- Fail even later, after cursor advancement but before job receipt completion.
create trigger fixture_fail_receipt before update on platform_jobs for each row execute function public.fixture_fail_checkpoint();
do $$declare p uuid;env jsonb;begin
  select permit,envelope into p,env from fixture_page_state;
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,env);raise exception 'expected injected failure';
  exception when raise_exception then if sqlerrm<>'injected checkpoint failure' then raise;end if;end;
  if exists(select 1 from learn_business_input_pages) or exists(select 1 from learn_business_input_versions)
    or exists(select 1 from learn_business_input_observations) or (select sync_cursor from connector_accounts)<>'{}'::jsonb then raise exception 'receipt failure left source or cursor';end if;
end $$;
drop trigger fixture_fail_receipt on platform_jobs;
grant select,update on fixture_page_state to service_role;
set role service_role;
update fixture_page_state set receipt=learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,permit,envelope);
reset role;
do $$declare p uuid;env jsonb;receipt jsonb;again jsonb;begin
  select permit,envelope,s.receipt into p,env,receipt from fixture_page_state s;
  if (select count(*) from learn_business_input_pages)<>1 or (select count(*) from learn_business_input_versions)<>2
    or (select count(*) from learn_business_input_observations)<>2 then raise exception 'source counts incorrect';end if;
  if (select envelope from learn_business_input_pages) is distinct from env then raise exception 'raw envelope changed';end if;
  if (select sync_cursor from connector_accounts) is distinct from receipt->'checkpoint' or receipt->'checkpoint'->>'after'<>'2'
    or receipt->'checkpoint'->>'complete'<>'false' then raise exception 'checkpoint not committed';end if;
  if (select metadata->'commusoft_page_v1' from platform_jobs where id=fixture_id(2)) is distinct from receipt then raise exception 'job receipt missing';end if;
  -- Lost-response replay is an acknowledgement, including after lease expiry/revocation.
  update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=fixture_id(2);
  update feature_flags set value='false';
  again:=learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,env);
  if again->>'already'<>'true' or again-'already' is distinct from receipt-'already' then raise exception 'replay changed receipt';end if;
  begin perform learn_commusoft_commit_page(fixture_id(1),fixture_id(2),'fixture-worker',1,p,jsonb_set(env,'{data,0,type}','"changed"'));raise exception 'changed replay accepted';exception when sqlstate 'PT409' then null;end;
  update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 hour',attempt_count=2 where id=fixture_id(2);
  again:=learn_commusoft_committed_page(fixture_id(1),fixture_id(2),'fixture-worker',2);
  if again->>'already'<>'true' or again-'already' is distinct from receipt-'already' then raise exception 'new-attempt recovery failed';end if;
  begin perform learn_commusoft_committed_page(fixture_id(1),fixture_id(2),'fixture-worker',1);raise exception 'stale attempt recovered receipt';exception when insufficient_privilege then null;end;
  begin
    update platform_jobs set metadata='{}' where id=fixture_id(2);
    perform learn_commusoft_committed_page(fixture_id(1),fixture_id(2),'fixture-worker',2);
    raise exception 'tampered receipt accepted';
  exception when sqlstate 'PT409' then null;end;
  update feature_flags set value='true';
  if learn_commusoft_acquire_page(fixture_id(1),fixture_id(2),'fixture-worker',2,fixture_expected()) is not null then raise exception 'committed job acquired another page';end if;
  begin update learn_business_input_versions set payload='{}';raise exception 'version rewrite accepted';exception when insufficient_privilege then null;end;
  begin delete from learn_business_input_pages;raise exception 'page deletion accepted';exception when insufficient_privilege then null;end;
  begin truncate learn_business_input_observations;raise exception 'observation truncate accepted';exception when insufficient_privilege then null;end;
  if (select count(*) from learn_business_input_pages)<>1 or (select count(*) from learn_business_input_versions)<>2 then raise exception 'history changed';end if;
end $$;
-- A new approval can observe the same source again; identical content reuses a
-- version but each new page has an observation. A changed payload retains both.
-- First finish the existing approval from its committed cursor in another job.
update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
insert into platform_jobs select fixture_id(11),tenant_id,job_type,'running',payload,claimed_by,1,clock_timestamp()+interval '1 hour','{}' from platform_jobs where id=fixture_id(2);
do $$declare p uuid;receipt jsonb;begin
  p:=(fixture_acquire(fixture_expected(fixture_id(11)),fixture_id(11))->>'permitId')::uuid;
  receipt:=learn_commusoft_commit_page(fixture_id(1),fixture_id(11),'fixture-worker',1,p,
    '{"data":[{"id":3,"type":"customer"}],"pagination":{"hasMore":false,"nextCursor":3}}');
  if receipt->'checkpoint'->>'pages'<>'2' or receipt->'checkpoint'->>'complete'<>'true'
    or (select checkpoint_before->>'after' from learn_business_input_pages where job_id=fixture_id(11))<>'2'
    or (select count(*) from learn_business_input_versions)<>3 then raise exception 'cursor continuation failed';end if;
end $$;
update connector_accounts set sync_cursor='{}',settings=jsonb_set(settings,'{commusoft_import,approvalId}',to_jsonb(fixture_id(16)::text));
update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
insert into platform_jobs select fixture_id(12),tenant_id,job_type,'running',payload,claimed_by,1,clock_timestamp()+interval '1 hour','{}' from platform_jobs where id=fixture_id(2);
do $$declare p uuid;receipt jsonb;begin
  p:=(fixture_acquire(fixture_expected(fixture_id(12)),fixture_id(12))->>'permitId')::uuid;
  receipt:=learn_commusoft_commit_page(fixture_id(1),fixture_id(12),'fixture-worker',1,p,
    '{"data":[{"id":1,"type":"customer","extra":{"original":true}},{"id":2,"type":"workaddress","parentPropertyID":1,"note":"new revision"}],"pagination":{"hasMore":false,"nextCursor":2}}');
  if (select count(*) from learn_business_input_pages)<>3 or (select count(*) from learn_business_input_versions)<>4
    or (select count(*) from learn_business_input_observations)<>5 then raise exception 'version retention/deduplication failed';end if;
  if receipt->'checkpoint'->>'complete'<>'true' or receipt->'checkpoint'->'after'<>'null'::jsonb then raise exception 'terminal checkpoint incorrect';end if;
end $$;
select 'atomic source storage, authority, replay, retained versions and rollback assertions passed' as result;
