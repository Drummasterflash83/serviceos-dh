-- Initial verification cycle starts at approval; later cycles keep the approved
-- delay after a completed cycle. Installation changes no existing policy.
begin;
do $patch$
declare d text;needle text:='clock_timestamp()+make_interval(hours=>p_interval_hours),case when p_enabled then';begin
 select pg_get_functiondef('public.learn_quickbooks_recurring_control(uuid,uuid,boolean,bigint,integer,integer,text)'::regprocedure) into d;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'quickbooks_initial_schedule_source_changed';end if;
 execute replace(d,needle,'case when p_enabled then clock_timestamp() else clock_timestamp()+make_interval(hours=>p_interval_hours) end,case when p_enabled then');
end $patch$;
commit;
