"""Synthetic work-transition tests: offline disposable Postgres, no real data."""
import concurrent.futures
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-work-history-' + uuid.uuid4().hex[:8]

def sql(text, tuples=False):
    return subprocess.run([docker,'exec','-i',name,'psql','-h','127.0.0.1','-U','postgres',
        '-v','ON_ERROR_STOP=1',*(['-Atq'] if tuples else []),'-f','-'],input=text,text=True,capture_output=True)

try:
    subprocess.run([docker,'run','-d','--pull=never','--network','none','--name',name,
        '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15'],check=True,capture_output=True)
    for attempt in range(80):
        if sql('select 1;').returncode == 0: break
        time.sleep(.25)
    else: raise RuntimeError('Disposable PostgreSQL not ready')
    paths = ['scripts/verify/learn-work-history.fixture.sql',
        'supabase/migrations/20260716120200_intelligence_objects.sql',
        'supabase/migrations/20261029180000_learn_work_transition_history.sql',
        'scripts/verify/learn-work-history.assert.sql']
    result=sql('\n'.join((root/p).read_text() for p in paths))
    print(result.stdout[-600:]); print(result.stderr[-1500:])
    if result.returncode: raise RuntimeError('Work history SQL assertions failed')
    statement="""select work_transition_apply('10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',1,'in_progress','{}',
      '{"verb":"start","actor":{"user_id":"20000000-0000-4000-8000-000000000001"}}',null);"""
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(sql,[statement,statement]))
    assert sum(r.returncode==0 for r in results)==1, 'Exactly one racing version must win'
    assert any('Work version changed' in r.stderr for r in results), 'Loser reports version conflict'
    result=sql("""do $$ begin
      assert (select count(*) from object_state_history where object_id='40000000-0000-4000-8000-000000000002')=1;
      assert (select version from intelligence_objects where id='40000000-0000-4000-8000-000000000002')=2;
    end $$;""")
    assert result.returncode==0, result.stderr
    print('Concurrent requests: one transition, one immutable history row, one conflict — PASS')
    result=sql('\n'.join((root/p).read_text() for p in [
        'supabase/migrations/20261029190000_learn_work_source_capture.sql',
        'scripts/verify/learn-work-capture.assert.sql']))
    print(result.stderr[-1500:])
    if result.returncode: raise RuntimeError('Work capture SQL assertions failed')
    print('Automatic capture, honest baseline, scoped reader and gap detection — PASS')
    result=sql("""set "test.actor"='20000000-0000-4000-8000-000000000001';
      set "test.tenant"='10000000-0000-4000-8000-000000000001';
      set role authenticated;
      select learn_work_history_read('10000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',statement_timestamp()-interval '1 day',statement_timestamp());
      """,tuples=True)
    assert result.returncode==0, result.stderr
    payload=json.loads(result.stdout)
    checked=subprocess.run([shutil.which('node') or '/usr/local/bin/node','--input-type=module','-e',"""
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import {buildWorkTimeline} from './src/lib/learn-work-history.ts';
      const data=JSON.parse(fs.readFileSync(0,'utf8'));
      const timeline=buildWorkTimeline(data,data);
      assert.equal(timeline.eventCount,3);
      assert.equal(timeline.coverage,'partial');
      assert.equal(timeline.handoffs.length,1);
      assert.ok(timeline.knownMinutes>=0 && timeline.unknownMinutes>1439);
      console.log('Actual SQL response accepted by the card timeline reader — PASS');
    """],input=json.dumps(payload),text=True,capture_output=True,cwd=root)
    print(checked.stdout)
    assert checked.returncode==0, checked.stderr
finally:
    subprocess.run([docker,'rm','-f',name],capture_output=True)
