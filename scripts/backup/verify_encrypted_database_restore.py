"""Real offline PostgreSQL + age + synthetic SDK wire recovery. No live services."""
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from database_restore_sandbox import RestoreSandbox
from database_backup_package import package_snapshot, describe, canonical, write_private, PackageError
from restore_production_database import run as restore_database
from restore_database_package import recover_database_package

IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.141'
AGE = Path('/private/tmp/serviceos-age-1.3.2/age')
KEYGEN = AGE.with_name('age-keygen')
KEYGEN_SHA256 = 'c16e229245123d0ad27442317461d63915416cad0294395cd19ca93feb3211ea'
INVENTORY = """select json_build_object(
 'tables',(select json_agg(json_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner)) order by n.nspname,c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p')
 and n.nspname not like 'pg_%' and n.nspname<>'information_schema'),
 'extensions',(select json_agg(json_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname)
 from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'roles',(select json_agg(row_to_json(r) order by r.rolname) from pg_roles r where r.rolname not like 'pg_%'),
 'memberships',(select json_agg(json_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,
 'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) order by r.rolname,m.rolname)
 from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member
 join pg_roles g on g.oid=a.grantor));"""


def main():
    if describe(KEYGEN)['sha256'] != KEYGEN_SHA256:
        raise PackageError('synthetic_keygen_pin_mismatch')
    with tempfile.TemporaryDirectory(prefix='serviceos-encrypted-database-') as temp:
        root = Path(temp)
        snapshot_dir = root / 'source'
        snapshot_dir.mkdir(mode=0o700)
        key = b'12' * 32  # Public test sentinel, never a production key.
        with RestoreSandbox(image=IMAGE, network_extension=True, root_key=key) as source:
            source.query("create extension if not exists supabase_vault cascade;"
                "select vault.create_secret('synthetic-secret-recovery-only','synthetic');"
                "create extension pg_net with schema extensions;"
                "select net.http_get('https://example.invalid/never-send');"
                "create table public.email_messages(id bigint primary key, body text);"
                "insert into public.email_messages values(1,'synthetic email');"
                "alter table public.email_messages enable row level security;"
                "grant select on public.email_messages to authenticated;"
                "create table public.phone_recordings(id bigint primary key, storage_path text);"
                "insert into public.phone_recordings values(1,'synthetic.wav');"
                "alter table public.phone_recordings enable row level security;"
                "grant select on public.phone_recordings to authenticated;"
                "create schema if not exists storage;"
                "create table storage.objects(id bigint, bucket_id text, name text);"
                "insert into storage.objects values(1,'phone-recordings','synthetic.wav');")
            inventory = json.loads(source.query(INVENTORY))
            observed = source.query("select clock_timestamp()::text;")
            snapshot = {'snapshot': 'synthetic-offline-source', 'observedAt': observed, 'readOnly': 'on'}
            # There is no concurrent writer or running network worker in this fixture.
            raw = b''
            for table in ['_http_response', 'http_request_queue']:
                columns = json.loads(source.query("select json_agg(attname order by attnum) from pg_attribute "
                    "where attrelid='net." + table + "'::regclass and attnum>0 and not attisdropped;"))
                rows = source._run(source._psql(), data=('COPY net.' + table + ' TO STDOUT;').encode())
                raw += ('COPY net.' + table + ' (' + ', '.join(columns) + ') FROM stdin;\n').encode() + rows + b'\\.\n'
            seq = json.loads(source.query("select json_build_object('lastValue',last_value,'isCalled',is_called) from net.http_request_queue_id_seq;"))
            raw += ("SELECT pg_catalog.setval('net.http_request_queue_id_seq', " + str(seq['lastValue'])
                    + ', ' + str(seq['isCalled']).lower() + ');\n').encode()
            write_private(snapshot_dir / 'net-tables.sql', raw)
            write_private(snapshot_dir / 'database.dump', source._run(['exec', source.name, 'pg_dump',
                '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '--format=custom']))
            cipher = source.query("select md5(jsonb_agg(to_jsonb(s) order by id)::text) from vault.secrets s;")
            assert source.query('select count(decrypted_secret) from vault.decrypted_secrets;') == '1'
            assert source.query("select count(*) from pg_stat_activity where backend_type like 'pg_net%';") == '0'
        assert source.cleaned
        write_private(snapshot_dir / 'source-inventory.json', canonical(inventory))
        archive = describe(snapshot_dir / 'database.dump')
        write_private(snapshot_dir / 'report.json', canonical({'project': 'tgbnakbxwcqjeimygroz',
            'state': 'export_complete_restore_unverified', 'productionDataWrites': False,
            'snapshot': snapshot, 'archive': archive, 'netSupplement': {
                **describe(snapshot_dir / 'net-tables.sql'), 'format': 'native-postgresql-copy',
                'tables': ['_http_response', 'http_request_queue'], 'rowsUseExportedSnapshot': True}}))
        first = root / 'initial-restore'
        first.mkdir(mode=0o700)
        restored = restore_database(source_root=snapshot_dir, evidence_root=first, compare_native=True,
                                    vault_root_key=key, expected_vault_count=1)
        write_private(snapshot_dir / 'restore-native-comparison-report.json', canonical(restored))
        # Establish the exact ciphertext + plaintext prerequisite using a new
        # keyed container, independently of the packaged recovery runner.
        from inspect_production_release_baseline import prepare_archive_roles
        with RestoreSandbox(image=IMAGE, network_extension=True, root_key=key) as before:
            prepare_archive_roles(before, inventory)
            before.restore_native_archive(snapshot_dir / 'database.dump')
            assert before.query("select md5(jsonb_agg(to_jsonb(s) order by id)::text) from vault.secrets s;") == cipher
            expected_digest = hashlib.sha256(b'synthetic-secret-recovery-only').hexdigest()
            assert before.query("select encode(extensions.digest(decrypted_secret,'sha256'),'hex') from vault.decrypted_secrets;") == expected_digest
            boundary = before.verify_boundary()
        assert before.cleaned
        write_private(snapshot_dir / 'vault-recovery-report.json', canonical({'archive': archive,
            'state': 'all_archived_vault_secrets_decrypt_and_match_live', 'vaultSecretsVerified': 1,
            'ciphertextMatchesLive': True, 'plaintextComparisonMatches': True,
            'containerRemoved': True, 'productionWrites': False, 'containment': boundary,
            'scope': 'Synthetic offline source; no live provider'}))
        generated = subprocess.run([str(KEYGEN)], capture_output=True, timeout=10, check=True)
        identity = generated.stdout
        recipient = subprocess.run([str(KEYGEN), '-y'], input=identity,
            capture_output=True, timeout=10, check=True).stdout.decode().strip()
        encrypted = root / 'snapshot.age'
        descriptor = package_snapshot(snapshot_dir, encrypted, recipient=recipient,
                                      revision='a' * 40, age=AGE)
        write_private(root / 'descriptor.json', canonical(descriptor))
        node = """
import { readFile } from 'node:fs/promises';
import { fixture } from './scripts/backup/test-support/s3-fixture.mjs';
import { uploadDatabasePackage, downloadDatabasePackage } from './scripts/backup/database-backup-transfer.mjs';
const [path, meta, output] = process.argv.slice(1);
const d = JSON.parse(await readFile(meta, 'utf8')); const f = fixture({database:true});
try { const copied=await uploadDatabasePackage(path,d,f,{now:f.now});
 await downloadDatabasePackage(copied.receipt,output,f,{now:f.now});
 console.log(JSON.stringify({storedObjects:f.objects.size,realAWSRequests:false}));
} finally {f.close();}
"""
        wire = subprocess.run(['node', '--input-type=module', '--eval', node, str(encrypted),
            str(root / 'descriptor.json'), str(root / 'downloaded.age')],
            cwd=Path(__file__).resolve().parents[2], capture_output=True, timeout=30)
        if wire.returncode or json.loads(wire.stdout)['storedObjects'] != 2:
            raise PackageError('synthetic_transport_failed')
        recovery_input = {'encryptedPath': str(root / 'downloaded.age'),
            'destination': str(root / 'restored'), 'descriptor': descriptor,
            'ageIdentity': identity.decode('ascii'), 'rootKey': key.decode('ascii'), 'agePath': str(AGE)}
        recovered = subprocess.run(['python3', '-B', 'scripts/backup/restore_database_package.py'],
            input=canonical(recovery_input), capture_output=True, timeout=180)
        if recovered.returncode:
            raise PackageError('synthetic_stdin_recovery_failed')
        assert key not in recovered.stdout + recovered.stderr
        assert identity not in recovered.stdout + recovered.stderr
        result = json.loads(recovered.stdout.splitlines()[-1])
        assert result['state'] == 'encrypted_package_database_and_vault_restored'
        assert result['vaultSecretsVerified'] == 1 and result['originalPackageFilesUnchanged']
        try:
            recover_database_package(root / 'downloaded.age', root / 'wrong-root-key',
                expected=descriptor, identity=identity, root_key=b'34' * 32, age=AGE)
        except (PackageError, SystemExit):
            wrong = json.loads((root / 'wrong-root-key/verification/restore-native-comparison-report.json').read_text())
            assert wrong['containerRemoved'] and not wrong['vaultDecryptionProven']
        else:
            raise AssertionError('Wrong root key unexpectedly accepted')
        print(json.dumps({'state': 'synthetic_encrypted_database_restore_verified',
            'realAWSRequests': False, 'productionRequests': False, 'wrongVaultKeyRejected': True,
            'allContainersRemoved': True, 'encryptedBytes': descriptor['bytes'],
            'recovery': result}))


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print(json.dumps({'state': 'synthetic_encrypted_database_restore_failed', 'rawDetailsWithheld': True}))
        raise SystemExit(1) from None
