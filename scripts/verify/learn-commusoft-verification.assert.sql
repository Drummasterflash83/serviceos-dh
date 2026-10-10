-- Synthetic identities and fake Vault values in a network-isolated container.
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
select learn_commusoft_configure(fixture_id(300),fixture_id(399),fixture_id(180),fixture_connection_definition(),'apply','SYNTHETIC_VERIFICATION_KEY')->>'state';
reset role;
create table fixture_v_transport(n integer primary key,value jsonb);
grant select,insert on fixture_v_transport to service_role;
create function fixture_v_prepare(n integer) returns void language plpgsql as $$begin
 insert into fixture_input_definitions(name,definition)
 select 'verify-'||n,jsonb_build_object('kind','verify_commusoft','reason','Synthetic access check','connection_id',id,'revision',updated_at,'one_read_confirmed',true)
 from provider_connections where tenant_id=fixture_id(300);
 -- Reset the synthetic clock gate between independent scenarios only.
 update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
end$$;
create function fixture_v_request(n integer,mode text default 'apply') returns jsonb language sql as $$
 select learn_commusoft_verify_request(fixture_id(300),fixture_id(n),fixture_id(180),fixture_definition('verify-'||n),mode)$$;
create function fixture_v_finish(n integer,code text default 'access_verified',retry_at timestamptz default null) returns jsonb language sql as $$
 select learn_commusoft_verify_finish(fixture_id(300),fixture_id(n),(select (value->>'permitId')::uuid from fixture_v_transport where fixture_v_transport.n=$1),code,retry_at)$$;
create function fixture_v_authorized(n integer) returns boolean language sql as $$
 select learn_commusoft_verify_authorized(fixture_id(300),fixture_id(n),(select (value->>'permitId')::uuid from fixture_v_transport where fixture_v_transport.n=$1))$$;
select fixture_v_prepare(400),fixture_v_prepare(401),fixture_v_prepare(402);
set role authenticated;
do $$begin
 if fixture_v_request(400,'check')->>'state'<>'pending' then raise exception 'Missing request fabricated';end if;
 begin perform learn_commusoft_verify_request(fixture_id(300),fixture_id(400),fixture_id(181),fixture_definition('verify-400'));raise exception 'Forged actor accepted';exception when insufficient_privilege then null;end;
 begin perform learn_commusoft_verify_request(fixture_id(300),fixture_id(400),fixture_id(180),fixture_definition('verify-400')||'{"api_key":"must-not-retain"}','cancel');raise exception 'Unknown definition retained';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_verify_request(fixture_id(300),fixture_id(400),fixture_id(180),fixture_definition('verify-400')||'{"one_read_confirmed":false}');raise exception 'Unapproved read accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_commusoft_verify_request(fixture_id(300),fixture_id(400),fixture_id(180),fixture_definition('verify-400')||'{"revision":"2020-01-01Z"}');raise exception 'Stale revision accepted';exception when sqlstate 'PT409' then null;end;
 if fixture_v_request(401,'cancel')->>'state'<>'cancelled' or fixture_v_request(401)->>'state'<>'cancelled' then raise exception 'Cancellation failed';end if;
 if fixture_v_request(400)->>'state'<>'approved' or fixture_v_request(400)->>'state'<>'approved' then raise exception 'Approval replay failed';end if;
 begin perform fixture_v_request(402);raise exception 'Overlapping verification approved';exception when object_not_in_prerequisite_state then null;end;
 begin perform learn_commusoft_verify_request(fixture_id(301),fixture_id(400),fixture_id(180),fixture_definition('verify-400'),'check');raise exception 'Foreign tenant accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_commusoft_verify_request(fixture_id(300),fixture_id(400),fixture_id(180),fixture_definition('verify-400')||'{"reason":"changed"}','check');raise exception 'Conflicting replay accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_commusoft_verify_acquire(fixture_id(300),fixture_id(400));raise exception 'User released key';exception when insufficient_privilege then null;end;
 begin perform * from learn_commusoft_verification_requests;raise exception 'User read private requests';exception when insufficient_privilege then null;end;
