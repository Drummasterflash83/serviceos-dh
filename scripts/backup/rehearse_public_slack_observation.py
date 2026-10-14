"""Rehearse public Slack observations against the retained native archive."""
import argparse,hashlib,json,subprocess
from pathlib import Path
from database_restore_sandbox import RestoreSandbox,RecoveryError
from restore_production_database import ROOT,IMAGE,PINNED_IMAGE,write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from native_copy_fingerprints import restored_fingerprints,compare_native_data
from rehearse_source_keysets import rehearse_source_keysets
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--selection-rows',type=int,default=1000)
args=p.parse_args();out=Path(args.output).resolve()
if not 1000<=args.selection_rows<=30000:raise SystemExit('Synthetic selection scale must be 1000–30000')
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
  print('Full candidate restored; checking authorised retained Slack sources.',flush=True)
  proof=Path('supabase/migrations/20261101910000_learn_slack_customer_job_context.sql').read_text().split('create function public.slack_commit_attested_page')[0]
  target.query('set role postgres;set search_path=public,pg_catalog;'+proof+'commit;')
  kind=Path('supabase/migrations/20261101940000_learn_slack_source_review.sql').read_text().split('do $$declare d text;')[0]
  target.query('set role postgres;set search_path=public,pg_catalog;'+kind+'commit;')
  target.query('set role postgres;set search_path=public,pg_catalog;'+Path('supabase/migrations/20261101610000_learn_observation_delivery.sql').read_text())
  target.query('set role postgres;set search_path=public,pg_catalog;'+Path('supabase/migrations/20261102160000_learn_reviewed_ingestion_selection.sql').read_text())
  signatures=['public.learn_observation_deliver(uuid,uuid,jsonb,jsonb)','public.intelligence_select_uningested(uuid,text,integer)']
  release=Path('supabase/release/learn-public-slack-observation')
  manifest=json.loads((release/'manifest.json').read_text())
  for name,digest in manifest['files'].items():
   if hashlib.sha256((release/name).read_bytes()).hexdigest()!=digest:raise RecoveryError('Release artifact differs')
  for name in ['learn_slack_message_kind','learn_slack_document_withheld','learn_observation_deliver','intelligence_select_uningested']:
   target.query('set role postgres;'+(release/(name+'.before.sql')).read_text())
  target.query('set role postgres;revoke all on function public.learn_slack_document_withheld(uuid,jsonb),public.learn_slack_message_kind(jsonb) from public,anon,authenticated,service_role;')
  original=[target.query("select pg_get_functiondef('"+sig+"'::regprocedure)") for sig in signatures]
  authority=[target.query("select pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text from pg_proc where oid='"+sig+"'::regprocedure") for sig in signatures]
  settings="set role postgres;set serviceos.release_target='tgbnakbxwcqjeimygroz';set serviceos.release_sha256='"+manifest['source']['sha256']+"';"
  apply=(release/'apply.sql').read_text();rollback=(release/'rollback.sql').read_text()
  before=restored_fingerprints(target)
  migration=Path('supabase/migrations/20261102190000_learn_public_slack_observation_context.sql').read_text()
  if hashlib.sha256(migration.encode()).hexdigest()!=manifest['source']['sha256']:raise RecoveryError('Release source differs')
  for label,attempt in [('target',settings.replace('tgbnakbxwcqjeimygroz','wrong-target')+apply),('digest',settings.replace(manifest['source']['sha256'],'0'*64)+apply),('late',settings+apply.replace(manifest['after'][0]['bodyMd5'],'0'*32))]:
   try:target.query(attempt)
   except RecoveryError:
    diagnostic=Path(str(out/'private-error')+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
    expected='Prepared function or authority differs' if label=='late' else 'Reviewed target/source required'
    if expected not in diagnostic:raise RecoveryError('Guard failed at an unexpected stage: '+label)
   else:raise RecoveryError('Guard unexpectedly passed: '+label)
   if any(target.query("select pg_get_functiondef('"+sig+"'::regprocedure)")!=d for sig,d in zip(signatures,original)):raise RecoveryError('Failed guard changed baseline')
   if target.query("select to_regprocedure('public.learn_public_slack_observation_context(uuid,uuid)') is null")!='t':raise RecoveryError('Failed guard retained helper')
  report['targetDigestAndLateFailureGuards']=True
  target.query(settings+apply)
  report['installedFunctions']=json.loads(target.query("select jsonb_agg(jsonb_build_object('signature',oid::regprocedure::text,'definitionMd5',md5(pg_get_functiondef(oid)),'bodyMd5',md5(prosrc),'owner',pg_get_userbyid(proowner),'acl',proacl::text,'securityDefiner',prosecdef,'config',proconfig)) from pg_proc where oid in('public.learn_observation_deliver(uuid,uuid,jsonb,jsonb)'::regprocedure,'public.intelligence_select_uningested(uuid,text,integer)'::regprocedure,'public.learn_public_slack_observation_context(uuid,uuid)'::regprocedure)"))
  installed=restored_fingerprints(target)
  report['preservation']=compare_native_data(before,installed)
  sql=Path('scripts/verify/learn-public-slack-observation.assert.sql').read_text()
  sql=sql.replace('generate_series(20000,20999)',f'generate_series(20000,{19999+args.selection_rows})')
  fixture=json.loads(subprocess.run(['node','scripts/verify/learn-public-slack-observation-fixture.ts'],capture_output=True,check=True,text=True).stdout)
  for k in ('draft','result'):sql=sql.replace('__'+k.upper()+'__','$fixture$'+json.dumps(fixture[k])+'$fixture$::jsonb')
  result=target.query('set role postgres;set search_path=public,pg_catalog;begin;'+sql+'\nrollback;')
  metrics=[json.loads(line) for line in result.splitlines() if line.startswith('{"selectionMetric"')]
  if len(metrics)!=1 or metrics[0]['selectionMetric']['selected']!=25:raise RecoveryError('Selection timing evidence missing')
  report['syntheticSelection']={**metrics[0]['selectionMetric'],'sourceRows':args.selection_rows,'scope':'isolated synthetic tenant on restored full schema; hosted latency unverified'}
  existing=Path('scripts/verify/learn-reviewed-ingestion-selection.assert.sql').read_text()
  target.query('set role postgres;set search_path=public,pg_catalog;begin;'+existing+'\nrollback;')
  report['existingReviewedAndHistoricalSelection']='passed'
  report['sourceFingerprintProtocol']=rehearse_source_keysets(target)
  report['sourceJourney']='passed'
  report['sourceAuthorityAndVisibility']='passed'
  after=restored_fingerprints(target)
  if installed['tables']!=after['tables']:raise RecoveryError('Synthetic rollback changed retained rows')
  report['syntheticSequenceChanges']=[{'before':a,'after':b} for a,b in zip(installed['sequences'],after['sequences']) if a!=b]
  if any(x['before']['name']!='public.learn_work_capture_sequence' for x in report['syntheticSequenceChanges']):raise RecoveryError('Unexpected sequence change')
  target.query(settings+rollback)
  if any(target.query("select pg_get_functiondef('"+sig+"'::regprocedure)")!=d for sig,d in zip(signatures,original)):raise RecoveryError('Rollback definitions differ')
  target.query(settings+apply)
  if any(target.query("select pg_get_userbyid(proowner)||'|'||proacl::text||'|'||prosecdef::text from pg_proc where oid='"+sig+"'::regprocedure")!=d for sig,d in zip(signatures,authority)):raise RecoveryError('Existing authority changed')
  report['migrationRollbackVerified']=True
  report['existingFunctionAuthorityPreserved']=True
  report.update(state='public_slack_observation_full_schema_rehearsed',migrationSha256=hashlib.sha256(migration.encode()).hexdigest(),journeyRollbackVerified=True)
except Exception:
 report['state']='requires_inspection';raise
finally:
 report['containerRemoved']=bool(target and target.cleaned);write_private(out/'report.json',report)
print(json.dumps(report))
