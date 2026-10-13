"""Exact historical job recovery in the retained networkless archive only."""
import json,hashlib,argparse
from pathlib import Path
from database_restore_sandbox import RestoreSandbox,RecoveryError
from restore_production_database import ROOT,IMAGE,PINNED_IMAGE,write_private,literal
from inspect_production_release_baseline import prepare_archive_roles
from native_copy_fingerprints import restored_fingerprints,compare_native_data

MANIFEST="""select jsonb_build_object('projectRef','tgbnakbxwcqjeimygroz','observedAt',clock_timestamp(),'rows',jsonb_agg(jsonb_build_object('id',id,'tenantId',tenant_id,'rowHash',md5(to_jsonb(j)::text)) order by id)) from public.platform_jobs j where status='running' and claimed_by is null and lease_expires_at is null and attempt_count=0;"""
def run():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);out=Path(p.parse_args().output).resolve()
 if out.parent!=Path('.verification-results').resolve() or out.exists():raise SystemExit('Fresh private directory required')
 out.mkdir(mode=0o700);report={'state':'started','productionChanges':0,'providerCalls':0};target=None
 sql=Path('scripts/verify/learn-production-legacy-job-settlement.sql').read_text()
 report['sqlSha256']=hashlib.sha256(sql.encode()).hexdigest()
 try:
  target=RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,synthetic_vault=True,private_diagnostics=out/'private-error')
  with target:
   if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image differs')
   prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
   report['archive']=target.restore_native_archive(ROOT/'database.dump');report['containment']=target.verify_boundary()
   before=restored_fingerprints(target)
   jobs_before=target.query("select md5(string_agg(to_jsonb(j)::text,E'\\n' order by id)) from public.platform_jobs j;")
   audits_before=target.query("select md5(string_agg(to_jsonb(a)::text,E'\\n' order by id)) from public.audit_logs a;")
   m=json.loads(target.query(MANIFEST));assert len(m['rows'])==14
   setup="begin;set local role postgres;set local serviceos.legacy_job_target='tgbnakbxwcqjeimygroz';select set_config('serviceos.legacy_job_manifest',"+literal(json.dumps(m))+",true);"
   cases=[('wrong_target',setup.replace("legacy_job_target='tgbnakbxwcqjeimygroz'","legacy_job_target='saatxzwxvdvqevbnskxy'"),'legacy_recovery_target_required'),
    ('changed_row',setup+"update public.platform_jobs set progress_current=progress_current+1 where id="+literal(m['rows'][0]['id'])+";",'legacy_recovery_row_changed'),
    ('claimed_row',setup+"update public.platform_jobs set claimed_by='synthetic' where id="+literal(m['rows'][0]['id'])+";",'legacy_recovery_row_changed'),
    ('recent_row',setup+"update public.platform_jobs set started_at=clock_timestamp() where id="+literal(m['rows'][0]['id'])+";",'legacy_recovery_row_changed')]
   ids=','.join(literal(x['id'])+'::uuid' for x in m['rows'])
   refresh="select set_config('serviceos.legacy_job_manifest',("+MANIFEST.split(" where status=")[0]+" where id in("+ids+"))::text,true);"
   cases=[(name,pre+(refresh if name in ['claimed_row','recent_row'] else ''),error) for name,pre,error in cases]
   duplicate=json.loads(json.dumps(m));duplicate['rows'][1]=duplicate['rows'][0]
   expired=json.loads(json.dumps(m));expired['observedAt']='2020-01-01T00:00:00Z'
   for name,manifest,error in [('duplicate_target',duplicate,'legacy_recovery_duplicate_target'),('expired_observation',expired,'legacy_recovery_observation_expired')]:
    cases.append((name,setup+"select set_config('serviceos.legacy_job_manifest',"+literal(json.dumps(manifest))+",true);",error))
   report['negativeChecks']=[]
   for name,pre,error in cases:
    try:target.query(pre+sql+'commit;')
    except RecoveryError:
     log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
     if error not in log:raise RecoveryError('Unexpected recovery rejection: '+name)
    else:raise RecoveryError('Unsafe recovery accepted: '+name)
    compare_native_data(before,restored_fingerprints(target))
    report['negativeChecks'].append(name)
   # Force failure after audit/status writes: entire transaction must roll back.
   try:target.query(setup+sql+'select 1/0;commit;')
   except RecoveryError:pass
   else:raise RecoveryError('Late failure accepted')
   compare_native_data(before,restored_fingerprints(target))
   report['negativeChecks'].append('late_failure_atomic_rollback')
   print(json.dumps({'stage':'negative_checks_passed','checks':len(report['negativeChecks'])}),flush=True)
   # Real archived rows, normal triggers, committed only in this disposable clone.
   target.query(setup+sql+'commit;')
   ids=','.join(literal(x['id'])+'::uuid' for x in m['rows'])
   receipt=json.loads(target.query("""select jsonb_build_object('jobs',count(*),'valid',bool_and(j.status='failed' and j.failed_at is not null and j.last_error='legacy_execution_interrupted_capture_unverified' and
    (to_jsonb(j)-array['status','failed_at','last_error','updated_at'])=((a.detail->'before')-array['status','failed_at','last_error','updated_at']) and
    md5((a.detail->'before')::text)=a.detail->>'beforeHash' and a.tenant_id=j.tenant_id and a.detail->>'automaticRetry'='false'))
    from public.platform_jobs j join public.audit_logs a on a.resource_id=j.id::text and a.action='learn.legacy_job.interrupted' where j.id in("""+ids+");"))
   if receipt!={'jobs':14,'valid':True}:raise RecoveryError('Audit or field preservation failed')
   after=restored_fingerprints(target)
   def omit_changed(x):
    return {**x,'tables':[t for t in x['tables'] if (t['schema'],t['table']) not in [('public','platform_jobs'),('public','audit_logs')]]}
   report['unrelatedPreservation']=compare_native_data(omit_changed(before),omit_changed(after))
   reconstructed=target.query("select md5(string_agg(coalesce(a.detail->'before',to_jsonb(j))::text,E'\\n' order by j.id)) from public.platform_jobs j left join public.audit_logs a on a.resource_id=j.id::text and a.action='learn.legacy_job.interrupted';")
   retained_audits=target.query("select md5(string_agg(to_jsonb(a)::text,E'\\n' order by id)) from public.audit_logs a where action<>'learn.legacy_job.interrupted';")
   if reconstructed!=jobs_before or retained_audits!=audits_before:raise RecoveryError('Original job/audit rows were not preserved')
   try:target.query(setup+sql+'commit;')
   except RecoveryError:pass
   else:raise RecoveryError('Duplicate settlement accepted')
   compare_native_data(after,restored_fingerprints(target))
   report['negativeChecks'].append('duplicate_settlement_rejected_unchanged')
   report['receipt']=receipt;report['originalJobRowsReconstructedExactly']=True;report['existingAuditRowsUnchanged']=True
   report['state']='legacy_job_settlement_rehearsed_offline'
 except Exception:
  report['state']='failed';raise
 finally:
  report['containerRemoved']=bool(target and target.cleaned);write_private(out/'report.json',report)
 print(json.dumps(report))
if __name__=='__main__':run()