end$$;
reset role;set request.jwt.claim.role='service_role';set role service_role;
do $$begin
 begin perform fixture_v_request(400);raise exception 'Service forged operator approval';exception when insufficient_privilege then null;end;
 if learn_commusoft_verify_acquire(fixture_id(301),fixture_id(400)) is not null
  or learn_commusoft_verify_acquire(fixture_id(300),fixture_id(401)) is not null then raise exception 'Foreign/cancelled permit issued';end if;
end$$;
insert into fixture_v_transport values(400,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(400)));
do $$begin
 if (select value->>'state' from fixture_v_transport where n=400)<>'ready' or not fixture_v_authorized(400) then raise exception 'Approved permit missing';end if;
 if learn_commusoft_verify_acquire(fixture_id(300),fixture_id(400)) is not null then raise exception 'Second key release';end if;
 begin perform * from learn_commusoft_verification_permits;raise exception 'Service read raw permit';exception when insufficient_privilege then null;end;
 if fixture_v_finish(400)->>'code'<>'access_verified' or fixture_v_finish(400)->>'code'<>'access_verified' then raise exception 'Successful result lost';end if;
 begin perform fixture_v_finish(400,'access_denied');raise exception 'Conflicting result accepted';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
do $$begin
 if (select verified_at from provider_connections where tenant_id=fixture_id(300)) is null
  or (select count(*) from provider_connection_events where tenant_id=fixture_id(300) and event='learn_connection_checked')<>1 then raise exception 'Success did not commit once';end if;
 if exists(select 1 from feature_flags where tenant_id=fixture_id(300)) or exists(select 1 from platform_jobs where tenant_id=fixture_id(300)) then raise exception 'Verification started imports';end if;
 if has_function_privilege('service_role','learn_commusoft_verification_receipt(uuid,uuid)','EXECUTE')
  or has_function_privilege('authenticated','learn_commusoft_verification_binding(provider_connections)','EXECUTE') then raise exception 'Internal helpers exposed';end if;
 begin update learn_commusoft_verification_requests set definition='{}';raise exception 'Request mutable';exception when object_not_in_prerequisite_state then null;end;
 begin delete from learn_commusoft_verification_permits;raise exception 'Permit mutable';exception when object_not_in_prerequisite_state then null;end;
 begin delete from learn_commusoft_verification_results;raise exception 'Result mutable';exception when object_not_in_prerequisite_state then null;end;
end$$;
set request.jwt.claim.role='authenticated';set role authenticated;
do $$begin if fixture_v_request(400,'check')->>'code'<>'access_verified' then raise exception 'Lost reply not recoverable';end if;end$$;
reset role;
-- A rejected credential clears old verification, without erasing its old result.
select fixture_v_prepare(403);
set role authenticated;select fixture_v_request(403)->>'state';reset role;
set request.jwt.claim.role='service_role';set role service_role;
insert into fixture_v_transport values(403,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(403)));
select fixture_v_finish(403,'authentication_required')->>'code';reset role;
do $$begin if (select verified_at from provider_connections where tenant_id=fixture_id(300)) is not null
 or (select receipt->>'code' from learn_commusoft_verification_results where request_id=fixture_id(400))<>'access_verified' then raise exception 'Failure corrupted verification history';end if;end$$;
