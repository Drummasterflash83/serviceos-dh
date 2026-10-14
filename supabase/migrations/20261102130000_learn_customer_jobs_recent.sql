-- Add a recent-jobs reader without changing the existing UUID-paged contract.
-- Exact source shape guards prevent silently cloning an unexpected reader.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';
do $migration$
declare d text;old text;new text;
begin
 if to_regprocedure('public.learn_customer_jobs_recent(uuid,uuid,text,uuid,text)') is not null then
  raise exception 'Recent job reader already exists; inspect before retry';end if;
 d:=pg_get_functiondef('public.learn_customer_business_context(uuid,uuid,text,uuid,text)'::regprocedure);
 if position('public.learn_operator_input_access' in d)=0 or position('public.learn_import_batch_authority' in d)=0
  or position('public.controlplane_change_log' in d)=0 then raise exception 'Business reader authority changed';end if;
 d:=replace(d,'FUNCTION public.learn_customer_business_context(', 'FUNCTION public.learn_customer_jobs_recent(');
 old:=' audit uuid;checked timestamptz;operator_mode boolean:=p_operator_reason is not null;';
 new:=' audit uuid;checked timestamptz;cursor_valid boolean;operator_mode boolean:=p_operator_reason is not null;';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader declaration differs';end if;d:=replace(d,old,new);
 old:=' case p_collection';new:=' if p_collection is distinct from ''jobs'' then raise exception ''recent_jobs_collection_invalid'' using errcode=''22023'';end if;'||E'\n'||old;
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader collection differs';end if;d:=replace(d,old,new);
 old:='select t.id,jsonb_build_object(%s) fields';new:='select t.id,t.created_date sort_at,jsonb_build_object(%s) fields';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader fields differ';end if;d:=replace(d,old,new);
 old:='),page as(select * from matched where $2::uuid is null or id>$2 order by id limit 26),';
 new:='),page as(select m.* from matched m where $2::uuid is null or exists(select 1 from matched a where a.id=$2 and
   (m.sort_at<a.sort_at or (m.sort_at is null and a.sort_at is not null) or (m.sort_at is not distinct from a.sort_at and m.id>a.id)))
   order by sort_at desc nulls last,id limit 26),';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader page differs';end if;d:=replace(d,old,new);
 old:='shown as(select * from page order by id limit 25)';new:='shown as(select * from page order by sort_at desc nulls last,id limit 25)';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader bounds differ';end if;d:=replace(d,old,new);
 old:='select s.id,jsonb_build_object(''id'',s.id';new:='select s.id,s.sort_at,jsonb_build_object(''id'',s.id';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader mapping differs';end if;d:=replace(d,old,new);
 old:='jsonb_agg(entry order by id) from mapped';new:='jsonb_agg(entry order by sort_at desc nulls last,id) from mapped';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader ordering differs';end if;d:=replace(d,old,new);
 old:='select id from shown order by id desc limit 1';new:='select id from shown order by sort_at asc nulls first,id desc limit 1';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader cursor differs';end if;d:=replace(d,old,new);
 old:='(select count(*) from matched)';new:=old||',($2::uuid is null or exists(select 1 from matched where id=$2))';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader count differs';end if;d:=replace(d,old,new);
 old:='into entries,next_id,total';new:='into entries,next_id,total,cursor_valid';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader output differs';end if;d:=replace(d,old,new);
 old:='using p_tenant,p_after,customer.person_id,customer.company_id,p_card;';new:=old||E'\n'||' if not cursor_valid then raise exception ''recent_jobs_cursor_unavailable'' using errcode=''22023'';end if;';
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader binding differs';end if;d:=replace(d,old,new);
 d:=replace(d,'learn-customer-business-context/1','learn-customer-jobs-recent/1');
 d:=replace(d,'learn-customer-business-context','learn-customer-jobs-recent');
 old:=$old$'collection',p_collection,'after',p_after$old$;new:=$new$'order','created_desc','collection',p_collection,'after',p_after$new$;
 if length(d)-length(replace(d,old,''))<>length(old) then raise exception 'Recent reader response differs';end if;d:=replace(d,old,new);
 execute d;
end$migration$;
revoke all on function public.learn_customer_jobs_recent(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_customer_jobs_recent(uuid,uuid,text,uuid,text) to authenticated;
commit;
