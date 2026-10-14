"""Reviewed shared-contact identity rehearsal. No network/provider/production writes.

Uses the approved retained native archive and matching release packages. All
synthetic users, grants, contacts and cards roll back. Does not prove deployment
acceptance or assert that later unrelated production migrations were applied.
"""
import sys,json,hashlib,time
from pathlib import Path
sys.path.insert(0,str(Path('scripts/backup').resolve()))
from database_restore_sandbox import RestoreSandbox,RecoveryError
from restore_production_database import ROOT,IMAGE,PINNED_IMAGE,write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix
from rehearse_production_roster import without_ledger
from native_copy_fingerprints import restored_fingerprints,compare_native_data
import argparse
parser=argparse.ArgumentParser(description="Verify reviewed distinct contacts in a disposable offline full-schema restore.")
parser.add_argument('--output',required=True)
out=Path(parser.parse_args().output).resolve()
if out.exists() or not any(out.is_relative_to(p) for p in [Path('/private/tmp'),Path('.verification-results').resolve()]):
 raise SystemExit('Choose a fresh private output directory under /private/tmp or .verification-results')
out.mkdir(mode=0o700)
root=Path('scripts/verify')
report={'state':'started','productionChanged':False,'hostedTestChanged':False,'providerRequests':0,'baseline':'retained native archive plus 24 reviewed packages; later unrelated Slack runtime changes excluded'}
target=None
try:
 packages=[]
 for path in sorted(Path('supabase/release/learn-production').glob('[0-9][0-9][0-9]_*.manifest.json')):
  m=json.loads(path.read_text());sql=path.with_name(path.name.replace('.manifest.json','.sql')).read_text()
  if hashlib.sha256(sql.encode()).hexdigest()!=m['sha256']:raise RecoveryError('Package digest changed')
  for source in m.get('sources',[m['source']] if 'source' in m else []):
   if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest()!=source['sha256']:raise RecoveryError('Package source changed')
  packages.append((m,sql))
 if len(packages)!=24:raise RecoveryError('Package count changed')
 target=RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,synthetic_vault=True,private_diagnostics=out/'private-error')
 with target:
  if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image pin changed')
  prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
  archive=target.restore_native_archive(ROOT/'database.dump')
  if any(m['baselineArchive']!=archive for m,_ in packages):raise RecoveryError('Archive changed')
  report['archive']=archive;report['containment']=target.verify_boundary();print('Offline native archive restored',flush=True)
  for m,sql in packages[:21]:target.query(prefix(m)+sql)
  target.query("create schema review_planning_rehearsal;create table review_planning_rehearsal.archived_running as select id,status from public.platform_jobs where status='running';begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs set status='cancelled' where id in(select id from review_planning_rehearsal.archived_running);alter table public.platform_jobs enable trigger user;commit;")
  m,sql=packages[21];target.query(prefix(m)+sql)
  target.query("begin;alter table public.platform_jobs disable trigger user;update public.platform_jobs j set status=r.status from review_planning_rehearsal.archived_running r where j.id=r.id;alter table public.platform_jobs enable trigger user;drop schema review_planning_rehearsal cascade;commit;")
  for m,sql in packages[22:]:target.query(prefix(m)+sql)
  print('Reviewed packages restored; validating shared-contact review',flush=True)
  schema_sql=Path('scripts/verify/learn-release-schema-inventory.sql').read_text();schema=lambda:target.query(schema_sql)
  before_schema=schema();write_private(out/'before-schema.json',json.loads(before_schema));before=without_ledger(restored_fingerprints(target))
  source=Path('supabase/migrations/20261102150000_learn_contact_separation.sql').read_text()
  report['sourceSha256']=hashlib.sha256(source.encode()).hexdigest()
  target.query('set role postgres;'+source.replace('\ncommit;','\nrollback;'))
  if schema()!=before_schema:raise RecoveryError('Schema rollback changed baseline')
  report['transactionRollback']=True
  target.query('set role postgres;'+source)
  write_private(out/'after-schema.json',json.loads(schema()));print('Migration compiled; running contact-separation and operator journeys',flush=True)
  fixture=(root/'learn-commusoft-contacts-projection.assert.sql').read_text()
  # Native auth's signup trigger already creates profiles; preserve that behaviour.
  fixture=fixture.replace("(fixture_id(81),fixture_id(1),'viewer');","(fixture_id(81),fixture_id(1),'viewer') on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;",1)
  target.query('set role postgres;set search_path=public,extensions;begin;'+fixture+(root/'learn-contact-separation.assert.sql').read_text()+(root/'learn-contact-separation-identity.assert.sql').read_text()+'rollback;')
  for regression in ['learn-identity-delivery.assert.sql','learn-identity-review.assert.sql']:
   target.query('set role postgres;set search_path=public,extensions;begin;'+(root/regression).read_text()+'rollback;')
  report['existingIdentityRegressions']='passed'
  definitions=target.query("select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'hash',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.proname),'[]') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in('learn_commusoft_work_batch','learn_commusoft_separate_contact','learn_identity_deliver_internal','learn_identity_shared_contact_channel');")
  write_private(out/'candidate-functions.json',json.loads(definitions))
  report['journeys']=['original_contact_projection','shared_channel_distinct_people','complete_candidate_snapshot','changed_source_name','exact_replay_and_conflict','cancel_fence','invalid_endpoint_no_orphan','retained_original_people_and_channels','tenant_viewer_and_private_helper_denial','logged_operator_publication','late_receipt_rollback','late_operator_audit_rollback','revoked_operator_denied','shared_endpoint_identity_hold','reviewed_identity_attribution','source_region_and_tenant_isolation']
  report['sourcePreservation']=compare_native_data(before,without_ledger(restored_fingerprints(target)))
  report['state']='passed';report['containmentAfter']=target.verify_boundary()
except Exception as e:
 report['state']='failed';report['errorType']=type(e).__name__
finally:
 report['containerRemoved']=bool(target and target.cleaned)
 write_private(out/'report.json',report)
 print(json.dumps(report),flush=True)
if report['state']!='passed':sys.exit(1)