-- Shared ingestion gate controls verification; waiting never issues a permit.
select fixture_v_prepare(404);
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(404)->>'state';reset role;
update learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '10 minutes';
set request.jwt.claim.role='service_role';set role service_role;
do $$begin if learn_commusoft_verify_acquire(fixture_id(300),fixture_id(404))->>'state'<>'wait' then raise exception 'Shared quota ignored';end if;end$$;
reset role;
do $$begin if exists(select 1 from learn_commusoft_verification_permits where request_id=fixture_id(404)) then raise exception 'Wait issued permit';end if;end$$;
update learn_business_input_request_gates set next_allowed_at=clock_timestamp()-interval '1 second';
set role service_role;insert into fixture_v_transport values(404,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(404)));reset role;
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(404,'cancel')->>'state';reset role;
set request.jwt.claim.role='service_role';set role service_role;
do $$begin
 if fixture_v_authorized(404) then raise exception 'Cancelled read authorized';end if;
 if fixture_v_finish(404,'rate_limited',clock_timestamp()+interval '10 minutes')->>'state'<>'cancelled' then raise exception 'Late result uncancelled';end if;
end$$;reset role;
do $$begin if not exists(select 1 from learn_business_input_request_gates where next_allowed_at>clock_timestamp()+interval '9 minutes') then raise exception 'Late quota discarded';end if;end$$;
-- Current authority is checked after approval AND after a provider read.
select fixture_v_prepare(405);
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(405)->>'state';reset role;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(180);
set request.jwt.claim.role='service_role';set role service_role;
do $$begin if learn_commusoft_verify_acquire(fixture_id(300),fixture_id(405)) is not null then raise exception 'Revoked actor released credential';end if;end$$;reset role;
update platform_authority_grants set effective_to=null where profile_id=fixture_id(180);
insert into view_as_context values(fixture_id(180),clock_timestamp()+interval '1 hour',null);
set role service_role;
do $$begin if learn_commusoft_verify_acquire(fixture_id(300),fixture_id(405)) is not null then raise exception 'View As released credential';end if;end$$;reset role;delete from view_as_context;
set role service_role;insert into fixture_v_transport values(405,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(405)));reset role;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(180);
set role service_role;
do $$begin if fixture_v_authorized(405) or fixture_v_finish(405)->>'code'<>'authority_changed' then raise exception 'Revoked actor verified';end if;end$$;reset role;
update platform_authority_grants set effective_to=null where profile_id=fixture_id(180);
-- In-place key change at the same Vault ID invalidates the issued permit.
select fixture_v_prepare(406);
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(406)->>'state';reset role;
set request.jwt.claim.role='service_role';set role service_role;insert into fixture_v_transport values(406,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(406)));reset role;
update vault.decrypted_secrets set decrypted_secret='SYNTHETIC_ROTATED_KEY' where name='provider_secret:'||fixture_id(300)||':commusoft:api_key';
set role service_role;
do $$begin if fixture_v_authorized(406) or fixture_v_finish(406)->>'code'<>'authority_changed' then raise exception 'Changed key verified';end if;end$$;reset role;
-- A late result cannot overwrite a newer configuration, even if the key is reused.
select fixture_v_prepare(407);
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(407)->>'state';reset role;
set request.jwt.claim.role='service_role';set role service_role;insert into fixture_v_transport values(407,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(407)));reset role;
insert into fixture_input_definitions select 'reconfigure',fixture_connection_definition('reuse',updated_at) from provider_connections where tenant_id=fixture_id(300);
set request.jwt.claim.role='authenticated';set role authenticated;
select learn_commusoft_configure(fixture_id(300),fixture_id(408),fixture_id(180),fixture_definition('reconfigure'))->>'state';reset role;
set request.jwt.claim.role='service_role';set role service_role;
do $$begin if fixture_v_authorized(407) or fixture_v_finish(407)->>'code'<>'authority_changed' then raise exception 'Old configuration verified';end if;end$$;reset role;
-- Expiry represents an interrupted invocation; it never authorizes another send.
select fixture_v_prepare(409);
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(409)->>'state';reset role;
set request.jwt.claim.role='service_role';set role service_role;insert into fixture_v_transport values(409,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(409)));reset role;
-- Fixture-only time passage injection, after separately proving immutability.
alter table learn_commusoft_verification_requests disable trigger learn_commusoft_verification_request_immutable;
update learn_commusoft_verification_requests set expires_at=clock_timestamp()-interval '1 second' where id=fixture_id(409);
alter table learn_commusoft_verification_requests enable trigger learn_commusoft_verification_request_immutable;
set request.jwt.claim.role='authenticated';set role authenticated;
do $$begin if fixture_v_request(409,'check')->>'state'<>'expired' or fixture_v_request(409)->>'state'<>'expired' then raise exception 'Expired request restarted';end if;end$$;reset role;
set request.jwt.claim.role='service_role';set role service_role;
do $$begin if fixture_v_authorized(409) or fixture_v_finish(409)->>'code'<>'authority_changed' then raise exception 'Expired request verified';end if;end$$;reset role;
-- Fail after connection/audit writes: the entire success rolls back, then the same
-- issued permit can settle its observed result without acquiring another key.
select fixture_v_prepare(410);
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(410)->>'state';reset role;
set request.jwt.claim.role='service_role';set role service_role;insert into fixture_v_transport values(410,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(410)));reset role;
create function fixture_v_late_failure() returns trigger language plpgsql as $$begin if new.request_id=public.fixture_id(410) then raise exception 'Synthetic late failure' using errcode='P0002';end if;return new;end$$;
create trigger fixture_v_late_failure before insert on learn_commusoft_verification_results for each row execute function fixture_v_late_failure();
set role service_role;
do $$begin begin perform fixture_v_finish(410);raise exception 'Failure absent';exception when no_data_found then null;end;end$$;reset role;
do $$begin if (select verified_at from provider_connections where tenant_id=fixture_id(300)) is not null
 or exists(select 1 from provider_connection_events where detail->>'request_id'=fixture_id(410)::text) then raise exception 'Failed result retained partial verification';end if;end$$;
