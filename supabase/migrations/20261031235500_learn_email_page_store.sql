-- Additive server-only page persistence. No cursor, run or queue completion writes.
-- Existing identities and source rows are retained. Requires the local job/outbox
-- migrations and the installed v2 ingestion protocol; not a standalone release.
begin;
create function public.learn_email_store_guard(p_context jsonb,p_claimed_by text,p_claim integer) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.email_accounts%rowtype;r public.email_sync_runs%rowtype;c public.email_ingestion_checkpoints%rowtype;
 v_tenant uuid;v_account uuid;v_attempt uuid;v_generation uuid;v_revision bigint;v_stream text;
begin
 if current_user<>'service_role' then raise exception 'learn_email_store_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_context) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_context))<>8
  or not (p_context ?& array['tenant_id','email_account_id','attempt_id','stream','generation','revision','mailbox','fetch_policy'])
  or exists(select 1 from jsonb_each(p_context) e where jsonb_typeof(e.value)<>'string')
  or not coalesce(p_context->>'revision'~'^(0|[1-9][0-9]{0,18})$',false)
  or p_context->>'stream' not in ('recent','historical') or p_context->>'fetch_policy' not in ('missing_only','refetch_all')
  or nullif(btrim(p_context->>'mailbox'),'') is null
 then raise exception 'learn_email_store_context_invalid' using errcode='22023';end if;
 v_tenant:=(p_context->>'tenant_id')::uuid;v_account:=(p_context->>'email_account_id')::uuid;
 v_attempt:=(p_context->>'attempt_id')::uuid;v_generation:=(p_context->>'generation')::uuid;v_revision:=(p_context->>'revision')::bigint;v_stream:=p_context->>'stream';
 perform public.learn_email_attempt_lease(v_attempt,p_claimed_by,p_claim);
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||v_attempt::text,0));
 select * into a from public.email_accounts where id=v_account and tenant_id=v_tenant and provider='gmail' for update;
 if not found or lower(a.email_address) is distinct from lower(p_context->>'mailbox') then raise exception 'learn_email_store_account_mismatch' using errcode='PT409';end if;
 -- The account row serializes this read with all protocol transitions. The
 -- service role retains SELECT-only checkpoint access; no new progress privilege.
 select * into c from public.email_ingestion_checkpoints where tenant_id=v_tenant and email_account_id=v_account and email_ingestion_checkpoints.stream=v_stream;
 if not found or c.contract_version<>2 or c.state<>'claimed' or c.owner_attempt_id is distinct from v_attempt
  or c.generation is distinct from v_generation or c.revision is distinct from v_revision then raise exception 'learn_email_store_checkpoint_changed' using errcode='PT409';end if;
 select * into r from public.email_sync_runs where id=v_attempt and tenant_id=v_tenant for update;
 if not found or r.provider<>'gmail' or r.status<>'running' or (r.metadata->>'email_account_id')::uuid is distinct from v_account
  or (v_stream='historical' and r.sync_type<>'workspace_backfill') or (v_stream='recent' and r.sync_type not in ('messages','workspace_messages'))
 then raise exception 'learn_email_store_attempt_invalid' using errcode='PT409';end if;
 if not coalesce(case when r.sync_type='messages' then a.status='active' and a.auth_state in ('ok','unknown') else a.status in ('pending_tokenless_dwd','active_dwd') end,false)
 then raise exception 'learn_email_store_ineligible' using errcode='PT409';end if;
 if (v_stream='recent' and (c.continuation->>'phase' is distinct from 'initialized' or c.continuation->>'fetch_policy' is distinct from p_context->>'fetch_policy'))
  or (v_stream='historical' and p_context->>'fetch_policy'<>'missing_only') then raise exception 'learn_email_store_policy_changed' using errcode='PT409';end if;
end $$;

