-- Gmail continuation v4: retain content, refresh labels and record provider absence.
-- Existing in-flight v2/v3 requests and receipts keep their original semantics.
-- A new/finished generation reconciles current messages before incremental changes.
-- No account, cursor, provider activation or source row changes at installation.
begin;
CREATE OR REPLACE FUNCTION public.email_ingestion_transition_v2(p_tenant_id uuid, p_email_account_id uuid, p_stream text, p_attempt_id uuid, p_transition_id uuid, p_operation text, p_expected_generation uuid, p_expected_revision bigint, p_expected_owner_attempt_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 a record; c public.email_ingestion_checkpoints%rowtype; receipt public.email_ingestion_transitions%rowtype;
 attempt public.email_sync_runs%rowtype; doc jsonb; result jsonb; evidence jsonb;
 exists_checkpoint boolean; replay boolean; changed boolean:=true; eligible boolean;
 done boolean:=false; terminal boolean:=false; attempt_status text:='running'; error_code text;
 records integer; label text; input_token text; next_token text; mode text; current_cursor text;
 new_total bigint; code text; v_attempt_metadata jsonb; confirmed_count integer; v_fetch_policy text; v_force boolean;
begin
 if p_tenant_id is null or p_email_account_id is null or p_attempt_id is null or p_transition_id is null or
   p_stream is null or p_stream not in ('recent','historical') or p_operation is null or
   p_expected_revision<0 then raise exception using errcode='22023',message='invalid_request'; end if;
 perform public.email_ingestion_payload_v2(p_operation,p_stream,p_payload);
 -- Defaults do not rewrite the frozen request_document: omitted/false remain
 -- different requests for same-ID replay equality, even when semantically equal.
 v_force:=p_stream='recent' and p_operation='claim' and coalesce((p_payload->>'force')::boolean,false);
 -- No whole account SELECT: this role has no token, identity-write or authority privileges.
 select id,tenant_id,provider,status,auth_state,history_id,backfill_status,backfill_started_at,
   backfill_completed_at,backfill_page_token,backfill_total_fetched,backfill_error
 into a from public.email_accounts where tenant_id=p_tenant_id and id=p_email_account_id and provider='gmail' for update;
 if not found then raise exception using errcode='P0001',message='account_not_found'; end if;
 perform 1 from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id
   order by case stream when 'recent' then 0 else 1 end for update;
 select * into c from public.email_ingestion_checkpoints where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
 exists_checkpoint:=found;
 select * into receipt from public.email_ingestion_transitions where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream and transition_id=p_transition_id;
 replay:=found;
 -- Own attempt lock comes BEFORE mutable status/association validation and mutation.
 select * into attempt from public.email_sync_runs where id=p_attempt_id and tenant_id=p_tenant_id for update;
 if not found or attempt.provider<>'gmail' or jsonb_typeof(attempt.metadata->'email_account_id') is distinct from 'string' or
   not coalesce(attempt.metadata->>'email_account_id'~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 if (attempt.metadata->>'email_account_id')::uuid<>p_email_account_id or
   (p_stream='historical' and attempt.sync_type<>'workspace_backfill') or
   (p_stream='recent' and attempt.sync_type not in ('messages','workspace_messages')) or
   exists(select 1 from public.email_ingestion_transitions where attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) or
   exists(select 1 from public.email_ingestion_checkpoints where owner_attempt_id=p_attempt_id and
     (tenant_id<>p_tenant_id or email_account_id<>p_email_account_id or stream<>p_stream)) then
   raise exception using errcode='P0001',message='attempt_mismatch';
 end if;
 doc:=jsonb_build_object('tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'attempt_id',p_attempt_id,'transition_id',p_transition_id,'operation',p_operation,
   'expected_generation',p_expected_generation,'expected_revision',p_expected_revision::text,
   'expected_owner_attempt_id',p_expected_owner_attempt_id,'payload',p_payload);
 if replay then
   if receipt.attempt_id<>p_attempt_id or receipt.request_document<>doc then raise exception using errcode='P0001',message='transition_id_reused'; end if;
   return jsonb_build_object('contract_version',2,'disposition','replayed','code','receipt_replayed','transition_id',p_transition_id,
     'accepted_result',receipt.accepted_result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',true);
 end if;
 if attempt.status<>'running' then raise exception using errcode='P0001',message='attempt_terminal'; end if;
 records:=attempt.records_processed;
 -- Slice A account check ONLY; DWD relationship/revision locking is not claimed.
 eligible:=case when attempt.sync_type='messages' then a.status='active' and a.auth_state in ('ok','unknown')
   else a.status in ('pending_tokenless_dwd','active_dwd') end;
 if p_operation not in ('block','release','finish_attempt') and not eligible then raise exception using errcode='P0001',message='source_ineligible'; end if;
 if p_operation='finish_attempt' then
   if exists_checkpoint and c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='owner_must_release'; end if;
   if not exists_checkpoint and (p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null) then
     raise exception using errcode='22023',message='absent_checkpoint_requires_null_fences';
   end if;
   -- Explicit stale-version exception: only caller's own evidence; no progress update.
   changed:=false; terminal:=true; attempt_status:='failed'; error_code:=p_payload->>'error_code';
   evidence:=p_payload->'attempt_evidence';
 else
   if not exists_checkpoint then
     if p_operation<>'claim' or p_expected_generation is not null or p_expected_revision is not null or p_expected_owner_attempt_id is not null or p_payload->'recovery'<>'null'::jsonb then
       raise exception using errcode='P0001',message='checkpoint_missing';
     end if;
     c.tenant_id:=p_tenant_id; c.email_account_id:=p_email_account_id; c.stream:=p_stream; c.contract_version:=2;
     c.generation:=gen_random_uuid(); c.revision:=0; c.state:='ready'; c.owner_attempt_id:=null;
     c.created_at:=now(); c.updated_at:=now();
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',4,'phase','uninitialized',
       'intent','reconcile',
       'fetch_policy','refetch_all');
     elsif a.backfill_status='completed' then c.state:='completed';
     elsif a.backfill_status='error' then
       c.state:='blocked';
       -- Preserve recognised classifications, especially restart-only expiry.
       -- Unknown legacy error text must not leak into protocol evidence.
       c.block_code:=case when a.backfill_error in (
         'history_expired','continuation_expired','pagination_no_progress',
         'fetch_failed','parse_failed','persistence_failed','checkpoint_conflict',
         'source_ineligible','unexpected_failure') then a.backfill_error else 'unexpected_failure' end;
     elsif a.backfill_status not in ('idle','running') then raise exception using errcode='P0001',message='legacy_state_invalid'; end if;
   elsif c.generation is distinct from p_expected_generation or c.revision is distinct from p_expected_revision or c.owner_attempt_id is distinct from p_expected_owner_attempt_id then
     raise exception using errcode='P0001',message='checkpoint_conflict';
   end if;
   if p_stream='recent' and p_operation<>'restart' then
     -- Known pre-policy generations were missing-only. Materialize only an
     -- absent field, never coalesce explicit null/invalid policy into permission.
     if jsonb_typeof(c.continuation) is distinct from 'object' then raise exception using errcode='P0001',message='invalid_legacy_policy'; end if;
     if not (c.continuation ? 'fetch_policy') then c.continuation:=c.continuation||jsonb_build_object('fetch_policy','missing_only'); end if;
     if not coalesce(c.continuation->>'version' in ('2','3','4'),false) then
       raise exception using errcode='P0001',message='invalid_legacy_policy'; end if;
     v_fetch_policy:=c.continuation->>'fetch_policy';
     if not coalesce(v_fetch_policy=any(array['missing_only','refetch_all']),false) or
       (v_fetch_policy='refetch_all' and c.continuation->>'version'<>'4' and not coalesce(
         (c.continuation->>'phase'='uninitialized' and c.continuation->>'intent'='reconcile') or
         (c.continuation->>'phase'='initialized' and c.continuation->>'mode'='reconcile'),false)) then
       raise exception using errcode='P0001',message='invalid_legacy_policy';
     end if;
   end if;
   case p_operation
   when 'claim' then
     if p_stream='recent' and exists_checkpoint and c.state<>'completed' and v_force and v_fetch_policy<>'refetch_all' then
       raise exception using errcode='P0001',message='force_generation_busy';
     end if;
     if not exists_checkpoint and c.state in ('completed','blocked') then
       terminal:=true; done:=c.state='completed'; attempt_status:=case when done then 'success' else 'failed' end;
       error_code:=case when done then null else c.block_code end;
     elsif p_stream='historical' and c.state='completed' then
       if p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
       changed:=false; done:=true; terminal:=true; attempt_status:='success';
     else
       if c.state='blocked' then
         if p_payload->'recovery'='null'::jsonb or c.block_code in ('history_expired','continuation_expired') then
           raise exception using errcode='P0001',message='explicit_recovery_required';
         end if;
       elsif p_payload->'recovery'<>'null'::jsonb then raise exception using errcode='P0001',message='invalid_recovery_state';
       elsif c.state<>'ready' and not(p_stream='recent' and c.state='completed') then raise exception using errcode='P0001',message='already_claimed'; end if;
       if p_stream='recent' and c.state='completed' then
         c.generation:=gen_random_uuid(); c.continuation:=jsonb_build_object('version',4,'phase','uninitialized',
           'intent',case when v_force or c.continuation->>'version' is distinct from '4' then 'reconcile' else 'normal' end,
           'fetch_policy','refetch_all');
       end if;
       c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
       if p_stream='historical' then
         update public.email_accounts set backfill_status='running',backfill_error=null,
           backfill_started_at=case when backfill_status='idle' and backfill_started_at is null then now() else backfill_started_at end
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
     end if;
   when 'takeover' then
     if c.state<>'claimed' or c.owner_attempt_id=p_attempt_id then raise exception using errcode='P0001',message='invalid_recovery_state'; end if;
     c.owner_attempt_id:=p_attempt_id;
     if p_stream='historical' then update public.email_accounts set backfill_status='running',backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   when 'restart' then
     c.generation:=gen_random_uuid(); c.state:='claimed'; c.owner_attempt_id:=p_attempt_id; c.block_code:=null;
     if p_stream='recent' then c.continuation:=jsonb_build_object('version',4,'phase','uninitialized','intent','reconcile',
       'fetch_policy',coalesce(p_payload->>'fetch_policy','missing_only'));
     else update public.email_accounts set backfill_status='running',backfill_page_token=null,backfill_total_fetched=0,
       backfill_started_at=now(),backfill_completed_at=null,backfill_error=null where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
   else
     if c.state<>'claimed' or c.owner_attempt_id is distinct from p_attempt_id then raise exception using errcode='P0001',message='not_owner'; end if;
     case p_operation
     when 'initialize_traversal' then
       if c.continuation->>'phase' is distinct from 'uninitialized' then raise exception using errcode='P0001',message='already_initialized'; end if;
       current_cursor:=a.history_id;
       if current_cursor is not null then
         if current_cursor!~'^(0|[1-9][0-9]{0,19})$' then raise exception using errcode='P0001',message='invalid_legacy_cursor'; end if;
         if current_cursor::numeric>18446744073709551615 or (p_payload->>'captured_history_id')::numeric<current_cursor::numeric then raise exception using errcode='P0001',message='boundary_regression'; end if;
       end if;
       mode:=case when c.continuation->>'intent'='normal' and current_cursor is not null then 'history' else 'reconcile' end;
       c.continuation:=jsonb_build_object('version',(c.continuation->>'version')::integer,'phase','initialized','mode',mode,'origin_history_id',current_cursor,
         'fetch_policy',c.continuation->>'fetch_policy',
         'captured_history_id',p_payload->>'captured_history_id','captured_at',p_payload->>'captured_at',
         'page_size',p_payload->'page_size','query',null,
         'labels',case when c.continuation->>'version' in ('3','4') then jsonb_build_array('ALL') else jsonb_build_array('INBOX','SENT') end,
         'labels_state',case when c.continuation->>'version' in ('3','4') then
           jsonb_build_object('ALL',jsonb_build_object('next_page_token',null,'complete',false))
         else jsonb_build_object('INBOX',jsonb_build_object('next_page_token',null,'complete',false),
           'SENT',jsonb_build_object('next_page_token',null,'complete',false)) end);
     when 'checkpoint' then
       next_token:=p_payload->>'returned_next_page_token'; evidence:=p_payload->'page_evidence';
       if p_stream='recent' then
         label:=p_payload->>'label'; input_token:=p_payload->>'expected_input_page_token';
         if c.continuation->>'phase' is distinct from 'initialized' then raise exception using errcode='P0001',message='not_initialized'; end if;
         if not coalesce(case c.continuation->>'version'
           when '4' then label='ALL' and c.continuation->'labels'='["ALL"]'::jsonb
           when '3' then label='ALL' and c.continuation->'labels'='["ALL"]'::jsonb
           when '2' then label in ('INBOX','SENT') and c.continuation->'labels'='["INBOX","SENT"]'::jsonb
           else false end,false) then raise exception using errcode='P0001',message='page_conflict'; end if;
         if c.continuation#>>array['labels_state',label,'complete'] is distinct from 'false' or
           c.continuation#>>array['labels_state',label,'next_page_token'] is distinct from input_token then raise exception using errcode='P0001',message='page_conflict'; end if;
         if a.history_id is distinct from c.continuation->>'origin_history_id' then raise exception using errcode='P0001',message='cursor_conflict'; end if;
       else
         label:=null; input_token:=p_payload->>'expected_page_token';
         if a.backfill_status<>'running' or a.backfill_page_token is distinct from input_token or a.backfill_total_fetched<>(p_payload->>'expected_total')::integer then raise exception using errcode='P0001',message='page_conflict'; end if;
       end if;
       if next_token is not null and (next_token is not distinct from input_token or exists(
         select 1 from public.email_ingestion_transitions t where t.tenant_id=p_tenant_id and t.email_account_id=p_email_account_id
           and t.stream=p_stream and t.result_generation=c.generation and t.operation='checkpoint'
           and (t.request_document->'payload'->>'label') is not distinct from label
           and ((md5(coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token'))=md5(next_token)
             and coalesce(t.request_document->'payload'->>'expected_input_page_token',t.request_document->'payload'->>'expected_page_token')=next_token)
           or (md5(t.request_document->'payload'->>'returned_next_page_token')=md5(next_token) and t.request_document->'payload'->>'returned_next_page_token'=next_token))
       )) then raise exception using errcode='P0001',message='pagination_no_progress'; end if;
       if p_stream='recent' then
         c.continuation:=jsonb_set(c.continuation,array['labels_state',label],jsonb_build_object('next_page_token',next_token,'complete',(p_payload->>'exhausted')::boolean));
         done:=case when c.continuation->>'version' in ('3','4') then (c.continuation#>>'{labels_state,ALL,complete}')::boolean
           else (c.continuation#>>'{labels_state,INBOX,complete}')::boolean and (c.continuation#>>'{labels_state,SENT,complete}')::boolean end;
         if done then update public.email_accounts set history_id=c.continuation->>'captured_history_id' where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
       else
         new_total:=a.backfill_total_fetched::bigint+(p_payload->>'listed_count')::bigint;
         if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
         done:=(p_payload->>'exhausted')::boolean;
         update public.email_accounts set backfill_page_token=next_token,backfill_total_fetched=new_total::integer,
           backfill_status=case when done then 'completed' else 'running' end,
           backfill_completed_at=case when done then now() else null end,backfill_error=null
           where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if;
       end if;
       new_total:=records::bigint+(evidence->>'message_upsert_count')::bigint;
       if new_total>2147483647 then raise exception using errcode='P0001',message='total_overflow'; end if;
       records:=new_total::integer;
       if done or (p_payload->>'yield_after_page')::boolean then
         c.state:=case when done then 'completed' else 'ready' end; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success';
       end if;
     when 'release' then
       c.state:='ready'; c.owner_attempt_id:=null; terminal:=true; attempt_status:='success'; evidence:=p_payload->'attempt_evidence';
     when 'block' then
       c.state:='blocked'; c.owner_attempt_id:=null; c.block_code:=p_payload->>'error_code';
       terminal:=true; attempt_status:='failed'; error_code:=c.block_code; evidence:=p_payload->'attempt_evidence';
       if p_stream='historical' then update public.email_accounts set backfill_status='error',backfill_error=c.block_code where tenant_id=p_tenant_id and id=p_email_account_id;
         if not found then raise exception 'account progress update affected no row'; end if; end if;
     else raise exception using errcode='22023',message='invalid_operation';
     end case;
   end case;
 end if;
 if changed then
   if c.revision=9223372036854775807 then raise exception using errcode='P0001',message='revision_exhausted'; end if;
   c.revision:=c.revision+1; c.updated_at:=now();
   if not exists_checkpoint then
     insert into public.email_ingestion_checkpoints(tenant_id,email_account_id,stream,contract_version,generation,revision,state,owner_attempt_id,continuation,block_code,created_at,updated_at)
     values(c.tenant_id,c.email_account_id,c.stream,c.contract_version,c.generation,c.revision,c.state,c.owner_attempt_id,c.continuation,c.block_code,c.created_at,c.updated_at);
   else
     update public.email_ingestion_checkpoints set generation=c.generation,revision=c.revision,state=c.state,
       owner_attempt_id=c.owner_attempt_id,continuation=c.continuation,block_code=c.block_code,updated_at=c.updated_at
       where tenant_id=p_tenant_id and email_account_id=p_email_account_id and stream=p_stream;
     if not found then raise exception 'checkpoint update affected no row'; end if;
   end if;
 end if;
 if p_operation in ('block','release','finish_attempt') then
   -- These counts are attempt-wide known totals; NULL never overwrites with zero.
   confirmed_count:=(evidence->>'message_upsert_count')::integer;
   if confirmed_count is not null then
     if confirmed_count<records then raise exception using errcode='22023',message='count_regression'; end if;
     records:=confirmed_count;
   end if;
 end if;
 result:=jsonb_build_object('operation',p_operation,'attempt_id',p_attempt_id,'tenant_id',p_tenant_id,'email_account_id',p_email_account_id,'stream',p_stream,
   'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'checkpoint_state',c.state,'owner_attempt_id',c.owner_attempt_id,'attempt_status',attempt_status,
   'records_processed',records,'coverage_complete',done);
 insert into public.email_ingestion_transitions(tenant_id,email_account_id,stream,transition_id,operation,attempt_id,
   expected_generation,expected_revision,expected_owner_attempt_id,request_document,request_fingerprint,accepted_result,checkpoint_stream,result_generation,result_revision)
 values(p_tenant_id,p_email_account_id,p_stream,p_transition_id,p_operation,p_attempt_id,p_expected_generation,p_expected_revision,
   p_expected_owner_attempt_id,doc,md5(doc::text),result,case when c.tenant_id is not null then p_stream else null end,c.generation,c.revision);
 v_attempt_metadata:=attempt.metadata||jsonb_build_object('email_ingestion_v2',jsonb_build_object('contract_version',2,'stream',p_stream,
   'transition_id',p_transition_id,'operation',p_operation,'checkpoint_present',c.tenant_id is not null,'generation',c.generation,'revision',c.revision::text,
   'coverage_complete',done,'continuation_pending',c.state<>'completed','evidence',evidence,
   'classification',case when p_operation='finish_attempt' then p_payload->>'outcome' else null end));
 update public.email_sync_runs as target_run set status=attempt_status,completed_at=case when terminal then now() else null end,
   records_processed=records,error_message=error_code,metadata=v_attempt_metadata
   where target_run.id=p_attempt_id and target_run.tenant_id=p_tenant_id and target_run.status='running';
 if not found then raise exception 'attempt update disappeared'; end if;
 return jsonb_build_object('contract_version',2,'disposition','applied','code','transition_applied','transition_id',p_transition_id,
   'accepted_result',result,'current_checkpoint',public.email_ingestion_checkpoint_json_v2(c),'historical_receipt',false);
exception
 when invalid_parameter_value or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
   return jsonb_build_object('contract_version',2,'disposition','denied','code','invalid_request','transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
 when sqlstate 'P0001' then
   code:=sqlerrm;
   if code<>all(array['account_not_found','attempt_mismatch','transition_id_reused','attempt_terminal','source_ineligible','owner_must_release',
     'checkpoint_missing','legacy_state_invalid','checkpoint_conflict','invalid_recovery_state','explicit_recovery_required','already_claimed',
     'not_owner','already_initialized','invalid_legacy_cursor','boundary_regression','not_initialized','page_conflict','cursor_conflict',
     'pagination_no_progress','total_overflow','revision_exhausted','force_generation_busy','invalid_legacy_policy']) then raise; end if;
   -- Exception subtransaction rolled back ALL writes; never return staged c as current.
   return jsonb_build_object('contract_version',2,'disposition',case when code in ('account_not_found','attempt_mismatch','transition_id_reused','source_ineligible') then 'denied' else 'conflict' end,
     'code',code,'transition_id',p_transition_id,'accepted_result',null,'current_checkpoint',null,'historical_receipt',false);
end $function$
;

create or replace function public.learn_email_store_page(p_context jsonb,p_threads jsonb,p_messages jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;thread_count integer;message_count integer;v jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 tenant:=(p_context->>'tenant_id')::uuid;
 if jsonb_typeof(p_threads) is distinct from 'array' or jsonb_typeof(p_messages) is distinct from 'array'
  or jsonb_array_length(p_threads)>2000 or jsonb_array_length(p_messages)>2000
  or octet_length(p_threads::text)+octet_length(p_messages::text)>67108864
 then raise exception 'learn_email_store_rows_invalid' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_threads) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>7
   or not(v ?& array['tenant_id','provider','provider_thread_id','subject','participants','last_message_at','updated_at'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'participants') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(v->'participants')e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'subject') not in ('string','null') or jsonb_typeof(v->'last_message_at') is distinct from 'string'
  then raise exception 'learn_email_store_thread_invalid' using errcode='22023';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_messages) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>16
   or not(v ?& array['tenant_id','provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails','subject','snippet','body_text','body_html','sent_at','received_at','direction','raw_payload'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_message_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_message_id')>256)
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'to_emails') is distinct from 'array' or jsonb_typeof(v->'cc_emails') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements((v->'to_emails')||(v->'cc_emails'))e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'raw_payload') is distinct from 'object' or jsonb_typeof(v->'direction') is distinct from 'string' or not coalesce(v->>'direction' in ('inbound','outbound') or (v->>'direction'='unknown' and v->'raw_payload'->'label_ids' @> '["DRAFT"]'::jsonb and v->'sent_at'='null'::jsonb),false)
   or exists(select 1 from jsonb_each(v)e where e.key=any(array['from_email','from_name','subject','snippet','body_text','body_html','sent_at','received_at']) and jsonb_typeof(e.value) not in ('string','null'))
  then raise exception 'learn_email_store_message_invalid' using errcode='22023';end if;
 end loop;
 -- Each thread summary must come from a message in this page and vice versa.
 if exists(select 1 from jsonb_array_elements(p_messages)m where not exists(select 1 from jsonb_array_elements(p_threads)t where t->>'provider_thread_id'=m->>'provider_thread_id'))
  or exists(select 1 from jsonb_array_elements(p_threads)t where not exists(select 1 from jsonb_array_elements(p_messages)m where m->>'provider_thread_id'=t->>'provider_thread_id'))
  or (select count(distinct elem->>'provider_thread_id') from jsonb_array_elements(p_threads)elem)<>jsonb_array_length(p_threads)
  or (select count(distinct elem->>'provider_message_id') from jsonb_array_elements(p_messages)elem)<>jsonb_array_length(p_messages)
 then raise exception 'learn_email_store_page_mismatch' using errcode='22023';end if;
 -- Mailbox history IDs are not comparable across accounts. A discovered
 -- cross-account source collision requires review, never silent replacement.
 if exists(select 1 from jsonb_array_elements(p_messages)entry join public.email_messages m
  on m.tenant_id=tenant and m.provider='gmail' and m.provider_message_id=entry->>'provider_message_id'
  where m.raw_payload ? 'provider_account_id' and m.raw_payload->>'provider_account_id' is distinct from p_context->>'email_account_id')
 then raise exception 'learn_email_store_mailbox_collision' using errcode='PT409';end if;
 insert into public.email_threads as retained(tenant_id,provider,provider_thread_id,subject,participants,last_message_at)
 select tenant,'gmail',x.provider_thread_id,x.subject,x.participants,x.last_message_at
 from jsonb_populate_recordset(null::public.email_threads,p_threads)x order by x.provider_thread_id
 on conflict(tenant_id,provider,provider_thread_id) do update set
  subject=case when retained.last_message_at is null or excluded.last_message_at>retained.last_message_at then coalesce(excluded.subject,retained.subject) else retained.subject end,
  last_message_at=greatest(retained.last_message_at,excluded.last_message_at),
  participants=(select coalesce(jsonb_agg(distinct e order by e),'[]') from jsonb_array_elements(retained.participants||excluded.participants)e);
 get diagnostics thread_count=row_count;
 insert into public.email_messages as retained(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
 select tenant,'gmail',x.provider_message_id,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,x.raw_payload||jsonb_build_object('provider_account_id',p_context->>'email_account_id')
 from jsonb_populate_recordset(null::public.email_messages,p_messages)x order by x.provider_message_id
 on conflict(tenant_id,provider,provider_message_id) do update set
  provider_thread_id=excluded.provider_thread_id,from_email=coalesce(excluded.from_email,retained.from_email),from_name=coalesce(excluded.from_name,retained.from_name),
  to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,subject=coalesce(excluded.subject,retained.subject),snippet=coalesce(excluded.snippet,retained.snippet),
  body_text=coalesce(excluded.body_text,retained.body_text),body_html=coalesce(excluded.body_html,retained.body_html),sent_at=case when excluded.direction='unknown' and excluded.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb then null else coalesce(excluded.sent_at,retained.sent_at) end,received_at=coalesce(excluded.received_at,retained.received_at),direction=excluded.direction,raw_payload=retained.raw_payload||excluded.raw_payload||case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$' then jsonb_build_object('provider_availability','available','provider_observed_history_id',excluded.raw_payload->>'history_id') else '{}'::jsonb end
 where p_context->>'fetch_policy'='refetch_all'
  and case when retained.raw_payload->>'provider_observed_history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'provider_observed_history_id')::numeric else false end
    else true end
  and case when retained.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'history_id')::numeric else false end
    else true end;
 get diagnostics message_count=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'message_upsert_count',message_count,'thread_upsert_count',thread_count);
end $$;

-- Prior message versions are private source history, never client-readable snapshots.
-- No backfill: versions are appended only when retained source fields actually change.
create table public.learn_email_source_versions (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 email_message_id uuid not null references public.email_messages(id),
 captured_at timestamptz not null default clock_timestamp(),
 source_row jsonb not null check(jsonb_typeof(source_row)='object')
);
alter table public.learn_email_source_versions enable row level security;
revoke all on public.learn_email_source_versions from public,anon,authenticated,service_role;
create index learn_email_source_versions_message on public.learn_email_source_versions(tenant_id,email_message_id,captured_at);
create function public.learn_email_preserve_source_version() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if old.provider='gmail' and (to_jsonb(old)-'updated_at') is distinct from (to_jsonb(new)-'updated_at') then
  insert into public.learn_email_source_versions(tenant_id,email_message_id,source_row)
   values(old.tenant_id,old.id,to_jsonb(old));
 end if;
 return new;
end $$;
revoke all on function public.learn_email_preserve_source_version() from public,anon,authenticated,service_role;
create trigger learn_email_preserve_source_version before update on public.email_messages
for each row execute function public.learn_email_preserve_source_version();

-- This is a provider-presence observation, not permission to delete local history.
-- A confirmed 404/410 is bounded by the traversal boundary, not by an invented
-- deletion timestamp. A newer stored history ID wins over an older traversal.
create function public.learn_email_store_unavailable(p_context jsonb,p_ids jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare c public.email_ingestion_checkpoints%rowtype; boundary text; observed integer;
begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 select * into strict c from public.email_ingestion_checkpoints
  where tenant_id=(p_context->>'tenant_id')::uuid and email_account_id=(p_context->>'email_account_id')::uuid and stream='recent';
 if p_context->>'stream'<>'recent' or c.continuation->>'version' is distinct from '4'
  or jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>2000
  or exists(select 1 from jsonb_array_elements(p_ids)e where jsonb_typeof(e)<>'string' or (not (e#>>'{}')~'^[a-zA-Z0-9_-]+$' or length(e#>>'{}')>256))
  or (select count(distinct value) from jsonb_array_elements(p_ids))<>jsonb_array_length(p_ids)
 then raise exception 'learn_email_availability_invalid' using errcode='22023';end if;
 boundary:=c.continuation->>'captured_history_id';
 if not coalesce(boundary~'^(0|[1-9][0-9]{0,19})$',false) or boundary::numeric>18446744073709551615 then
  raise exception 'learn_email_availability_boundary_invalid' using errcode='22023';end if;
 update public.email_messages m set raw_payload=m.raw_payload||jsonb_build_object(
   'provider_availability','unavailable','provider_observed_history_id',boundary)
 where m.tenant_id=(p_context->>'tenant_id')::uuid and m.provider='gmail'
  and m.raw_payload->>'provider_account_id'=p_context->>'email_account_id'
  and m.provider_message_id in(select jsonb_array_elements_text(p_ids))
  and case when m.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$' then (m.raw_payload->>'history_id')::numeric<=boundary::numeric else true end
  and case when m.raw_payload->>'provider_observed_history_id'~'^(0|[1-9][0-9]{0,19})$' then (m.raw_payload->>'provider_observed_history_id')::numeric<=boundary::numeric else true end
  and (m.raw_payload->>'provider_availability' is distinct from 'unavailable' or m.raw_payload->>'provider_observed_history_id' is distinct from boundary);
 get diagnostics observed=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'observed_count',observed);
end $$;
revoke all on function public.learn_email_store_unavailable(jsonb,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.learn_email_store_unavailable(jsonb,jsonb,text,integer) to service_role;
commit;
