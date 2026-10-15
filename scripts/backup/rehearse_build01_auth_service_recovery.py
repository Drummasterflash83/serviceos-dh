"""Offline Auth startup against the already verified private production archive.

No live connection, host ports, external network, email delivery, or persistent
credentials. Only synthetic user mutations occur in disposable containers.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, '/Users/chrisdrummond/Documents/ChatGPT/ServiceOS/scripts/backup')
from database_restore_sandbox import RestoreSandbox, RecoveryError
from inspect_production_release_baseline import prepare_archive_roles

ROOT = Path('/Users/chrisdrummond/Documents/ChatGPT/ServiceOS')
SOURCE = ROOT / '.verification-results/production-database-daily-20261015-911be91a-8569-4fa6-ab26-cac68014a999'
ARCHIVE = SOURCE / 'database.dump'
EXPECTED_ARCHIVE = {'bytes': 1179050190, 'sha256': '31f1e594e9c3b43f3cff0ec0c45095216a4bb6580e8a0e5f2a4a81db99c03fe8'}
DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
DB_IMAGE_ID = 'sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518'
AUTH_IMAGE = 'public.ecr.aws/supabase/gotrue:v2.196.0'
AUTH_IMAGE_ID = 'sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232'
LABEL = 'ai.openfolk.serviceos.auth-recovery'
RUN = uuid.uuid4().hex
AUTH_NAME = 'serviceos-auth-recovery-' + RUN
REPORT = ROOT / '.verification-results' / ('learn-build01-auth-recovery-' + RUN + '.json')
DOCKER = '/usr/local/bin/docker'


def checked(args, *, data=None, timeout=30):
    result = subprocess.run([DOCKER, *args], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RecoveryError('Offline Auth container command failed; diagnostic withheld')
    return result.stdout


def inspect_auth():
    return json.loads(checked(['inspect', AUTH_NAME]))[0]


def cleanup_auth():
    found = checked(['ps', '-aq', '--filter', 'name=^/' + AUTH_NAME + '$'])
    if found.strip():
        meta = inspect_auth()
        if (meta.get('Config', {}).get('Labels') or {}).get(LABEL) != RUN:
            raise RecoveryError('Refusing to remove unowned Auth container')
        checked(['rm', '-f', AUTH_NAME])
    if checked(['ps', '-aq', '--filter', 'name=^/' + AUTH_NAME + '$']).strip():
        raise RecoveryError('Offline Auth container cleanup unconfirmed')


def curl_inside(db_name, path, *, method='GET', headers=(), payload=None):
    args = ['exec', '-i', db_name, 'curl', '--silent', '--show-error', '--max-time', '8',
            '--output', '-', '--write-out', '\n%{http_code}', '-X', method]
    for header in headers:
        args.extend(['-H', header])
    if payload is not None:
        args.extend(['--data-binary', '@-'])
    args.append('http://127.0.0.1:9999' + path)
    result = subprocess.run([DOCKER, *args], input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=15)
    if result.returncode or b'\n' not in result.stdout:
        return 0, {}
    body, code = result.stdout.rsplit(b'\n', 1)
    try:
        parsed = json.loads(body) if body else {}
    except ValueError:
        parsed = {}
    return int(code), parsed


def b64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def service_token(secret):
    now = int(time.time())
    head = b64url(b'{"alg":"HS256","typ":"JWT"}')
    body = b64url(json.dumps({'role':'service_role','iss':'supabase','aud':'authenticated',
                               'iat':now,'exp':now+1800}, separators=(',', ':')).encode())
    signing = (head + '.' + body).encode()
    return head + '.' + body + '.' + b64url(hmac.new(secret.encode(), signing, hashlib.sha256).digest())


def run():
    report = {'version':'learn-build01-auth-recovery/1', 'state':'preflight',
              'productionWrites':False, 'externalNetwork':False, 'hostPorts':0,
              'realUserLoginAttempted':False, 'emailSent':False,
              'authContainerRemoved':False, 'databaseContainerRemoved':False}
    target = None
    stage = 'preflight'
    try:
        if ARCHIVE.stat().st_size != EXPECTED_ARCHIVE['bytes']:
            raise RecoveryError('Archived byte count changed')
        digest = hashlib.sha256()
        with ARCHIVE.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != EXPECTED_ARCHIVE['sha256']:
            raise RecoveryError('Archived digest changed')
        inventory = json.loads((SOURCE/'source-inventory.json').read_text())
        if json.loads(checked(['image','inspect',AUTH_IMAGE]))[0]['Id'] != AUTH_IMAGE_ID:
            raise RecoveryError('Auth image pin differs')
        stage = 'database_restore'
        target = RestoreSandbox(image=DB_IMAGE, network_extension=True,
                                private_diagnostics=SOURCE/'auth-restore-private-error')
        with target:
            if target.image_id != DB_IMAGE_ID:
                raise RecoveryError('PostgreSQL image pin differs')
            prepare_archive_roles(target, inventory)
            archive_receipt = target.restore_native_archive(ARCHIVE)
            if archive_receipt != EXPECTED_ARCHIVE:
                raise RecoveryError('Restored archive receipt differs')
            users_before = json.loads(target.query("select json_build_object('count',count(*),"
                "'digest',md5(coalesce(string_agg(id::text,',' order by id),''))) from auth.users;"))
            report['preservedAuthUsers'] = users_before['count']
            report['archiveVerified'] = True
            stage = 'auth_startup'
            secret = secrets.token_urlsafe(48)
            synthetic_email = 'build01-' + RUN + '@invalid.test'
            synthetic_password = secrets.token_urlsafe(30)
            env = {
                'GOTRUE_API_HOST':'127.0.0.1', 'GOTRUE_API_PORT':'9999',
                'API_EXTERNAL_URL':'http://127.0.0.1:9999',
                'GOTRUE_SITE_URL':'http://127.0.0.1:9999',
                'GOTRUE_DB_DRIVER':'postgres',
                'GOTRUE_DB_DATABASE_URL':'postgres://supabase_auth_admin@127.0.0.1:5432/postgres?sslmode=disable',
                'GOTRUE_DB_NAMESPACE':'auth', 'GOTRUE_JWT_SECRET':secret,
                'GOTRUE_JWT_ADMIN_ROLES':'service_role',
                'GOTRUE_JWT_AUD':'authenticated',
                'GOTRUE_JWT_DEFAULT_GROUP_NAME':'authenticated',
                'GOTRUE_DISABLE_SIGNUP':'true',
                'GOTRUE_EXTERNAL_EMAIL_ENABLED':'true',
                'GOTRUE_EXTERNAL_PHONE_ENABLED':'false',
                'GOTRUE_MAILER_AUTOCONFIRM':'true',
                'GOTRUE_DB_CLEANUP_ENABLED':'false',
                'GOTRUE_SMTP_HOST':'127.0.0.1', 'GOTRUE_SMTP_PORT':'2525',
            }
            command = ['run','-d','--pull=never','--network','container:'+target.name,
                       '--ipc','private','--name',AUTH_NAME,'--label',LABEL+'='+RUN,
                       '--log-driver','none','--security-opt','no-new-privileges',
                       '--cap-drop','ALL','--memory','512m','--cpus','1','--pids-limit','128']
            for key,value in env.items():
                command.extend(['-e',key+'='+value])
            checked([*command,AUTH_IMAGE_ID], timeout=30)
            meta = inspect_auth()
            report['authBoundaryObserved'] = {
                'nameMatched':meta['Name']=='/'+AUTH_NAME,
                'running':meta['State']['Running'],
                'networkMode':meta['HostConfig']['NetworkMode'],
                'portBindings':len(meta['HostConfig'].get('PortBindings') or {}),
                'mounts':len(meta.get('Mounts') or []),
                'privileged':meta['HostConfig'].get('Privileged'),
                'logDriver':meta['HostConfig']['LogConfig']['Type'],
                'imageMatched':meta['Image']==AUTH_IMAGE_ID,
            }
            if not (meta['Name']=='/'+AUTH_NAME and meta['State']['Running']
                    and meta['HostConfig']['NetworkMode']=='container:'+target._inspect()['Id']
                    and not meta['HostConfig'].get('PortBindings')
                    and not meta.get('Mounts')
                    and not meta['HostConfig'].get('Privileged')
                    and meta['HostConfig']['LogConfig']['Type']=='none'
                    and meta['Image']==AUTH_IMAGE_ID):
                raise RecoveryError('Offline Auth containment changed')
            health = 0
            for _ in range(80):
                health,_ = curl_inside(target.name,'/health')
                if health == 200:
                    break
                if not inspect_auth()['State']['Running']:
                    raise RecoveryError('Offline Auth exited before health')
                time.sleep(.25)
            if health != 200:
                raise RecoveryError('Offline Auth health did not pass')
            report['authHealthVerified'] = True
            stage = 'synthetic_login'
            token = service_token(secret)
            created_status,created = curl_inside(target.name,'/admin/users',method='POST',
                headers=('Authorization: Bearer '+token,'Content-Type: application/json'),
                payload=json.dumps({'email':synthetic_email,'password':synthetic_password,
                                    'email_confirm':True}).encode())
            if created_status not in (200,201) or created.get('email') != synthetic_email or not created.get('id'):
                raise RecoveryError('Synthetic recovery user creation unconfirmed: HTTP '+str(created_status))
            login_status,login = curl_inside(target.name,'/token?grant_type=password',method='POST',
                headers=('Content-Type: application/json',),
                payload=json.dumps({'email':synthetic_email,'password':synthetic_password}).encode())
            if login_status != 200 or not login.get('access_token') or login.get('user',{}).get('id') != created['id']:
                raise RecoveryError('Synthetic fresh login unconfirmed: HTTP '+str(login_status))
            me_status,me = curl_inside(target.name,'/user',
                headers=('Authorization: Bearer '+login['access_token'],))
            if me_status != 200 or me.get('id') != created['id']:
                raise RecoveryError('Synthetic authenticated user read unconfirmed: HTTP '+str(me_status))
            users_after = json.loads(target.query("select json_build_object('count',count(*),"
                "'digest',md5(coalesce(string_agg(id::text,',' order by id)"
                " filter(where email not like 'build01-%@invalid.test'),''))) from auth.users;"))
            if users_after['count'] != users_before['count']+1 or users_after['digest'] != users_before['digest']:
                raise RecoveryError('Preserved Auth user inventory changed')
            report.update(state='isolated_auth_fresh_login_verified', syntheticLogin=True,
                          originalUsersPreserved=True, authUsersAfter=users_after['count'],
                          syntheticNewSigningSecretUsed=True,
                          oldSessionContinuationVerified=False)
            target.verify_boundary()
            cleanup_auth()
            report['authContainerRemoved'] = True
        report['databaseContainerRemoved'] = target.cleaned
        return report
    except BaseException as exc:
        report.update(state='isolated_auth_recovery_unverified',failureStage=stage,
                      safeFailure=(str(exc) if isinstance(exc,RecoveryError)
                                   else type(exc).__name__))
        try:
            cleanup_auth()
            report['authContainerRemoved'] = True
        except BaseException:
            report['authContainerRemoved'] = False
        report['databaseContainerRemoved'] = bool(target and target.cleaned)
        raise
    finally:
        with REPORT.open('x') as f:
            os.chmod(REPORT,0o600)
            json.dump(report,f,indent=2)
            f.write('\n')


if __name__=='__main__':
    try:
        print(json.dumps(run()))
    except BaseException:
        print(json.dumps({'state':'isolated_auth_recovery_unverified','report':str(REPORT)}))
        raise SystemExit(1)
