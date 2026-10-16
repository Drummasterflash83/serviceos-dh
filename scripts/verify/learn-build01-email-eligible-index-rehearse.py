"""Offline, private-data-safe rehearsal of a partial email projection index.

The production archive is restored to a disposable network-isolated container.
Only aggregate plan counters and an exact-result equality flag are printed.
This script never connects to LIVE or installs a production index.
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backup'))
from database_restore_sandbox import RecoveryError, RestoreSandbox
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_build01_auth_service_recovery import SOURCE, ARCHIVE, EXPECTED_ARCHIVE, DB_IMAGE, DB_IMAGE_ID

TENANT = '00000000-0000-0000-0000-000000000001'
PRIVATE_DIAGNOSTIC = Path('.verification-results/build01-email-index-private-error')
SELECTION = f"""select m.id from public.email_messages m
 where m.tenant_id='{TENANT}'::uuid
 and not coalesce(m.provider='gmail' and
   m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
 and not exists(select 1 from public.interactions i
   where i.tenant_id=m.tenant_id and i.source_table='email_messages'
   and i.source_id=m.id)
 order by coalesce(m.received_at,m.sent_at,m.created_at),m.id limit 200"""
INDEX = """create index learn_email_projection_eligible_order_idx
 on public.email_messages
 (tenant_id,(coalesce(received_at,sent_at,created_at)),id)
 where not coalesce(provider='gmail' and
   raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)"""


def selected_digest(target):
    sql = "select coalesce(md5(string_agg(id::text,',' order by id)),md5('')) from (" + \
          SELECTION + ") selected;"
    value = target.query(sql)
    if len(value) != 32 or any(c not in '0123456789abcdef' for c in value):
        raise RecoveryError('Selection digest shape changed')
    return value


def measured_plan(target):
    plan = json.loads(target.query('explain (analyze,buffers,format json) ' + SELECTION))[0]
    nodes = []

    def visit(node):
        nodes.append({
            'kind': node.get('Node Type'),
            'relation': node.get('Relation Name'),
            'index': node.get('Index Name'),
            'actualRows': node.get('Actual Rows'),
            'heapFetches': node.get('Heap Fetches'),
            'sharedRead': node.get('Shared Read Blocks'),
            'sharedHit': node.get('Shared Hit Blocks'),
        })
        for child in node.get('Plans', []):
            visit(child)

    visit(plan['Plan'])
    return {'executionMs': plan['Execution Time'], 'nodes': nodes}


def main():
    digest = hashlib.sha256()
    with ARCHIVE.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    if {'bytes': ARCHIVE.stat().st_size, 'sha256': digest.hexdigest()} != EXPECTED_ARCHIVE:
        raise RecoveryError('Reviewed archive pin differs')
    target = RestoreSandbox(image=DB_IMAGE, network_extension=True,
                            private_diagnostics=PRIVATE_DIAGNOSTIC)
    result = {'version': 'learn-build01-email-eligible-index-rehearsal/1',
              'state': 'unverified', 'productionWrites': False,
              'sourceProviderRequests': 0, 'privateRowsPrinted': False}
    try:
        with target:
            if target.image_id != DB_IMAGE_ID:
                raise RecoveryError('Reviewed database image pin differs')
            prepare_archive_roles(target, json.loads((SOURCE / 'source-inventory.json').read_text()))
            if target.restore_native_archive(ARCHIVE) != EXPECTED_ARCHIVE:
                raise RecoveryError('Archive restore digest differs')
            target.verify_boundary()
            # Equalize relation statistics before both plans; otherwise a
            # post-index ANALYZE alone could explain a plan improvement.
            target.query('analyze public.email_messages;')
            before_digest = selected_digest(target)
            result['beforeCold'] = measured_plan(target)
            result['beforeWarm'] = measured_plan(target)
            target.query(INDEX + ';analyze public.email_messages;')
            after_digest = selected_digest(target)
            result['afterCold'] = measured_plan(target)
            result['afterWarm'] = measured_plan(target)
            result['exactSelectionPreserved'] = before_digest == after_digest
            result['indexValid'] = target.query("select indisvalid from pg_index where indexrelid='public.learn_email_projection_eligible_order_idx'::regclass;") == 't'
            result['containment'] = target.verify_boundary()
            if not result['exactSelectionPreserved'] or not result['indexValid']:
                raise RecoveryError('Index selection or catalog readback differs')
            result['state'] = 'isolated_index_compared'
        result['containerRemoved'] = target.cleaned
        summary = {key: {
            'executionMs': result[key]['executionMs'],
            'emailIndex': next((node['index'] for node in result[key]['nodes']
                                if node['relation'] == 'email_messages'), None),
            'sharedRead': result[key]['nodes'][0]['sharedRead'],
            'sharedHit': result[key]['nodes'][0]['sharedHit'],
            'interactionHeapFetches': sum(node['heapFetches'] or 0
                                          for node in result[key]['nodes']
                                          if node['relation'] == 'interactions'),
        } for key in ('beforeCold', 'beforeWarm', 'afterCold', 'afterWarm')}
        print(json.dumps({
            'version': result['version'], 'state': result['state'],
            'exactSelectionPreserved': result['exactSelectionPreserved'],
            'indexValid': result['indexValid'], 'measurements': summary,
            'containerRemoved': result['containerRemoved'],
            'productionWrites': False, 'privateRowsPrinted': False,
        }))
    except BaseException:
        result['containerRemoved'] = target.cleaned
        print(json.dumps({k: result[k] for k in ('version', 'state', 'productionWrites',
                                               'sourceProviderRequests', 'privateRowsPrinted',
                                               'containerRemoved')}))
        raise


if __name__ == '__main__':
    main()
