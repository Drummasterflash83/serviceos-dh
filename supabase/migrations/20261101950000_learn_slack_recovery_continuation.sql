-- A recovery approval authorises exactly its one retained failed page. Once that
-- page commits, an ordinary successor uses the existing campaign authority and
-- allowance. Retain parent_job_id and the immutable recovery receipt for audit.
begin;
do $$declare d text;needle text:='j.id,j.payload)';begin
 d:=pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure);
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Reviewed history continuation payload differs';end if;
 execute replace(d,needle,'j.id,j.payload-''campaign_recovery_id'')');
end$$;
commit;
