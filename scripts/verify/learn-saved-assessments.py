"""Isolated saved-assessment SQL checks. Synthetic dependencies; no hosted access."""
import concurrent.futures,json,shutil,subprocess,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];DOCKER=shutil.which('docker') or '/usr/local/bin/docker';NAME='serviceos-saved-assessments-'+uuid.uuid4().hex[:8]
def run(sql,check=True):
 r=subprocess.run([DOCKER,'exec','-i',NAME,'psql','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True)
 if check and r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r
try:
 subprocess.run([DOCKER,'run','-d','--pull=never','--network','none','--name',NAME,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],capture_output=True,check=True)
 for _ in range(80):
  r=subprocess.run([DOCKER,'exec',NAME,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True)
  if r.returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError('Disposable database did not start')
 paths=['scripts/verify/learn-performance.fixture.sql','supabase/migrations/20260720120000_objectives.sql','supabase/migrations/20260720120100_objectives_hardening.sql','supabase/migrations/20261029150000_learn_performance_measurements.sql','scripts/verify/learn-performance.assert.sql','scripts/verify/learn-performance-review.fixture.sql','supabase/migrations/20261029160000_learn_performance_reviews.sql','scripts/verify/learn-performance-review.assert.sql']
 run('\n'.join((ROOT/p).read_text() for p in paths))
 expected=json.loads((ROOT/'supabase/release/learn-test/006_measurements_reviews.expected.json').read_text())
 for name in ['learn_performance_append','learn_performance_review','learn_performance_insert_guard']:
  fn=next(f['definition'] for f in expected['functions'] if f['name']==name)
  if name=='learn_performance_append':fn=fn.replace("'jobs','team_members')","'jobs','team_members','learn_work_measurement_runs')")
  run(fn+';')
 run('create trigger learn_performance_insert_guard before insert on measurements for each row execute function learn_performance_insert_guard();')
 run((ROOT/'supabase/migrations/20261031020000_learn_performance_corrections.sql').read_text())

 run("alter table profiles add column tenant_id uuid,add column role text;update profiles set tenant_id='00000000-0000-4000-8000-000000000001',role='owner';insert into profiles values('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000002','owner'),('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000001','viewer');delete from view_as_context;create or replace function current_tenant_id() returns uuid language sql stable security definer as $$select tenant_id from profiles where id=auth.uid()$$;create or replace function current_user_role() returns text language sql stable security definer as $$select role from profiles where id=auth.uid()$$;")
 publication=(ROOT/'supabase/migrations/20261030000000_learn_scorecard_publication.sql').read_text()
 run(publication[:publication.index('alter table public.learn_scorecard_publications')])
 rules=json.loads((ROOT/'supabase/release/learn-test/004_rules_membership.expected.json').read_text())
 if isinstance(rules,dict):rules=rules['functions']
 for name in ['learn_scorecard_policy_for_period']:
  run(next(f['definition'] for f in rules if f['name']==name)+';')
 # The actual historical-membership helper is present for nonempty group tests too.
 group=(ROOT/'supabase/migrations/20261030050000_learn_measurement_group_history.sql').read_text()
 run('create table learn_member_history(id uuid,tenant_id uuid,member_id uuid,observed_at timestamptz,sequence bigint,snapshot jsonb);')
 a=group.index('create function public.learn_member_group_covers');b=group.index('revoke all on function',a)
 run(group[a:b])
 run((ROOT/'supabase/migrations/20261031040000_learn_saved_assessments.sql').read_text())
 run((ROOT/'scripts/verify/learn-saved-assessments.assert.sql').read_text())
 def race(i):return run("set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';select learn_assessment_save('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000075','00000000-0000-4000-8000-000000000060','member','00000000-0000-4000-8000-000000000003',null,'2026-01-01','2026-01-02','[{\"id\":\"00000000-0000-4000-8000-000000000008\",\"reviewRevision\":0},{\"id\":\"00000000-0000-4000-8000-000000000009\",\"reviewRevision\":3}]','Concurrent same request');",False)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(race,[0,1]))
 assert all(r.returncode==0 for r in results),[r.stderr for r in results]
 assert sum('"reused": true' in r.stdout for r in results)==1
 assert run("select count(*) from learn_assessments where id='00000000-0000-4000-8000-000000000075';").stdout.strip()=='1'
 run("set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';select learn_performance_correct('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000076',3,20,'Later correction');")
 run("set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';select test_save_assessment('00000000-0000-4000-8000-000000000077','[{\"id\":\"00000000-0000-4000-8000-000000000008\",\"reviewRevision\":0},{\"id\":\"00000000-0000-4000-8000-000000000009\",\"reviewRevision\":3},{\"id\":\"00000000-0000-4000-8000-000000000076\",\"reviewRevision\":0}]');")
 assert run("select jsonb_array_length(snapshot->'corrections') from learn_assessments where id='00000000-0000-4000-8000-000000000077';").stdout.strip()=='1'
 assert run("select count(*) from first_assessment f join learn_assessments a using(id) where to_jsonb(f)=to_jsonb(a);").stdout.strip()=='1'
 rows=json.loads(run("select jsonb_agg(to_jsonb(a) order by id) from learn_assessments a;").stdout.strip())
 (ROOT/'.verification-results/learn-saved-assessments-rows.json').write_text(json.dumps(rows,indent=2)+'\n')
 print(json.dumps({'state':'passed','checks':['Server-owned canonical snapshots retain published policy, original measurements and complete review/correction ledgers.','Changed request, stale evidence, wrong publication, future period, foreign subject, role/company/View-As and raw writes denied.','A later review creates a new snapshot without changing the first. Exact retry and simultaneous same-request saves retain one record.','Snapshot rewrite/delete/truncate and injected insert failure denied; prior source measurements and reviews retained.'],'limitations':['Isolated PostgreSQL and synthetic dependencies with actual published-policy reader; not hosted Auth, production or provider acceptance.']},indent=2))
finally:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
