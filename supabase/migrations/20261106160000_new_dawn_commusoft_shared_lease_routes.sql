-- Route the remaining one-use Commusoft reads through the same owner-bound
-- credential lease as source pages. Existing queue guards and feature flags
-- stay unchanged; this migration cannot enable manual/import coexistence.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $patch$
declare d text;old text;replacement text;signature text;
begin
 -- Exact job: the request UUID is the only owner; a waiting acquisition must
 -- leave the request prepared and must never return a Vault key.
 signature:='public.new_dawn_commusoft_job_detail_acquire(uuid)';
 d:=pg_get_functiondef(signature::regprocedure);
 old:=$old$ insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates
  where credential_fingerprint=fingerprint for update;
 if next_at>clock_timestamp() then
  update public.new_dawn_commusoft_job_detail_reads set state='prepared',claimed_at=null where id=p_request;
  return jsonb_build_object('state','wait','retry_at',ceil(extract(epoch from next_at)*1000)::bigint);
 end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
  where credential_fingerprint=fingerprint;$old$;
 replacement:=$new$ lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'job_detail',p_request::text);
 if lease->>'state'='wait' then
  update public.new_dawn_commusoft_job_detail_reads set state='prepared',claimed_at=null where id=p_request;
  return jsonb_build_object('state','wait','retry_at',(lease->>'retryAt')::bigint);
 end if;
 if lease->>'state'<>'ready' then raise exception 'job_detail_lease_unavailable' using errcode='55000';end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1
  or (length(d)-length(replace(d,'secret text;fingerprint text;next_at timestamptz;','')))/length('secret text;fingerprint text;next_at timestamptz;')<>1
 then raise exception 'job_detail_lease_contract_changed';end if;
 d:=replace(d,'secret text;fingerprint text;next_at timestamptz;',
  'secret text;fingerprint text;next_at timestamptz;lease jsonb;');
 execute replace(d,old,replacement);

 -- Opportunity: one prepared request may acquire once. Its existing one-use
 -- permit and binding checks remain unchanged.
 signature:='public.new_dawn_commusoft_opportunity_probe_acquire(uuid)';
 d:=pg_get_functiondef(signature::regprocedure);
 old:=$old$ insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates
  where credential_fingerprint=fingerprint for update;
 if next_at>clock_timestamp() then
  return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds'
  where credential_fingerprint=fingerprint;$old$;
 replacement:=$new$ lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'opportunity',p_request::text);
 if lease->>'state'='wait' then return lease;end if;
 if lease->>'state'<>'ready' then raise exception 'opportunity_probe_lease_unavailable' using errcode='55000';end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1
  or (length(d)-length(replace(d,'secret text;fingerprint text;next_at timestamptz;permit uuid:=gen_random_uuid();','')))
   /length('secret text;fingerprint text;next_at timestamptz;permit uuid:=gen_random_uuid();')<>1
 then raise exception 'opportunity_lease_contract_changed';end if;
 d:=replace(d,'secret text;fingerprint text;next_at timestamptz;permit uuid:=gen_random_uuid();',
  'secret text;fingerprint text;next_at timestamptz;lease jsonb;permit uuid:=gen_random_uuid();');
 execute replace(d,old,replacement);

 -- Connection verification may run outside import only under existing
 -- authority. The one-use permit still binds any late 429 extension.
 signature:='public.learn_commusoft_verify_acquire(uuid,uuid)';
 d:=pg_get_functiondef(signature::regprocedure);
 old:=$old$ insert into public.learn_business_input_request_gates values(fingerprint,clock_timestamp()) on conflict do nothing;
 select next_allowed_at into next_at from public.learn_business_input_request_gates where credential_fingerprint=fingerprint for update;
 if not public.learn_commusoft_verification_authority(r) then return null;end if;
 if next_at>clock_timestamp() then return jsonb_build_object('state','wait','retryAt',ceil(extract(epoch from next_at)*1000)::bigint);end if;
 update public.learn_business_input_request_gates set next_allowed_at=clock_timestamp()+interval '1250 milliseconds' where credential_fingerprint=fingerprint;$old$;
 replacement:=$new$ if not public.learn_commusoft_verification_authority(r) then return null;end if;
 lease:=public.learn_commusoft_shared_lease_acquire(fingerprint,'verification',p_request::text);
 if lease->>'state'='wait' then return lease;end if;
 if lease->>'state'<>'ready' then return null;end if;$new$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1
  or (length(d)-length(replace(d,'secret text;fingerprint text;next_at timestamptz;permit public.learn_commusoft_verification_permits%rowtype;','')))
   /length('secret text;fingerprint text;next_at timestamptz;permit public.learn_commusoft_verification_permits%rowtype;')<>1
 then raise exception 'verification_lease_contract_changed';end if;
 d:=replace(d,'secret text;fingerprint text;next_at timestamptz;permit public.learn_commusoft_verification_permits%rowtype;',
  'secret text;fingerprint text;next_at timestamptz;lease jsonb;permit public.learn_commusoft_verification_permits%rowtype;');
 execute replace(d,old,replacement);
end $patch$;

-- Release only the same owner, after durable result or explicit failure.
-- Failed SQL transactions roll these releases back with their receipts.
create function public.new_dawn_commusoft_manual_lease_release()
returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_table_name='new_dawn_commusoft_job_detail_reads' then
  if old.state='claimed' and new.state in ('complete','failed') then
   perform public.learn_commusoft_shared_lease_release('job_detail',new.id::text);
  end if;
 elsif tg_table_name='new_dawn_commusoft_opportunity_probes' then
  if old.state='claimed' and new.state in ('complete','failed') then
   perform public.learn_commusoft_shared_lease_release('opportunity',new.id::text);
  end if;
 elsif tg_table_name='learn_commusoft_verification_results' then
  perform public.learn_commusoft_shared_lease_release('verification',new.request_id::text);
 end if;
 return new;
end $$;
create trigger new_dawn_job_detail_lease_release after update of state
 on public.new_dawn_commusoft_job_detail_reads for each row
 execute function public.new_dawn_commusoft_manual_lease_release();
create trigger new_dawn_opportunity_lease_release after update of state
 on public.new_dawn_commusoft_opportunity_probes for each row
 execute function public.new_dawn_commusoft_manual_lease_release();
create trigger new_dawn_verification_lease_release after insert
 on public.learn_commusoft_verification_results for each row
 execute function public.new_dawn_commusoft_manual_lease_release();
revoke all on function public.new_dawn_commusoft_manual_lease_release()
 from public,anon,authenticated,service_role;
commit;
