"""Rehearse recent customer jobs against the retained native archive."""
import argparse,hashlib,json,sys
from pathlib import Path
from database_restore_sandbox import RestoreSandbox,RecoveryError
from restore_production_database import ROOT,IMAGE,PINNED_IMAGE,write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from native_copy_fingerprints import restored_fingerprints,compare_native_data
p=argparse.ArgumentParser();p.add_argument('--output',required=True);out=Path(p.parse_args().output).resolve()
if out.parent!=Path('.verification-results').resolve() or out.exists():raise SystemExit('Fresh private output required')
out.mkdir(mode=0o700);report={'state':'started','productionChanged':False,'hostedTestChanged':False};target=None
try:
 target=RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,synthetic_vault=True,private_diagnostics=out/'private-error')
 with target:
  if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image differs')
  prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
  report['archive']=target.restore_native_archive(ROOT/'database.dump');report['containment']=target.verify_boundary()
  paths=sorted(Path('supabase/release/learn-production').glob('[0-9][0-9][0-9]_*.manifest.json'))[:21]
  if [int(p.name[:3]) for p in paths]!=list(range(1,22)):raise RecoveryError('Exact 21 prerequisites required')
  for path in paths:
   m=json.loads(path.read_text());sql=path.with_name(path.name.replace('.manifest.json','.sql')).read_text()
   if hashlib.sha256(sql.encode()).hexdigest()!=m['sha256']:raise RecoveryError('Package changed')
   target.query(prefix(m)+sql)
  print('Full candidate restored; checking authorised recent jobs and legacy reader.',flush=True)
  before=restored_fingerprints(target)
  legacy_sql="select md5(pg_get_functiondef('public.learn_customer_business_context(uuid,uuid,text,uuid,text)'::regprocedure))"
  legacy=target.query(legacy_sql)
  migration=Path('supabase/migrations/20261102130000_learn_customer_jobs_recent.sql').read_text()
  target.query('set role postgres;set search_path=public,pg_catalog;'+migration)
  installed=restored_fingerprints(target)
  report['preservation']=compare_native_data(before,installed)
  for name in ['learn-customer-business-context']:
   sql=Path('scripts/verify/'+name+'.assert.sql').read_text()+Path('scripts/verify/learn-customer-jobs-recent.assert.sql').read_text()
   target.query('set role postgres;set search_path=public,pg_catalog;begin;'+sql+'\nrollback;')
   report[name]='passed';print(name+' passed.',flush=True)
  if target.query(legacy_sql)!=legacy:raise RecoveryError('Legacy business reader changed')
  report['legacyReaderUnchanged']=True
  after=restored_fingerprints(target)
  if installed['tables']!=after['tables']:raise RecoveryError('Synthetic rollback changed retained rows')
  report['syntheticSequenceChanges']=[{'before':a,'after':b} for a,b in zip(installed['sequences'],after['sequences']) if a!=b]
  if any(x['before']['name']!='public.learn_work_capture_sequence' for x in report['syntheticSequenceChanges']):raise RecoveryError('Unexpected sequence change')
  report.update(state='customer_jobs_recent_full_schema_rehearsed',migrationSha256=hashlib.sha256(migration.encode()).hexdigest(),journeyRollbackVerified=True)
except Exception:
 report['state']='requires_inspection';raise
finally:
 report['containerRemoved']=bool(target and target.cleaned);write_private(out/'report.json',report)
print(json.dumps(report))
