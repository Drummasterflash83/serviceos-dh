import copy, unittest
from voicemail_database_recovery import expected_pair, compare_relationships, compare_restore_receipt
class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.raw={'sourceBucket':'learn-voicemail-sources','sourceKey':'tenant/intake/source.eml','tenantId':'tenant','recordingIds':['source'],'objectId':'raw','sourceContentSha256':'rawhash','size':5}
  self.audio={'sourceBucket':'receptionist-voicemails','sourceKey':'tenant/mailbox/intake','tenantId':'tenant','recordingIds':['intake'],'objectId':'audio','sourceContentSha256':'audiohash','size':6}
  self.p=expected_pair([self.raw,self.audio]); self.rows={'intake':{'id':'intake','tenant_id':'tenant','mailbox_id':'mailbox','state':'published','audio_sha256':'audiohash','audio_bytes':6},'source':{'id':'source','tenant_id':'tenant','intake_id':'intake','raw_sha256':'rawhash','raw_bytes':5},'voicemail':{'id':'intake','tenant_id':'tenant','mailbox_id':'mailbox','recording_path':'tenant/mailbox/intake'},'rawStorage':{'id':'raw','bucket_id':'learn-voicemail-sources','name':'tenant/intake/source.eml'},'audioStorage':{'id':'audio','bucket_id':'receptionist-voicemails','name':'tenant/mailbox/intake'}}
 def test_exact_pair_and_every_relationship_field(self):
  self.assertTrue(compare_relationships(self.p,self.rows)['databaseRecoveryVerified'])
  for row in self.rows:
   for field in self.rows[row]:
    changed=copy.deepcopy(self.rows);changed[row][field]='changed'
    self.assertFalse(compare_relationships(self.p,changed)['databaseRecoveryVerified'],(row,field))
 def test_missing_snapshot_rows_never_pass(self):
  for row in self.rows:
   changed=copy.deepcopy(self.rows);del changed[row]
   self.assertFalse(compare_relationships(self.p,changed)['databaseRecoveryVerified'])
 def test_unpaired_and_tenant_mismatch_rejected(self):
  for field,value in [('sourceKey','tenant/other/source.eml'),('tenantId','other'),('recordingIds',['other'])]:
   changed=copy.deepcopy(self.raw);changed[field]=value
   with self.assertRaises(ValueError):expected_pair([changed,self.audio])
 def test_restored_bytes_decode_and_no_source_requirement(self):
  receipt={'state':'independent_pair_restored_and_verified','sourceAccessDuringRestore':False,'privateContentRemoved':True,'proofs':[{'sourceBucket':e['sourceBucket'],'objectId':e['objectId'],'bytes':e['size'],'sha256':e['sourceContentSha256'],'playback':{'state':'decoded','frames':8000,'sampleRate':8000,'durationSeconds':1}} for e in [self.raw,self.audio]]}
  self.assertTrue(compare_restore_receipt(self.p,receipt)['decoded'])
  for key in ['sha256','bytes','objectId']:
   changed=copy.deepcopy(receipt);changed['proofs'][0][key]='changed'
   with self.assertRaises(ValueError):compare_restore_receipt(self.p,changed)
  changed=copy.deepcopy(receipt);changed['sourceAccessDuringRestore']=True
  with self.assertRaises(ValueError):compare_restore_receipt(self.p,changed)
  changed=copy.deepcopy(receipt);changed['proofs'][1]['playback']['frames']=0
  with self.assertRaises(ValueError):compare_restore_receipt(self.p,changed)
  self.assertFalse(compare_restore_receipt(self.p,None)['filesVerified'])
if __name__=='__main__':unittest.main()
