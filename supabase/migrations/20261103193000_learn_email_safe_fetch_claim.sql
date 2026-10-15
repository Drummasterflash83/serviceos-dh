-- Permit the ordinary scheduled Workspace claim to resume one proven legacy
-- zero-write fetch block. No human actor is attributed to system recovery.
-- The accepted transition marks automated recovery; continuation is unchanged.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
  signature regprocedure := 'public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure;
  body text;
  old_claim constant text := $old$if p_payload->'recovery'='null'::jsonb or c.block_code in ('history_expired','continuation_expired') then
           raise exception using errcode='P0001',message='explicit_recovery_required';
         end if;$old$;
  new_claim constant text := $new$if p_payload->'recovery'='null'::jsonb then
           -- Recovery is automatic only for the exact retained zero-write
           -- fetch failure. The third failure within two hours still blocks.
           if not (p_stream='recent' and attempt.sync_type='workspace_messages'
             and c.block_code='fetch_failed' and c.owner_attempt_id is null
             and c.updated_at<=clock_timestamp()-interval '5 minutes'
             and (select count(*) from public.email_sync_runs prior
               where prior.tenant_id=p_tenant_id and prior.provider='gmail'
                 and prior.sync_type='workspace_messages' and prior.status='failed'
                 and prior.error_message='fetch_failed'
                 and prior.metadata->>'email_account_id'=p_email_account_id::text
                 and prior.completed_at>clock_timestamp()-interval '2 hours')<2
             and exists(select 1 from public.email_sync_runs prior
               join public.email_ingestion_transitions prior_transition
                 on prior_transition.tenant_id=prior.tenant_id
                 and prior_transition.attempt_id=prior.id
                 and prior_transition.email_account_id=p_email_account_id
                 and prior_transition.stream='recent' and prior_transition.operation='block'
                 and prior_transition.result_generation=c.generation
                 and prior_transition.result_revision=c.revision
               where prior.tenant_id=p_tenant_id and prior.provider='gmail'
                 and prior.sync_type='workspace_messages' and prior.status='failed'
                 and prior.error_message='fetch_failed'
                 and prior.metadata->>'email_account_id'=p_email_account_id::text
                 and abs(extract(epoch from prior.completed_at-c.updated_at))<=1
                 and prior.metadata#>>'{email_ingestion_v2,evidence,persistence}'='confirmed'
                 and prior.metadata#>>'{email_ingestion_v2,evidence,classification}'='fetch_failure'
                 and prior.metadata#>>'{email_ingestion_v2,evidence,message_upsert_count}'='0'
                 and prior.metadata#>>'{email_ingestion_v2,evidence,thread_upsert_count}'='0'
                 and prior.metadata#>>'{email_ingestion_v2,evidence,ids_seen}'='0'
                 and prior.metadata#>>'{email_ingestion_v2,evidence,gone_count}'='0'
                 and prior_transition.accepted_result->>'checkpoint_state'='blocked')
             and a.status='active_dwd')
           then raise exception using errcode='P0001',message='explicit_recovery_required'; end if;
           v_auto_resume:=true;
         elsif c.block_code in ('history_expired','continuation_expired') then
           raise exception using errcode='P0001',message='explicit_recovery_required';
         end if;$new$;
begin
  select pg_get_functiondef(p.oid) into strict body from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.oid=signature
      and p.prosecdef and pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
      and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}';
  if md5(body)<>'c0f6296f051aada999af147773066cac'
    or length(body)-length(replace(body,old_claim,''))<>length(old_claim)
    or length(body)-length(replace(body,'v_fetch_policy text; v_force boolean;',''))<>
      length('v_fetch_policy text; v_force boolean;')
    or length(body)-length(replace(body,
      '''records_processed'',records,''coverage_complete'',done);',''))<>
      length('''records_processed'',records,''coverage_complete'',done);')
  then raise exception 'email_safe_claim_definition_changed'; end if;
  body:=replace(body,'v_fetch_policy text; v_force boolean;',
    'v_fetch_policy text; v_force boolean; v_auto_resume boolean:=false;');
  body:=replace(body,old_claim,new_claim);
  body:=replace(body,'''records_processed'',records,''coverage_complete'',done);',
    '''records_processed'',records,''coverage_complete'',done,''automatic_recovery'',case when v_auto_resume then ''confirmed_zero_write_fetch_retry'' else null end);');
  execute body;
  if (select pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
       and p.prosecdef
       and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}'
       from pg_proc p where p.oid=signature) is distinct from true
  then raise exception 'email_safe_claim_privileges_changed'; end if;
end $migration$;
commit;
