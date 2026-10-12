"""Inspect Slack prerequisites after packages 001–005 in an offline archive restore."""
import hashlib
import json
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_production_rules import prefix

OUT=Path('.verification-results/production-slack-baseline-v1')


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
            for name in ['001_launch_metadata_views','002_foundation_rules','003_measurements_work','004_governed_work_actions','005_scoring_working_time']:
                base=Path('supabase/release/learn-production')/name
                m=json.loads(base.with_suffix('.manifest.json').read_text());s=base.with_suffix('.sql').read_text()
                if hashlib.sha256(s.encode()).hexdigest()!=m['sha256'] or m['baselineArchive']!=archive:
                    raise RecoveryError('Package or archive pin differs')
                target.query(prefix(m)+s)
            catalog=json.loads(target.query("begin read only;set local search_path=public,pg_catalog;"+Path('scripts/verify/learn-release-schema-inventory.sql').read_text()+'commit;'))
            write_private(OUT/'schema.json',catalog)
            registry={}
            for name in ['object_classes','domain_object_types','state_definitions','state_transitions','authority_permissions']:
                registry[name]=json.loads(target.query("select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from public."+name+' r;'))
            write_private(OUT/'registry.json',registry)
            report.update(archive=archive,registryCounts={k:len(v) for k,v in registry.items()},containment=target.verify_boundary())
        report.update(containerRemoved=target.cleaned,state='offline_slack_prerequisites_inspected')
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report.update(containerRemoved=bool(target and target.cleaned),failure=str(error) if isinstance(error,RecoveryError) else 'Inspection failed; private diagnostics retained')
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
