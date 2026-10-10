set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000181';
set role authenticated;
do $$begin
 begin perform learn_operator_inputs(fixture_id(100));raise exception 'Tenant owner gained platform access';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 if has_function_privilege('anon','learn_operator_inputs(uuid)','EXECUTE') or
  has_function_privilege('service_role','learn_operator_input_request(uuid,uuid,uuid,jsonb,text)','EXECUTE') or
  has_function_privilege('authenticated','learn_operator_input_flags(uuid)','EXECUTE') then raise exception 'Private helper/operator grants broadened';end if;
end$$;
insert into platform_authority_grants(profile_id,permission,granted_by) values(fixture_id(180),'platform.controlplane.admin','synthetic'),(fixture_id(182),'platform.controlplane.view','synthetic');
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000182';set role authenticated;
do $$begin
 if learn_operator_inputs(fixture_id(100))->>'tenant_id'<>fixture_id(100)::text then raise exception 'Operator view failed';end if;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(190),fixture_id(182),fixture_definition('enable'));raise exception 'Viewer wrote controls';exception when insufficient_privilege then null;end;
 begin perform * from learn_operator_input_requests;raise exception 'Raw operator history readable';exception when insufficient_privilege then null;end;
end $$;
reset role;set request.jwt.claim.sub='00000000-0000-4000-8000-000000000180';set role authenticated;
do $$declare r jsonb;begin
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(190),fixture_id(181),fixture_definition('enable'));raise exception 'Wrong actor accepted';exception when insufficient_privilege then null;end;
 r:=learn_operator_input_request(fixture_id(100),fixture_id(190),fixture_id(180),fixture_definition('enable'));
 if r->>'state'<>'recorded' or r is distinct from learn_operator_input_request(fixture_id(100),fixture_id(190),fixture_id(180),fixture_definition('enable')) then raise exception 'Module receipt replay failed';end if;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(190),fixture_id(180),fixture_definition('enable')||'{"reason":"Changed"}');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_input_request(fixture_id(101),fixture_id(190),fixture_id(180),fixture_definition('enable'));raise exception 'Cross-tenant request replay accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(191),fixture_id(180),fixture_definition('enable'));raise exception 'Stale flag values accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(191),fixture_id(180),fixture_definition('start'));raise exception 'Missing credential accepted';exception when object_not_in_prerequisite_state then null;end;
end $$;
reset role;
do $$begin if exists(select 1 from platform_jobs where tenant_id=fixture_id(100)) or exists(select 1 from connector_accounts where tenant_id=fixture_id(100)) then raise exception 'Failed start retained work';end if;end$$;
insert into vault.decrypted_secrets values(fixture_id(107),'provider_secret:'||fixture_id(100)||':commusoft:api_key','SYNTHETIC_NO_NETWORK');
set role authenticated;
do $$declare r jsonb;begin
 r:=learn_operator_input_request(fixture_id(100),fixture_id(192),fixture_id(180),fixture_definition('start'),'cancel');
 if r->>'state'<>'cancelled' or r is distinct from learn_operator_input_request(fixture_id(100),fixture_id(192),fixture_id(180),fixture_definition('start')) then raise exception 'Late apply bypassed cancellation';end if;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(193),fixture_id(180),fixture_definition('start')||'{"revision":"2026-02-01Z"}');raise exception 'Changed connection accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(193),fixture_id(180),fixture_definition('start')||'{"resource":"propertyContacts"}');raise exception 'Unscoped contacts accepted';exception when invalid_parameter_value then null;end;
 r:=learn_operator_input_request(fixture_id(100),fixture_id(194),fixture_id(180),fixture_definition('start'));
 if r->>'state'<>'recorded' or r->>'job_id' is null or r is distinct from learn_operator_input_request(fixture_id(100),fixture_id(194),fixture_id(180),fixture_definition('start')) then raise exception 'Start/replay failed';end if;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(195),fixture_id(180),fixture_definition('start'));raise exception 'Active job replaced';exception when object_not_in_prerequisite_state then null;end;
 if (learn_operator_inputs(fixture_id(100))->'accounts'->0->'latest_job'->>'status')<>'queued' then raise exception 'Status reader lost queue';end if;
 if learn_operator_inputs(fixture_id(100))::text like '%SYNTHETIC_NO_NETWORK%' then raise exception 'Reader leaked credential';end if;
