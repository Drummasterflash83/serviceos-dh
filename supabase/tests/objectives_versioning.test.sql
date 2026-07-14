-- Objective strategic versioning & approval — assertions.
-- Run in a real environment: `supabase db execute < supabase/tests/objectives_versioning.test.sql`
-- Wrapped in a transaction and rolled back (non-destructive).
-- Requires migrations through 20260720120100 and the seeded Drummond tenant.

begin;

insert into config_versions (id, tenant_id, artifact_kind, artifact_key, version, status, author) values
  ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','objective','test.obj',1,'draft','tester'),
  ('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','objective','test.obj',2,'draft','tester');

-- (1) A draft objective may be edited.
insert into objectives (id, tenant_id, objective_type, title, status, source, version_id, created_by)
values ('41000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','north_star','Draft objective','draft','tenant_configuration','40000000-0000-0000-0000-000000000001','tester');
update objectives set title = 'Draft objective v1.1' where id = '41000000-0000-0000-0000-000000000001';
do $$ begin
  if (select title from objectives where id='41000000-0000-0000-0000-000000000001') <> 'Draft objective v1.1'
    then raise exception 'FAIL: draft edit did not apply'; end if;
end $$;

-- (6) An unauthorised actor cannot publish it.
do $$ begin
  update objectives set status='active' where id='41000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: unauthorised publish was allowed';
exception when insufficient_privilege then null; -- expected
end $$;

-- Publish with an authorised role.
update objectives set status='active', published_by='alice', published_role='tenant_owner'
  where id='41000000-0000-0000-0000-000000000001';

-- (2) A published objective cannot be changed in place.
do $$ begin
  update objectives set title='hacked' where id='41000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: published objective was edited in place';
exception when restrict_violation then null; -- expected
end $$;

-- Its target is immutable too.
insert into metric_definitions (id, tenant_id, key, name, unit, direction)
values ('42000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','test_metric','Test','count','decrease');
insert into objective_metrics (tenant_id, objective_id, metric_id, role, direction, baseline_value, baseline_unit, target_value, target_unit)
values ('00000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001','primary','decrease',10,'count',5,'count');
do $$ begin
  update objective_metrics set target_value=1 where objective_id='41000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: published objective target was edited in place';
exception when restrict_violation then null; -- expected
end $$;

-- (3) A new version can supersede it, and the original can be archived.
insert into objectives (id, tenant_id, objective_type, title, status, source, version_id, supersedes, published_by, published_role)
values ('41000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','north_star','Objective v2','active','tenant_configuration','40000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000001','alice','tenant_owner');
update objectives set status='archived' where id='41000000-0000-0000-0000-000000000001'; -- lifecycle transition permitted

-- (4) The original's strategic definition remains unchanged.
do $$ begin
  if (select title from objectives where id='41000000-0000-0000-0000-000000000001') <> 'Draft objective v1.1'
     or (select objective_type from objectives where id='41000000-0000-0000-0000-000000000001') <> 'north_star'
    then raise exception 'FAIL: original strategic definition mutated'; end if;
end $$;

-- (5) An AI proposal remains draft — AI cannot publish.
do $$ begin
  insert into objectives (id, tenant_id, objective_type, title, status, source, version_id)
  values ('41000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','north_star','AI obj','active','approved_ai_proposal','40000000-0000-0000-0000-000000000001');
  raise exception 'FAIL: AI-created objective was published';
exception when insufficient_privilege then null; -- expected
end $$;
insert into objectives (id, tenant_id, objective_type, title, status, source, version_id)
values ('41000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','north_star','AI draft obj','draft','approved_ai_proposal','40000000-0000-0000-0000-000000000001');
do $$ begin
  if (select status from objectives where id='41000000-0000-0000-0000-000000000003') <> 'draft'
    then raise exception 'FAIL: AI objective is not draft'; end if;
end $$;

-- Measurements are append-only (inserts allowed, edits rejected).
insert into measurements (id, tenant_id, metric_id, value, unit, measured_at)
values ('43000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','42000000-0000-0000-0000-000000000001',5,'count',now());
do $$ begin
  update measurements set value=99 where id='43000000-0000-0000-0000-000000000001';
  raise exception 'FAIL: measurement was editable';
exception when restrict_violation then null; -- expected
end $$;

do $$ begin
  raise notice 'PASS: drafts editable; published objectives + targets immutable; supersession works; AI cannot publish; unauthorised publish blocked; measurements append-only';
end $$;

rollback;
