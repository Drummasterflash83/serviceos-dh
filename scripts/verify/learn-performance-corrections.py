"""Isolated correction checks with actual deployed append/review bodies and synthetic dependencies."""
import concurrent.futures,json,shutil,subprocess,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];DOCKER=shutil.which('docker') or '/usr/local/bin/docker';NAME='serviceos-performance-correct-'+uuid.uuid4().hex[:8]
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
 run((ROOT/'scripts/verify/learn-performance-corrections.assert.sql').read_text())
 def race(i):return run(f"set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';select learn_performance_correct('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-{51+i:012d}',0,{10+i},'Concurrent review');",False)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(race,[0,1]))
 assert sum(r.returncode==0 for r in results)==1
 assert run("select count(*) from measurements where supersedes='00000000-0000-4000-8000-000000000050';").stdout.strip()=='1'
 assert run("select count(*) from learn_performance_corrections where predecessor_id='00000000-0000-4000-8000-000000000050';").stdout.strip()=='1'
 print(json.dumps({'state':'passed','checks':['Retained original values/reviews, exact retry and changed-identity/stale/fork denial.','New observation stays inferred; independent review; correction-of-correction retains source freshness.','NULL withholding, coverage/evidence preservation, role/tenant/View-As denial and immutable correction ledger.','Failed ledger append rolls back measurement; two real database sessions retain exactly one correction.'],'limitations':['Offline synthetic dependencies with actual deployed append/review bodies; no hosted Auth, full-schema or historical group-membership acceptance.']},indent=2))
finally:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
