"""Compare a restored release snapshot's object versions with verified audio inventory.
No hosted/provider access and no new copy. Existing inventory verification is dated;
this is not a fresh S3 integrity check or playback acceptance.
"""
import json,hashlib
from pathlib import Path
from database_restore_sandbox import RestoreSandbox,RecoveryError
from restore_production_database import IMAGE,PINNED_IMAGE,write_private
from inspect_production_release_baseline import prepare_archive_roles
ROOT=Path('.verification-results/production-release-checkpoint-20261013-prelaunch')
AUDIO=Path('.verification-results/recording-daily/run-0pXn6z')
report={'state':'started','productionChanges':0,'providerRequests':0,'newCopies':0};target=None
try:
 exported=json.loads((ROOT/'report.json').read_text());restored=json.loads((ROOT/'restore-native-comparison-report.json').read_text())
 inventory=json.loads((AUDIO/'inventory.json').read_text());verified=json.loads((AUDIO/'result.json').read_text())
 if not restored['containerRemoved'] or not restored['allInventoriedPhysicalTablesCaptured'] or verified['state']!='inventory_verified' or inventory['runId']!=verified['runId']:raise RecoveryError('Verified source prerequisites required')
 # Hash matches the normalized inventory used by the existing copy verifier.
 objects=sorted(inventory['objects'],key=lambda x:x['objectId'])
 inventory['objects']=objects
 if hashlib.sha256(json.dumps(inventory,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()!=verified['inventorySha256']:raise RecoveryError('Audio inventory pin changed')
 with RestoreSandbox(image=IMAGE,network_extension=True,private_diagnostics=ROOT/'audio-coverage-error') as target:
  if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image differs')
  prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
  archive=target.restore_native_archive(ROOT/'database.dump')
  if archive!=exported['archive'] or restored['sourceArchive']!=archive:raise RecoveryError('Fresh archive differs')
  tenant='00000000-0000-0000-0000-000000000001'
  rows=json.loads(target.query("select jsonb_agg(jsonb_build_object('id',id,'path',storage_path) order by id) from public.phone_recordings where tenant_id='"+tenant+"';"))
  stored=json.loads(target.query("select jsonb_agg(jsonb_build_object('id',id,'path',name,'version',version,'bytes',(metadata->>'size')::bigint,'etag',metadata->>'eTag') order by id) from storage.objects where bucket_id='phone-recordings' and name like '"+tenant+"/%';"))
  idx={o['sourceKey']:o for o in objects};by_path={o['path']:o for o in stored}
  bad_refs=[r for r in rows if r['path'] not in idx or r['id'] not in idx[r['path']]['recordingIds']]
  bad_versions=[]
  for o in stored:
   e=idx.get(o['path']);v=json.loads(e['sourceVersion']) if e else []
   if not e or e['tenantId']!=tenant or e['objectId']!=o['id'] or e['size']!=o['bytes'] or v[0]!=o['version'] or str(v[1]).strip('"')!=str(o['etag']).strip('"'):bad_versions.append(o['id'])
  expected_refs={(e['sourceKey'],rid) for e in objects for rid in e['recordingIds']}
  actual_refs={(r['path'],r['id']) for r in rows}
  same_set=set(idx)==set(by_path)
  report.update(snapshotAt=exported['snapshot']['observedAt'],archive=archive,audioInventoryVerifiedAt=verified['verifiedAt'],audioInventorySha256=verified['inventorySha256'],recordingReferences=len(rows),storageObjects=len(stored),unmatchedReferences=len(bad_refs),mismatchedObjectVersions=len(bad_versions),exactObjectSet=same_set,exactReferenceSet=expected_refs==actual_refs,containment=target.verify_boundary())
  if bad_refs or bad_versions or not same_set or expected_refs!=actual_refs:raise RecoveryError('Snapshot/audio inventory coverage differs')
 report['state']='fresh_snapshot_matches_verified_audio_versions'
except Exception:
 report['state']='audio_snapshot_coverage_unverified';raise
finally:
 report['containerRemoved']=bool(target and target.cleaned)
 report['limitations']=['Binds current database snapshot to earlier verified audio inventory by exact object ID, version, ETag, size, path and recording references.','Does not redownload S3 bytes, prove current provider capture completeness or replace playback/operational backup monitoring.']
 write_private(ROOT/'audio-coverage-report.json',report)
print(json.dumps(report))
