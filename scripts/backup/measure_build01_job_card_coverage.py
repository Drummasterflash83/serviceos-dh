"""Aggregate-only Drummonds job-card coverage in the pinned offline archive.

The archive is an historical point-in-time sample, not a current LIVE audit.
No job IDs, customer details, titles, numbers or message bodies are printed.
"""
import json

from database_restore_sandbox import RestoreSandbox, RecoveryError
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_build01_auth_service_recovery import (
    SOURCE, ARCHIVE, EXPECTED_ARCHIVE, DB_IMAGE, DB_IMAGE_ID,
)

TENANT = '00000000-0000-0000-0000-000000000001'


def run():
    report = {'version': 'learn-build01-job-card-coverage/1',
              'state': 'preflight', 'productionWrites': False,
              'sourceProviderRequests': 0, 'privateContentPrinted': False}
    target = None
    try:
        target = RestoreSandbox(image=DB_IMAGE, network_extension=True,
                                private_diagnostics=SOURCE/'job-coverage-private-error')
        with target:
            if target.image_id != DB_IMAGE_ID:
                raise RecoveryError('PostgreSQL image pin differs')
            prepare_archive_roles(target, json.loads((SOURCE/'source-inventory.json').read_text()))
            if target.restore_native_archive(ARCHIVE) != EXPECTED_ARCHIVE:
                raise RecoveryError('Archive digest differs')
            sql = """begin read only;
with linked_jobs as materialized (
 select distinct entity_id from public.learn_business_input_links
 where tenant_id='%(tenant)s'::uuid and entity_kind='job'
), communicative_jobs as materialized (
 select distinct related_job_id from public.interactions
 where tenant_id='%(tenant)s'::uuid and related_job_id is not null
), scoped as (
 select j.source_system,j.status,j.customer_person_id,j.customer_company_id,
  j.site_id,j.engineer_person_id,j.created_date,j.completed_date,j.metadata,
  l.entity_id is not null reviewed,i.related_job_id is not null communication
 from public.jobs j left join linked_jobs l on l.entity_id=j.id
 left join communicative_jobs i on i.related_job_id=j.id
 where j.tenant_id='%(tenant)s'::uuid and j.active
), counted as (
 select count(*) total,
  count(*) filter(where source_system like 'commusoft:connection:%%') commusoft,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed) reviewed,
  count(*) filter(where source_system like 'commusoft:connection:%%' and
    status in ('open','pending','on_hold')) noncomplete,
  count(*) filter(where source_system like 'commusoft:connection:%%' and
    status in ('open','pending','on_hold') and reviewed) noncomplete_reviewed,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed and
    (customer_person_id is not null or customer_company_id is not null)) reviewed_customer,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed and
    site_id is not null) reviewed_site,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed and
    engineer_person_id is not null) reviewed_engineer,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed and
    communication) reviewed_communication,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed and
    status in ('completed','closed')) reviewed_complete,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed and
    status in ('completed','closed') and completed_date is not null) reviewed_complete_zoned,
  count(*) filter(where source_system like 'commusoft:connection:%%' and reviewed and
    status in ('completed','closed') and
    metadata#>>'{learn_business_input,timestamps,completed,state}'='unzoned') reviewed_complete_unzoned
 from scoped)
select row_to_json(counted) from counted;
rollback;""" % {'tenant': TENANT}
            numbers = json.loads(target.query(sql))
            if numbers['commusoft'] < 1 or numbers['total'] < numbers['commusoft']:
                raise RecoveryError('Expected source-backed job sample unavailable')
            target.verify_boundary()
            report.update(state='isolated_aggregate_verified', archiveVerified=True,
                          snapshot=numbers)
        report['databaseContainerRemoved'] = target.cleaned
        return report
    except BaseException:
        report['state'] = 'isolated_aggregate_unverified'
        report['databaseContainerRemoved'] = bool(target and target.cleaned)
        raise
    finally:
        print(json.dumps(report))


if __name__ == '__main__':
    run()
