"""Offline decryption check; key and expected digest arrive only through stdin."""
import hashlib
import json
import sys
import re
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from inspect_production_release_baseline import prepare_archive_roles
from restore_production_database import IMAGE, PINNED_IMAGE, write_private

ROOT = Path('.verification-results/production-database-complete-capture-small-full-2026-10-12')
report = {'version':'production-vault-recovery/1','productionWrites':False,
          'keyPersistedOnHost':False,'decryptedValuesPersisted':False,'externalUpload':False}
stage = 'input'
try:
    data = json.loads(sys.stdin.buffer.read(8192))
    source = data.pop('source',str(ROOT))
    if source != str(ROOT) and not re.fullmatch(r'\.verification-results/production-release-checkpoint-[0-9]{8}-[a-z0-9-]+',source):
        raise RecoveryError('Unreviewed private checkpoint path')
    ROOT = Path(source)
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
    if (data.get('snapshotAt') != exported['snapshot']['observedAt']
            or restored.get('nativeDataComparison', {}).get('state') != 'all_archived_copy_rows_and_sequences_match'):
        raise RecoveryError('Snapshot Vault comparison prerequisites differ')
    archived_tables = json.loads((ROOT / 'native-archive-fingerprints.json').read_text())['tables']
    restored_tables = json.loads((ROOT / 'native-restored-fingerprints.json').read_text())['tables']
    def vault_table(tables):
        matching = [t for t in tables if t.get('schema') == 'vault' and t.get('table') == 'secrets']
        if len(matching) != 1:
            raise RecoveryError('Archived Vault COPY table unavailable')
        return matching[0]
    vault_copy = vault_table(archived_tables)
    if vault_copy != vault_table(restored_tables) or vault_copy.get('rows', 0) < 1:
        raise RecoveryError('Archived Vault COPY rows differ')
    stage = 'offline_restore'
    with RestoreSandbox(image=IMAGE, network_extension=True, root_key=key) as target:
        key = b''
        if target.image_id != PINNED_IMAGE:
            raise RecoveryError('Recovery image pin differs')
        prepare_archive_roles(target, json.loads((ROOT / 'source-inventory.json').read_text()))
        report['archive'] = target.restore_native_archive(archive)
        stage = 'vault_decryption'
        observed = json.loads(target.query("set timezone='UTC';select json_build_object('count',count(*),"
            "'digest',md5(string_agg(id::text||':'||encode(extensions.hmac(convert_to(decrypted_secret,'UTF8'),decode('"
            + challenge + "','hex'),'sha256'),'hex'),',' order by id))) from vault.decrypted_secrets;"))
        cipher = target.query("set timezone='UTC';select md5(jsonb_agg(to_jsonb(s) order by id)::text) from vault.secrets s;")
        stage = 'live_comparison'
        if observed['count'] != vault_copy['rows']:
            raise RecoveryError('Vault decryption count differs from archived rows')
        matches_live = cipher == data['ciphertextDigest'] and observed == data['expected']
        changed = data.get('changedAfterSnapshot')
        if not matches_live and (type(changed) is not int or changed < 1):
            raise RecoveryError('Live Vault differs without evidenced post-snapshot change')
        report.update(
            state=('all_archived_vault_secrets_decrypt_and_match_live' if matches_live
                   else 'all_archived_vault_secrets_decrypt_and_match_archive'),
            snapshotAt=data['snapshotAt'],vaultSecretsVerified=observed['count'],
            vaultCopySha256=vault_copy['sha256'],
            ciphertextMatchesArchive=True,plaintextDecryptionVerified=True,
            ciphertextMatchesLive=matches_live,plaintextComparisonMatches=matches_live,
            liveChangedAfterSnapshotCount=changed,containment=target.verify_boundary())
    report['containerRemoved'] = target.cleaned
except Exception:
    report['state'] = 'vault_recovery_not_verified'
    report['failure'] = 'Recovery comparison failed; no secret or raw exception disclosed'
    report['failureStage'] = stage
    report['containerRemoved'] = bool('target' in locals() and target.cleaned)
finally:
    key = b''
    write_private(ROOT / 'vault-recovery-report.json',report)
    print(json.dumps(report))
if report['state'] not in ('all_archived_vault_secrets_decrypt_and_match_live',
                           'all_archived_vault_secrets_decrypt_and_match_archive'):
    raise SystemExit(1)
