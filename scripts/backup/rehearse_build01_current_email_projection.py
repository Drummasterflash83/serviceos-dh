"""Isolated, synthetic test of the current-Email selector on retained schema."""
import hashlib
import json
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from database_restore_sandbox import RestoreSandbox, RecoveryError
from inspect_production_release_baseline import prepare_archive_roles

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / '.verification-results/production-database-daily-20261015-911be91a-8569-4fa6-ab26-cac68014a999'
ARCHIVE = SOURCE / 'database.dump'
EXPECTED = {'bytes': 1179050190,
            'sha256': '31f1e594e9c3b43f3cff0ec0c45095216a4bb6580e8a0e5f2a4a81db99c03fe8'}
MIGRATION = ROOT / 'supabase/migrations/20261104130000_learn_email_current_projection_lane.sql'


def run():
    digest = hashlib.sha256()
    with ARCHIVE.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if ARCHIVE.stat().st_size != EXPECTED['bytes'] or digest.hexdigest() != EXPECTED['sha256']:
        raise RecoveryError('Pinned archive changed')
    inventory = json.loads((SOURCE / 'source-inventory.json').read_text())
    report = {'version': 'learn-build01-current-email-isolated/1',
              'archiveSha256': EXPECTED['sha256'], 'network': 'none',
              'hostPorts': 0, 'productionWrites': False, 'providerRequests': 0,
              'customerContentPrinted': False, 'containerRemoved': False}
    target = RestoreSandbox(network_extension=True,
                            private_diagnostics=SOURCE / 'current-email-private-error')
    try:
        with target:
            prepare_archive_roles(target, inventory)
            if target.restore_native_archive(ARCHIVE) != EXPECTED:
                raise RecoveryError('Archive restore receipt changed')
            target.query(MIGRATION.read_text())
            tenant = str(uuid.uuid4())
            current = str(uuid.uuid4())
            old = str(uuid.uuid4())
            draft = str(uuid.uuid4())
            fixture_sql = f"""
            insert into public.tenants(id,slug,display_name)
             values('{tenant}'::uuid,'build01-current-{tenant[:8]}','Synthetic current Email');
            insert into public.email_messages(id,tenant_id,provider,provider_message_id,
             received_at,created_at,from_email,to_emails,subject,snippet,direction,raw_payload)
            values
             ('{current}'::uuid,'{tenant}'::uuid,'gmail','synthetic-current-{current}',
              now()-interval '1 hour',now(),'customer@example.invalid','[]',
              'Synthetic current message','Synthetic only','inbound','{{}}'),
             ('{old}'::uuid,'{tenant}'::uuid,'gmail','synthetic-old-{old}',
              now()-interval '2 days',now(),'customer@example.invalid','[]',
              'Synthetic old message','Synthetic only','inbound','{{}}'),
             ('{draft}'::uuid,'{tenant}'::uuid,'gmail','synthetic-draft-{draft}',
              now()-interval '1 hour',now(),'customer@example.invalid','[]',
              'Synthetic draft','Synthetic only','outbound','{{"label_ids":["DRAFT"]}}');
            """
            target.query(fixture_sql)

            def selected_rows():
                return target.query(f"""
            begin;
            set local role service_role;
            set local request.jwt.claim.role='service_role';
            select source_kind||'|'||source_id::text||'|'||source_revision
             from public.learn_projection_pending_current_email('{tenant}'::uuid,50);
            commit;
            """).splitlines()

            selected = selected_rows()
            if len(selected) != 1:
                raise RecoveryError('Current Email selector included old or draft mail')
            kind, source_id, revision = selected[0].split('|')
            if kind != 'email' or source_id != current or len(revision) != 64 \
                    or any(char not in '0123456789abcdef' for char in revision):
                raise RecoveryError('Current Email selector revision changed')
            target.query(f"""
            insert into public.learn_interaction_projection_receipts
              (request_id,tenant_id,source_kind,source_id,source_revision,receipt)
            values(gen_random_uuid(),'{tenant}'::uuid,'email','{current}'::uuid,
                   '{revision}','{{"state":"review_required"}}');
            """)
            if selected_rows():
                raise RecoveryError('Current Email revision hold ignored')
            target.query(f"update public.email_messages set snippet='Synthetic changed revision' "
                         f"where id='{current}'::uuid;")
            changed = selected_rows()
            if len(changed) != 1 or changed[0].split('|')[1] != current \
                    or changed[0].split('|')[2] == revision:
                raise RecoveryError('Changed current Email source did not reenter')
            if target.query("select has_function_privilege('authenticated',"
                "'public.learn_projection_pending_current_email(uuid,integer)'::regprocedure,"
                "'EXECUTE')::text||'|'||has_function_privilege('service_role',"
                "'public.learn_projection_pending_current_email(uuid,integer)'::regprocedure,"
                "'EXECUTE')::text;") != 'false|true':
                raise RecoveryError('Current Email selector ACL changed')
            report.update(state='isolated_current_email_selector_verified',
                          currentSelected=True, olderAndDraftExcluded=True,
                          reviewHoldRetained=True, changedSourceReentered=True,
                          serviceOnly=True, boundary=target.verify_boundary())
    finally:
        report['containerRemoved'] = target.cleaned
    if not target.cleaned:
        raise RecoveryError('Isolated database cleanup unconfirmed')
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        run()
    except (RecoveryError, OSError, ValueError, KeyError):
        print(json.dumps({'state': 'current_email_isolated_unverified',
                          'customerContentPrinted': False, 'productionWrites': False}))
        raise SystemExit(1)
