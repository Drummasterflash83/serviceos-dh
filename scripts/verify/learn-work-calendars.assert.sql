-- Synthetic fixtures only, in the disposable local schema clone.
create table calendar_fixture(definition jsonb);
insert into calendar_fixture select jsonb_build_object('name','Office hours','timezone','Europe/London','weekly',
 (select jsonb_agg(jsonb_build_object('day',n,'startMinute',540,'endMinute',1020)) from generate_series(1,5) n),
 'exceptions',jsonb_build_array(jsonb_build_object('date','2026-10-05','windows','[]'::jsonb)));
grant select on calendar_fixture to authenticated;
create table calendar_before as select
 (select md5(string_agg(to_jsonb(m)::text,'' order by id)) from measurements m) measurements,
 (select md5(string_agg(to_jsonb(m)::text,'' order by id)) from learn_work_collection_runs m) runs,
 (select md5(string_agg(to_jsonb(m)::text,'' order by capture_sequence)) from object_state_history m) history;

do $$declare d jsonb;w jsonb;n numeric;bad jsonb;role_name text;f record;begin
 select definition into d from calendar_fixture;
 assert learn_work_calendar_validate(d)=d;
 foreach bad in array array[
  d||'{"timezone":"BST"}',d||'{"timezone":"Europe/Invented"}',d||'{"weekly":[{"day":1,"startMinute":1200,"endMinute":300}]}',
  d||'{"weekly":[{"day":1,"startMinute":30.5,"endMinute":60}]}',d||'{"weekly":[{"day":1,"startMinute":30,"endMinute":60},{"day":1.0,"startMinute":59,"endMinute":90}]}',
  d||'{"exceptions":[{"date":"2026-02-30","windows":[]}]}',d||'{"exceptions":[{"date":"2026-10-05","windows":[]},{"date":"2026-10-05","windows":[]}]}',
  d||'{"exceptions":[{"date":"2026-10-05","windows":[{"startMinute":30,"endMinute":60},{"startMinute":59,"endMinute":90}]}]}',
  d||'{"unrecognised":true}'
 ] loop
  begin perform learn_work_calendar_validate(bad);raise exception 'Invalid calendar admitted';exception when invalid_parameter_value then null;end;
 end loop;
 begin perform learn_work_calendar_validate(d||jsonb_build_object('weekly',(select jsonb_agg(jsonb_build_object('day',1,'startMinute',0,'endMinute',1)) from generate_series(1,85))));raise exception 'Excessive weekly windows admitted';exception when program_limit_exceeded then null;end;
 begin perform learn_work_calendar_validate(d||jsonb_build_object('exceptions',(select jsonb_agg(jsonb_build_object('date','2026-10-05','windows','[]'::jsonb)) from generate_series(1,367))));raise exception 'Excessive override dates admitted';exception when program_limit_exceeded then null;end;
 begin perform learn_work_calendar_validate(d||jsonb_build_object('name',repeat('x',262145)));raise exception 'Oversize definition admitted';exception when invalid_parameter_value then null;end;
 begin perform learn_work_calendar_validate(d||jsonb_build_object('exceptions',jsonb_build_array(jsonb_build_object('date','2026-10-05','windows',(select jsonb_agg(jsonb_build_object('startMinute',x.n,'endMinute',x.n+1)) from generate_series(1,13)x(n))))));raise exception 'Excessive date windows admitted';exception when invalid_parameter_value then null;end;
 w:=learn_work_calendar_expand(d,'2026-10-05T00:00:00Z','2026-10-12T00:00:00Z');
 assert jsonb_array_length(w)=4;
 select sum(extract(epoch from (x->>'end')::timestamptz-(x->>'start')::timestamptz)/60) into n from jsonb_array_elements(w) x;
 assert n=1920,'A closed Monday must replace, not add to, the weekday schedule';
 assert (w->0->>'start')::timestamptz='2026-10-06T08:00:00Z';
 d:='{"name":"Sunday shift","timezone":"Europe/London","weekly":[{"day":7,"startMinute":0,"endMinute":240}],"exceptions":[]}';
 w:=learn_work_calendar_expand(d,'2026-03-29T00:00:00Z','2026-03-30T00:00:00Z');
 assert jsonb_array_length(w)=1 and extract(epoch from (w->0->>'end')::timestamptz-(w->0->>'start')::timestamptz)/60=180,'Spring gap contains no real minutes';
 w:=learn_work_calendar_expand(d,'2026-10-24T23:00:00Z','2026-10-26T00:00:00Z');
 assert jsonb_array_length(w)=1 and extract(epoch from (w->0->>'end')::timestamptz-(w->0->>'start')::timestamptz)/60=300,'Autumn fold includes both occurrences';
 d:='{"name":"Repeated local hour","timezone":"America/New_York","weekly":[{"day":7,"startMinute":60,"endMinute":120}],"exceptions":[]}';
 w:=learn_work_calendar_expand(d,'2026-11-01T00:00:00Z','2026-11-02T00:00:00Z');
 assert jsonb_array_length(w)=1 and extract(epoch from (w->0->>'end')::timestamptz-(w->0->>'start')::timestamptz)/60=120;
 d:=jsonb_set(d,'{weekly}','[{"day":7,"startMinute":120,"endMinute":180}]');
 assert learn_work_calendar_expand(d,'2026-03-08T00:00:00Z','2026-03-09T00:00:00Z')='[]';
 d:='{"name":"Half-hour DST","timezone":"Australia/Lord_Howe","weekly":[{"day":7,"startMinute":90,"endMinute":150}],"exceptions":[]}';
 w:=learn_work_calendar_expand(d,'2026-04-04T12:00:00Z','2026-04-05T12:00:00Z');
 assert extract(epoch from (w->0->>'end')::timestamptz-(w->0->>'start')::timestamptz)/60=90;
 d:='{"name":"Skipped local date","timezone":"Pacific/Apia","weekly":[{"day":5,"startMinute":0,"endMinute":1440}],"exceptions":[]}';
 assert learn_work_calendar_expand(d,'2011-12-29T10:00:00Z','2011-12-31T10:00:00Z')='[]';
 d:='{"name":"Precise clipping","timezone":"UTC","weekly":[{"day":1,"startMinute":540,"endMinute":600},{"day":1,"startMinute":600,"endMinute":660}],"exceptions":[]}';
 w:=learn_work_calendar_expand(d,'2026-10-05T09:00:15.25Z','2026-10-05T09:01:02.75Z');
 assert jsonb_array_length(w)=1 and extract(epoch from (w->0->>'end')::timestamptz-(w->0->>'start')::timestamptz)=47.5;
 w:=learn_work_calendar_expand(d,'2026-10-05T00:00:00Z','2026-10-06T00:00:00Z');
 assert jsonb_array_length(w)=1 and extract(epoch from (w->0->>'end')::timestamptz-(w->0->>'start')::timestamptz)/60=120,'Adjacent windows merge';
 d:=jsonb_set(d,'{weekly}','[{"day":1,"startMinute":540,"endMinute":600},{"day":1,"startMinute":660,"endMinute":720}]');
 w:=learn_work_calendar_expand(d,'2026-10-05T00:00:00Z','2026-10-06T00:00:00Z');
 assert jsonb_array_length(w)=2 and (w->0->>'end')::timestamptz='2026-10-05T10:00:00Z' and (w->1->>'start')::timestamptz='2026-10-05T11:00:00Z','Split shift break must remain outside calendar time';
 select jsonb_build_object('name','All hours','timezone','UTC','weekly',jsonb_agg(jsonb_build_object('day',x.dow,'startMinute',0,'endMinute',1440)),'exceptions','[]'::jsonb) into d from generate_series(1,7)x(dow);
 w:=learn_work_calendar_expand(d,'2026-01-01T00:00:00Z','2027-01-02T00:00:00Z');
 assert jsonb_array_length(w)=1 and extract(epoch from (w->0->>'end')::timestamptz-(w->0->>'start')::timestamptz)/60=527040,'Full supported year is not truncated';
 begin perform learn_work_calendar_expand(d,'2026-01-01','2027-01-03');raise exception 'Excessive period admitted';exception when invalid_parameter_value then null;end;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  for f in select p.oid,p.proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname like 'learn_work_calendar_%' loop
   assert has_function_privilege(role_name,f.oid,'EXECUTE')=(role_name='authenticated' and f.proname in ('learn_work_calendar_save','learn_work_calendar_publish','learn_work_calendar_read','learn_work_calendar_preview'));
  end loop;
  assert not has_table_privilege(role_name,'learn_work_calendar_versions','INSERT,UPDATE,DELETE,TRUNCATE');
  assert not has_table_privilege(role_name,'learn_work_calendar_publications','INSERT,UPDATE,DELETE,TRUNCATE');
 end loop;
