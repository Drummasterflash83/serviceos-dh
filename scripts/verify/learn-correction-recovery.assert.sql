create temp table recovery_measurements_before as select * from measurements;
create temp table recovery_reviews_before as select * from learn_performance_reviews;
create temp table recovery_corrections_before as select * from learn_performance_corrections;
set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';
do $$ declare t uuid:='00000000-0000-4000-8000-000000000001';m uuid:='00000000-0000-4000-8000-000000000043';r uuid:='00000000-0000-4000-8000-000000000070';v jsonb;
begin
 v:=learn_performance_correction_resolve(t,m,r,0,17,'Pending recovery',false);
 if v->>'state'<>'pending' then raise exception 'Pending request not found';end if;
 v:=learn_performance_correction_resolve(t,m,r,0,17,'Pending recovery',true);
 if v->>'state'<>'cancelled' then raise exception 'Cancellation not recorded';end if;
 if learn_performance_correction_resolve(t,m,r,0,17,'Pending recovery',true) is distinct from v then raise exception 'Cancellation retry changed';end if;
 begin perform learn_performance_correct(t,m,r,0,17,'Pending recovery');raise exception 'Delayed request bypassed cancellation';exception when sqlstate 'PT409' then null;end;
 begin perform learn_performance_correction_resolve(t,m,r,0,18,'Pending recovery',false);raise exception 'Changed cancellation identity accepted';exception when sqlstate 'PT409' then null;end;
 -- Already recorded corrections remain recorded even when cancellation is requested.
 v:=learn_performance_correction_resolve(t,'00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000043',1,null,'Withhold until source ambiguity is resolved',true);
 if v->>'state'<>'recorded' or v->>'actorId'<>'00000000-0000-4000-8000-000000000030' or v->>'recordedAt' is null then raise exception 'Recorded correction not recovered';end if;
 -- Superseded/stale predecessor intents are cancellable without changing evidence.
 v:=learn_performance_correction_resolve(t,'00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000071',0,17,'Stale request',true);
 if v->>'state'<>'cancelled' then raise exception 'Stale intent cannot retire';end if;
 begin perform learn_performance_correction_resolve(t,m,gen_random_uuid(),0,17,'Invalid action',null);raise exception 'NULL action accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_performance_correction_resolve(t,m,gen_random_uuid(),0,'NaN','Invalid value',false);raise exception 'NaN accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_performance_correction_resolve(t,gen_random_uuid(),gen_random_uuid(),0,17,'Missing observation',true);raise exception 'Missing observation accepted';exception when invalid_parameter_value then null;end;
end $$;
set test.actor='00000000-0000-4000-8000-000000000042';
do $$ begin begin perform learn_performance_correction_resolve('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043',gen_random_uuid(),0,17,'Viewer',false);raise exception 'Viewer recovered';exception when insufficient_privilege then null;end;end $$;
set test.actor='00000000-0000-4000-8000-000000000041';
do $$ begin begin perform learn_performance_correction_resolve('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043',gen_random_uuid(),0,17,'Foreign owner',false);raise exception 'Foreign owner recovered';exception when insufficient_privilege then null;end;end $$;
reset role;
insert into profiles values('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000001','admin');
set role authenticated;set test.actor='00000000-0000-4000-8000-000000000072';
do $$ begin begin perform learn_performance_correction_resolve('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000070',0,17,'Pending recovery',false);raise exception 'Another actor recovered request';exception when sqlstate 'PT409' then null;end;end $$;
reset role;
insert into view_as_context values('00000000-0000-4000-8000-000000000030',null,now()+interval '1 hour');
set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';
do $$ begin begin perform learn_performance_correction_resolve('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000070',0,17,'Pending recovery',false);raise exception 'View-as recovered';exception when insufficient_privilege then null;end;end $$;
reset role;delete from view_as_context;
do $$ declare r text;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  if has_table_privilege(r,'learn_correction_cancellations','select,insert,update,delete,truncate') then raise exception 'Cancellation table access broadened';end if;
 end loop;
 if has_function_privilege('anon','learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean)','execute') or has_function_privilege('service_role','learn_performance_correction_resolve(uuid,uuid,uuid,integer,numeric,text,boolean)','execute') then raise exception 'Recovery RPC access broadened';end if;
 begin update learn_correction_cancellations set request='{}';raise exception 'Cancellation rewritten';exception when restrict_violation then null;end;
 begin delete from learn_correction_cancellations;raise exception 'Cancellation deleted';exception when restrict_violation then null;end;
 begin truncate learn_correction_cancellations;raise exception 'Cancellation truncated';exception when restrict_violation then null;end;
 if exists(select * from recovery_measurements_before except select * from measurements) or exists(select * from measurements except select * from recovery_measurements_before)
 or exists(select * from recovery_reviews_before except select * from learn_performance_reviews) or exists(select * from learn_performance_reviews except select * from recovery_reviews_before)
 or exists(select * from recovery_corrections_before except select * from learn_performance_corrections) or exists(select * from learn_performance_corrections except select * from recovery_corrections_before) then raise exception 'Recovery changed retained evidence';end if;
end $$;
select 'PASS: correction recovery, exact identity, cancellation, stale-intent retirement, source preservation, private ledger and authority';
