-- Preserve the current validated append implementation when adding work receipts.
-- On a complete migration replay this evidence source is already present; the
-- selective TEST release adds it without overwriting newer membership guards.
do $patch$ declare d text; old_list text; new_list text; signature text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into d;
 old_list:=$old$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members')$old$;
 new_list:=$new$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs')$new$;
 if array_length(string_to_array(d,old_list),1)=2 then execute replace(d,old_list,new_list);
 elsif array_length(string_to_array(d,new_list),1)<>2 then raise exception 'Unexpected adapter evidence contract';end if;
 foreach signature in array array[
  'public.learn_work_handoffs_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text)',
  'public.learn_work_residence_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text)'
 ] loop
  select pg_get_functiondef(to_regprocedure(signature)) into d;
  if d is null or array_length(string_to_array(d,'errcode=''40001'''),1)<>3 then
   raise exception 'Unexpected collection conflict contract';end if;
  execute replace(d,'errcode=''40001''','errcode=''PT409''');
 end loop;
end $patch$;
-- The retained row trigger does not cover a whole-table TRUNCATE.
create trigger learn_work_history_no_truncate before truncate on public.object_state_history
 for each statement execute function public.learn_member_history_immutable();
alter table public.learn_work_measurement_runs add constraint learn_work_measurement_actor_fkey
 foreign key(actor_id) references public.profiles(id);
-- Put temporary schemas last explicitly in every released work function.
alter function public.learn_work_history_immutable() set search_path=public,pg_temp;
alter function public.learn_work_snapshot(public.intelligence_objects) set search_path=public,pg_temp;
alter function public.learn_capture_work_change() set search_path=public,pg_temp;
alter function public.learn_work_capture_baseline(uuid,uuid) set search_path=public,pg_temp;
alter function public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) set search_path=public,pg_temp;
alter function public.learn_handoff_owner(uuid,jsonb,jsonb,timestamptz) set search_path=public,pg_temp;
alter function public.learn_work_handoffs_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) set search_path=public,pg_temp;
alter function public.learn_work_residence_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) set search_path=public,pg_temp;
revoke all on function public.learn_work_history_immutable() from public,anon,authenticated,service_role;