end $$;
reset role;
do $$declare a connector_accounts%rowtype;j platform_jobs%rowtype;begin
 select * into a from connector_accounts where tenant_id=fixture_id(100);
 select * into j from platform_jobs where tenant_id=fixture_id(100);
 if a.settings->'commusoft_import'->>'approvalId'<>fixture_id(194)::text or a.settings->'commusoft_import'->>'connectionId'<>fixture_id(105)::text
  or j.job_key<>'commusoft.source:'||a.id::text||':'||fixture_id(194)::text or a.sync_cursor<>'{}' then raise exception 'Worker binding mismatch';end if;
 begin update learn_operator_input_requests set receipt='{}' where id=fixture_id(194);raise exception 'History mutable';exception when object_not_in_prerequisite_state then null;end;
end $$;
insert into fixture_input_definitions values('disable',jsonb_build_object('kind','set_modules','reason','Synthetic disable',
 'expected',jsonb_build_object('learn.enabled',true,'learn.inputs.commusoft.enabled',true),'values',jsonb_build_object('learn.enabled',true,'learn.inputs.commusoft.enabled',false)));
set role authenticated;
do $$begin
 perform learn_operator_input_request(fixture_id(100),fixture_id(196),fixture_id(180),fixture_definition('disable'));
 if learn_operator_input_request(fixture_id(100),fixture_id(194),fixture_id(180),fixture_definition('start'),'check')->>'state'<>'recorded' then raise exception 'Disabled module hid prior receipt';end if;
 begin perform learn_operator_input_request(fixture_id(100),fixture_id(197),fixture_id(180),fixture_definition('start'));raise exception 'Disabled module started work';exception when object_not_in_prerequisite_state then null;end;
end$$;
reset role;
insert into view_as_context values(fixture_id(180),clock_timestamp()+interval '1 hour',null);
set role authenticated;
do $$begin begin perform learn_operator_inputs(fixture_id(100));raise exception 'View As accepted';exception when insufficient_privilege then null;end;end $$;
reset role;delete from view_as_context;
update platform_authority_grants set effective_to=clock_timestamp() where profile_id=fixture_id(180);
set role authenticated;
do $$begin begin perform learn_operator_inputs(fixture_id(100));raise exception 'Revoked authority accepted';exception when insufficient_privilege then null;end;end $$;
reset role;update platform_authority_grants set effective_to=null where profile_id=fixture_id(180);
-- A terminal but incomplete import must retain its checkpoint for recovery.
update platform_jobs set status='dead_letter' where tenant_id=fixture_id(100);
update feature_flags set value='true' where tenant_id=fixture_id(100);
set role authenticated;
do $$begin begin perform learn_operator_input_request(fixture_id(100),fixture_id(197),fixture_id(180),fixture_definition('start'));raise exception 'Incomplete import replaced';exception when object_not_in_prerequisite_state then null;end;end $$;
reset role;
-- Completion permits a new collection, retaining the prior approval/checkpoint.
update connector_accounts set sync_cursor=jsonb_build_object('approvalId',fixture_id(999),'pages',1,'after',null,'complete',true) where tenant_id=fixture_id(100);
set role authenticated;
do $$begin begin perform learn_operator_input_request(fixture_id(100),fixture_id(197),fixture_id(180),fixture_definition('start'));raise exception 'Foreign approval checkpoint replaced';exception when object_not_in_prerequisite_state then null;end;end $$;
reset role;
update connector_accounts set sync_cursor=jsonb_build_object('approvalId',fixture_id(194),'pages',1,'after',null,'complete',true) where tenant_id=fixture_id(100);
create function fixture_reject_receipt() returns trigger language plpgsql as $$begin if new.id=public.fixture_id(198) then raise exception 'Synthetic receipt failure' using errcode='P0002';end if;return new;end$$;
create trigger fixture_reject_receipt before insert on learn_operator_input_requests for each row execute function fixture_reject_receipt();
set role authenticated;
do $$begin begin perform learn_operator_input_request(fixture_id(100),fixture_id(198),fixture_id(180),fixture_definition('start')||'{"resource":"jobs"}');raise exception 'Injected failure absent';exception when no_data_found then null;end;end$$;
reset role;
do $$begin if (select count(*) from platform_jobs where tenant_id=fixture_id(100))<>1 or (select settings->'commusoft_import'->>'approvalId' from connector_accounts where tenant_id=fixture_id(100))<>fixture_id(194)::text then raise exception 'Late failure did not roll back queue/settings';end if;end$$;
set role authenticated;
select learn_operator_input_request(fixture_id(100),fixture_id(199),fixture_id(180),fixture_definition('start')||'{"resource":"jobs"}')->>'state';
reset role;
do $$begin if (select previous_state->'checkpoint'->>'complete' from learn_operator_input_requests where id=fixture_id(199))<>'true' then raise exception 'Prior checkpoint not retained';end if;end$$;
select 'Operator authority, switches, approvals, replay/cancellation, checkpoint preservation and atomic failure passed';