end $$;

set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000004';set role authenticated;
do $$declare t uuid:='aaa40000-0000-0000-0000-000000000004';d jsonb;a jsonb;p jsonb;begin
 select definition into d from calendar_fixture;
 a:=learn_work_calendar_read(t);assert a->'draft'='null' and a->'publication'='null';
 a:=learn_work_calendar_save(t,0,d,'ca140000-0000-4000-8000-000000000001','Initial company hours');
 assert a->'version'->>'revision'='1';
 assert a=learn_work_calendar_save(t,0,d,'ca140000-0000-4000-8000-000000000001','Initial company hours');
 begin perform learn_work_calendar_save(t,0,d,'ca140000-0000-4000-8000-000000000002','Stale revision');raise exception 'Stale save admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_calendar_save(t,0,d,'ca140000-0000-4000-8000-000000000001','Changed reason');raise exception 'Changed identity admitted';exception when sqlstate 'PT409' then null;end;
 assert learn_work_calendar_read(t)->'publication'='null','Saving a draft must not activate it';
 p:=learn_work_calendar_preview(t,'ca140000-0000-4000-8000-000000000001','2026-10-05T00:00:00Z','2026-10-12T00:00:00Z');
 assert (p->>'minutes')::numeric=1920 and (p->>'simulation')::boolean;
 p:=learn_work_calendar_publish(t,'ca140000-0000-4000-8000-000000000001',null,'ca140000-0000-4000-8000-000000000011','Approve future calendar');
 assert (p->>'effectiveFrom')::timestamptz>=statement_timestamp();
 assert p=learn_work_calendar_publish(t,'ca140000-0000-4000-8000-000000000001',null,'ca140000-0000-4000-8000-000000000011','Approve future calendar');
 begin perform learn_work_calendar_publish(t,'ca140000-0000-4000-8000-000000000001','ca140000-0000-4000-8000-000000000011','ca140000-0000-4000-8000-000000000012','Duplicate publication');raise exception 'Duplicate version admitted';exception when sqlstate 'PT409' then null;end;
 a:=learn_work_calendar_save(t,1,d||'{"name":"Revised company hours","weekly":[]}', 'ca140000-0000-4000-8000-000000000002','Close future schedule');
 assert a->'version'->>'revision'='2';
 assert learn_work_calendar_read(t)->'publication'->'version'->>'revision'='1','Draft revision cannot change published calendar';
 begin perform learn_work_calendar_publish(t,'ca140000-0000-4000-8000-000000000002',null,'ca140000-0000-4000-8000-000000000012','Stale publication');raise exception 'Stale publication admitted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_work_calendar_read('aaa40000-0000-0000-0000-000000000006');raise exception 'Foreign calendar admitted';exception when insufficient_privilege then null;end;
 begin perform learn_work_calendar_snapshot(t,now()-interval '1 day',now(),now());raise exception 'Private snapshot exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Store a historical snapshot, then publish a later revision. Neither earlier
