"""Rehearse the prepared founder access change in an isolated retained DB only."""
import hashlib,json,uuid,argparse
from pathlib import Path
from database_restore_sandbox import RestoreSandbox,RecoveryError
from restore_production_database import IMAGE,PINNED_IMAGE,write_private,literal
from inspect_production_release_baseline import prepare_archive_roles
from native_copy_fingerprints import restored_fingerprints,compare_native_data

def main():
 p=argparse.ArgumentParser();p.add_argument('--plan',required=True);p.add_argument('--source',required=True);p.add_argument('--output',required=True);args=p.parse_args()
 source=Path(args.source).resolve();out=Path(args.output).resolve();private=Path('.verification-results').resolve()
 if source.parent!=private or out.parent!=private or out.exists():raise SystemExit('Existing private source and fresh output required')
 plan_path=Path(args.plan).resolve()
 if plan_path.parent!=private:raise SystemExit('Private plan required')
 plan=json.loads(plan_path.read_text());SUBJECT=str(uuid.UUID(plan['subject']))
 if plan['project']!='tgbnakbxwcqjeimygroz' or plan['prior']['role']!='viewer' or plan['prior']['tenantId'] is not None or plan['proposed']!={'role':'admin','tenantId':'00000000-0000-0000-0000-000000000001'}:raise SystemExit('Prepared scope differs')
 template=Path('scripts/verify/learn-founder-access.sql').read_text()
 if hashlib.sha256(template.encode()).hexdigest()!=plan['templateSha256']:raise SystemExit('Template changed')
 sql=template.replace('__APPROVED_PROFILE_ID__',SUBJECT).replace('__APPROVED_EMAIL__',plan['email'].replace("'","''"))
 if hashlib.sha256(sql.encode()).hexdigest()!=plan['sqlSha256']:raise SystemExit('Reviewed execution bytes differ')
 out.mkdir(mode=0o700);run=str(uuid.uuid4());target=None
 report={'state':'started','productionChanges':0,'providerRequests':0,'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'checks':[]}
 try:
  target=RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,synthetic_vault=True,private_diagnostics=out/'private-error')
  with target:
   if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image differs')
   prepare_archive_roles(target,json.loads((source/'source-inventory.json').read_text()))
   print(json.dumps({'stage':'restoring_full_schema_offline'}),flush=True)
   report['archive']=target.restore_native_archive(source/'database.dump');report['containment']=target.verify_boundary()
   before=restored_fingerprints(target)
   profile=lambda:target.query("select to_jsonb(p)::text from public.profiles p where id='"+SUBJECT+"';")
   original=json.loads(profile());assert original['tenant_id'] is None and original['role']=='viewer'
   def prefix(mode='grant'):
    h=target.query("select md5(to_jsonb(p)::text) from public.profiles p where id='"+SUBJECT+"';")
    return "begin;set local role postgres;set local serviceos.customer_access_project='tgbnakbxwcqjeimygroz';set local serviceos.customer_access_action="+literal(mode)+";set local serviceos.customer_access_run="+literal(run)+";set local serviceos.customer_access_row_hash="+literal(h)+";"
   cases=[('wrong_project',prefix().replace("project='tgbnakbxwcqjeimygroz'","project='saatxzwxvdvqevbnskxy'"),'customer_access_scope_required'),('stale_profile',prefix()+"update public.profiles set full_name='Synthetic drift' where id='"+SUBJECT+"';",'customer_access_profile_changed')]
   for name,pre,expected in cases:
    try:target.query(pre+sql+'commit;')
    except RecoveryError:
     log=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
     if expected not in log:raise RecoveryError('Unexpected rejection '+name)
    else:raise RecoveryError('Unsafe access accepted')
    compare_native_data(before,restored_fingerprints(target));report['checks'].append(name)
   try:target.query(prefix()+sql+'select 1/0;commit;')
   except RecoveryError:pass
   else:raise RecoveryError('Late failure accepted')
   compare_native_data(before,restored_fingerprints(target));report['checks'].append('late_failure_atomic_rollback')
   target.query(prefix()+sql+'commit;');changed=json.loads(profile());assert changed['role']=='admin' and changed['tenant_id']=='00000000-0000-0000-0000-000000000001'
   assert {k:v for k,v in original.items() if k not in ['role','tenant_id','updated_at']}=={k:v for k,v in changed.items() if k not in ['role','tenant_id','updated_at']}
   after=restored_fingerprints(target)
   def omit(x):return {**x,'tables':[t for t in x['tables'] if (t['schema'],t['table']) not in [('public','profiles'),('public','controlplane_change_log')]]}
   report['unrelatedPreservation']=compare_native_data(omit(before),omit(after));report['checks'].append('grant_only_expected_profile_fields_and_audit')
   auth="begin;set local role authenticated;select set_config('request.jwt.claim.sub','"+SUBJECT+"',true);"
   state=target.query(auth+"select jsonb_build_object('tenant',public.current_tenant_id(),'role',public.current_user_role(),'operator',public.current_user_is_openfolk_operator());rollback;").splitlines()[-1]
   state=json.loads(state);assert state=={'tenant':'00000000-0000-0000-0000-000000000001','role':'admin','operator':False};report['customerAuthority']=state
   own=target.query(auth+"select count(*) from public.client_programmes;rollback;").splitlines()[-1];assert own=='1'
   report['checks'].append('existing_customer_context_resolves_without_platform_authority')
   try:target.query(prefix()+sql+'commit;')
   except RecoveryError:pass
   else:raise RecoveryError('Duplicate grant accepted')
   compare_native_data(after,restored_fingerprints(target));report['checks'].append('duplicate_rejected_unchanged')
   target.query(prefix('revert')+sql+'commit;');reverted=json.loads(profile());assert reverted['role']=='viewer' and reverted['tenant_id'] is None
   assert {k:v for k,v in original.items() if k!='updated_at'}=={k:v for k,v in reverted.items() if k!='updated_at'}
   compare_native_data(omit(before),omit(restored_fingerprints(target)));report['checks'].append('revert_restores_prior_scope_and_retains_audit')
   report['auditCount']=int(target.query("select count(*) from public.controlplane_change_log where correlation_id="+literal(run)+" and source='learn-founder-access';"));assert report['auditCount']==2
   report['state']='offline_access_change_and_revert_passed'
 except Exception:
  report['state']='failed';raise
 finally:
  report['containerRemoved']=bool(target and target.cleaned);write_private(out/'report.json',report)
 print(json.dumps(report),flush=True)
if __name__=='__main__':main()
