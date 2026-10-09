-- Disposable-only fixtures; no source table reads beyond the retained email check.
reset role;
insert into tenants(id,slug,display_name) values(verify.id(501),'synthetic-measurements-a','Synthetic measurement A'),(verify.id(502),'synthetic-measurements-b','Synthetic measurement B');
insert into auth.users(id) select verify.id(n) from generate_series(511,514) n;
insert into profiles(id,tenant_id,role) values(verify.id(511),verify.id(501),'owner'),(verify.id(512),verify.id(501),'viewer'),(verify.id(513),verify.id(502),'owner'),(verify.id(514),verify.id(502),'openfolk');
insert into org_units(id,tenant_id,kind,name) values(verify.id(521),verify.id(501),'team','Team A'),(verify.id(522),verify.id(501),'team','Team A2'),(verify.id(523),verify.id(502),'team','Team B');
insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from)
 values(verify.id(531),verify.id(501),verify.id(521),verify.id(511),'Synthetic member',now()-interval '1 day',now()-interval '1 day');
create table verify.measurement_payload(p jsonb);
grant select on verify.measurement_payload to service_role,authenticated;
set request.jwt.claim.sub='f0000000-0000-0000-0000-000000000511';
set role authenticated;
create temporary table measurement_draft as select learn_scorecard_save_draft(verify.id(501),0,
 jsonb_build_object('name','Synthetic response measure','subjectKind','member','groupId',verify.id(521),'scaleMax',50,
 'metrics','[{"key":"response.minutes","label":"Response minutes","unit":"minutes","weight":1,"zeroAt":60,"fullAt":0,"minSamples":1,"minCoverage":1,"maxAgeHours":24,"sourceSystems":["synthetic.communications"]}]'::jsonb),'Synthetic retained source criteria') policy;