-- publication nor the same observation-time snapshot may change.
create table calendar_frozen as select clock_timestamp() observed_at;
alter table calendar_frozen add column snapshot jsonb;
update calendar_frozen set snapshot=learn_work_calendar_snapshot('aaa40000-0000-0000-0000-000000000004',observed_at-interval '1 day',observed_at,observed_at);
do $$declare s jsonb;begin select snapshot into s from calendar_frozen;
 assert not (s->>'complete')::boolean and jsonb_array_length(s->'missing')=1;
 assert jsonb_array_length(s->'versions')=1 and s->'versions'->0->>'revision'='1';end $$;
set role authenticated;
select learn_work_calendar_publish('aaa40000-0000-0000-0000-000000000004','ca140000-0000-4000-8000-000000000002','ca140000-0000-4000-8000-000000000011','ca140000-0000-4000-8000-000000000012','Approve revised hours prospectively');
reset role;
do $$declare r record;begin select * into r from calendar_frozen;
 assert r.snapshot=learn_work_calendar_snapshot('aaa40000-0000-0000-0000-000000000004',r.observed_at-interval '1 day',r.observed_at,r.observed_at),'Later publication changed frozen history';
 begin update learn_work_calendar_versions set reason='rewrite' where id='ca140000-0000-4000-8000-000000000001';raise exception 'Immutable version updated';exception when sqlstate '55000' then null;end;
 begin delete from learn_work_calendar_publications where id='ca140000-0000-4000-8000-000000000011';raise exception 'Immutable publication deleted';exception when sqlstate '55000' then null;end;
