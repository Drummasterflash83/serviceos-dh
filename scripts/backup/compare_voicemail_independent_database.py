"""One existing independent snapshot, isolated restore; no network/data acquisition."""
import argparse,hashlib,json,os,re,sys
from pathlib import Path
from database_restore_sandbox import RestoreSandbox,RecoveryError
from inspect_production_release_baseline import prepare_archive_roles
from restore_production_database import IMAGE,PINNED_IMAGE,literal,write_private
from voicemail_database_recovery import expected_pair,compare_relationships,compare_restore_receipt
R=Path('.verification-results').resolve()
def arguments():
 parser=argparse.ArgumentParser(description=__doc__)
 for name in ('snapshot','manifest-sha256','file-execution-config','config-sha256','output'):
  parser.add_argument('--'+name,required=True)
 args=parser.parse_args()
 for name in ('manifest_sha256','config_sha256'):
  if not re.fullmatch(r'[a-f0-9]{64}',getattr(args,name)):raise RecoveryError('Expected exact artifact hash')
 for name in ('snapshot','file_execution_config','output'):
  p=Path(getattr(args,name)).absolute()
  if p.resolve()!=p or not str(p).startswith(str(R)+'/'):raise RecoveryError('Expected private nonsymlink artifact path')
  setattr(args,name,p)
 if not re.fullmatch(r'database-backup-[a-f0-9-]{36}/restore-[a-f0-9-]{36}/snapshot',str(args.snapshot.relative_to(R))):raise RecoveryError('Expected independently restored snapshot')
 return args
def read_pin(path,pin):
 b=path.read_bytes()
 if hashlib.sha256(b).hexdigest()!=pin:raise RecoveryError('Local artifact pin differs')
 return json.loads(b)
def main():
 args=arguments();SNAP=args.snapshot;OUT=args.output
 OUT.mkdir(mode=0o700,exist_ok=False)
 report={'state':'preflight','productionChanges':False,'newDataFetched':False,'rowsSeeded':False,'migrationsApplied':False,'applicationRecoveryVerified':False}
 target=None
 try:
  m=read_pin(SNAP/'manifest.json',args.manifest_sha256)
  attempt=SNAP.parent.name.removeprefix('restore-')
  verified=json.loads((SNAP.parent.parent/('verified-'+attempt+'.json')).read_text())
  if (verified.get('state')!='independent_database_snapshot_verified' or verified.get('attempt')!=attempt
      or verified.get('independentStorageVerified') is not True or verified.get('keyEscrowReadbackVerified') is not True
      or verified.get('snapshotAt')!=m.get('snapshot',{}).get('observedAt')
      or m.get('project')!='tgbnakbxwcqjeimygroz'):raise RecoveryError('Independent restore provenance unverified')
  report['independentStorageProvenanceVerified']=True
  c=read_pin(args.file_execution_config,args.config_sha256)
  p=read_pin(Path(c['planPath']),c['planSha256'])
  entries=[]
  for selection in c['restoreSelection']:
   spec=next(s for s in p['inventories'] if s['sourceBucket']==selection['sourceBucket'])
   inv=read_pin(Path(spec['inventoryPath']),spec['inventoryFileSha256'])
   e=next(e for e in inv['objects'] if e['objectId']==selection['objectId'])
   if e['size']!=selection['bytes'] or e['sourceContentSha256']!=selection['expectedSha256']:raise RecoveryError('Selection pin differs')
   entries.append(e)
  pair=expected_pair(entries)
  report['pairInventoryBindingVerified']=True
  report['snapshotObservedAt']=m['snapshot']['observedAt']
  report['archive']=m['files']['database.dump']
  archive=SNAP/'database.dump'
  digest=hashlib.sha256()
  with archive.open('rb') as source:
   for chunk in iter(lambda:source.read(1048576),b''):digest.update(chunk)
  if archive.stat().st_size!=report['archive']['bytes'] or digest.hexdigest()!=report['archive']['sha256']:raise RecoveryError('Archive pin differs')
  inventory=read_pin(SNAP/'source-inventory.json',m['files']['source-inventory.json']['sha256'])
  target=RestoreSandbox(image=IMAGE,network_extension=True,storage_policy_hook=True,private_diagnostics=OUT/'private-error')
  with target:
   if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image pin differs')
   report['containmentBefore']=target.verify_boundary()
   prepare_archive_roles(target,inventory)
   report['archiveRestored']=target.restore_native_archive(archive)
   definitions={
    'intake':('public.receptionist_voicemail_intakes',['id','tenant_id','mailbox_id','state','audio_sha256','audio_bytes'],pair['intake']),
    'source':('public.receptionist_voicemail_sources',['id','tenant_id','intake_id','raw_sha256','raw_bytes'],pair['source']),
    'voicemail':('public.receptionist_voicemails',['id','tenant_id','mailbox_id','recording_path'],pair['intake']),
    'rawStorage':('storage.objects',['id','bucket_id','name'],pair['raw']['objectId']),
    'audioStorage':('storage.objects',['id','bucket_id','name'],pair['audio']['objectId'])}
   rows={}; availability={}
   for label,(table,fields,identity) in definitions.items():
    exists=target.query('select to_regclass('+literal(table)+') is not null;')=='t'; availability[label]=exists
    rows[label]=None
    if exists:
     fields_sql=','.join(literal(f)+',to_jsonb(t)->'+literal(f) for f in fields)
     raw=target.query('begin read only; select json_build_object('+fields_sql+') from '+table+' t where id='+literal(identity)+'::uuid; commit;')
     if raw:rows[label]=json.loads(raw)
   report['schemaAvailable']=availability
   report['databaseComparison']=compare_relationships(pair,rows)
   report['containmentAfter']=target.verify_boundary()
  receipt=Path(c['evidenceRoot'])/'paired-restore.json'
  report['pairedFileComparison']=compare_restore_receipt(pair,json.loads(receipt.read_text()) if receipt.exists() else None)
  report['state']='comparison_complete'
  report['containerRemoved']=target.cleaned
  report['remaining']=([] if report['databaseComparison']['databaseRecoveryVerified'] else ['post_import_independent_database_snapshot_and_relationship_restore']) + ([] if report['pairedFileComparison']['filesVerified'] else ['independent_file_pair_restore']) + ['human_listening_not_verified']
  write_private(OUT/'report.json',report)
  print(json.dumps(report))
 except Exception as e:
  report['state']='failed';report['failure']=str(e) if isinstance(e,RecoveryError) else 'Local comparison failed; private content withheld'
  report['containerRemoved']=bool(target and target.cleaned)
  write_private(OUT/'report.json',report);print(json.dumps(report));raise SystemExit(1)
if __name__=='__main__':main()
