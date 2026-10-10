begin;
insert into tenants(id,slug,display_name) values
 ('88000000-0000-0000-0000-000000000001','import-authority-a','Synthetic import authority A'),
 ('88000000-0000-0000-0000-000000000002','import-authority-b','Synthetic import authority B');
insert into auth.users(id,email,is_sso_user,is_anonymous) values('88000000-0000-0000-0000-000000000011','import-authority@example.invalid',false,false);
insert into profiles(id,tenant_id,role,email) values('88000000-0000-0000-0000-000000000011','88000000-0000-0000-0000-000000000001','owner','import-authority@example.invalid');
insert into data_imports(id,tenant_id,source_system,entity_type,file_checksum,status,row_count,preview) values
 ('88000000-0000-0000-0000-000000000021','88000000-0000-0000-0000-000000000001','commusoft','customers','synthetic','previewed',10,
 '{"sealed":{"profile":{"id":"synthetic"},"import_options":{"source":"commusoft"},"provenance_source":"commusoft"}}');
do $$ declare t uuid:='88000000-0000-0000-0000-000000000001';a uuid:='88000000-0000-0000-0000-000000000011';im uuid:='88000000-0000-0000-0000-000000000021';ctx uuid;denied boolean;r jsonb;begin
 r:=import_customer_row(t,im,a,2,'{"external_id":"authority-ok","record_kind":"person","display_name":"Synthetic authority"}','{"source":"commusoft"}');
 assert r->>'action'='created';
 -- Even a context targeting another company is a read-only context for its actor.
 insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,mode,read_only,expires_at)
 values('88000000-0000-0000-0000-000000000002',a,'role','owner','supervised_test',false,clock_timestamp()+interval '1 hour') returning id into ctx;
 denied:=false;
 begin
  perform import_customer_row(t,im,a,3,'{"external_id":"authority-view-as","record_kind":"person","display_name":"Must not import"}','{"source":"commusoft"}');
 exception when insufficient_privilege then denied:=true;end;
 assert denied,'active actor preview cannot import, regardless of mode/read_only flags';
 assert not exists(select 1 from import_row_results where import_id=im and row_number=3),'refusal cannot create row outcome';
 update view_as_context set ended_at=clock_timestamp() where id=ctx;
 r:=import_customer_row(t,im,a,3,'{"external_id":"authority-after-preview","record_kind":"person","display_name":"Synthetic after preview"}','{"source":"commusoft"}');
 assert r->>'action'='created','ended preview allows current authority';
 update view_as_context set ended_at=null,expires_at=clock_timestamp()-interval '1 second' where id=ctx;
 perform import_row_preamble(t,im,a,4,'{}','{"source":"commusoft"}','customers');
 update tenants set status='suspended' where id=t;
 denied:=false;begin perform import_row_preamble(t,im,a,4,'{}','{"source":"commusoft"}','customers');exception when insufficient_privilege then denied:=true;end;
 assert denied,'suspended company cannot continue an import';
 update tenants set status='active' where id=t;
 update profiles set role='viewer' where id=a;
 denied:=false;begin perform import_row_preamble(t,im,a,4,'{}','{"source":"commusoft"}','customers');exception when insufficient_privilege then denied:=true;end;
 assert denied,'demoted actor cannot continue an import';
 update profiles set role='owner' where id=a;
 assert not has_function_privilege('authenticated','import_row_preamble(uuid,uuid,uuid,integer,jsonb,jsonb,text)','EXECUTE');
end $$;
commit;
begin isolation level repeatable read;
do $$ declare denied boolean:=false;begin
 begin perform import_row_preamble('88000000-0000-0000-0000-000000000001','88000000-0000-0000-0000-000000000021','88000000-0000-0000-0000-000000000011',4,'{}','{"source":"commusoft"}','customers');exception when invalid_parameter_value then denied:=true;end;
 assert denied,'stale-snapshot imports must be refused';
end $$;
rollback;
