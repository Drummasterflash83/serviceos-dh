-- Synthetic, isolated database only. Produces the checkpoint through the real
-- credential permit, page publication and worker settlement functions.
insert into platform_authority_grants(profile_id,permission,granted_by) values(fixture_id(180),'platform.controlplane.admin','synthetic'),(fixture_id(182),'platform.controlplane.view','synthetic');
insert into vault.decrypted_secrets values(fixture_id(107),'provider_secret:'||fixture_id(100)||':commusoft:api_key','SYNTHETIC_NO_NETWORK');
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(190),fixture_id(180),fixture_definition('enable'))->>'state';
select learn_operator_input_request(fixture_id(100),fixture_id(194),fixture_id(180),fixture_definition('start')||'{"max_pages":1}')->>'state';
reset role;
create table fixture_resume_state(name text primary key,value jsonb);
create function fixture_capture(p_id integer,p_more boolean) returns jsonb language plpgsql as $$
declare j platform_jobs%rowtype;a connector_accounts%rowtype;c provider_connections%rowtype;b jsonb;r jsonb;begin
 select * into j from learn_commusoft_claim_jobs(fixture_id(170));
 if j.id is null then raise exception 'No synthetic job claimed';end if;
 select * into a from connector_accounts where id=(j.payload->>'connector_account_id')::uuid;
 select * into c from provider_connections where id=(a.settings->'commusoft_import'->>'connectionId')::uuid;
 b:=jsonb_build_object('tenantId',a.tenant_id,'jobId',j.id,'accountId',a.id,'connectorId',a.tenant_connector_id,'connectionId',c.id,'connectionRevision',c.updated_at,'secretId',c.secret_refs->>'api_key','approval',a.settings->'commusoft_import','checkpoint',a.sync_cursor,'pages',coalesce(a.sync_cursor->'pages','0'::jsonb),'complete',coalesce(a.sync_cursor->'complete','false'::jsonb),'request',jsonb_build_object('region','uk','resource',a.settings->'commusoft_import'->>'resource','after',a.sync_cursor->'after','limit',a.settings->'commusoft_import'->'pageSize'));
 r:=learn_commusoft_acquire_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,b);
 if r->>'state' is distinct from 'ready' then raise exception 'Synthetic permit unavailable';end if;
 perform learn_commusoft_commit_page(a.tenant_id,j.id,j.claimed_by,j.attempt_count,(r->>'permitId')::uuid,jsonb_build_object('data',jsonb_build_array(jsonb_build_object('id',p_id,'type','customer','name','Synthetic retained customer')),'pagination',jsonb_build_object('hasMore',p_more,'nextCursor',p_id)));
 return learn_commusoft_finish_job(a.tenant_id,j.id,j.claimed_by,j.attempt_count,'{"success":true}');
end$$;
set request.jwt.claim.role='service_role';select fixture_capture(101,true);reset request.jwt.claim.role;
create function fixture_resume_definition() returns jsonb language sql as $$
 select jsonb_build_object('kind','resume_commusoft','reason','Reviewed retained progress','account_id',a.id,'approval_id',a.settings->'commusoft_import'->>'approvalId','job_id',j.id,'connection_id',fixture_id(105),'revision','2026-01-01T00:00:00Z','checkpoint',jsonb_build_object('approvalId',a.sync_cursor->'approvalId','pages',a.sync_cursor->'pages','after',a.sync_cursor->'after','complete',a.sync_cursor->'complete'),'max_pages',3,'expires_at',clock_timestamp()+interval '2 hours')
 from connector_accounts a join lateral(select id from platform_jobs where tenant_id=a.tenant_id and payload->>'connector_account_id'=a.id::text order by created_at desc,id desc limit 1) j on true where a.tenant_id=fixture_id(100)
$$;
insert into fixture_input_definitions values('resume',fixture_resume_definition());
insert into fixture_resume_state select 'before',jsonb_build_object('checkpoint',sync_cursor,'settings',settings,'pages',(select jsonb_agg(to_jsonb(p)) from learn_business_input_pages p)) from connector_accounts where tenant_id=fixture_id(100);
-- Assert failures by SQLSTATE, never swallowing a missing rejection.
create function fixture_resume_fails(d jsonb,expected text) returns void language plpgsql as $$begin
 begin perform learn_operator_resume_commusoft(fixture_id(100),fixture_id(219),auth.uid(),d);exception when others then
  if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection %',expected;
