"""Isolated correction checks with actual deployed append/review bodies and synthetic dependencies."""
import concurrent.futures,json,shutil,subprocess,time,uuid,sys
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
 if '--recovery' in sys.argv:
  recovery_sql=(ROOT/'supabase/migrations/20261101170000_learn_correction_recovery.sql').read_text()
  before=run("select md5(pg_get_functiondef('learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure))||':'||coalesce(proacl::text,'') from pg_proc where oid='learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure;").stdout
  run(recovery_sql.removesuffix('commit;\n')+'rollback;\n')
  assert run("select to_regclass('public.learn_correction_cancellations') is null;").stdout.strip()=='t'
  assert run("select md5(pg_get_functiondef('learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure))||':'||coalesce(proacl::text,'') from pg_proc where oid='learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure;").stdout==before
  run(recovery_sql)
  run((ROOT/'scripts/verify/learn-correction-recovery.assert.sql').read_text())
  for index,first_cancel in enumerate([True,False]):
   parent=f'00000000-0000-4000-8000-{80+index*2:012d}';request=f'00000000-0000-4000-8000-{81+index*2:012d}'
   run(f"select learn_performance_append('00000000-0000-4000-8000-000000000001',(select p||jsonb_build_object('id','{parent}','observedAt',clock_timestamp()-interval '1 second') from test_payload),'Synthetic recovery race');")
   args=f"'00000000-0000-4000-8000-000000000001','{parent}','{request}',0,17,'Recovery race'"
   cancel=f"select learn_performance_correction_resolve({args},true);"
   correct=f"select learn_performance_correct({args});"
   prefix="set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';"
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    first=pool.submit(run,"begin;set application_name='correction-recovery-race';"+prefix+(cancel if first_cancel else correct)+"select pg_sleep(2);commit;",False)
    for _ in range(100):
     if run("select count(*) from pg_stat_activity where application_name='correction-recovery-race' and wait_event='PgSleep';").stdout.strip()=='1':break
     time.sleep(.01)
    else:raise RuntimeError('First race transaction did not reach its retained lock')
    second=pool.submit(run,prefix+(correct if first_cancel else cancel),False)
    a,b=first.result(),second.result()
   assert a.returncode==0,a.stderr[-1000:]
   assert (b.returncode!=0)==first_cancel,b.stderr[-1000:]
   counts=run(f"select (select count(*) from learn_performance_corrections where id='{request}')||','||(select count(*) from learn_correction_cancellations where id='{request}');").stdout.strip()
   assert counts==('0,1' if first_cancel else '1,0'),counts
   if not first_cancel:assert 'recorded' in b.stdout
  print('PASS: recovery race held real database lock; cancellation-first blocks delayed correction, correction-first retains recorded outcome')

 def race(i):return run(f"set role authenticated;set test.actor='00000000-0000-4000-8000-000000000030';select learn_performance_correct('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-{51+i:012d}',0,{10+i},'Concurrent review');",False)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(race,[0,1]))
 assert sum(r.returncode==0 for r in results)==1
 assert run("select count(*) from measurements where supersedes='00000000-0000-4000-8000-000000000050';").stdout.strip()=='1'
 assert run("select count(*) from learn_performance_corrections where predecessor_id='00000000-0000-4000-8000-000000000050';").stdout.strip()=='1'
 print(json.dumps({'state':'passed','checks':['Retained original values/reviews, exact retry and changed-identity/stale/fork denial.','New observation stays inferred; independent review; correction-of-correction retains source freshness.','NULL withholding, coverage/evidence preservation, role/tenant/View-As denial and immutable correction ledger.','Failed ledger append rolls back measurement; two real database sessions retain exactly one correction.'],'limitations':['Offline synthetic dependencies with actual deployed append/review bodies; no hosted Auth, full-schema or historical group-membership acceptance.']},indent=2))
finally:subprocess.run([DOCKER,'rm','-f',NAME],capture_output=True)
