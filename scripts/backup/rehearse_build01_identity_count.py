"""Rehearse the exact identity draft-count patch in a disposable offline restore."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path('/Users/chrisdrummond/Documents/ChatGPT/ServiceOS')
sys.path.insert(0, str(ROOT / 'scripts/backup'))
from database_restore_sandbox import RestoreSandbox, RecoveryError
from inspect_production_release_baseline import prepare_archive_roles

SOURCE = ROOT / '.verification-results/production-database-daily-20261015-911be91a-8569-4fa6-ab26-cac68014a999'
ARCHIVE = SOURCE / 'database.dump'
ARCHIVE_HASH = '31f1e594e9c3b43f3cff0ec0c45095216a4bb6580e8a0e5f2a4a81db99c03fe8'
PATCH = ROOT / 'supabase/migrations/20261104030000_learn_identity_set_based_draft_count.sql'
BASELINE = '60adf2eca5be0f1c0aaa97765364eeca'
TENANT = '00000000-0000-0000-0000-000000000001'


def run():
    archive_digest = hashlib.sha256()
    with ARCHIVE.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            archive_digest.update(chunk)
    if archive_digest.hexdigest() != ARCHIVE_HASH:
        raise RecoveryError('Pinned archive changed')
    patch_bytes = PATCH.read_bytes()
    patch_hash = hashlib.sha256(patch_bytes).hexdigest()
    inventory = json.loads((SOURCE / 'source-inventory.json').read_text())
    report = {'state': 'preflight', 'patchSha256': patch_hash,
              'productionWrites': False, 'externalNetwork': False,
              'publishedPorts': 0, 'containerRemoved': False}
    target = RestoreSandbox(network_extension=True,
                            private_diagnostics=SOURCE / 'identity-count-private-error')
    try:
        with target:
            prepare_archive_roles(target, inventory)
            target.restore_native_archive(ARCHIVE)
            signature = "'public.learn_identity_deliver_internal(uuid,uuid,uuid,text,text,uuid)'::regprocedure"
            before = target.query('select md5(pg_get_functiondef(' + signature + '));')
            if before != BASELINE:
                raise RecoveryError('Offline identity baseline differs from reviewed TEST/LIVE')
            sample = target.query("select x.related_person_id::text from public.interactions x "
                "where x.tenant_id='" + TENANT + "'::uuid and x.related_person_id is not null "
                "group by x.related_person_id having count(*) between 2 and 100 "
                "order by count(*) desc,x.related_person_id limit 5;").splitlines()
            if len(sample) != 5:
                raise RecoveryError('Offline identity count sample incomplete')
            old_counts = []
            new_counts = []
            for person in sample:
                old = target.query("set statement_timeout='15s'; select count(*)::text from "
                    "public.interactions x where x.tenant_id='" + TENANT + "'::uuid "
                    "and x.related_person_id='" + person + "'::uuid and not "
                    "public.learn_interaction_is_draft(x.tenant_id,x.source_table,x.source_id);")
                new = target.query("set statement_timeout='15s'; select count(*)::text from "
                    "public.interactions x left join public.email_messages m on "
                    "x.source_table='email_messages' and m.tenant_id=x.tenant_id and m.id=x.source_id "
                    "where x.tenant_id='" + TENANT + "'::uuid and x.related_person_id='" + person + "'::uuid "
                    "and not coalesce(m.provider='gmail' and m.raw_payload->'label_ids' "
                    "@> '[\"DRAFT\"]'::jsonb,false);")
                old_counts.append(int(old.splitlines()[-1]))
                new_counts.append(int(new.splitlines()[-1]))
            if old_counts != new_counts:
                raise RecoveryError('Offline draft-count semantics differ')
            target.query(patch_bytes.decode('utf8'))
            after = target.query('select md5(pg_get_functiondef(' + signature + '));')
            if after == before:
                raise RecoveryError('Offline identity function unchanged')
            report.update(state='isolated_identity_count_patch_verified',
                          sourceDefinitionMd5=before, patchedDefinitionMd5=after,
                          sampledPeople=len(sample), sampledEligibleCounts=new_counts)
            target.verify_boundary()
        report['containerRemoved'] = target.cleaned
        if not report['containerRemoved']:
            raise RecoveryError('Offline identity container cleanup unconfirmed')
        return report
    finally:
        print(json.dumps({**report, 'containerRemoved': target.cleaned}))


if __name__ == '__main__':
    try:
        run()
    except BaseException:
        raise SystemExit(1)
