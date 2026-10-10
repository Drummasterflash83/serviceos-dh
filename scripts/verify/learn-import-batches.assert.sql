begin;
insert into tenants(id,slug,display_name) values
 ('66000000-0000-0000-0000-000000000001','import-batch-a','SYNTHETIC batch A'),
 ('66000000-0000-0000-0000-000000000002','import-batch-b','SYNTHETIC batch B');
insert into auth.users(id,email,is_sso_user,is_anonymous) values('66000000-0000-0000-0000-000000000011','batch@example.invalid',false,false);
insert into profiles(id,tenant_id,role,email) values('66000000-0000-0000-0000-000000000011','66000000-0000-0000-0000-000000000001','owner','batch@example.invalid');
insert into data_imports(id,tenant_id,source_system,entity_type,file_checksum,status,row_count,preview) values
 ('66000000-0000-0000-0000-000000000021','66000000-0000-0000-0000-000000000001','commusoft','customers','synthetic','previewed',1200,'{"sealed":{"profile":{"id":"synthetic"},"import_options":{"source":"commusoft"},"provenance_source":"commusoft"}}');
insert into data_imports(id,tenant_id,source_system,entity_type,file_checksum,status,row_count,preview) values
 ('66000000-0000-0000-0000-000000000022','66000000-0000-0000-0000-000000000001','commusoft','sites','synthetic','previewed',10,'{"sealed":{"profile":{"id":"synthetic"},"import_options":{"source":"commusoft"},"provenance_source":"commusoft"}}'),
 ('66000000-0000-0000-0000-000000000023','66000000-0000-0000-0000-000000000001','commusoft','jobs','synthetic','previewed',10,'{"sealed":{"profile":{"id":"synthetic"},"import_options":{"source":"commusoft"},"provenance_source":"commusoft"}}');
