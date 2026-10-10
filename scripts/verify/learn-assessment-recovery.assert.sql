-- Synthetic owner/tenant fixtures from learn-saved-assessments.py only.
create function public.test_resolve_assessment(p_id uuid, p_cancel boolean default false, p_reason text default 'Retained synthetic assessment') returns jsonb
language sql as $$
 select learn_assessment_resolve('00000000-0000-4000-8000-000000000001',p_id,'00000000-0000-4000-8000-000000000060','member','00000000-0000-4000-8000-000000000003',null,'2026-01-01','2026-01-02',
 '[{"id":"00000000-0000-4000-8000-000000000008","reviewRevision":0},{"id":"00000000-0000-4000-8000-000000000009","reviewRevision":3}]',p_reason,p_cancel)
$$;
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000030';
do $$ declare r jsonb; begin
 r:=test_resolve_assessment('00000000-0000-4000-8000-000000000080');
 if r->>'state'<>'pending' or r->>'tenantId'<>'00000000-0000-4000-8000-000000000001' or r->>'actorId'<>'00000000-0000-4000-8000-000000000030' then raise exception 'Incorrect pending receipt';end if;
 r:=test_resolve_assessment('00000000-0000-4000-8000-000000000080',true);
 if r->>'state'<>'cancelled' or test_resolve_assessment('00000000-0000-4000-8000-000000000080')->>'state'<>'cancelled' then raise exception 'Cancellation not retained';end if;
 begin perform test_resolve_assessment('00000000-0000-4000-8000-000000000080',true,'Different');raise exception 'Changed cancelled identity accepted';exception when sqlstate 'PT409' then null;end;
 begin perform test_save_assessment('00000000-0000-4000-8000-000000000080','[{"id":"00000000-0000-4000-8000-000000000008","reviewRevision":0},{"id":"00000000-0000-4000-8000-000000000009","reviewRevision":3}]');raise exception 'Delayed save accepted after cancellation';exception when sqlstate 'PT409' then null;end;
 -- The existing retained assessment is resolved without rechecking now-stale evidence.
 r:=learn_assessment_resolve('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000060','member','00000000-0000-4000-8000-000000000003',null,'2026-01-01','2026-01-02','[{"id":"00000000-0000-4000-8000-000000000008","reviewRevision":0},{"id":"00000000-0000-4000-8000-000000000009","reviewRevision":2}]','Retained synthetic assessment',true);
 if r->>'state'<>'recorded' or r->>'recordedAt' is null then raise exception 'Completed save not recovered';end if;
 begin perform test_resolve_assessment('00000000-0000-4000-8000-000000000070',true);raise exception 'Changed saved identity accepted';exception when sqlstate 'PT409' then null;end;
 begin perform test_resolve_assessment('00000000-0000-4000-8000-000000000081',null);raise exception 'Null mode accepted';exception when invalid_parameter_value then null;end;
 begin insert into learn_assessment_cancellations(id) values(gen_random_uuid());raise exception 'Direct cancellation insert allowed';exception when insufficient_privilege then null;end;
 begin perform 1 from learn_assessment_cancellations;raise exception 'Raw cancellation read allowed';exception when insufficient_privilege then null;end;
end $$;
set test.actor='00000000-0000-4000-8000-000000000042';
do $$ begin begin perform test_resolve_assessment(gen_random_uuid(),true);raise exception 'Viewer cancelled';exception when insufficient_privilege then null;end;end $$;
set test.actor='00000000-0000-4000-8000-000000000041';
do $$ begin begin perform test_resolve_assessment(gen_random_uuid(),true);raise exception 'Foreign owner cancelled';exception when insufficient_privilege then null;end;end $$;
set test.actor='';
do $$ begin begin perform test_resolve_assessment(gen_random_uuid(),true);raise exception 'Missing actor cancelled';exception when insufficient_privilege then null;end;end $$;
reset role;
insert into profiles values('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000001','owner');
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000043';
do $$ begin begin perform test_resolve_assessment('00000000-0000-4000-8000-000000000080',true);raise exception 'Other actor resolved cancellation';exception when sqlstate 'PT409' then null;end;end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000030',null,null);
set role authenticated;
set test.actor='00000000-0000-4000-8000-000000000030';
do $$ begin begin perform test_resolve_assessment(gen_random_uuid(),true);raise exception 'Preview cancelled';exception when insufficient_privilege then null;end;end $$;
reset role;
delete from view_as_context;
do $$ begin
 if (select count(*) from learn_assessment_cancellations)<>1 then raise exception 'Unexpected cancellation rows';end if;
 if exists(select * from first_assessment except select * from learn_assessments) then raise exception 'Retained assessment changed';end if;
 begin update learn_assessment_cancellations set recorded_at=now();raise exception 'Cancellation changed';exception when restrict_violation then null;end;
 begin delete from learn_assessment_cancellations;raise exception 'Cancellation deleted';exception when restrict_violation then null;end;
 begin truncate learn_assessment_cancellations;raise exception 'Cancellation truncated';exception when restrict_violation then null;end;
 if has_function_privilege('anon','learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean)','execute')
 or has_function_privilege('service_role','learn_assessment_resolve(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text,boolean)','execute')
 or has_table_privilege('authenticated','learn_assessment_cancellations','insert')
 or has_table_privilege('service_role','learn_assessment_cancellations','insert') then raise exception 'Authority broadened';end if;
end $$;
