-- Revert only the bounded source-description field and response version.
-- Use after checking the installed exact function hash and source ledger.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $rollback$
declare
 signature regprocedure := 'public.new_dawn_customer_blockers(uuid,text)'::regprocedure;
 prior text := pg_get_functiondef(signature);
 changed text;
 source_new text := 'customer_name,' || chr(10) ||
  '   case when jsonb_typeof(v.payload->''description'')=''string'' then' || chr(10) ||
  '    nullif(btrim(left(btrim(v.payload->>''description''),160)),'''') end source_description' || chr(10) ||
  '  from public.new_dawn_commusoft_current_job_source';
 source_old text := 'customer_name' || chr(10) ||
  '  from public.new_dawn_commusoft_current_job_source';
 row_new text := '''source_observed_at'',observed_at,''status'',status,' || chr(10) ||
  '    ''source_description'',source_description)';
 row_old text := '''source_observed_at'',observed_at,''status'',status)';
begin
 if encode(sha256(convert_to(prior,'UTF8')),'hex') <>
  '99c5e202c99aec449c20cc89b4f87923a97fef79dbd8804e9c9e0fa2fae16eea'
 then raise exception 'customer_work_description_rollback_state_changed'; end if;
 if length(prior)-length(replace(prior,source_new,''))<>length(source_new)
  or length(prior)-length(replace(prior,row_new,''))<>length(row_new)
  or length(prior)-length(replace(prior,'''new-dawn-customer-blockers/2''',''))<>
   length('''new-dawn-customer-blockers/2''')
 then raise exception 'customer_work_description_rollback_marker_changed'; end if;
 changed:=replace(prior,source_new,source_old);
 changed:=replace(changed,row_new,row_old);
 changed:=replace(changed,'new-dawn-customer-blockers/2',
  'new-dawn-customer-blockers/1');
 execute changed;
 if encode(sha256(convert_to(pg_get_functiondef(signature),'UTF8')),'hex') <>
  'a2f5916d204014e3affced8136308a74e67d6c0d42ea7856cdf27d7276f813c0'
 then raise exception 'customer_work_description_rollback_mismatch'; end if;
end $rollback$;
commit;
