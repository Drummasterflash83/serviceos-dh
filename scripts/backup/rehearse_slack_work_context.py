"""Rehearse Slack context on the full production candidate, isolated and rolled back."""
import argparse, hashlib, json
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from native_copy_fingerprints import restored_fingerprints, compare_native_data
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True);out=Path(p.parse_args().output).resolve()
if out.parent!=Path('.verification-results').resolve() or out.exists():raise SystemExit('Fresh private output required')
out.mkdir(mode=0o700)
report={'state':'started','productionChanged':False,'hostedTestChanged':False,'providerRequests':0}
target=None
try:
 target=RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,synthetic_vault=True,private_diagnostics=out/'private-error')
 with target:
  if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image pin differs')
  prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
  report['archive']=target.restore_native_archive(ROOT/'database.dump');report['containment']=target.verify_boundary()
  paths=sorted(p for p in Path('supabase/release/learn-production').glob('[0-9][0-9][0-9]_*.manifest.json') if int(p.name[:3])<=20)
  if [int(x.name[:3]) for x in paths]!=list(range(1,21)):raise RecoveryError('Twenty prerequisites required')
  for path in paths:
   m=json.loads(path.read_text());sql=path.with_name(path.name.replace('.manifest.json','.sql')).read_text()
   if hashlib.sha256(sql.encode()).hexdigest()!=m['sha256']:raise RecoveryError('Package changed')
   target.query(prefix(m)+sql)
  print('Full candidate restored; testing Slack context.',flush=True)
  before=restored_fingerprints(target)
  migration=Path('supabase/migrations/20261101600000_learn_slack_work_context.sql').read_text()
  inventory=Path('scripts/verify/learn-release-schema-inventory.sql').read_text();schema=target.query(inventory)
  package_path=Path('supabase/release/learn-production/021_slack_work_context.sql')
  package=package_path.read_text();manifest=json.loads(package_path.with_suffix('.manifest.json').read_text())
  if hashlib.sha256(package.encode()).hexdigest()!=manifest['sha256'] or manifest['sources'][0]['sha256']!=hashlib.sha256(migration.encode()).hexdigest():
   raise RecoveryError('Candidate package differs')
  target.query(prefix(manifest)+package.replace('\ncommit;','\nrollback;'))
  if schema!=target.query(inventory):raise RecoveryError('Package rollback changed schema')
  compare_native_data(before,restored_fingerprints(target))
  report['packageRollbackVerified']=True;report['packageSha256']=manifest['sha256']
  target.query('set role postgres;set search_path=public,pg_catalog;'+migration.replace('\ncommit;','\nrollback;'))
  if schema!=target.query(inventory):raise RecoveryError('Migration rollback changed schema')
  target.query('set role postgres;set search_path=public,pg_catalog;'+migration)
  installed=restored_fingerprints(target)
  prior_keys={(t['schema'],t['table']) for t in before['tables']}
  retained={**installed,'tables':[t for t in installed['tables'] if (t['schema'],t['table']) in prior_keys]}
  preservation=compare_native_data(before,retained)
  added=[t for t in installed['tables'] if (t['schema'],t['table']) not in prior_keys]
  if [(t['schema'],t['table'],t['rows']) for t in added]!=[('public','learn_slack_context_reviews',0)]:
   raise RecoveryError('Unexpected additional data')
  target.query('set role postgres;set search_path=public,pg_catalog;begin;\n'+Path('scripts/verify/learn-slack-work-context.assert.sql').read_text()+'\nrollback;')
  after=restored_fingerprints(target)
  if installed!=after:raise RecoveryError('Journey rollback changed retained data')
  report.update(state='slack_work_context_full_schema_rehearsed',migrationSha256=hashlib.sha256(migration.encode()).hexdigest(),preservation=preservation,migrationRollbackVerified=True,journeyRollbackVerified=True,containerRemoved=False)
 report['containerRemoved']=target.cleaned
except Exception:
 report['state']='requires_inspection';report['containerRemoved']=bool(target and target.cleaned);raise
finally:
 write_private(out/'report.json',report)
print(json.dumps(report))
