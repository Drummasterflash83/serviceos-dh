"""Rehearse the first production candidate only in a disposable offline restore."""
import hashlib
import json
import time
from pathlib import Path
from database_restore_sandbox import RecoveryError, RestoreSandbox
from restore_production_database import ROOT, IMAGE, PINNED_IMAGE, write_private, literal
from inspect_production_release_baseline import prepare_archive_roles
from native_copy_fingerprints import restored_fingerprints, compare_native_data

OUT = Path('.verification-results/production-launch-rehearsal-v3')
PACKAGE = Path('supabase/release/learn-production/001_launch_metadata_views.sql')


def absent(target):
    return target.query("select to_regnamespace('of_learn_deploy') is null and not exists"
        "(select 1 from pg_roles where rolname='learn_launch_metadata_reader') and not exists"
        "(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'learn_launch_%');") == 't'


def run():
    OUT.mkdir(mode=0o700, exist_ok=False)
    report = {'state':'preflight', 'productionChanged':False, 'hostedTestChanged':False,
        'providerRequests':0, 'fullReleaseAccepted':False, 'signedInHttpVerified':False}
    target = None
    started = time.monotonic()
    try:
        manifest = json.loads(PACKAGE.with_suffix('.manifest.json').read_text())
        source = PACKAGE.read_text()
        if hashlib.sha256(source.encode()).hexdigest() != manifest['sha256']:
            raise RecoveryError('Candidate hash differs')
        report['packageSha256'] = manifest['sha256']
        inventory = json.loads((ROOT/'source-inventory.json').read_text())
        target = RestoreSandbox(image=IMAGE,network_extension=True,private_diagnostics=OUT/'private-error')
        with target:
            if target.image_id != PINNED_IMAGE:
                raise RecoveryError('Pinned database image differs')
            prepare_archive_roles(target,inventory)
            report['state']='restoring_offline_database';write_private(OUT/'report.json',report)
            print(json.dumps({'stage':report['state']}),flush=True)
            archive=target.restore_native_archive(ROOT/'database.dump')
            if archive != manifest['baselineArchive']:
                raise RecoveryError('Archive differs from candidate baseline')
            report['containmentBefore']=target.verify_boundary()
            before=restored_fingerprints(target)
            schema_sql=Path('scripts/verify/learn-release-schema-inventory.sql').read_text()
            schema_before=json.loads(target.query(schema_sql))
            access_sql="""select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'role',r,
                'select',has_column_privilege(r,c.oid,a.attnum,'SELECT'),
                'insert',has_column_privilege(r,c.oid,a.attnum,'INSERT'),
                'update',has_column_privilege(r,c.oid,a.attnum,'UPDATE'),
                'references',has_column_privilege(r,c.oid,a.attnum,'REFERENCES'))
                order by c.relname,a.attnum,r)
                from pg_class c join pg_namespace n on n.oid=c.relnamespace
                join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
                cross join unnest(array['anon','authenticated','service_role']) r
                where n.nspname='public' and c.relkind in ('r','p');"""
            access_before=target.query(access_sql)
            if not absent(target):raise RecoveryError('Candidate already present in archive')
            prefix="set role postgres;set serviceos.release_target='tgbnakbxwcqjeimygroz';set serviceos.release_source_sha256="+literal(manifest['sha256'])+';\n'
            failures=[('wrong_target','Reviewed production target, deployer and package checksum required',prefix.replace('tgbnakbxwcqjeimygroz','saatxzwxvdvqevbnskxy')+source),
                ('catalog_drift','Production source table catalog differs from reviewed baseline',prefix+source.replace('begin;\n','begin;\nalter table public.email_messages add column rehearsal_catalog_drift text;\n',1)),
                ('late_failure','division by zero',prefix+source.replace('\ncommit;\n','\nselect 1/0;\ncommit;\n'))]
            report['negativeChecks']=[]
            for name,expected_error,sql in failures:
                try:
                    target.query(sql)
                except RecoveryError:
                    # Confirm the intended failure, then inspect durable schema.
                    diagnostic=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                    if expected_error not in diagnostic:
                        raise RecoveryError('Negative check failed for an unexpected reason')
                    if not absent(target) or json.loads(target.query(schema_sql)) != schema_before:
                        raise RecoveryError('Failed candidate did not roll back')
                    report['negativeChecks'].append({'case':name,'rejected':True,'schemaRestored':True})
                else:raise RecoveryError('Candidate negative check unexpectedly succeeded')
            report['state']='applying_offline_candidate';write_private(OUT/'report.json',report)
            print(json.dumps({'stage':report['state']}),flush=True)
            target.query(prefix+source)
            schema_after=json.loads(target.query(schema_sql))
            # Every existing table/column/grant/index/constraint/trigger is retained;
            # only the two new reader policies may augment each of nine sources.
            actual={x['name']:x for x in schema_after['tables']}
            for original in schema_before['tables']:
                observed=dict(actual[original['name']])
                added=[p for p in observed['policies'] if p['name'] not in {v['name'] for v in original['policies']}]
                if original['name'] in manifest['sourceTables']:
                    if len(added)!=2 or not any(p['name']=='learn_launch_production_boundary' and p['permissive']=='RESTRICTIVE' for p in added):
                        raise RecoveryError('Production reader policies differ')
                elif added:raise RecoveryError('Unexpected table policy change')
                observed['policies']=[p for p in observed['policies'] if p not in added]
                if observed!=original:raise RecoveryError('Existing table catalog changed')
            if schema_before['functions']!=schema_after['functions']:
                raise RecoveryError('Existing function catalog changed')
            for view in schema_before['views']:
                if view not in schema_after['views']:raise RecoveryError('Existing view changed')
            report['existingPublicCatalogPreserved']=True
            if target.query(access_sql)!=access_before:
                raise RecoveryError('Existing application column privileges changed')
            target.query("""do $$ begin
                assert (select not rolcanlogin and not rolinherit and not rolsuper and not rolbypassrls
                    and not rolcreaterole and not rolcreatedb and not rolreplication from pg_roles where rolname='learn_launch_metadata_reader');
                assert not has_schema_privilege('learn_launch_metadata_reader','public','CREATE');
                assert not pg_has_role('postgres','learn_launch_metadata_reader','SET');
                assert not pg_has_role('postgres','learn_launch_metadata_reader','USAGE');
                assert not pg_has_role('authenticated','learn_launch_metadata_reader','MEMBER');
                assert not pg_has_role('anon','learn_launch_metadata_reader','MEMBER');
                assert not pg_has_role('service_role','learn_launch_metadata_reader','MEMBER');
                assert not has_schema_privilege('authenticated','of_learn_deploy','USAGE');
                assert not has_schema_privilege('anon','of_learn_deploy','USAGE');
                assert not has_schema_privilege('service_role','of_learn_deploy','USAGE');
                end $$;""")
            report['existingApplicationColumnPrivilegesPreserved']=True
            report['restrictedReaderAndLedgerAuthorityVerified']=True
            # SQL role checks use an existing retained profile only inside a
            # transaction. No password, login or hosted grant is created.
            actor=json.loads(target.query("select json_build_object('id',p.id,'tenant',p.tenant_id) from public.profiles p where p.tenant_id is not null order by (select count(*) from public.email_messages e where e.tenant_id=p.tenant_id) desc,p.id limit 1;"))
            if not actor:raise RecoveryError('No retained profile for isolated role checks')
            views=[n for n in manifest['sourceTables'] if n!='profiles']
            expected={n:int(target.query('select count(*) from public.'+n+' where tenant_id='+literal(actor['tenant'])+';')) for n in views}
            if expected['email_messages']==0 or expected['phone_calls']==0:
                raise RecoveryError('Representative retained source rows missing')
            checks=[]
            for role in ['owner','admin','viewer']:
                check="begin;set local search_path=public,pg_catalog;update public.profiles set role="+literal(role)+" where id="+literal(actor['id'])+";set local request.jwt.claim.sub="+literal(actor['id'])+";set local role authenticated;do $$ begin\n"
                for n in views:
                    count=expected[n] if role in ('owner','admin') else 0
                    check+=f"assert (select count(*) from public.learn_launch_{n})={count}, 'Scoped retained count differs';\n"
                    check+=f"assert not exists(select 1 from public.learn_launch_{n} where tenant_id<>{literal(actor['tenant'])}::uuid), 'Foreign tenant visible';\n"
                check+="assert not exists(select 1 from learn_launch_email_messages e, lateral jsonb_object_keys(e.raw_payload) k where k<>'label_ids'), 'Private email key exposed';\n"
                check+="assert not exists(select 1 from learn_launch_email_messages e, lateral jsonb_array_elements_text(e.raw_payload->'label_ids') l where l not in ('INBOX','SENT','DRAFT')), 'Private label exposed';\n"
                for n in ['email_sync_runs','phone_sync_runs']:
                    check+=f"assert not exists(select 1 from learn_launch_{n} where error_message is not null and error_message not in ('','[redacted]')), 'Private provider error exposed';\n"
                check+="begin update learn_launch_phone_calls set direction='OUT';raise exception 'View write allowed';exception when insufficient_privilege then null;end;\nend $$;rollback;"
                target.query(check);checks.append(role)
            for sub in ['', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee']:
                target.query("begin;set local search_path=public,pg_catalog;set local request.jwt.claim.sub="+literal(sub)+";set local role authenticated;do $$ begin "+
                    ''.join(f"assert (select count(*) from learn_launch_{n})=0;" for n in views)+"end $$;rollback;")
            target.query("begin;set local search_path=public,pg_catalog;set local role anon;do $$ begin begin perform 1 from learn_launch_email_messages;raise exception 'Anonymous view read allowed';exception when insufficient_privilege then null;end;end $$;rollback;")
            report['sqlRoleChecks']={'existingProfileRoles':checks,'unsignedDenied':True,'unknownActorDenied':True,
                'anonymousDenied':True,'viewWritesDenied':True,'emailAndErrorRedactionVerified':True,'retainedTenantCounts':expected}
            after=restored_fingerprints(target)
            # The single migration receipt is the only new data table.
            receipt=[x for x in after['tables'] if x['schema']=='of_learn_deploy' and x['table']=='migrations']
            if len(receipt)!=1 or receipt[0]['rows']!=1:raise RecoveryError('Candidate receipt differs')
            after['tables']=[x for x in after['tables'] if x not in receipt]
            report['sourcePreservation']=compare_native_data(before,after)
            try:target.query(prefix+source)
            except RecoveryError:
                diagnostic=Path(str(target.private_diagnostics)+'-'+target.run_id+'-'+str(target.failed_command_count)+'.log').read_text()
                if 'Initial production release objects already exist; inspect before retry' not in diagnostic:
                    raise RecoveryError('Duplicate submission failed for an unexpected reason')
                if json.loads(target.query(schema_sql))!=schema_after:raise RecoveryError('Duplicate submission changed schema')
                report['duplicateSubmissionRejected']=True
            else:raise RecoveryError('Duplicate candidate unexpectedly accepted')
            report['containmentAfter']=target.verify_boundary()
        report['containerRemoved']=target.cleaned
        report['state']='first_production_candidate_rehearsed_offline'
        report['elapsedSeconds']=round(time.monotonic()-started,2)
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
    except Exception as error:
        report['failure']=str(error) if isinstance(error,RecoveryError) else 'Rehearsal failed; private diagnostics retained'
        report['containerRemoved']=bool(target and target.cleaned)
        write_private(OUT/'report.json',report);print(json.dumps(report),flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':run()
