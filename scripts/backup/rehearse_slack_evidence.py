"""Isolated full-schema rehearsal; no hosted/provider requests or copied outputs."""
import argparse,hashlib,json
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
  proof=Path('supabase/migrations/20261101910000_learn_slack_customer_job_context.sql').read_text().split('create function public.slack_commit_attested_page')[0]
  kind=Path('supabase/migrations/20261101940000_learn_slack_source_review.sql').read_text().split('do $$declare d text;')[0]
  for sql in [proof+'commit;',kind+'commit;',Path('supabase/migrations/20261101610000_learn_observation_delivery.sql').read_text(),Path('supabase/migrations/20261102140000_learn_slack_card_source.sql').read_text()]:
   target.query('set role postgres;set search_path=public,pg_catalog;'+sql)
  before=restored_fingerprints(target)
  migration=Path('supabase/migrations/20261103010000_learn_slack_evidence_browse.sql').read_text()
  target.query('set role postgres;'+migration)
  installed=restored_fingerprints(target);report['preservation']=compare_native_data(before,installed)
  fixture=Path('scripts/verify/learn-slack-card-source.assert.sql').read_text().split('create temporary table source_reader_before')[0]
  assertions=Path('scripts/verify/learn-slack-evidence.assert.sql').read_text().replace('__SOURCE_FIXTURE__',fixture)
  print('Restored full schema; checking source-gated pagination, role boundaries and revocation.',flush=True)
  target.query('set role postgres;set search_path=public,pg_catalog;begin;'+assertions+'\nrollback;')
  after=restored_fingerprints(target)
  if installed['tables']!=after['tables']:raise RecoveryError('Rollback changed retained rows')
  report['syntheticSequenceChanges']=[{'before':a,'after':b} for a,b in zip(installed['sequences'],after['sequences']) if a!=b]
  if any(x['before']['name']!='public.learn_work_capture_sequence' for x in report['syntheticSequenceChanges']):raise RecoveryError('Unexpected sequence change')
  target.query('drop function public.learn_slack_evidence_read(uuid,uuid,text);drop index public.learn_slack_evidence_receipt_page;')
  target.query('set role postgres;'+migration)
  report.update(state='slack_evidence_full_schema_rehearsed',migrationSha256=hashlib.sha256(migration.encode()).hexdigest(),journeyRollbackVerified=True,functionRollbackReapplyVerified=True)
except Exception:
 report['state']='requires_inspection';raise
finally:
 report['containerRemoved']=bool(target and target.cleaned);write_private(out/'report.json',report)
print(json.dumps({k:v for k,v in report.items() if k not in ['syntheticSequenceChanges']}))
