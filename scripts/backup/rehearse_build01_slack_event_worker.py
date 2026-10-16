"""Offline signed-event queue/source/deletion rehearsal against a pinned archive.

All synthetic writes occur in a disposable, network-isolated PostgreSQL
container. No Slack request, production write, secret read or host port.
"""
import hashlib
import json
import sys
import time
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
MIGRATIONS = [
    '20261104070000_learn_slack_event_hints.sql',
    '20261104100000_learn_slack_event_jobs.sql',
    '20261104110000_learn_slack_event_worker.sql',
]


def qliteral(value):
    if not isinstance(value, str) or '\x00' in value:
        raise RecoveryError('Synthetic SQL value invalid')
    return "'" + value.replace("'", "''") + "'"


def run():
    digest = hashlib.sha256()
    with ARCHIVE.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    if ARCHIVE.stat().st_size != EXPECTED['bytes'] or digest.hexdigest() != EXPECTED['sha256']:
        raise RecoveryError('Pinned archive changed')
    inventory = json.loads((SOURCE / 'source-inventory.json').read_text())
    report = {'version': 'learn-build01-slack-event-isolated/1',
              'archiveSha256': EXPECTED['sha256'], 'network': 'none',
              'hostPorts': 0, 'productionWrites': False, 'providerRequests': 0,
              'sourceTextPrinted': False, 'containerRemoved': False}
    target = RestoreSandbox(network_extension=True,
                            private_diagnostics=SOURCE / 'slack-event-private-error')
    try:
        with target:
            prepare_archive_roles(target, inventory)
            if target.restore_native_archive(ARCHIVE) != EXPECTED:
                raise RecoveryError('Archive restore receipt changed')
            for filename in MIGRATIONS:
                path = ROOT / 'supabase/migrations' / filename
                target.query(path.read_text())
            chosen = target.query("select s.tenant_id||'|'||s.team_id||'|'||s.channel_id "
                "from public.slack_recurring_channels s where s.enabled and s.include_threads "
                "order by s.account_id limit 1;")
            parts = chosen.split('|')
            if len(parts) != 3:
                raise RecoveryError('Archived subscription unavailable')
            tenant, team, channel = parts
            stamp = str(int(time.time()) - 120) + '.123456'
            later = str(int(time.time()) - 119) + '.123456'
            first = 'EvSYNTH' + uuid.uuid4().hex[:18]
            deletion = 'EvSYNTH' + uuid.uuid4().hex[:18]
            source_external = team + ':' + channel + ':' + stamp
            # All source content below is synthetic. A rollback or exception
            # destroys the container; no current system may see these records.
            script = f"""
            begin;
            set local role service_role;
            set local request.jwt.claim.role='service_role';
            update public.platform_jobs set status='cancelled',lease_expires_at=null
             where job_type in ('slack.history_sync','slack.thread_sync')
              and status in ('queued','running','retrying');
            do $test$
            declare t uuid:={qliteral(tenant)}::uuid;team text:={qliteral(team)};
             channel text:={qliteral(channel)};source_ts text:={qliteral(stamp)};
             first_id text:={qliteral(first)};delete_id text:={qliteral(deletion)};
             result jsonb;j public.platform_jobs%rowtype;
             worker uuid:=gen_random_uuid();claim text;records jsonb;source_key text;
            begin
             result:=public.learn_slack_event_record(t,team,first_id,channel,
              'message_hint',source_ts,source_ts,null,null);
             if result->>'state'<>'recorded' then raise exception 'synthetic_hint_not_recorded';end if;
             select * into j from public.learn_slack_claim_jobs(worker,1);
             if not found or j.job_type<>'slack.event_sync'
              or j.payload->>'event_id'<>first_id then
              raise exception 'synthetic_event_not_claimed';end if;
             claim:=j.claimed_by;
             result:=public.learn_slack_event_context(t,j.id,claim,j.attempt_count);
             if result->>'sourceTs'<>source_ts or result->>'channelId'<>channel
              then raise exception 'synthetic_context_changed';end if;
             source_key:=team||':'||channel||':'||source_ts;
             records:=jsonb_build_array(jsonb_build_object('tenant_id',t,'channel_id',channel,
              'source_external_id',source_key,'source_connector_id','slack',
              'provider_timestamp',source_ts,'thread_timestamp',null,'text','Synthetic isolated Slack evidence',
              'provider_payload',jsonb_build_object('type','message','ts',source_ts,
               'text','Synthetic isolated Slack evidence')));
             result:=public.learn_slack_event_commit(t,j.id,claim,j.attempt_count,records,false,true);
             if result->>'outcome'<>'stored_source' then raise exception 'synthetic_source_not_saved';end if;
             result:=public.learn_slack_finish_event_job(t,j.id,claim,j.attempt_count,'{{"success":true}}');
             if result->>'status'<>'succeeded' then raise exception 'synthetic_event_not_settled';end if;
             result:=public.learn_slack_event_record(t,team,first_id,channel,
              'message_hint',source_ts,source_ts,null,null);
             if result->>'state'<>'duplicate' then raise exception 'synthetic_duplicate_not_recognised';end if;
             update public.slack_workspace_pacing set next_allowed_at='-infinity',
              blocked_until='-infinity' where team_id=team;
             result:=public.learn_slack_event_record(t,team,delete_id,channel,
              'correction_hint',{qliteral(later)},source_ts,null,'deleted');
             if result->>'state'<>'recorded' then raise exception 'synthetic_delete_not_recorded';end if;
             select * into j from public.learn_slack_claim_jobs(worker,1);
             if not found or j.payload->>'event_id'<>delete_id then
              raise exception 'synthetic_delete_not_claimed';end if;
             result:=public.learn_slack_event_commit(t,j.id,j.claimed_by,j.attempt_count,'[]',true,true);
             if result->>'outcome'<>'withheld_after_provider_absence' then
              raise exception 'synthetic_delete_not_withheld';end if;
             result:=public.learn_slack_finish_event_job(t,j.id,j.claimed_by,j.attempt_count,'{{"success":true}}');
             if result->>'status'<>'succeeded' then raise exception 'synthetic_delete_not_settled';end if;
             if not exists(select 1 from public.slack_messages m join public.interactions i
               on i.tenant_id=m.tenant_id and i.source_table='slack_messages' and i.source_id=m.id
               where m.tenant_id=t and m.source_external_id=source_key and i.status='deleted')
              then raise exception 'synthetic_deleted_card_still_visible';end if;
             if (select count(*) from public.slack_message_versions v join public.slack_messages m
               on m.id=v.message_id and m.tenant_id=v.tenant_id
               where m.tenant_id=t and m.source_external_id=source_key)<>1
              then raise exception 'synthetic_original_version_not_retained';end if;
            end$test$;
            commit;
            select 'passed';
            """
            if target.query(script).splitlines()[-1] != 'passed':
                raise RecoveryError('Synthetic event proof missing')
            report['state'] = 'isolated_queue_source_delete_verified'
            report['syntheticEvents'] = 2
            report['originalVersionRetained'] = True
            report['deletedCardWithheld'] = True
            report['boundary'] = target.verify_boundary()
    finally:
        report['containerRemoved'] = target.cleaned
    if not target.cleaned:
        raise RecoveryError('Isolated container cleanup unconfirmed')
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    try:
        run()
    except (RecoveryError, OSError, ValueError, KeyError):
        print(json.dumps({'state':'slack_event_isolated_unverified',
                          'sourceTextPrinted':False,'productionWrites':False}))
        raise SystemExit(1)
