-- Reproduce the previously accepted gap before installing any new constraints.
create table receipt_legacy_fixture as select id original_id,tenant_id,subject_id,policy_id,policy_revision,window_start,window_end,
 request_payload||jsonb_build_object('id','ab160000-0000-4000-8000-000000000001') payload
 from measurements where source='serviceos.work.residence@1' and request_payload is not null limit 1;
do $$declare f receipt_legacy_fixture%rowtype;begin
 select * into strict f from receipt_legacy_fixture;
 perform learn_performance_append(f.tenant_id,f.payload,'Synthetic pre-migration mismatched receipt');
end $$;
create table receipt_preservation_before as select id,to_jsonb(m) row from measurements m;
create table receipt_functions_before as select oid,pg_get_functiondef(oid) definition,proacl from pg_proc
 where oid in ('learn_performance_append(uuid,jsonb,text)'::regprocedure,
 'learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure,
 'learn_assessment_save(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,jsonb,text)'::regprocedure,
 'learn_performance_review(uuid,uuid,uuid,integer,text,text)'::regprocedure);
