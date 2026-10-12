"""Inspect Governed import prerequisites after packages 001–007 in an offline archive restore."""
import hashlib
import json
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix

OUT=Path('.verification-results/production-imports-baseline-v2')


def run():
    OUT.mkdir(mode=0o700,exist_ok=False)
    report={'state':'preflight','productionChanged':False,'hostedTestChanged':False}
    target=None
    try:
        target=RestoreSandbox(image=IMAGE,network_extension=True,private_diagnostics=OUT/'private-error')
        with target:
            if target.image_id!=PINNED_IMAGE:raise RecoveryError('Image pin differs')
            prepare_archive_roles(target,json.loads((ROOT/'source-inventory.json').read_text()))
            archive=target.restore_native_archive(ROOT/'database.dump')
            for name in ['001_launch_metadata_views','002_foundation_rules','003_measurements_work','004_governed_work_actions','005_scoring_working_time','006_slack_intake','007_capture_controls']:
                base=Path('supabase/release/learn-production')/name
                m=json.loads(base.with_suffix('.manifest.json').read_text());s=base.with_suffix('.sql').read_text()
                if hashlib.sha256(s.encode()).hexdigest()!=m['sha256'] or m['baselineArchive']!=archive:
                    raise RecoveryError('Package or archive pin differs')
                target.query(prefix(m)+s)
            catalog=json.loads(target.query("begin read only;set local search_path=public,pg_catalog;"+Path('scripts/verify/learn-release-schema-inventory.sql').read_text()+'commit;'))
            write_private(OUT/'schema.json',catalog)
            quality=json.loads(target.query("""set search_path=public,pg_catalog;select jsonb_build_object(
 'duplicatePersonCardGroups',(select count(*) from (select tenant_id,person_id from customer_cards where person_id is not null group by tenant_id,person_id having count(*)>1)x),
 'duplicateCompanyCardGroups',(select count(*) from (select tenant_id,company_id from customer_cards where person_id is null and company_id is not null group by tenant_id,company_id having count(*)>1)x),
 'foreignContactPointParents',(select count(*) from contact_points c join people p on p.id=c.person_id where c.tenant_id<>p.tenant_id));"""))
            report.update(archive=archive,quality=quality,containment=target.verify_boundary())
        report.update(containerRemoved=target.cleaned,state='offline_import_prerequisites_inspected')
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report.update(containerRemoved=bool(target and target.cleaned),failure=str(error) if isinstance(error,RecoveryError) else 'Inspection failed; private diagnostics retained')
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