create function public.learn_email_store_existing(p_context jsonb,p_ids jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare result jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>2000
  or exists(select 1 from jsonb_array_elements(p_ids)e where jsonb_typeof(e)<>'string' or (not (e#>>'{}')~'^[a-zA-Z0-9_-]+$' or length(e#>>'{}')>256))
 then raise exception 'learn_email_store_ids_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(provider_message_id order by provider_message_id),'[]') into result from public.email_messages
  where tenant_id=(p_context->>'tenant_id')::uuid and provider='gmail' and provider_message_id in (select jsonb_array_elements_text(p_ids));
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'existing_ids',result);
end $$;

create function public.learn_email_store_page(p_context jsonb,p_threads jsonb,p_messages jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
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
   or jsonb_typeof(v->'raw_payload') is distinct from 'object' or jsonb_typeof(v->'direction') is distinct from 'string' or v->>'direction' not in ('inbound','outbound')
   or exists(select 1 from jsonb_each(v)e where e.key=any(array['from_email','from_name','subject','snippet','body_text','body_html','sent_at','received_at']) and jsonb_typeof(e.value) not in ('string','null'))
  then raise exception 'learn_email_store_message_invalid' using errcode='22023';end if;
 end loop;
 -- Each thread summary must come from a message in this page and vice versa.
 if exists(select 1 from jsonb_array_elements(p_messages)m where not exists(select 1 from jsonb_array_elements(p_threads)t where t->>'provider_thread_id'=m->>'provider_thread_id'))
  or exists(select 1 from jsonb_array_elements(p_threads)t where not exists(select 1 from jsonb_array_elements(p_messages)m where m->>'provider_thread_id'=t->>'provider_thread_id'))
  or (select count(distinct elem->>'provider_thread_id') from jsonb_array_elements(p_threads)elem)<>jsonb_array_length(p_threads)
  or (select count(distinct elem->>'provider_message_id') from jsonb_array_elements(p_messages)elem)<>jsonb_array_length(p_messages)
 then raise exception 'learn_email_store_page_mismatch' using errcode='22023';end if;
 insert into public.email_threads as retained(tenant_id,provider,provider_thread_id,subject,participants,last_message_at)
 select tenant,'gmail',x.provider_thread_id,x.subject,x.participants,x.last_message_at
 from jsonb_populate_recordset(null::public.email_threads,p_threads)x order by x.provider_thread_id
 on conflict(tenant_id,provider,provider_thread_id) do update set
  subject=case when retained.last_message_at is null or excluded.last_message_at>retained.last_message_at then coalesce(excluded.subject,retained.subject) else retained.subject end,
  last_message_at=greatest(retained.last_message_at,excluded.last_message_at),
  participants=(select coalesce(jsonb_agg(distinct e order by e),'[]') from jsonb_array_elements(retained.participants||excluded.participants)e);
 get diagnostics thread_count=row_count;
 insert into public.email_messages as retained(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
 select tenant,'gmail',x.provider_message_id,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,x.raw_payload
 from jsonb_populate_recordset(null::public.email_messages,p_messages)x order by x.provider_message_id
 on conflict(tenant_id,provider,provider_message_id) do update set
  provider_thread_id=excluded.provider_thread_id,from_email=coalesce(excluded.from_email,retained.from_email),from_name=coalesce(excluded.from_name,retained.from_name),
  to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,subject=coalesce(excluded.subject,retained.subject),snippet=coalesce(excluded.snippet,retained.snippet),
  body_text=coalesce(excluded.body_text,retained.body_text),body_html=coalesce(excluded.body_html,retained.body_html),sent_at=coalesce(excluded.sent_at,retained.sent_at),received_at=coalesce(excluded.received_at,retained.received_at),direction=excluded.direction,raw_payload=retained.raw_payload||excluded.raw_payload
 where p_context->>'fetch_policy'='refetch_all'
  and case when retained.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'history_id')::numeric else false end
    else true end;
 get diagnostics message_count=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'message_upsert_count',message_count,'thread_upsert_count',thread_count);
end $$;
revoke all on function public.learn_email_store_guard(jsonb,text,integer),public.learn_email_store_existing(jsonb,jsonb,text,integer),public.learn_email_store_page(jsonb,jsonb,jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_store_guard(jsonb,text,integer),public.learn_email_store_existing(jsonb,jsonb,text,integer),public.learn_email_store_page(jsonb,jsonb,jsonb,text,integer) to service_role;
commit;