create function public.synthetic_batch_failure() returns trigger language plpgsql as $$begin if new.display_name='SYNTHETIC forced failure' then raise exception 'DO NOT EXPOSE raw synthetic customer values' using errcode='23514';end if;return new;end$$;
create trigger synthetic_batch_failure before insert on people for each row execute function synthetic_batch_failure();
set local role service_role;
do $$ declare t uuid:='66000000-0000-0000-0000-000000000001';a uuid:='66000000-0000-0000-0000-000000000011';im uuid:='66000000-0000-0000-0000-000000000021';r jsonb;rows jsonb;denied boolean;begin
 select jsonb_agg(jsonb_build_object('row_number',n+1,'record',jsonb_build_object('external_id','BATCH-'||n,'record_kind','person','display_name','SYNTHETIC batch '||n)) order by n) into rows from generate_series(1,100) n;
 r:=learn_import_match_batch(t,a,'commusoft','customers',rows);
 assert jsonb_array_length(r)=100 and not exists(select 1 from jsonb_array_elements(r) x where x->'result'->>'action'<>'new');
 assert not exists(select 1 from people where tenant_id=t),'matching must not mutate identities';
 r:=learn_import_apply_batch(t,im,a,'customers','{"source":"commusoft"}',rows);
 assert jsonb_array_length(r)=100 and not exists(select 1 from jsonb_array_elements(r) x where x->'result'->>'action'<>'created');
 assert (select count(*) from people where tenant_id=t)=100 and (select count(*) from customer_cards where tenant_id=t)=100;
 assert (select count(*) from import_row_results where import_id=im and outcome='created' and attempt=1)=100;
 r:=learn_import_apply_batch(t,im,a,'customers','{"source":"commusoft"}',rows);
 assert not exists(select 1 from jsonb_array_elements(r) x where x->'result'->>'action'<>'already_applied');
 assert (select count(*) from people where tenant_id=t)=100 and (select count(*) from import_row_results where import_id=im and attempt=1)=100;
 r:=learn_import_apply_batch(t,im,a,'customers','{"source":"commusoft"}','[
 {"row_number":102,"record":{},"invalid_fields":["record_kind"]},
 {"row_number":103,"record":{"external_id":"FORCED","record_kind":"person","display_name":"SYNTHETIC forced failure"}},
 {"row_number":104,"record":{"external_id":"AFTER-FAILURE","record_kind":"person","display_name":"SYNTHETIC after failure"}}]');
 assert r->0->'result'->>'action'='invalid';
 assert r->1->'result'='{"error_code":"23514"}'::jsonb,'never expose driver error values';
 assert r->2->'result'->>'action'='created';
 assert not exists(select 1 from import_row_results where import_id=im and row_number=103),'uncaptured row failure must remain unprocessed';
 assert (select count(*) from people where tenant_id=t)=101;
 denied:=false;begin perform learn_import_apply_batch(t,im,a,'customers','{"source":"commusoft"}','[{"row_number":105,"record":{"external_id":"ROLLBACK","record_kind":"person","display_name":"Must roll back"}},{"row_number":1202,"record":{}}]');exception when invalid_parameter_value then denied:=true;end;
 assert denied and (select count(*) from people where tenant_id=t)=101,'late contract failure rolls back the whole batch';
 denied:=false;begin perform learn_import_match_batch(t,a,'commusoft','customers',rows||jsonb_build_array(rows->0));exception when invalid_parameter_value then denied:=true;end;assert denied,'101 rows refused';
 denied:=false;begin perform learn_import_match_batch(t,a,'commusoft','customers',jsonb_build_array(rows->0,rows->0));exception when invalid_parameter_value then denied:=true;end;assert denied,'duplicate row identities refused';
 denied:=false;begin perform learn_import_apply_batch(t,im,a,'customers','{"source":"wrong"}',rows);exception when invalid_parameter_value then denied:=true;end;assert denied,'changed sealed options refused';
 denied:=false;begin perform learn_import_match_batch('66000000-0000-0000-0000-000000000002',a,'commusoft','customers',rows);exception when insufficient_privilege then denied:=true;end;assert denied,'foreign company refused';
 rows:='[{"row_number":2,"record":{"external_id":"BATCH-S1","customer_external_id":"BATCH-1","label":"SYNTHETIC site","address_text":"1 Synthetic Road","postcode":"SW1A 1AA"}}]';
 r:=learn_import_match_batch(t,a,'commusoft','sites',rows);assert r->0->'result'->>'action'='new';
 r:=learn_import_apply_batch(t,'66000000-0000-0000-0000-000000000022',a,'sites','{"source":"commusoft"}',rows);assert r->0->'result'->>'action'='created';
 rows:='[{"row_number":2,"record":{"external_id":"BATCH-J1","job_number":"900001","customer_external_id":"BATCH-1","site_external_id":"BATCH-S1","title":"SYNTHETIC job","status":"open"}}]';
 r:=learn_import_match_batch(t,a,'commusoft','jobs',rows);assert r->0->'result'->>'action'='new';
 r:=learn_import_apply_batch(t,'66000000-0000-0000-0000-000000000023',a,'jobs','{"source":"commusoft"}',rows);assert r->0->'result'->>'action'='created';
 rows:='[{"row_number":3,"record":{"external_id":"BATCH-J2","job_number":"900002","customer_external_id":"BATCH-2","site_external_id":"BATCH-S1","title":"SYNTHETIC contradictory job","status":"open"}}]';
 r:=learn_import_apply_batch(t,'66000000-0000-0000-0000-000000000023',a,'jobs','{"source":"commusoft"}',rows);assert r->0->'result'->>'action'='conflict';
 assert (select count(*) from jobs where tenant_id=t)=1,'contradictory site must not create another job';
 assert not has_function_privilege('authenticated','learn_import_apply_batch(uuid,uuid,uuid,text,jsonb,jsonb)','EXECUTE');
 assert not has_function_privilege('anon','learn_import_match_batch(uuid,uuid,text,text,jsonb)','EXECUTE');
end $$;
reset role;
do $$ declare t uuid:='66000000-0000-0000-0000-000000000001';a uuid:='66000000-0000-0000-0000-000000000011';denied boolean;ctx uuid;begin
 update profiles set role='viewer' where id=a;
 denied:=false;begin perform learn_import_batch_authority(t,a);exception when insufficient_privilege then denied:=true;end;assert denied;
 update profiles set role='owner' where id=a;
 update tenants set status='suspended' where id=t;
 denied:=false;begin perform learn_import_batch_authority(t,a);exception when insufficient_privilege then denied:=true;end;assert denied;
 update tenants set status='active' where id=t;
 insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,mode,read_only,expires_at) values('66000000-0000-0000-0000-000000000002',a,'role','owner','supervised_test',false,clock_timestamp()+interval '1 hour') returning id into ctx;
 denied:=false;begin perform learn_import_batch_authority(t,a);exception when insufficient_privilege then denied:=true;end;assert denied,'even other-company View As refused';
 update view_as_context set ended_at=clock_timestamp() where id=ctx;
 perform learn_import_batch_authority(t,a);
end$$;
rollback;
begin isolation level repeatable read;
do $$ declare denied boolean:=false;begin begin perform learn_import_batch_authority('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000011');exception when invalid_parameter_value then denied:=true;end;assert denied;end$$;
rollback;
