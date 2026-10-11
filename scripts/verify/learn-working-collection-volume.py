"""Company-volume acceptance inside the injected disposable synthetic database."""
import json
import subprocess
import time

command = [DOCKER,'exec','-i',TARGET,'psql','-U','supabase_admin','-d','roster_verify','-qAt','-v','ON_ERROR_STOP=1']
tenant='aaa50000-0000-4000-8000-000000000001'
prefix="set request.jwt.claim.sub='bbb50000-0000-4000-8000-000000000001';set role authenticated;"

def call(sql):
    result=subprocess.run(command,input=sql.encode(),capture_output=True,timeout=60)
    if result.returncode: raise RuntimeError(result.stderr.decode()[-1500:])
    return result.stdout.decode()

measurements=[]
for kind,suffix in [('member','41'),('team','42')]:
    request='ff150000-0000-4000-8000-0000000000'+suffix
    times=[]
    for after in range(0,14500,100):
        started=time.monotonic()
        output=call(prefix+f"select learn_work_collection_step('{tenant}','{request}',{after});")
        times.append(time.monotonic()-started)
        progress=json.loads(next(line for line in output.splitlines() if line.startswith('{')))
        assert progress['processed']==after+100 and progress['population']==14500
        assert progress['covered']==progress['eligible']==after+100
        assert progress['state']==('completed' if after==14400 else 'collecting')
        if after%3000==0: print(f'{kind} working-time collection: {after+100}/14500 committed',flush=True)
    # Every proof page is actually read, not inferred from table row counts.
    pages=call(prefix+'\n'.join(f"select jsonb_build_object('after',p->'after','count',jsonb_array_length(p->'items'),'next',p->'next','bytes',octet_length(p::text)) from (select learn_work_collection_evidence('{tenant}','{request}','items',{after}) p) q;" for after in range(0,14500,100)))
    pages=[json.loads(line) for line in pages.splitlines() if line.startswith('{')]
    assert len(pages)==145 and sum(p['count'] for p in pages)==14500
    assert all(p['after']==i*100 and p['count']==100 and p['next']==(None if i==144 else (i+1)*100) for i,p in enumerate(pages))
    check=call(f"""select jsonb_build_object('expected',f.expected_micros::text,'actual',c.known_micros::text,
      'sum',(select sum((result->>'assessedMicros')::numeric)::text from learn_work_collection_items where run_id=c.run_id),
      'measurementMatches',m.value=round(f.expected_micros/60000000,12),'review',m.review_state,
      'retainedInputs',(select count(*) from learn_working_collection_items where run_id=c.run_id and history is not null and delays is not null))
      from working_volume_fixture f cross join learn_working_collection_runs c join measurements m on m.id=c.run_id where c.run_id='{request}';""")
    checked=json.loads(check.strip())
    from decimal import Decimal
    assert Decimal(checked['expected'])==Decimal(checked['actual'])==Decimal(checked['sum'])
    assert checked['measurementMatches'] and checked['review']=='inferred' and checked['retainedInputs']==14500
    measurements.append({'kind':kind,'items':14500,'committedBatches':145,'proofPages':145,'maxPageBytes':max(p['bytes'] for p in pages),'maxBatchSeconds':round(max(times),3),'totalBatchSeconds':round(sum(times),3)})
print(json.dumps({'workingTimeCompanyVolume':'passed','measurements':measurements}),flush=True)