end $$;
update profiles set role='viewer' where id='bbb40000-0000-0000-0000-000000000004';
set role authenticated;
do $$begin
 assert (select count(*)=0 from learn_work_calendar_versions);
 begin perform learn_work_calendar_read('aaa40000-0000-0000-0000-000000000004');raise exception 'Revoked reader admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;update profiles set role='owner' where id='bbb40000-0000-0000-0000-000000000004';
insert into view_as_context(tenant_id,actor_user_id,subject_kind,subject_ref,reason) values('aaa40000-0000-0000-0000-000000000004','bbb40000-0000-0000-0000-000000000004','role','owner','Synthetic calendar View-As');
set role authenticated;
do $$begin
 begin perform learn_work_calendar_read('aaa40000-0000-0000-0000-000000000004');raise exception 'View-As calendar access admitted';exception when insufficient_privilege then null;end;
end $$;
reset role;update view_as_context set ended_at=clock_timestamp() where actor_user_id='bbb40000-0000-0000-0000-000000000004' and ended_at is null;
set request.jwt.claim.sub='';
do $$declare r text;denied boolean;begin
 foreach r in array array['anon','authenticated','service_role'] loop
  execute 'set local role '||quote_ident(r);
  denied:=false;begin perform learn_work_calendar_read('aaa40000-0000-0000-0000-000000000004');exception when insufficient_privilege then denied:=true;end;assert denied;
  denied:=false;begin perform learn_work_calendar_save('aaa40000-0000-0000-0000-000000000004',2,'{}',gen_random_uuid(),'Denied probe');exception when insufficient_privilege then denied:=true;end;assert denied;
  denied:=false;begin perform learn_work_calendar_publish('aaa40000-0000-0000-0000-000000000004',gen_random_uuid(),null,gen_random_uuid(),'Denied probe');exception when insufficient_privilege then denied:=true;end;assert denied;
  denied:=false;begin perform learn_work_calendar_preview('aaa40000-0000-0000-0000-000000000004',gen_random_uuid(),now()-interval '1 day',now());exception when insufficient_privilege then denied:=true;end;assert denied;
  execute 'reset role';
 end loop;
end $$;
set request.jwt.claim.sub='bbb40000-0000-0000-0000-000000000006';set role authenticated;
do $$begin assert (select count(*)=0 from learn_work_calendar_versions);assert learn_work_calendar_read('aaa40000-0000-0000-0000-000000000006')->'draft'='null';end $$;
reset role;
do $$begin
 assert (select measurements=(select md5(string_agg(to_jsonb(m)::text,'' order by id)) from measurements m) from calendar_before);
 assert (select runs=(select md5(string_agg(to_jsonb(m)::text,'' order by id)) from learn_work_collection_runs m) from calendar_before);
 assert (select history=(select md5(string_agg(to_jsonb(m)::text,'' order by capture_sequence)) from object_state_history m) from calendar_before);
end $$;
