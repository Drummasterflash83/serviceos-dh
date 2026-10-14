"""Rehearse Workspace discovery sender dependency against the retained native archive."""
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
  print('Full candidate restored; checking Workspace discovery sender dependency.',flush=True)
  catalog_sql="set search_path=public,pg_catalog;select jsonb_object_agg(oid::regprocedure::text,jsonb_build_object('hash',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'acl',proacl::text,'securityDefiner',prosecdef,'config',proconfig)) from pg_proc where pronamespace='public'::regnamespace and prokind='f';"
  original_catalog=json.loads(target.query(catalog_sql))
  before=restored_fingerprints(target)
  migration=Path('supabase/migrations/20261102180000_learn_workspace_discovery_sender_helpers.sql').read_text()
  target.query(migration)
  installed_catalog=json.loads(target.query(catalog_sql))
  changes={k for k in original_catalog if original_catalog[k]!=installed_catalog.get(k)}
  write_private(out/'helper-catalogs.private.json',{'before':original_catalog,'after':installed_catalog,'changed':sorted(changes),'added':sorted(set(installed_catalog)-set(original_catalog))})
  if set(original_catalog)!=set(installed_catalog) or changes!={'marketing_sender_readiness(uuid,uuid)','marketing_sender_authority_state(uuid,text,text)'}:raise RecoveryError('Unexpected helper changes')
  for k in changes:
   for field in ['owner','acl','securityDefiner']:
    if original_catalog[k][field]!=installed_catalog[k][field]:raise RecoveryError('Helper authority changed')
  installed=restored_fingerprints(target)
  report['preservation']=compare_native_data(before,installed)
  sql=Path('scripts/verify/learn-workspace-discovery-helpers.assert.sql').read_text()
  target.query('set role postgres;set search_path=public,pg_catalog;begin;'+sql+'\nrollback;')
  report['discoveryAndSenderSafetyJourney']='passed'
  report['assertionSha256']=hashlib.sha256(sql.encode()).hexdigest()
  if json.loads(target.query(catalog_sql))!=installed_catalog:raise RecoveryError('Fixture rollback changed helper definitions')
  after=restored_fingerprints(target)
  if installed['tables']!=after['tables'] or installed['sequences']!=after['sequences']:raise RecoveryError('Fixture rollback changed retained rows or sequences')
  target.query(Path('supabase/release/learn-workspace-discovery-helpers/rollback.sql').read_text())
  if json.loads(target.query(catalog_sql))!=original_catalog:raise RecoveryError('Exact helper rollback differs')
  target.query(migration)
  if json.loads(target.query(catalog_sql))!=installed_catalog:raise RecoveryError('Exact helper reapply differs')
  report['exactHelperCatalogRollbackReapply']=True
  report['unrelatedFunctionsAndPermissionsPreserved']=True
  report.update(state='workspace_discovery_helpers_full_schema_rehearsed',migrationSha256=hashlib.sha256(migration.encode()).hexdigest(),journeyRollbackVerified=True,functionRollbackReapplyVerified=True)
except Exception:
 report['state']='requires_inspection';raise
finally:
 report['containerRemoved']=bool(target and target.cleaned);write_private(out/'report.json',report)
print(json.dumps(report))
