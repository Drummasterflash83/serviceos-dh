-- An unchanged source revision can be a confirmed progress receipt when only
-- Email metadata changed. Permit continuation only after a full, distinct,
-- claim-owned Email batch of committed unchanged publication receipts.
-- The next older-Email batch may grow to 50; current Email and other job
-- sources keep their existing settlement policy.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$declare definition text; old_guard text; old_count text; old_payload text;
 new_guard text; new_count text; new_payload text;
begin
 definition:=pg_get_functiondef('public.learn_processing_settle(uuid,uuid,text,integer,uuid,jsonb,text)'::regprocedure);
 if md5(definition)<>'5ad5d407c2d9445fa8231051a5ada9d1'
 then raise exception 'email_settlement_baseline_changed';end if;
 old_guard:='or (continued and ((records=0 and not review_continuation) or p_definition->''result''->''continued'' is distinct from ''true''::jsonb))';
 -- j has not been selected at this early validation point. Defer the scoped
 -- zero-record decision to the later fenced, claim-owned validation below.
 new_guard:='or (continued and (p_definition->''result''->''continued'' is distinct from ''true''::jsonb))';
 old_count:='if records>actual or (success and records<>actual) then raise exception ''processing_count_unconfirmed'' using errcode=''PT409'';end if;';
 new_count:=$patch$if records>actual or (success and records<>actual) then raise exception 'processing_count_unconfirmed' using errcode='PT409';end if;
 if continued and records=0 and not review_continuation then
  limit_n:=case when coalesce(j.payload->>'limit','')~'^[0-9]{1,6}$'
    then greatest(1,least(50,(j.payload->>'limit')::integer)) else 20 end;
  if not success or j.job_type<>'interactions.sync'
    or coalesce(j.payload->>'source','all')<>'email'
    or j.payload ? 'lane'
    or coalesce((p_definition->'result'->>'skipped')::integer,-1)<>limit_n
    or coalesce((p_definition->'result'->>'failed')::integer,-1)<>0
    or coalesce((p_definition->'result'->>'reviews_recorded')::integer,-1)<>0
  then raise exception 'processing_unchanged_continuation_invalid' using errcode='PT409';end if;
  select count(*),count(distinct p.source_id),
   count(*) filter(where p.receipt->>'state'='committed' and p.receipt->>'action'='unchanged')
   into total_receipts,batch_receipts,skipped_confirmed
   from public.learn_processing_publications p
   where p.tenant_id=p_tenant and p.job_id=p_job and p.attempt=p_attempt
    and p.worker=p_worker and p.source_kind='email';
  if total_receipts<>limit_n or batch_receipts<>limit_n or skipped_confirmed<>limit_n
  then raise exception 'processing_unchanged_receipts_unconfirmed' using errcode='PT409';end if;
 end if;$patch$;
 old_payload:='payload:=jsonb_build_object(''limit'',limit_n)||case j.job_type when ''interactions.sync'' then jsonb_build_object(''source'',source) else ''{}''::jsonb end;';
 new_payload:='payload:=jsonb_build_object(''limit'',case when j.job_type=''interactions.sync'' and source=''email'' and not(j.payload ? ''lane'') then 50 else limit_n end)||case j.job_type when ''interactions.sync'' then jsonb_build_object(''source'',source) else ''{}''::jsonb end;';
 if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1
  or (length(definition)-length(replace(definition,old_count,'')))/length(old_count)<>1
  or (length(definition)-length(replace(definition,old_payload,'')))/length(old_payload)<>1
 then raise exception 'email_settlement_anchor_changed';end if;
 execute replace(replace(replace(definition,old_guard,new_guard),old_count,new_count),old_payload,new_payload);
end$$;
notify pgrst, 'reload schema';
commit;