drop trigger fixture_v_late_failure on learn_commusoft_verification_results;
set role service_role;select fixture_v_finish(410)->>'code';reset role;
do $$begin
 if exists(select 1 from learn_commusoft_verification_requests where to_jsonb(learn_commusoft_verification_requests)::text like '%SYNTHETIC_%KEY%')
  or exists(select 1 from learn_commusoft_verification_results where to_jsonb(learn_commusoft_verification_results)::text like '%SYNTHETIC_%KEY%')
  or exists(select 1 from provider_connection_events where to_jsonb(provider_connection_events)::text like '%SYNTHETIC_%KEY%') then raise exception 'Credential retained outside Vault/transport';end if;
 if exists(select 1 from platform_jobs where tenant_id=fixture_id(300)) or exists(select 1 from feature_flags where tenant_id=fixture_id(300)) then raise exception 'Verification enabled capture';end if;
end$$;
-- Real ingestion and verification acquisition share quota even when the same
-- credential is stored separately for another synthetic tenant.
select fixture_v_prepare(411);
set request.jwt.claim.role='authenticated';set role authenticated;select fixture_v_request(411)->>'state';reset role;
update vault.decrypted_secrets set decrypted_secret='SYNTHETIC_ROTATED_KEY' where id=fixture_id(7);
update platform_jobs set status='running',claimed_by='fixture-worker',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 hour' where id=fixture_id(2);
set request.jwt.claim.role='service_role';set role service_role;
insert into fixture_v_transport values(411,learn_commusoft_verify_acquire(fixture_id(300),fixture_id(411)));
do $$begin
 if (select value->>'state' from fixture_v_transport where n=411) is distinct from 'ready'
  or fixture_acquire()->>'state' is distinct from 'wait' then raise exception 'Ingestion and verification did not share credential quota';end if;
end$$;
select fixture_v_finish(411)->>'code';reset role;
update platform_jobs set status='dead_letter' where id=fixture_id(2);
select 'Authority, bounded approval, shared ingestion quota, one permit, cancellation, expiry, rotation, receipt replay and atomic result checks passed.';