reset role;
insert into verify.measurement_payload select jsonb_build_object('id',verify.id(541),'tenantId',verify.id(501),
 'policyId',policy->'id','policyVersion',1,'subject',jsonb_build_object('kind','member','id',verify.id(531)),
 'period',jsonb_build_object('start',(select min(observed_at) from learn_member_history where member_id=verify.id(531)),'end',clock_timestamp()),
 'metricKey','response.minutes','unit','minutes','sourceSystem','synthetic.communications','value',30,
 'sampleCount',10,'coveredCount',10,'eligibleCount',10,'observedAt',clock_timestamp(),'sourceThrough',clock_timestamp(),
 'review','inferred','exclusions','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('table','team_members','id',verify.id(531)))) from measurement_draft;
-- Ensure sourceThrough never exceeds the explicit observation timestamp.
update verify.measurement_payload set p=jsonb_set(p,'{sourceThrough}',p->'observedAt');
set role service_role;
do $$ declare p jsonb;r jsonb; begin
 select v.p into p from verify.measurement_payload v;
 r:=learn_performance_append(verify.id(501),p,'Synthetic adapter observation');assert not (r->>'reused')::boolean;
 assert (learn_performance_append(verify.id(501),p,'Synthetic adapter observation')->>'reused')::boolean;
 begin perform learn_performance_append(verify.id(501),p||'{"value":29}','Synthetic adapter observation');raise exception 'Changed request accepted';exception when sqlstate 'PT409' then null;end;
 begin perform learn_performance_append(verify.id(501),p||jsonb_build_object('id',verify.id(549),'evidence',jsonb_build_array(jsonb_build_object('table','org_units','id',verify.id(523)))),'Foreign source');raise exception 'Unsupported source accepted';exception when invalid_parameter_value then null;end;
 begin perform learn_performance_append(verify.id(501),p||jsonb_build_object('id',verify.id(549),'period',jsonb_build_object('start',now()-interval '2 days','end',p#>'{period,end}')),'Unobserved history');raise exception 'Effective dates fabricated membership coverage';exception when invalid_parameter_value then null;end;
end $$;
reset role;
set role authenticated;
do $$ declare r jsonb;begin
 assert (select count(*)=1 from measurements);
 assert not has_function_privilege('authenticated','learn_performance_append(uuid,jsonb,text)','EXECUTE');
 r:=learn_performance_review(verify.id(501),verify.id(541),verify.id(551),0,'confirmed','Reviewed synthetic evidence');assert r->>'revision'='1';
 assert (learn_performance_review(verify.id(501),verify.id(541),verify.id(551),0,'confirmed','Reviewed synthetic evidence')->>'reused')::boolean;
 begin perform learn_performance_review(verify.id(501),verify.id(541),verify.id(551),0,'disputed','Changed review');raise exception 'Review retry changed';exception when sqlstate 'PT409' then null;end;
 begin perform learn_performance_review(verify.id(501),verify.id(541),verify.id(552),0,'disputed','Stale editor');raise exception 'Review revision skipped';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
-- A later transfer must not erase evidence of the earlier team's period.
update team_members set org_unit_id=verify.id(522) where id=verify.id(531);
set role service_role;
do $$ declare p jsonb;begin
 select v.p||jsonb_build_object('id',verify.id(542),'supersedes',verify.id(541),'value',25,'observedAt',clock_timestamp()) into p from verify.measurement_payload v;
 perform learn_performance_append(verify.id(501),p,'Corrected earlier team observation');
 begin perform learn_performance_append(verify.id(501),p||jsonb_build_object('id',verify.id(543),'observedAt',clock_timestamp()),'Competing correction');raise exception 'Correction fork accepted';exception when sqlstate 'PT409' then null;end;
end $$;
reset role;
set role authenticated;
do $$ begin
 assert (select count(*)=2 from measurements);
 assert (select bool_and(review_state='inferred') from measurements),'Human review rewrote raw observations';
 begin perform learn_performance_review(verify.id(501),verify.id(541),verify.id(553),1,'confirmed','Old source');raise exception 'Corrected observation reviewed';exception when sqlstate 'PT409' then null;end;
 perform learn_performance_review(verify.id(501),verify.id(542),verify.id(554),0,'disputed','Review corrected source');
end $$;
reset role;
do $$ declare p jsonb;begin
 select v.p into p from verify.measurement_payload v;
 assert not learn_member_group_covers(verify.id(501),verify.id(531),verify.id(521),(p#>>'{period,start}')::timestamptz,clock_timestamp()),'Mixed team period accepted';
 assert learn_member_group_covers(verify.id(501),verify.id(531),verify.id(521),(p#>>'{period,start}')::timestamptz,(p#>>'{period,end}')::timestamptz),'Earlier observed team lost after transfer';
 begin update measurements set value=99 where id=verify.id(541);raise exception 'Measurement rewrite accepted';exception when restrict_violation then null;end;
 begin delete from measurements where id=verify.id(541);raise exception 'Measurement deletion accepted';exception when restrict_violation then null;end;
 begin truncate measurements cascade;raise exception 'Measurement truncation accepted';exception when restrict_violation then null;end;
 begin truncate learn_performance_reviews;raise exception 'Review truncation accepted';exception when restrict_violation then null;end;
 begin truncate objective_health;raise exception 'Health truncation accepted';exception when restrict_violation then null;end;
 assert (select to_jsonb(e)=b.payload from email_messages e cross join verify.email_before b),'Original communications changed';
end $$;
set role service_role;
do $$ declare v uuid;begin
 select policy_version_id into v from measurements where id=verify.id(541);
 begin insert into metric_definitions(tenant_id,key,name,version_id) values(verify.id(502),'foreign','Foreign version',v);raise exception 'Foreign config reference accepted';exception when check_violation then null;end;
end $$;
reset role;
-- Viewer, foreign owner and foreign OpenFolk profiles cannot read staff facts/reviews.
set role authenticated;
do $$ declare n int;begin
 foreach n in array array[512,513,514] loop
  perform set_config('request.jwt.claim.sub',verify.id(n)::text,true);
  assert (select count(*)=0 from measurements);
  assert (select count(*)=0 from learn_performance_reviews);
  begin perform learn_performance_review(verify.id(501),verify.id(542),verify.id(555),1,'confirmed','Unauthorized');raise exception 'Unauthorized review accepted';exception when insufficient_privilege then null;end;
 end loop;
end $$;
reset role;

-- Trusted services must use the validated adapter for individual facts.
set role service_role;
do $$ declare r measurements%rowtype;begin
 select * into r from measurements where id=verify.id(541);
 r.id:=verify.id(590);r.review_state:='confirmed';
 begin insert into measurements select r.*;raise exception 'Service bypassed adapter';exception when insufficient_privilege then null;end;
 insert into metric_definitions(id,tenant_id,key,name,unit) values(verify.id(591),verify.id(501),'synthetic.company.total','Synthetic company measure','count');
 insert into measurements(id,tenant_id,metric_id,value,unit) values(verify.id(592),verify.id(501),verify.id(591),2,'count');
end $$;
reset role;
-- Existing membership has no historical evidence; dates alone cannot repair it.
do $$ begin
 assert not learn_member_group_covers(verify.id(1),verify.id(141),verify.id(131),now()-interval '1 day',now());
end $$;
