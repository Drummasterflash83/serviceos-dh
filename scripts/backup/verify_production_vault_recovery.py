"""Offline decryption check; key and expected digest arrive only through stdin."""
import hashlib
import json
import sys
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from inspect_production_release_baseline import prepare_archive_roles
from restore_production_database import IMAGE, PINNED_IMAGE, write_private

ROOT = Path('.verification-results/production-database-complete-capture-small-full-2026-10-12')
report = {'version':'production-vault-recovery/1','productionWrites':False,
          'keyPersistedOnHost':False,'decryptedValuesPersisted':False,'externalUpload':False}
try:
    data = json.loads(sys.stdin.buffer.read(8192))
    key = data.pop('rootKey').encode('ascii')
    challenge = data['challenge']
    if len(challenge) != 64 or any(c not in '0123456789abcdef' for c in challenge):
        raise RecoveryError('Invalid recovery comparison challenge')
    exported = json.loads((ROOT / 'report.json').read_text())
    restored = json.loads((ROOT / 'restore-native-comparison-report.json').read_text())
    archive = ROOT / 'database.dump'
    if not restored['containerRemoved'] or not restored['allInventoriedPhysicalTablesCaptured']:
        raise RecoveryError('Completed full native restore prerequisite missing')
    if archive.stat().st_size != exported['archive']['bytes'] or hashlib.sha256(archive.read_bytes()).hexdigest() != exported['archive']['sha256']:
        raise RecoveryError('Verified archive integrity differs')
    with RestoreSandbox(image=IMAGE, network_extension=True, root_key=key) as target:
        key = b''
        if target.image_id != PINNED_IMAGE:
            raise RecoveryError('Recovery image pin differs')
        prepare_archive_roles(target, json.loads((ROOT / 'source-inventory.json').read_text()))
        report['archive'] = target.restore_native_archive(archive)
        observed = json.loads(target.query("set timezone='UTC';select json_build_object('count',count(*),"
            "'digest',md5(string_agg(id::text||':'||encode(extensions.hmac(convert_to(decrypted_secret,'UTF8'),decode('"
            + challenge + "','hex'),'sha256'),'hex'),',' order by id))) from vault.decrypted_secrets;"))
        cipher = target.query("set timezone='UTC';select md5(jsonb_agg(to_jsonb(s) order by id)::text) from vault.secrets s;")
        if cipher != data['ciphertextDigest'] or observed != data['expected'] or observed['count'] < 1:
            raise RecoveryError('Vault snapshot or decryption comparison differs')
        report.update(state='all_archived_vault_secrets_decrypt_and_match_live',
                      vaultSecretsVerified=observed['count'],ciphertextMatchesLive=True,
                      plaintextComparisonMatches=True,containment=target.verify_boundary())
    report['containerRemoved'] = target.cleaned
except Exception:
    report['state'] = 'vault_recovery_not_verified'
    report['failure'] = 'Recovery comparison failed; no secret or raw exception disclosed'
    report['containerRemoved'] = bool('target' in locals() and target.cleaned)
finally:
    key = b''
    write_private(ROOT / 'vault-recovery-report.json',report)
    print(json.dumps(report))
if report['state'] != 'all_archived_vault_secrets_decrypt_and_match_live':
    raise SystemExit(1)