end$$;
grant execute on function fixture_resume_fails(jsonb,text) to authenticated;
set request.jwt.claim.role='authenticated';set role authenticated;
select fixture_resume_fails(fixture_definition('resume')||'{"max_pages":1}','22023');
select fixture_resume_fails(fixture_definition('resume')||'{"resource":"jobs"}','22023');
select fixture_resume_fails(fixture_definition('resume')||jsonb_build_object('job_id',fixture_id(1)),'PT409');
select fixture_resume_fails(fixture_definition('resume')||jsonb_build_object('account_id',fixture_id(3)),'PT409');
select fixture_resume_fails(jsonb_set(fixture_definition('resume'),'{checkpoint,after}','102'),'PT409');
select fixture_resume_fails(fixture_definition('resume')||'{"revision":"2026-02-01Z"}','PT409');
select fixture_resume_fails(fixture_definition('resume')||'{"expires_at":"2026-01-01Z"}','22023');
select learn_operator_resume_commusoft(fixture_id(100),fixture_id(218),fixture_id(180),fixture_definition('resume'),'cancel')->>'state';
do $$begin if learn_operator_resume_commusoft(fixture_id(100),fixture_id(218),fixture_id(180),fixture_definition('resume'))->>'state'<>'cancelled' then raise exception 'Late apply bypassed cancellation';end if;end$$;
reset role;
update feature_flags set value='false' where tenant_id=fixture_id(100) and flag='learn.inputs.commusoft.enabled';
set role authenticated;select fixture_resume_fails(fixture_definition('resume'),'55000');reset role;
update feature_flags set value='true' where tenant_id=fixture_id(100);
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;select fixture_resume_fails(fixture_definition('resume'),'42501');reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';set role authenticated;select fixture_resume_fails(fixture_definition('resume'),'42501');reset role;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';
insert into view_as_context values(fixture_id(180),clock_timestamp()+interval '1 hour',null);
set role authenticated;select fixture_resume_fails(fixture_definition('resume'),'42501');reset role;delete from view_as_context;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(180);
set role authenticated;select fixture_resume_fails(fixture_definition('resume'),'42501');reset role;
update platform_authority_grants set effective_to=null where profile_id=fixture_id(180);
-- Late failure rolls back both the limit change and new queue record.
create function fixture_resume_reject() returns trigger language plpgsql as $$begin if new.id=public.fixture_id(219) then raise exception 'Synthetic receipt failure' using errcode='P0002';end if;return new;end$$;
create trigger fixture_resume_reject before insert on learn_operator_input_requests for each row execute function fixture_resume_reject();
set role authenticated;select fixture_resume_fails(fixture_definition('resume'),'P0002');reset role;
do $$begin if (select count(*) from platform_jobs where tenant_id=fixture_id(100))<>1 or (select settings from connector_accounts where tenant_id=fixture_id(100)) is distinct from (select value->'settings' from fixture_resume_state where name='before') then raise exception 'Late failure left mutations';end if;end$$;
set role authenticated;
select learn_operator_resume_commusoft(fixture_id(100),fixture_id(220),fixture_id(180),fixture_definition('resume'))->>'state';
select fixture_resume_fails(fixture_definition('resume'),'55000');
do $$declare r jsonb;begin
 r:=learn_operator_resume_commusoft(fixture_id(100),fixture_id(220),fixture_id(180),fixture_definition('resume'),'check');
 if r is distinct from learn_operator_resume_commusoft(fixture_id(100),fixture_id(220),fixture_id(180),fixture_definition('resume')) then raise exception 'Receipt changed on replay';end if;
end$$;
reset role;
do $$declare a connector_accounts%rowtype;j platform_jobs%rowtype;begin
 select * into a from connector_accounts where tenant_id=fixture_id(100);
 select * into j from platform_jobs where tenant_id=fixture_id(100) and status='queued';
 if a.sync_cursor is distinct from (select value->'checkpoint' from fixture_resume_state where name='before')
  or ((a.settings->'commusoft_import')-array['maxPages','expiresAt']) is distinct from (select (value->'settings'->'commusoft_import')-array['maxPages','expiresAt'] from fixture_resume_state where name='before')
  or j.parent_job_id::text is distinct from fixture_definition('resume')->>'job_id'
  or (select jsonb_agg(to_jsonb(p)) from learn_business_input_pages p) is distinct from (select value->'pages' from fixture_resume_state where name='before') then raise exception 'Continuation changed retained state';end if;
 if has_function_privilege('anon','learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text)','execute') or has_function_privilege('service_role','learn_operator_resume_commusoft(uuid,uuid,uuid,jsonb,text)','execute') then raise exception 'Resume grants broadened';end if;
end$$;
-- Worker consumes the preserved cursor and the extended approval; publication
-- and settlement remain unmodified production functions. Only fixture pacing is moved.
update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
set request.jwt.claim.role='service_role';select fixture_capture(102,false);reset request.jwt.claim.role;
do $$begin if (select sync_cursor->>'pages' from connector_accounts where tenant_id=fixture_id(100))<>'2' or (select sync_cursor->>'after' from connector_accounts where tenant_id=fixture_id(100))<>'102' or (select sync_cursor->>'complete' from connector_accounts where tenant_id=fixture_id(100))<>'true' then raise exception 'Worker did not continue retained cursor';end if;end$$;
insert into fixture_input_definitions values('complete',fixture_resume_definition());
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_resume_fails(fixture_definition('complete'),'PT409');reset role;
-- A new collection may fail before its first page. It resumes from the empty
-- checkpoint, retaining its own approval identity and its terminal failed job.
update fixture_input_definitions set definition=jsonb_set(definition,'{expires_at}',to_jsonb(clock_timestamp()+interval '1 hour')) where name='start';
set role authenticated;select learn_operator_input_request(fixture_id(100),fixture_id(225),fixture_id(180),fixture_definition('start')||'{"max_pages":2,"resource":"jobs"}')->>'state';reset role;
update platform_jobs set status='dead_letter',error_code='commusoft_transport_failed' where tenant_id=fixture_id(100) and status='queued';
insert into fixture_input_definitions values('race',fixture_resume_definition());
select 'Resume limits, authority, cancellation, immutable history, failure rollback and actual worker continuation passed';
