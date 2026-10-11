"""Run only inside the disposable verifier with its injected Docker helpers."""
import concurrent.futures
import selectors
import subprocess

prefix = "set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;"
request = 'ff150000-0000-4000-8000-000000000031'
tenant = 'aaa50000-0000-4000-8000-000000000001'
command = [DOCKER, 'exec', '-i', TARGET, 'psql', '-U', 'supabase_admin', '-d', 'roster_verify', '-qAt', '-v', 'ON_ERROR_STOP=1']

def call(sql):
    result = subprocess.run(command, input=sql.encode(), capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.decode())
    return result.stdout.decode()

# Keep an actual provider-independent approval transaction uncommitted while
# begin freezes the run. Its recorded_at is earlier than the run's snapshot.
transaction = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    approval = """begin;
    set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;
    do $$declare f working_collection_fixture%rowtype;begin select * into f from working_collection_fixture;
      perform learn_work_delay_record('aaa50000-0000-4000-8000-000000000001','de150000-0000-4000-8000-000000000031',
        jsonb_build_object('objectId','eee50000-0000-4000-8000-000000000001','expectedRevision',0,'decision','approve','approvalId',null,
        'period',jsonb_build_object('start',(select occurred_at from object_state_history where object_id='eee50000-0000-4000-8000-000000000001' and capture_kind='insert'),'end',f.ends),
        'label','Synthetic late commit','reason','Prove committed snapshot isolation','evidenceIds',jsonb_build_array((select id from object_state_history where object_id='eee50000-0000-4000-8000-000000000001' and capture_kind='insert'))));
    end $$;
    \\echo working-delay-ready
    """
    transaction.stdin.write(approval.encode())
    transaction.stdin.flush()
    with selectors.DefaultSelector() as selector:
        selector.register(transaction.stdout, selectors.EVENT_READ)
        assert selector.select(timeout=10), 'Approval transaction did not reach its ready marker'
        assert transaction.stdout.readline().strip() == b'working-delay-ready'
    call(prefix + f"""select learn_work_collection_begin('{tenant}','workingTime','ddd50000-0000-4000-8000-000000000001',
      (member_policy->>'id')::uuid,1,starts+interval '.000035 second',ends,'{request}','Late-commit visibility check') from working_collection_fixture;""")
    output, errors = transaction.communicate(b'commit;\n', timeout=10)
    assert transaction.returncode == 0, errors.decode()
finally:
    if transaction.poll() is None:
        transaction.kill()
        transaction.communicate(timeout=10)

call(f"""do $$begin
 assert (select e.recorded_at < r.snapshot_at from learn_work_delay_events e cross join learn_work_collection_runs r
   where e.id='de150000-0000-4000-8000-000000000031' and r.id='{request}'),'Test must prove timestamp-only filtering would admit the later commit';
 assert (select delay_through=0 from learn_working_collection_items where run_id='{request}' and ordinal=1),'Uncommitted approval must be absent from the frozen head';
 end $$;""")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    outputs = list(pool.map(lambda _: call(prefix + f"select learn_work_collection_step('{tenant}','{request}',0);"), range(2)))
assert all('"processed": 100' in output for output in outputs), 'Concurrent identical checkpoints must advance only once'
call(prefix + f"""do $$declare r jsonb;begin
 r:=learn_work_collection_status('{tenant}','{request}');
 while r->>'state'='collecting' loop r:=learn_work_collection_step('{tenant}','{request}',(r->>'processed')::int);end loop;
 assert r->>'state'='completed';
 assert (select result->>'delayThrough'='0' and result->>'assessedMicros'<>'0' from learn_work_collection_items where run_id='{request}' and ordinal=1),'Late approval must not change resumed arithmetic';
 end $$;""")
print('Uncommitted earlier-timestamp approval excluded after later commit; competing working-time checkpoints advance once: PASS')

# Begin and cancel can arrive in either order. A cancelled request must never
# resurrect when a delayed begin is delivered later.
import json
for attempt in range(3):
    request=f'ff150000-0000-4000-8000-00000000007{attempt}'
    args=f"'{tenant}','workingTime','ddd50000-0000-4000-8000-000000000001',(member_policy->>'id')::uuid,1,starts,ends-interval '{10+attempt} microseconds','{request}','Competing begin and cancel'"
    begin=f"select learn_work_collection_begin({args}) from working_collection_fixture;"
    abandon=f"select learn_work_collection_abandon({args},'Synthetic cancellation') from working_collection_fixture;"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outputs=list(pool.map(lambda sql: call(prefix+sql),[begin,abandon]))
    state=json.loads(next(line for line in outputs[1].splitlines() if line.startswith('{')))
    assert state['state']=='abandoned' and state['measurementId'] is None
    retry=json.loads(next(line for line in call(prefix+begin).splitlines() if line.startswith('{')))
    assert retry==state
    call(f"do $$begin assert not exists(select 1 from measurements where id='{request}');end $$;")
print('Three simultaneous working-time begin/abandon races retain one terminal cancellation; delayed begin cannot resurrect it: PASS')
