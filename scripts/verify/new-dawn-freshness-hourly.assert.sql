set test.role='service_role';
do $$
declare result jsonb;second_run uuid;
begin
 -- The saved ID and connection revision have not changed. A fresh provider
 -- comparison still has to start after the one-hour cooldown.
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'ready' then
  raise exception 'unchanged saved source must get hourly provider check: %',result;end if;
 select id into second_run from public.new_dawn_commusoft_freshness_runs
  where run_number=2 and saved_id='13446' and state='collecting';
 if second_run is null then raise exception 'immutable second receipt missing';end if;
 update public.new_dawn_commusoft_freshness_runs
  set state='complete',checked_at=clock_timestamp(),claim_token=null
  where id=second_run;
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'idle' or
   (select count(*) from public.new_dawn_commusoft_freshness_runs)<>2 then
  raise exception 'hourly cooldown failed: %',result;end if;
 update public.new_dawn_commusoft_freshness_runs
  set run_number=26,checked_at=clock_timestamp()-interval '2 hours'
  where id=second_run;
 result:=public.new_dawn_commusoft_freshness_claim();
 if result->>'state'<>'idle' or
   (select count(*) from public.new_dawn_commusoft_freshness_runs)<>2 then
  raise exception '26-run London-day cap failed: %',result;end if;
end $$;
