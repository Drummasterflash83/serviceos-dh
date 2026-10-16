"""Rehearse exact customer-source labels in a disposable production archive.

No source-provider call, hosted write, host port, raw identity or secret output.
"""
import json
from pathlib import Path

from database_restore_sandbox import RestoreSandbox, RecoveryError
from inspect_production_release_baseline import prepare_archive_roles
from rehearse_build01_auth_service_recovery import (
    SOURCE, ARCHIVE, EXPECTED_ARCHIVE, DB_IMAGE, DB_IMAGE_ID,
)

TENANT = '00000000-0000-0000-0000-000000000001'
MIGRATION = Path('supabase/migrations/20261104080000_learn_customer_card_provenance.sql')


def run():
    report = {'version': 'learn-customer-card-provenance-rehearsal/1',
              'state': 'preflight', 'productionWrites': False,
              'sourceProviderRequests': 0, 'customerContentPrinted': False}
    target = None
    try:
        target = RestoreSandbox(image=DB_IMAGE, network_extension=True,
                                private_diagnostics=SOURCE/'customer-provenance-private-error')
        with target:
            if target.image_id != DB_IMAGE_ID:
                raise RecoveryError('PostgreSQL image pin differs')
            prepare_archive_roles(target, json.loads((SOURCE/'source-inventory.json').read_text()))
            if target.restore_native_archive(ARCHIVE) != EXPECTED_ARCHIVE:
                raise RecoveryError('Archive digest differs')
            target.query(MIGRATION.read_text())
            index_definition = target.query("select pg_get_indexdef("
                "'public.learn_business_input_customer_card_lookup'::regclass);")
            if ("ON public.learn_business_input_links USING btree (tenant_id, card_id) "
                "WHERE ((entity_kind = 'customer'::text) AND (card_id IS NOT NULL))"
                    not in index_definition):
                raise RecoveryError('Customer source index differs from release guard')
            scope = "'" + TENANT + "'::uuid"
            baseline = json.loads(target.query("begin read only;select json_build_object("
                "'cards',count(*),'reviewed',count(*) filter(where exists(select 1 "
                "from public.learn_business_input_links l where l.tenant_id=c.tenant_id "
                "and l.card_id=c.id and l.entity_kind='customer'))) "
                "from public.customer_cards c where c.tenant_id=" + scope + ";commit;"))
            if baseline['cards'] < 2 or baseline['reviewed'] < 1:
                raise RecoveryError('Expected card coverage fixture unavailable')
            # The selected IDs remain only in transaction-local GUCs. The
            # returned text is never printed or stored in the public receipt.
            sql = """begin;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',
  (select id::text from public.profiles where tenant_id=%(tenant)s order by id limit 1),true);
select set_config('build01.reviewed',
  (select c.id::text from public.customer_cards c where c.tenant_id=%(tenant)s
   and exists(select 1 from public.learn_business_input_links l
    where l.tenant_id=c.tenant_id and l.card_id=c.id and l.entity_kind='customer')
   order by c.id limit 1),true);
select set_config('build01.identity',
  (select c.id::text from public.customer_cards c where c.tenant_id=%(tenant)s
   and c.context ? 'projection' and not exists(select 1 from public.learn_business_input_links l
    where l.tenant_id=c.tenant_id and l.card_id=c.id and l.entity_kind='customer')
   order by c.id limit 1),true);
set local role authenticated;
do $check$declare result jsonb;reviewed uuid:=current_setting('build01.reviewed')::uuid;
 identity uuid:=current_setting('build01.identity')::uuid; denied boolean:=false;
begin
 result:=public.learn_customer_card_provenance(%(tenant)s,array[reviewed,identity]);
 if result->>'version'<>'learn-customer-card-provenance/1'
  or result->>'tenantId'<>%(tenant)s::text
  or result#>>'{cards,0,state}'<>'reviewed_business_customer'
  or result#>>'{cards,1,state}'<>'communication_identity'
 then raise exception 'Customer provenance contract differed';end if;
 begin perform public.learn_customer_card_provenance(%(tenant)s,array[reviewed,reviewed]);
 exception when invalid_parameter_value then denied:=true;end;
 if not denied then raise exception 'Duplicate card scope accepted';end if;
 denied:=false;
 begin perform public.learn_customer_card_provenance(
  'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid,array[reviewed]);
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Foreign tenant scope accepted';end if;
end $check$;
select 'verified';
rollback;""" % {'tenant':scope}
            if target.query(sql).splitlines()[-1] != 'verified':
                raise RecoveryError('Authenticated provenance rehearsal unconfirmed')
            target.verify_boundary()
            report.update(state='isolated_provenance_verified',
                          archiveVerified=True, migrationApplied=True,
                          cards=baseline['cards'], reviewedCommusoftCustomerCards=baseline['reviewed'],
                          reviewedAndIdentityLabelsVerified=True,
                          indexDefinitionMatchesReleaseGuard=True,
                          duplicateAndForeignScopeDenied=True)
        report['databaseContainerRemoved'] = target.cleaned
        return report
    except BaseException:
        report['state'] = 'isolated_provenance_unverified'
        report['databaseContainerRemoved'] = bool(target and target.cleaned)
        raise
    finally:
        print(json.dumps(report))


if __name__ == '__main__':
    run()
