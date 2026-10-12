"""Read release metadata from a fresh offline restore of the retained archive.

No migrations, provider calls, source connection, users or grants are created on
either hosted environment. The archive's roles exist only in the disposable DB.
This is a release-planning baseline, not a migration or service acceptance run.
"""
import hashlib
import json
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, ident, literal, write_private

OUT = Path('.verification-results/production-release-baseline-v1')


def main():
    OUT.mkdir(mode=0o700, exist_ok=False)
    report = {'state': 'preflight', 'productionChanged': False,
              'migrationAcceptanceProven': False, 'serviceRecoveryProven': False}
    started = time.monotonic()
    target = None
    try:
        archive = ROOT / 'database.dump'
        expected = {'bytes': 196872981, 'sha256': 'b76d652209ac62cf901b388a4defe3a3a839694a0252b36c8e2887a25c02efbd'}
        digest = hashlib.sha256()
        with archive.open('rb') as f:
            for part in iter(lambda: f.read(1024 * 1024), b''):
                digest.update(part)
        if {'bytes': archive.stat().st_size, 'sha256': digest.hexdigest()} != expected:
            raise RecoveryError('Reviewed archive pin differs')
        inventory = json.loads((ROOT / 'source-inventory.json').read_text())
        report['archive'] = expected
        report['archiveOmissions'] = ['net._http_response', 'net.http_request_queue']
        target = RestoreSandbox(image=IMAGE, network_extension=True, private_diagnostics=OUT / 'private-error')
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Reviewed image pin differs')
            report['containmentBefore'] = target.verify_boundary()
            existing = set(json.loads(target.query('select json_agg(rolname) from pg_roles;')))
            for role in inventory['roles']:
                name = ident(role['rolname'])
                if role['rolname'] not in existing:
                    target.query('create role ' + name + ' nologin;')
                attrs = []
                for field, token in [('rolsuper','SUPERUSER'),('rolinherit','INHERIT'),
                    ('rolcreaterole','CREATEROLE'),('rolcreatedb','CREATEDB'),
                    ('rolcanlogin','LOGIN'),('rolreplication','REPLICATION'),('rolbypassrls','BYPASSRLS')]:
                    attrs.append(token if role[field] else 'NO' + token)
                target.query('alter role ' + name + ' with ' + ' '.join(attrs) + ' connection limit '
                    + str(int(role['rolconnlimit'])) + ' valid until ' + literal(role['rolvaliduntil'] or 'infinity') + ';')
                for setting in role.get('rolconfig') or []:
                    key, value = setting.split('=', 1)
                    target.query('alter role ' + name + ' set ' + ident(key) + ' to ' + literal(value) + ';')
            for m in inventory['memberships'] or []:
                target.query('grant ' + ident(m['role']) + ' to ' + ident(m['member'])
                    + ' with admin ' + str(m['admin']).lower() + ', inherit ' + str(m['inherit']).lower()
                    + ', set ' + str(m['set']).lower() + ' granted by ' + ident(m['grantor']) + ';')
            report['state'] = 'restoring_offline_archive'
            write_private(OUT / 'report.json', report)
            print(json.dumps({'state': report['state']}), flush=True)
            report['restoreReceipt'] = target.restore_native_archive(archive)
            if report['restoreReceipt'] != expected:
                raise RecoveryError('Restored bytes differ from archive pin')
            sql = Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            metadata = json.loads(target.query("begin read only;set local search_path=public,pg_catalog;" + sql + 'commit;'))
            write_private(OUT / 'schema.json', metadata)
            # Migration names/versions only; statements can contain old secrets.
            ledger = json.loads(target.query("select coalesce(json_agg(json_build_object('version',version,'name',name) order by version),'[]') from supabase_migrations.schema_migrations;"))
            write_private(OUT / 'migration-ledger.json', ledger)
            report['objectCounts'] = {k: len(v) for k, v in metadata.items()}
            report['migrationCount'] = len(ledger)
            report['inventorySqlSha256'] = hashlib.sha256(sql.encode()).hexdigest()
            report['schemaSha256'] = hashlib.sha256(json.dumps(metadata,sort_keys=True).encode()).hexdigest()
            report['containmentAfter'] = target.verify_boundary()
            report['state'] = 'offline_release_baseline_recorded'
        report['containerRemoved'] = target.cleaned
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        write_private(OUT / 'report.json', report)
        print(json.dumps(report), flush=True)
    except Exception as error:
        report['failure'] = str(error) if isinstance(error, RecoveryError) else 'Baseline failed; private diagnostics retained'
        report['containerRemoved'] = bool(target and target.cleaned)
        write_private(OUT / 'report.json', report)
        print(json.dumps(report), flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
