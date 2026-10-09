set role authenticated;
select set_config('test.actor','00000000-0000-4000-8000-000000000001',false);
do $$
declare
  t uuid := '00000000-0000-4000-8000-000000000010';
  p jsonb := '{"name":"Office performance","subjectKind":"member","scaleMax":50,"metrics":[{"key":"response.rate","label":"Response rate","unit":"percent","weight":1,"zeroAt":0,"fullAt":100,"minSamples":5,"minCoverage":1,"maxAgeHours":24,"sourceSystems":["communications"]}]}';
  saved jsonb;
  changed jsonb;
begin
  saved := learn_scorecard_save_draft(t,0,p,'Initial fixture draft');
  if saved->>'status'<>'draft' or (saved->>'version')::int<>1 or saved->>'tenantId'<>t::text then raise exception 'Incorrect initial draft'; end if;
  changed := learn_scorecard_save_draft(t,1,p||'{"status":"published","scaleMax":100,"tenantId":"00000000-0000-4000-8000-000000000099"}','Changed fixture scale');
  if changed->>'id'<>saved->>'id' or changed->>'status'<>'draft' or changed->>'tenantId'<>t::text or (changed->>'version')::int<>2 then raise exception 'Revision lost identity or trusted client authority'; end if;
  begin perform learn_scorecard_save_draft(t,1,p,'Stale save');raise exception 'Stale save accepted';exception when serialization_failure then null;end;
  begin perform learn_scorecard_save_draft('00000000-0000-4000-8000-000000000099',0,p,'Foreign tenant');raise exception 'Foreign tenant accepted';exception when insufficient_privilege then null;end;
  begin perform learn_scorecard_save_draft(t,2,jsonb_set(p,'{metrics,0,fullAt}','0'),'Invalid target');raise exception 'Equal anchors accepted';exception when invalid_parameter_value then null;end;
  begin perform learn_scorecard_save_draft(t,2,jsonb_set(p,'{metrics,0,weight}','0'),'Invalid weight');raise exception 'No weight accepted';exception when invalid_parameter_value then null;end;
  begin perform learn_scorecard_save_draft(t,2,p||'{"groupId":"00000000-0000-4000-8000-000000000020"}','Foreign group');raise exception 'Foreign group accepted';exception when invalid_parameter_value then null;end;
  perform set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
  begin perform learn_scorecard_save_draft(t,2,p,'Viewer save');raise exception 'Viewer accepted';exception when insufficient_privilege then null;end;
  perform set_config('test.actor','',false);
  begin perform learn_scorecard_save_draft(t,2,p,'No session');raise exception 'Unauthenticated accepted';exception when insufficient_privilege then null;end;
end;
$$;
reset role;
do $$
begin
  if (select count(*) from config_versions)<>2 or (select count(*) from operating_profile_entries)<>2 then raise exception 'History lost or rejected save wrote rows';end if;
  if exists(select 1 from config_versions where status<>'draft') then raise exception 'A policy was activated';end if;
  if has_function_privilege('anon','learn_scorecard_save_draft(uuid,integer,jsonb,text)','execute') then raise exception 'Anonymous execute granted';end if;
  if has_table_privilege('authenticated','operating_profile_entries','insert') then raise exception 'Direct configuration write granted';end if;
end;
$$;
select 'PASS: version history, concurrency, tenant/group boundaries, draft-only, role checks and rollback on invalid writes' as result;
