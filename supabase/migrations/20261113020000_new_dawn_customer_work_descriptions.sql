-- Put the saved Commusoft work description beside each exactly linked
-- On-hold/Pending customer job. It is source wording, not a work-type or
-- urgency classification. Install only after the current-source Home release.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $release$
declare
 signature regprocedure := 'public.new_dawn_customer_blockers(uuid,text)'::regprocedure;
 prior text := pg_get_functiondef(signature);
 changed text;
 source_needle text := 'customer_name' || chr(10) || '  from public.new_dawn_commusoft_current_job_source';
 source_replacement text := 'customer_name,' || chr(10) ||
  '   case when jsonb_typeof(v.payload->''description'')=''string'' then' || chr(10) ||
  '    nullif(btrim(left(btrim(v.payload->>''description''),160)),'''') end source_description' || chr(10) ||
  '  from public.new_dawn_commusoft_current_job_source';
 row_needle text := '''source_observed_at'',observed_at,''status'',status)';
 row_replacement text := '''source_observed_at'',observed_at,''status'',status,' || chr(10) ||
  '    ''source_description'',source_description)';
begin
 if encode(sha256(convert_to(prior,'UTF8')),'hex') <>
  'a2f5916d204014e3affced8136308a74e67d6c0d42ea7856cdf27d7276f813c0'
 then raise exception 'customer_work_description_baseline_changed'; end if;
 if length(prior)-length(replace(prior,source_needle,''))<>length(source_needle)
  or length(prior)-length(replace(prior,row_needle,''))<>length(row_needle)
  or length(prior)-length(replace(prior,'''new-dawn-customer-blockers/1''',''))<>
   length('''new-dawn-customer-blockers/1''')
 then raise exception 'customer_work_description_marker_changed'; end if;
 changed:=replace(prior,source_needle,source_replacement);
 changed:=replace(changed,row_needle,row_replacement);
 changed:=replace(changed,'new-dawn-customer-blockers/1',
  'new-dawn-customer-blockers/2');
 execute changed;
 if encode(sha256(convert_to(pg_get_functiondef(signature),'UTF8')),'hex') <>
  '99c5e202c99aec449c20cc89b4f87923a97fef79dbd8804e9c9e0fa2fae16eea'
 then raise exception 'customer_work_description_candidate_changed'; end if;
end $release$;
commit;
