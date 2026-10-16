-- Keep job freshness independent during the one-hour full-cycle rest as well.
-- Preserve the exact full-cycle due time and frontend-compatible status on resume.
begin;
do $patch$ declare d text;r record;begin
 d:=pg_get_functiondef('public.learn_commusoft_schedule_current_jobs(integer)'::regprocedure);
 for r in select * from (values
  ($old$r.phase in(3,4)$old$,$new$r.phase in(0,3,4)$new$),
  ($old$current_definition=saved->'current_definition'$old$,$new$current_definition=nullif(saved->'current_definition','null'::jsonb)$new$),
  ($old$next_check_at=clock_timestamp(),last_state='contact_resumed',updated_at=clock_timestamp()$old$,
   $new$next_check_at=greatest(coalesce((saved->>'next_check_at')::timestamptz,clock_timestamp()),clock_timestamp()),
    last_state=case when not s.enabled then 'paused' else coalesce(saved->>'last_state','ready') end,updated_at=clock_timestamp()$new$),
  ($old$  if not f.enabled or not s.enabled or s.phase not in(3,4) or f.next_check_at>clock_timestamp()
   or not public.learn_commusoft_recurring_actor(s.approved_by) or a.status<>'active'
   or public.learn_operator_input_flags(s.tenant_id) is distinct from '{"learn.enabled":true,"learn.inputs.commusoft.enabled":true}'::jsonb
   or a.settings->'commusoft_import'->>'resource' is distinct from 'propertyContacts'
   or a.settings->'commusoft_import'->>'approvalId' is distinct from s.current_request::text
   or a.sync_cursor->'complete'='true'::jsonb then continue;end if;$old$,
   $new$  if not f.enabled or not s.enabled or s.phase not in(0,3,4) or f.next_check_at>clock_timestamp()
   or not public.learn_commusoft_recurring_actor(s.approved_by) or a.status<>'active'
   or public.learn_operator_input_flags(s.tenant_id) is distinct from '{"learn.enabled":true,"learn.inputs.commusoft.enabled":true}'::jsonb then continue;end if;
  if s.phase=0 then
   if s.current_request is not null or a.sync_cursor->'complete' is distinct from 'true'::jsonb
    or exists(select 1 from public.platform_jobs j where j.tenant_id=s.tenant_id and j.job_type='commusoft.source_sync'
     and j.payload->>'connector_account_id'=s.account_id::text and j.status in('queued','running','retrying')) then continue;end if;
  elsif a.settings->'commusoft_import'->>'resource' is distinct from 'propertyContacts'
   or a.settings->'commusoft_import'->>'approvalId' is distinct from s.current_request::text
   or a.sync_cursor->'complete'='true'::jsonb then continue;
  end if;$new$),
  ($old$'current_request',s.current_request,'current_definition',s.current_definition,'cycle_start',s.cycle_start,'cycle_end',s.cycle_end)$old$,
   $new$'current_request',s.current_request,'current_definition',s.current_definition,'cycle_start',s.cycle_start,'cycle_end',s.cycle_end,
   'next_check_at',s.next_check_at,'last_state',s.last_state)$new$)
 ) patches(old_source,new_source) loop
  if length(d)-length(replace(d,r.old_source,''))<>length(r.old_source) then raise exception 'commusoft_current_jobs_idle_source_changed';end if;
  d:=replace(d,r.old_source,r.new_source);
 end loop;
 execute d;
end $patch$;
commit;
