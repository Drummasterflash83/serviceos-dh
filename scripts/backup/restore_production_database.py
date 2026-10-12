"""Restore the reviewed real native archive into one disposable offline database.

No source credentials, network access, external destination or source SQL writes.
Private reports contain metadata/hashes only. Never print source rows or SQL errors.
"""
import hashlib
import json
import os
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox

ROOT = Path('.verification-results/production-database-export-2026-10-12')
IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.141'
PINNED_IMAGE = 'sha256:ba10e934f0a59990379f78ab9ed93926f1c291dd61a12fe4026f4202f1b89770'


def ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def write_private(path, value):
    tmp = path.with_suffix('.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, indent=2)
        f.write('\n')
    os.replace(tmp, path)


def run():
    report_path = ROOT / 'restore-v3-report.json'
    # An interrupted prior restore must be inspected, not silently restarted.
    fd = os.open(ROOT / 'restore-v3-started', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    report = {'version': 'production-native-restore/1', 'state': 'preflight',
              'destination': 'new_offline_container', 'productionWrites': False,
              'applicationAcceptanceProven': False, 'vaultDecryptionProven': False}
    started = time.monotonic()
    target = None
    try:
        export = json.loads((ROOT / 'report.json').read_text())
        if export['state'] not in ('export_complete_restore_unverified', 'fingerprinting_source_snapshot') or 'archive' not in export:
            raise RecoveryError('Native source archive is incomplete')
        inventory = json.loads((ROOT / 'source-inventory.json').read_text())
        baseline = ROOT / 'source-fingerprints.json'
        expected = json.loads(baseline.read_text()) if baseline.exists() else None
        report['sourceComparisonBaselineAvailable'] = expected is not None
        report['knownArchiveOmissions'] = ['net._http_response', 'net.http_request_queue']
        if expected is not None and len(expected) != len(inventory['tables']):
            raise RecoveryError('Source comparison baseline incomplete')
        archive = ROOT / 'database.dump'
        h = hashlib.sha256()
        with archive.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                h.update(chunk)
        if {'bytes': archive.stat().st_size, 'sha256': h.hexdigest()} != export['archive']:
            raise RecoveryError('Source archive integrity mismatch')
        report['sourceArchive'] = export['archive']
        report['sourceSnapshot'] = export['snapshot']
        target = RestoreSandbox(image=IMAGE, private_diagnostics=ROOT / 'restore-private-error', network_extension=True)
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Production-matching image pin differs')
            report['imageId'] = target.image_id
            report['containmentBefore'] = target.verify_boundary()
            report['state'] = 'preparing_local_roles'
            write_private(report_path, report)
            # Cluster roles are not included in a database archive. Recreate the
            # source attributes/memberships locally, without any role passwords.
            existing = set(json.loads(target.query('select json_agg(rolname) from pg_roles;')))
            for role in inventory['roles']:
                name = ident(role['rolname'])
                if role['rolname'] not in existing:
                    target.query('create role ' + name + ' nologin;')
                attributes = []
                for field, token in [('rolsuper', 'SUPERUSER'), ('rolinherit', 'INHERIT'),
                                     ('rolcreaterole', 'CREATEROLE'), ('rolcreatedb', 'CREATEDB'),
                                     ('rolcanlogin', 'LOGIN'), ('rolreplication', 'REPLICATION'),
                                     ('rolbypassrls', 'BYPASSRLS')]:
                    attributes.append(token if role[field] else 'NO' + token)
                target.query('alter role ' + name + ' with ' + ' '.join(attributes)
                             + ' connection limit ' + str(int(role['rolconnlimit']))
                             + ' valid until ' + literal(role['rolvaliduntil'] or 'infinity') + ';')
                for setting in role.get('rolconfig') or []:
                    key, value = setting.split('=', 1)
                    target.query('alter role ' + name + ' set ' + ident(key) + ' to ' + literal(value) + ';')
            for m in inventory['memberships'] or []:
                target.query('grant ' + ident(m['role']) + ' to ' + ident(m['member'])
                             + ' with admin ' + str(m['admin']).lower()
                             + ', inherit ' + str(m['inherit']).lower()
                             + ', set ' + str(m['set']).lower()
                             + ' granted by ' + ident(m['grantor']) + ';')
            report['state'] = 'restoring_native_archive'
            write_private(report_path, report)
            print(json.dumps({'stage': report['state']}), flush=True)
            report['restoreReceipt'] = target.restore_native_archive(archive)
            if export.get('netSupplement'):
                supplement = ROOT / 'net-tables.sql'
                raw = supplement.read_bytes()
                proof = export['netSupplement']
                if len(raw) != proof['bytes'] or hashlib.sha256(raw).hexdigest() != proof['sha256']:
                    raise RecoveryError('Network table supplement integrity mismatch')
                target.restore_sql_files([supplement])
                report['knownArchiveOmissions'] = []
            report['state'] = 'verifying_all_table_fingerprints'
            write_private(report_path, report)
            actual = []
            comparisons = expected if expected is not None else [
                {'schema': x['schema'], 'table': x['name']} for x in inventory['tables']]
            for table in comparisons:
                qualified = ident(table['schema']) + '.' + ident(table['table'])
                query = ("set timezone='UTC';set datestyle='ISO, MDY';set extra_float_digits=3;"
                         "set bytea_output='hex';select json_build_object('schema',"
                         + literal(table['schema']) + ",'table'," + literal(table['table'])
                         + ",'rows',count(*),'fingerprint',md5(coalesce(string_agg("
                         "md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))) from only "
                         + qualified + ' t;')
                observed = json.loads(target.query(query))
                actual.append(observed)
                if expected is not None and observed != table:
                    write_private(ROOT / 'restore-fingerprints.json', actual)
                    report['mismatch'] = {'schema': table['schema'], 'table': table['table'],
                                          'expectedRows': table['rows'], 'actualRows': observed['rows']}
                    raise RecoveryError('Source snapshot and restored table differ')
                if len(actual) % 25 == 0:
                    print(json.dumps({'stage': report['state'], 'tablesRead': len(actual)}), flush=True)
            write_private(ROOT / 'restore-fingerprints.json', actual)
            report['tablesMatched'] = len(actual) if expected is not None else 0
            report['tablesRead'] = len(actual)
            # Read back schema boundaries, owners and extension versions.
            tables = json.loads(target.query("select json_agg(json_build_object('schema',n.nspname,"
                "'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,"
                "'owner',pg_get_userbyid(c.relowner)) order by n.nspname,c.relname) from pg_class c "
                "join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') "
                "and n.nspname not like 'pg_%' and n.nspname<>'information_schema';"))
            if tables != inventory['tables']:
                raise RecoveryError('Restored table ownership or RLS catalog differs')
            extensions = json.loads(target.query("select json_agg(json_build_object('name',e.extname,"
                "'version',e.extversion,'schema',n.nspname) order by e.extname) from pg_extension e "
                "join pg_namespace n on n.oid=e.extnamespace;"))
            wanted = [{k: x[k] for k in ('name', 'version', 'schema')} for x in inventory['extensions']]
            if extensions != wanted:
                raise RecoveryError('Restored extension versions differ')
            report['tableCatalogMatched'] = True
            report['extensionVersionsMatched'] = True
            # Absence of an authenticated actor must not expose retained inputs.
            report['noActorRows'] = json.loads(target.query("set role authenticated;"
                "select json_build_object('emails',(select count(*) from public.email_messages),"
                "'recordings',(select count(*) from public.phone_recordings));"))
            if any(report['noActorRows'].values()):
                raise RecoveryError('Restored inputs exposed without an authenticated actor')
            report['recordingRelationships'] = json.loads(target.query("select json_build_object("
                "'recordings',count(*),'withObjectPath',count(storage_path),"
                "'missingStorageMetadata',count(*) filter(where storage_path is not null and not exists "
                "(select 1 from storage.objects o where o.bucket_id='phone-recordings' and o.name=r.storage_path))) "
                "from public.phone_recordings r;"))
            report['containmentAfter'] = target.verify_boundary()
            report['state'] = ('native_archive_restored_full_recovery_unverified' if expected is None
                               else 'native_records_restore_verified_application_recovery_incomplete')
        report['containerRemoved'] = target.cleaned
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        write_private(report_path, report)
        print(json.dumps({k: report[k] for k in ('state', 'tablesMatched', 'tableCatalogMatched',
            'extensionVersionsMatched', 'noActorRows', 'recordingRelationships', 'containerRemoved', 'elapsedSeconds')}))
    except Exception as error:
        report['failure'] = str(error) if isinstance(error, RecoveryError) else 'Restore stopped; raw error withheld'
        report['containerRemoved'] = bool(target and target.cleaned)
        write_private(report_path, report)
        print(json.dumps({'state': report['state'], 'failure': report['failure'],
                          'containerRemoved': report['containerRemoved']}))
        raise SystemExit(1) from None


if __name__ == '__main__':
    run()
