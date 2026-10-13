"""No Docker, network, credentials or customer rows in these CLI checks."""
import sys,unittest
from unittest.mock import patch
from compare_voicemail_independent_database import arguments,RecoveryError
class ArgumentsTests(unittest.TestCase):
 def args(self):
  return ['check','--snapshot','.verification-results/database-backup-11111111-1111-4111-8111-111111111111/restore-22222222-2222-4222-8222-222222222222/snapshot','--manifest-sha256','a'*64,'--file-execution-config','.verification-results/example.json','--config-sha256','b'*64,'--output','.verification-results/example-output']
 def test_explicit_future_snapshot_pins(self):
  with patch.object(sys,'argv',self.args()):
   a=arguments();self.assertEqual(a.manifest_sha256,'a'*64);self.assertTrue(str(a.snapshot).endswith('/snapshot'))
 def test_unpinned_or_nonindependent_locations_rejected(self):
  for index,value in [(2,'/tmp/snapshot'),(2,'.verification-results/production-release-checkpoint-20261013-voicemail-recovery'),(2,'.verification-results/a/../b'),(4,'bad'),(8,'x'*64),(10,'/tmp/output')]:
   args=self.args();args[index]=value
   with patch.object(sys,'argv',args),self.assertRaises(RecoveryError):arguments()
if __name__=='__main__':unittest.main()
