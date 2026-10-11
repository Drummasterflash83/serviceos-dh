"""Real PostgreSQL dump/restore with synthetic rows; no customer/source access."""
import hashlib
import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from database_restore_sandbox import RecoveryError, RestoreSandbox

SCHEMA = """
create schema recovery_fixture;
create role recovery_reader nologin;
grant usage on schema recovery_fixture to recovery_reader;
create table recovery_fixture.customers (
  id int primary key, tenant_id int not null, unique(id, tenant_id));
create table recovery_fixture.recordings (
  id int primary key, tenant_id int not null, customer_id int not null,
  object_path text not null, transcript_state text not null,
  foreign key (customer_id,tenant_id) references recovery_fixture.customers(id,tenant_id));
alter table recovery_fixture.recordings enable row level security;
create policy tenant_read on recovery_fixture.recordings to recovery_reader
  using (tenant_id = current_setting('app.tenant_id', true)::int);
grant select on recovery_fixture.recordings to recovery_reader;
create table recovery_fixture.scheduled_effects(id bigint generated always as identity);
insert into recovery_fixture.customers values(1,1),(2,2);
insert into recovery_fixture.recordings values
  (11,1,1,'synthetic/one.wav','completed'),
  (12,1,1,'synthetic/two.wav','failed'),
  (21,2,2,'synthetic/three.wav','pending');
"""
FINGERPRINT = """
select json_build_object(
 'customers', (select md5(string_agg(row_to_json(t)::text,'' order by id))
   from recovery_fixture.customers t),
 'recordings', (select md5(string_agg(row_to_json(t)::text,'' order by id))
   from recovery_fixture.recordings t),
 'orphanedRelationships', (select count(*) from recovery_fixture.recordings r
   left join recovery_fixture.customers c on (r.customer_id,r.tenant_id)=(c.id,c.tenant_id)
   where c.id is null));
"""


def verify():
    started = time.monotonic()
    report = {'scope': 'isolated-local-synthetic-dump-and-restore',
              'productionAccessed': False, 'testAccessed': False,
              'realDatabaseRecoveryProven': False, 'checks': {}}
    with tempfile.TemporaryDirectory(prefix='serviceos-db-recovery-') as private:
        os.chmod(private, 0o700)
        path = Path(private) / 'synthetic.sql'
        cron_path = Path(private) / 'cron.sql'
        # A genuinely separate source and target exercise pg_dump restoration,
        # not just applying fixtures and comparing them in one database.
        with RestoreSandbox() as source:
            source.query(SCHEMA)
            source.query('create extension pg_cron;'
                         "select cron.schedule('recovery-sentinel','1 second',"
                         "'insert into recovery_fixture.scheduled_effects default values');")
            expected = json.loads(source.query(FINGERPRINT))
            dump = source.dump_sql('recovery_fixture')
            # pg_dump --schema cron omits extension-owned configuration tables.
            # Select the configuration table and its sequence explicitly.
            cron_dump = source.dump_sql(data_only=True, tables=['cron.job', 'cron.jobid_seq'])
            with open(path, 'xb') as target_file:
                os.chmod(path, 0o600)
                target_file.write(dump)
            with open(cron_path, 'xb') as cron_file:
                os.chmod(cron_path, 0o600)
                cron_file.write(cron_dump)
            report['imageId'] = source.image_id
        assert source.cleaned
        with RestoreSandbox() as target:
            report['containment'] = target.verify_boundary()
            target.query('create role recovery_reader nologin;create extension pg_cron;')
            receipts = target.restore_sql_files([path, cron_path])
            assert receipts == [{'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                                for data in (dump, cron_dump)]
            assert json.loads(target.query(FINGERPRINT)) == expected
            assert target.query("set role recovery_reader;set app.tenant_id='1';"
                                'select string_agg(id::text,\',\' order by id) '
                                'from recovery_fixture.recordings;') == '11,12'
            assert target.query("set role recovery_reader;set app.tenant_id='2';"
                                'select string_agg(id::text,\',\' order by id) '
                                'from recovery_fixture.recordings;') == '21'
            assert target.query('set role recovery_reader;'
                                'select count(*) from recovery_fixture.recordings;') == '0'
            try:
                target.query("insert into recovery_fixture.recordings values"
                             "(99,1,2,'synthetic/wrong.wav','completed');")
            except RecoveryError:
                pass
            else:
                raise AssertionError('Cross-tenant relationship unexpectedly accepted')
            # An enabled, every-second cron job must retain its source configuration
            # without executing; both server setting and actual absence are checked.
            time.sleep(3)
            assert target.query('select count(*) from cron.job where active;') == '1'
            assert target.query('select last_value from cron.jobid_seq;') == '1'
            assert target.query('select count(*) from recovery_fixture.scheduled_effects;') == '0'
            assert target.query('select count(*) from cron.job_run_details;') == '0'
            target.verify_boundary()
        assert target.cleaned
        # SQL failure must stop later files and remove the partially loaded target.
        failure = Path(private) / 'invalid.sql'
        failure.write_text("select 'PRIVATE_CANARY'::integer;")
        os.chmod(failure, 0o600)
        failed = RestoreSandbox()
        try:
            with failed:
                failed.restore_sql_files([failure, path])
        except RecoveryError as error:
            assert 'PRIVATE_CANARY' not in str(error)
        else:
            raise AssertionError('Invalid restore unexpectedly succeeded')
        assert failed.cleaned and failed.restore_receipts == []
    report['checks'] = dict.fromkeys([
        'separateSourceAndTarget', 'sqlDumpRestored', 'allRowFingerprintsEqual',
        'recordingPointersAndFailedTranscriptStatePreserved', 'relationshipsPreserved',
        'crossTenantForeignKeyEnforced', 'tenantRlsEnforced', 'missingTenantDenied',
        'activeCronRetainedButDidNotRun', 'restoreFailureStopsAndCleans',
        'privateErrorContentsWithheld', 'allContainersRemoved', 'temporaryDumpRemoved'], True)
    report['completedAt'] = datetime.now(timezone.utc).isoformat()
    report['elapsedSeconds'] = round(time.monotonic() - started, 2)
    return report


if __name__ == '__main__':
    try:
        result = verify()
    except Exception as error:
        # Tracebacks/subprocess objects may embed rows or SQL in a real restore.
        print(json.dumps({'status': 'failed', 'errorType': type(error).__name__}))
        raise SystemExit(1)
    print(json.dumps(result, indent=2))
