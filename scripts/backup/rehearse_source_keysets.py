"""Exercise the release's exact SQL renderer in the offline restored schema."""
import json,re,subprocess,hashlib
from pathlib import Path
from database_restore_sandbox import RecoveryError

def render(config):
    return subprocess.run(['node','scripts/verify/learn-release-source-preservation.mjs','--sql-from-stdin'],
        input=json.dumps(config),encoding='utf8',capture_output=True,check=True).stdout.strip()

def parse_rows(output):
    rows=[]
    for line in output.splitlines():
        if not line.strip():continue
        parts=line.split('|')
        if len(parts)!=2 or not re.fullmatch('[a-f0-9-]{36}',parts[0]) or not re.fullmatch('[a-f0-9]{32}',parts[1]):
            raise RecoveryError('Fingerprint protocol returned unexpected output')
        rows.append({'id':parts[0],'fingerprint':parts[1]})
    return rows

def rehearse_source_keysets(target):
    names=json.loads(subprocess.run(['node','--input-type=module','-e',
        "import{SOURCE_TABLES}from'./scripts/verify/learn-release-source-preservation.mjs';console.log(JSON.stringify(SOURCE_TABLES))"],
        encoding='utf8',capture_output=True,check=True).stdout)
    columns=json.loads(target.query("select jsonb_object_agg(name,columns) from (select c.relname name,jsonb_agg(a.attname::text order by a.attnum) columns from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relname in("+','.join("'"+n+"'" for n in names)+") and a.attnum>0 and not a.attisdropped group by c.relname)d"))
    counts={};pages=0
    for name in names:
        config={'table':name,'tenant':'00000000-0000-0000-0000-000000000001',
            'cutoff':'2026-10-14T07:00:00Z','columns':columns[name],'pageSize':2000,'cursor':None}
        seen=set()
        for page in range(150):
            rows=parse_rows(target.query('set role postgres;begin read only;'+render(config)+';rollback;'));pages+=1
            if any(r['id'] in seen or (config['cursor'] and r['id']<=config['cursor']) for r in rows):
                raise RecoveryError('Fingerprint pagination repeated or moved backwards')
            if not rows:break
            seen.update(r['id'] for r in rows);config['cursor']=rows[-1]['id']
        else:raise RecoveryError('Fingerprint keyset did not terminate')
        clock='observed_at' if name=='slack_message_versions' else 'created_at'
        expected=int(target.query("select count(*) from public."+name+" where tenant_id='"+config['tenant']+"' and "+clock+"<='"+config['cutoff']+"'"))
        if len(seen)!=expected:raise RecoveryError('Fingerprint keyset missed archived sources')
        counts[name]=expected
    tenant='af440001-aaaa-4000-8000-000000000001';email='af440001-aaaa-4000-8000-000000000002'
    config={'table':'email_messages','tenant':tenant,'cutoff':'2026-10-14T07:00:00Z','columns':columns['email_messages'],'pageSize':1}
    fingerprint=render(config)
    setup="insert into public.tenants(id,slug,display_name,status) values('"+tenant+"','source-keyset-rehearsal','Synthetic source keysets','active');insert into public.email_messages(id,tenant_id,provider,provider_message_id,body_text,raw_payload,created_at) values('"+email+"','"+tenant+"','gmail','synthetic-keyset-message','Synthetic retained body','{\"label_ids\":[\"INBOX\"],\"history_id\":\"1\"}','2026-10-12');"
    result=parse_rows(target.query('set role postgres;begin;'+setup+fingerprint+";update public.email_messages set raw_payload='{\"label_ids\":[\"SENT\"],\"history_id\":\"2\"}' where id='"+email+"';"+fingerprint+";update public.email_messages set body_text='Changed synthetic body' where id='"+email+"';"+fingerprint+';rollback;'))
    if len(result)!=3 or result[0]!=result[1] or result[1]['fingerprint']==result[2]['fingerprint']:
        raise RecoveryError('Mutable-label/canonical-body separation failed')
    mailbox='af440001-aaaa-4000-8000-000000000003';voicemail='af440001-aaaa-4000-8000-000000000004'
    config={'table':'receptionist_voicemails','tenant':tenant,'cutoff':'2026-10-14T07:00:00Z','columns':columns['receptionist_voicemails'],'pageSize':1}
    fingerprint=render(config)
    setup="insert into public.tenants(id,slug,display_name,status) values('"+tenant+"','source-keyset-rehearsal','Synthetic source keysets','active');insert into public.receptionist_mailboxes(id,tenant_id,provider_mailbox_id,display_name,extension) values('"+mailbox+"','"+tenant+"','synthetic-keyset','Synthetic mailbox','synthetic');insert into public.receptionist_voicemails(id,tenant_id,mailbox_id,provider_message_id,received_at,transcript,recording_path,created_at) values('"+voicemail+"','"+tenant+"','"+mailbox+"','synthetic-keyset','2026-10-12','Synthetic voicemail transcript','"+tenant+'/'+mailbox+'/'+voicemail+"','2026-10-12');"
    result=parse_rows(target.query('set role postgres;begin;'+setup+fingerprint+";update public.receptionist_voicemails set recording_path=null where id='"+voicemail+"';"+fingerprint+";update public.receptionist_voicemails set transcript='Changed synthetic transcript' where id='"+voicemail+"';"+fingerprint+';rollback;'))
    if len(result)!=3 or result[0]['fingerprint']==result[1]['fingerprint'] or result[1]['fingerprint']==result[2]['fingerprint']:
        raise RecoveryError('Voicemail pointer/transcript changes went undetected')
    return {'state':'source_keyset_protocol_rehearsed','datasets':counts,'pages':pages,
        'archivedCoverageMatches':True,'mutableEmailLabelsExcluded':True,'canonicalEmailBodyChangesDetected':True,
        'voicemailPointerAndTranscriptChangesDetected':True,
        'sourceSha256':hashlib.sha256(Path('scripts/verify/learn-release-source-preservation.mjs').read_bytes()).hexdigest(),
        'syntheticChangesRolledBack':True,'network':'none','sourceCredentials':False}
