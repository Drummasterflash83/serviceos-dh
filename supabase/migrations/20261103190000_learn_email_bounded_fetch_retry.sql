-- A confirmed pre-persistence Workspace fetch failure may leave its exact
-- continuation ready for a later scheduled attempt. Repeated failures block.
-- Existing blocked checkpoints, source rows, grants and credentials are untouched.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare
  signature regprocedure := 'public.email_ingestion_transition_v2(uuid,uuid,text,uuid,uuid,text,uuid,bigint,uuid,jsonb)'::regprocedure;
  body text;
  old_block constant text := 'c.state:=''blocked''; c.owner_attempt_id:=null; c.block_code:=p_payload->>''error_code'';';
  old_error constant text := 'terminal:=true; attempt_status:=''failed''; error_code:=c.block_code; evidence:=p_payload->''attempt_evidence'';';
  new_block constant text := $replacement$
       -- Only a confirmed zero-write fetch failure can retry. The terminal
       -- attempt and immutable transition still record the failure. A bounded
       -- third failure in two hours remains blocked for operator review.
       if p_stream='recent' and attempt.sync_type='workspace_messages'
         and p_payload->>'error_code'='fetch_failed'
         and attempt.records_processed=0
         and p_payload#>>'{attempt_evidence,persistence}'='confirmed'
         and p_payload#>>'{attempt_evidence,classification}'='fetch_failure'
         and p_payload#>>'{attempt_evidence,message_upsert_count}'='0'
         and p_payload#>>'{attempt_evidence,thread_upsert_count}'='0'
         and p_payload#>>'{attempt_evidence,ids_seen}'='0'
         and p_payload#>>'{attempt_evidence,gone_count}'='0'
         and (select count(*) from public.email_sync_runs prior
           where prior.tenant_id=p_tenant_id and prior.provider='gmail'
             and prior.sync_type='workspace_messages' and prior.status='failed'
             and prior.error_message='fetch_failed'
             and prior.metadata->>'email_account_id'=p_email_account_id::text
             and prior.completed_at>clock_timestamp()-interval '2 hours')<2
       then c.state:='ready'; c.block_code:=null;
       else c.state:='blocked'; c.block_code:=p_payload->>'error_code'; end if;
       c.owner_attempt_id:=null;$replacement$;
begin
  select pg_get_functiondef(p.oid) into strict body from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.oid=signature
      and p.prosecdef and pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
      and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}';
  if md5(body)<>'45a140fffe35e7e3de3597eb848cfbc2'
    or length(body)-length(replace(body,old_block,''))<>length(old_block)
    or length(body)-length(replace(body,old_error,''))<>length(old_error)
  then raise exception 'email_retry_definition_changed'; end if;
  body:=replace(replace(body,old_block,new_block),old_error,
    'terminal:=true; attempt_status:=''failed''; error_code:=p_payload->>''error_code''; evidence:=p_payload->''attempt_evidence'';');
  execute body;
  if (select pg_get_userbyid(p.proowner)='email_ingestion_protocol_owner'
       and p.prosecdef
       and p.proacl::text='{email_ingestion_protocol_owner=X/email_ingestion_protocol_owner,service_role=X/email_ingestion_protocol_owner}'
       from pg_proc p where p.oid=signature) is distinct from true
  then raise exception 'email_retry_privileges_changed'; end if;
end $migration$;
commit;
