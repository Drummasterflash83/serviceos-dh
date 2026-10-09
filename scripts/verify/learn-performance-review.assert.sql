-- Snapshot all existing facts; review must never change value or timestamps.
create table facts_before as select * from measurements;
set role authenticated;
select set_config('test.tenant','00000000-0000-4000-8000-000000000001',false);
select set_config('test.actor','00000000-0000-4000-8000-000000000030',false);
select set_config('test.role','owner',false);
do $$
declare t uuid:='00000000-0000-4000-8000-000000000001'; m uuid:='00000000-0000-4000-8000-000000000009'; r jsonb;
begin
 r:=learn_performance_review(t,m,'00000000-0000-4000-8000-000000000031',0,'confirmed','Checked the source calculation');
 if r->>'decision'<>'confirmed' or r->>'revision'<>'1' or r->>'reused'<>'false' then raise exception 'Bad review receipt';end if;
 r:=learn_performance_review(t,m,'00000000-0000-4000-8000-000000000031',0,'confirmed','Checked the source calculation');
 if r->>'reused'<>'true' then raise exception 'Replay duplicated';end if;
 begin perform learn_performance_review(t,m,'00000000-0000-4000-8000-000000000031',0,'disputed','Changed request');raise exception 'Changed replay accepted';exception when serialization_failure then null;end;
 begin perform learn_performance_review(t,m,'00000000-0000-4000-8000-000000000032',0,'disputed','Stale review');raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
 begin perform learn_performance_review(t,'00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000032',0,'confirmed','Corrected fact');raise exception 'Corrected fact reviewed';exception when serialization_failure then null;end;
 begin perform learn_performance_review('00000000-0000-4000-8000-000000000002',m,'00000000-0000-4000-8000-000000000032',0,'confirmed','Foreign tenant');raise exception 'Foreign tenant accepted';exception when insufficient_privilege then null;end;
 begin perform learn_performance_review(t,'00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000032',0,'confirmed','Missing fact');raise exception 'Missing fact accepted';exception when invalid_parameter_value then null;end;
 perform learn_performance_review(t,m,'00000000-0000-4000-8000-000000000032',1,'disputed','Sample population needs correction');
 if (select count(*) from learn_performance_reviews)<>2 then raise exception 'Review history lost';end if;
 perform set_config('test.role','viewer',false);
 if (select count(*) from learn_performance_reviews)<>0 then raise exception 'Viewer read review';end if;
 begin perform learn_performance_review(t,m,'00000000-0000-4000-8000-000000000033',2,'confirmed','Viewer');raise exception 'Viewer reviewed';exception when insufficient_privilege then null;end;
 perform set_config('test.role','',false);
 begin perform learn_performance_review(t,m,'00000000-0000-4000-8000-000000000033',2,'confirmed','Missing role');raise exception 'Missing role reviewed';exception when insufficient_privilege then null;end;
 perform set_config('test.role','owner',false);
 perform set_config('test.actor','',false);
 begin perform learn_performance_review(t,m,'00000000-0000-4000-8000-000000000033',2,'confirmed','No actor');raise exception 'Missing actor reviewed';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000030',null,now()+interval '1 hour');
set role authenticated;
select set_config('test.actor','00000000-0000-4000-8000-000000000030',false);
do $$ begin
 begin perform learn_performance_review('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000033',2,'confirmed','Preview');raise exception 'Preview reviewed';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if exists((select * from facts_before except select * from measurements) union all (select * from measurements except select * from facts_before)) then raise exception 'Review changed source facts or freshness';end if;
 if (select count(*) from learn_performance_reviews)<>2 then raise exception 'Rejected review wrote history';end if;
 begin update learn_performance_reviews set reason='Rewrite';raise exception 'Review edited';exception when restrict_violation then null;end;
 begin delete from learn_performance_reviews;raise exception 'Review deleted';exception when restrict_violation then null;end;
 if has_function_privilege('service_role','learn_performance_review(uuid,uuid,uuid,integer,text,text)','execute') or has_function_privilege('anon','learn_performance_review(uuid,uuid,uuid,integer,text,text)','execute') then raise exception 'Non-human review granted';end if;
 if has_table_privilege('authenticated','learn_performance_reviews','insert') or has_table_privilege('service_role','learn_performance_reviews','insert') then raise exception 'Direct review writes granted';end if;
end $$;
select 'PASS: review authority, idempotence, stale/corrected fact rejection, immutable ledger and unchanged source freshness' as result;
