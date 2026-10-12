"""Exercise whole native-archive restore in the actual offline container boundary."""
import json
import os
import tempfile
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox
from native_copy_fingerprints import archive_fingerprints, restored_fingerprints, compare_native_data
from verify_database_restore_isolation import SCHEMA, FINGERPRINT

IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.141'

with tempfile.TemporaryDirectory(prefix='serviceos-native-recovery-') as folder:
    os.chmod(folder, 0o700)
    archive = Path(folder) / 'synthetic.dump'
    supplement = Path(folder) / 'net-data.sql'
    with RestoreSandbox(image=IMAGE, network_extension=True) as source:
        source.query(SCHEMA)
        source.query("create extension pg_cron; select cron.schedule('native-restore-sentinel',"
                     "'1 second','insert into recovery_fixture.scheduled_effects default values');")
        expected = source.query(FINGERPRINT)
        source.query("create extension pg_net with schema extensions;"
                     "select net.http_get('https://example.invalid/recovery-sentinel');")
        source_queue = source.query('select count(*) from net.http_request_queue;')
        source_workers = source.query("select count(*) from pg_stat_activity where backend_type like 'pg_net%';")
        assert source_queue == '1' and source_workers == '0', (source_queue, source_workers)
        source_roles = json.loads(source.query('select json_agg(rolname) from pg_roles;'))
        # pg_dump omits non-configuration extension-owned table data even with
        # --table. Use PostgreSQL's native COPY protocol for this explicit table.
        queued_rows = source._run(source._psql(), data=b'COPY net.http_request_queue TO STDOUT;')
        supplement.write_bytes(b'COPY net.http_request_queue FROM STDIN;\n' + queued_rows + b'\\.\n')
        supplement.chmod(0o600)
        data = source._run(['exec', source.name, 'pg_dump', '-h', '127.0.0.1',
                            '-U', 'supabase_admin', '-d', 'postgres', '--format=custom'])
        archive.write_bytes(data)
        archive.chmod(0o600)
    with RestoreSandbox(image=IMAGE, network_extension=True,
                        private_diagnostics='.verification-results/native-synthetic-restore-error') as target:
        target_roles = set(json.loads(target.query('select json_agg(rolname) from pg_roles;')))
        for role in source_roles:
            if role not in target_roles:
                target.query('create role "' + role.replace('"', '""') + '" nologin;')
        receipt = target.restore_native_archive(archive)
        archived_data = archive_fingerprints(archive, docker=target.docker, image=target.image_id)
        native_comparison = compare_native_data(archived_data, restored_fingerprints(target))
        target.restore_sql_files([supplement])
        time.sleep(3)
        restored_queue = target.query('select count(*) from net.http_request_queue;')
        assert restored_queue == '1', {'restoredQueue': restored_queue,
                                      'supplementHasCopy': b'COPY' in supplement.read_bytes()}
        assert target.query('select count(*) from net._http_response;') == '0'
        assert target.query(FINGERPRINT) == expected
        assert target.query('select count(*) from recovery_fixture.scheduled_effects;') == '0'
        assert target.query('select count(*) from cron.job where active;') == '1'
        assert target.query('select count(*) from cron.job_run_details;') == '0'
        assert target.query("set role recovery_reader;set app.tenant_id='2';"
                            'select count(*) from recovery_fixture.recordings;') == '1'
        assert target.query('set role recovery_reader;'
                            'select count(*) from recovery_fixture.recordings;') == '0'
        containment = target.verify_boundary()
        target.query("update recovery_fixture.recordings set transcript_state='tampered' where id=11;")
        try:
            compare_native_data(archived_data, restored_fingerprints(target))
        except RecoveryError:
            tamper_detected = True
        else:
            raise AssertionError('Native comparison accepted a changed archived row')
    assert source.cleaned and target.cleaned
    print(json.dumps({'scope': 'synthetic-native-whole-database-restore',
                      'sourceAndTargetRemoved': True, 'fingerprintsMatch': True,
                      'tenantRlsVerified': True, 'enabledCronDidNotRun': True,
                      'queuedNetworkRequestDidNotRun': True,
                      'nativeComparison': native_comparison, 'changedRowDetected': tamper_detected,
                      'archive': receipt, 'containment': containment}))
