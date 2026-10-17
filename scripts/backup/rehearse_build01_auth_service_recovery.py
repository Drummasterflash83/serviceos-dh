"""Offline Auth startup against the already verified private production archive.

No live connection, host ports, external network, email delivery, or persistent
credentials. Only synthetic user mutations occur in disposable containers.
"""
import base64
import hashlib
import hmac
import json
import os
import re
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
EXPECTED_ARCHIVE = {'bytes': 1179050190, 'sha256': '31f1e594e9c3b43f3cff0ec0c45095216a4bb6580e8a0e5f2a4a81db99c03fe8'}
DB_IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
DB_IMAGE_ID = 'sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518'
AUTH_IMAGE = 'public.ecr.aws/supabase/gotrue:v2.196.0'
AUTH_IMAGE_ID = 'sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232'
REST_IMAGE = 'public.ecr.aws/supabase/postgrest:v14.5'
REST_IMAGE_ID = 'sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9'
GATEWAY_IMAGE = 'public.ecr.aws/supabase/studio:2026.08.24-sha-8ec45b2'
GATEWAY_IMAGE_ID = 'sha256:4905784b715cb22b265d26405067649544b40faffff89fd8dc7a28736f42afb0'
EDGE_IMAGE = 'public.ecr.aws/supabase/edge-runtime:v1.74.3'
EDGE_IMAGE_ID = 'sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c'
EDGE_ROOT = ROOT / '.verification-results/build01-edge-isolated-20261016'
EDGE_BUNDLE = EDGE_ROOT / 'output/learn-launch-status.eszip'
EDGE_BUNDLE_SHA256 = 'abd78823453b1da6ff7c9b8171fe3e95ffcc6b4105eb2cb07aa75de819ab1d99'
V107_EDGE_BUNDLE = ROOT / '.verification-results/build01-edge-bundles-v107/learn-launch-status.eszip'
V107_EDGE_BUNDLE_SHA256 = 'd0e3601d0acbae63a0d0d85dea1327b95ad22d965e592603aca5040ad45f0a25'
GATEWAY_SOURCE = ROOT / 'scripts/backup/recovery_gateway.mjs'
GATEWAY_SOURCE_SHA256 = '15ab66f9f20096200efe049e787bac71d4e25d41352b9d10333567a082236ddf'
LABEL = 'ai.openfolk.serviceos.auth-recovery'
REST_LABEL = 'ai.openfolk.serviceos.rest-recovery'
EDGE_LABEL = 'ai.openfolk.serviceos.edge-recovery'
GATEWAY_LABEL = 'ai.openfolk.serviceos.gateway-recovery'
RUN = uuid.uuid4().hex
AUTH_NAME = 'serviceos-auth-recovery-' + RUN
REST_NAME = 'serviceos-rest-recovery-' + RUN
EDGE_NAME = 'serviceos-edge-recovery-' + RUN
GATEWAY_NAME = 'serviceos-gateway-recovery-' + RUN
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


def cleanup_rest():
    found = checked(['ps', '-aq', '--filter', 'name=^/' + REST_NAME + '$'])
    if found.strip():
        meta = json.loads(checked(['inspect', REST_NAME]))[0]
        if (meta.get('Config', {}).get('Labels') or {}).get(REST_LABEL) != RUN:
            raise RecoveryError('Refusing to remove unowned REST container')
        checked(['rm', '-f', REST_NAME])
    if checked(['ps', '-aq', '--filter', 'name=^/' + REST_NAME + '$']).strip():
        raise RecoveryError('Offline REST container cleanup unconfirmed')


def cleanup_optional(name, label):
    found = checked(['ps', '-aq', '--filter', 'name=^/' + name + '$'])
    if found.strip():
        meta = json.loads(checked(['inspect', name]))[0]
        if (meta.get('Config', {}).get('Labels') or {}).get(label) != RUN:
            raise RecoveryError('Refusing to remove unowned recovery container')
        checked(['rm', '-f', name])
    if checked(['ps', '-aq', '--filter', 'name=^/' + name + '$']).strip():
        raise RecoveryError('Optional recovery container cleanup unconfirmed')


def curl_inside(db_name, path, *, method='GET', headers=(), payload=None, port=9999):
    args = ['exec', '-i', db_name, 'curl', '--silent', '--show-error', '--max-time', '8',
            '--output', '-', '--write-out', '\n%{http_code}', '-X', method]
    for header in headers:
        args.extend(['-H', header])
    if payload is not None:
        args.extend(['--data-binary', '@-'])
    args.append('http://127.0.0.1:' + str(port) + path)
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


def service_token(secret, role='service_role'):
    now = int(time.time())
    head = b64url(b'{"alg":"HS256","typ":"JWT"}')
    body = b64url(json.dumps({'role':role,'iss':'supabase','aud':'authenticated',
                               'iat':now,'exp':now+1800}, separators=(',', ':')).encode())
    signing = (head + '.' + body).encode()
    return head + '.' + body + '.' + b64url(hmac.new(secret.encode(), signing, hashlib.sha256).digest())


def run(*, with_edge=False, reviewed_v107=False, recover_existing_user=False,
        source_dir=SOURCE, expected_archive=EXPECTED_ARCHIVE):
    archive = source_dir / 'database.dump'
    edge_bundle = V107_EDGE_BUNDLE if reviewed_v107 else EDGE_BUNDLE
    edge_bundle_sha256 = V107_EDGE_BUNDLE_SHA256 if reviewed_v107 else EDGE_BUNDLE_SHA256
    report = {'version':'learn-build01-auth-recovery/1', 'state':'preflight',
              'productionWrites':False, 'externalNetwork':False, 'hostPorts':0,
              'realUserLoginAttempted':False, 'emailSent':False,
              'existingUserDisposableResetVerified':False,
              'existingUserCurrentEdgeReadVerified':False,
              'databaseArchiveSha256':expected_archive['sha256'],
              'databaseArchiveBytes':expected_archive['bytes'],
              'databaseSourceKind':('independent_15_oct_archive' if source_dir==SOURCE
                                    else 'independent_scheduled_offsite_ciphertext'
                                    if source_dir.parent.name == 'offsite-restored'
                                    else 'private_current_daily_reader_export'),
              'authContainerRemoved':False, 'restContainerRemoved':False,
              'databaseContainerRemoved':False}
    if with_edge:
        report.update(edgeContainerRemoved=False,gatewayContainerRemoved=False,
                      edgeSourceBundleVerified=False,edgeAuthenticatedReadVerified=False,
                      reviewedV107Bundle=reviewed_v107,
                      edgeBundleSha256=edge_bundle_sha256)
    target = None
    stage = 'preflight'
    try:
        if archive.stat().st_size != expected_archive['bytes']:
            raise RecoveryError('Archived byte count changed')
        digest = hashlib.sha256()
        with archive.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != expected_archive['sha256']:
            raise RecoveryError('Archived digest changed')
        inventory = json.loads((source_dir/'source-inventory.json').read_text())
        if json.loads(checked(['image','inspect',AUTH_IMAGE]))[0]['Id'] != AUTH_IMAGE_ID:
            raise RecoveryError('Auth image pin differs')
        if json.loads(checked(['image','inspect',REST_IMAGE]))[0]['Id'] != REST_IMAGE_ID:
            raise RecoveryError('REST image pin differs')
        if with_edge:
            if (json.loads(checked(['image','inspect',GATEWAY_IMAGE]))[0]['Id'] != GATEWAY_IMAGE_ID
                    or json.loads(checked(['image','inspect',EDGE_IMAGE]))[0]['Id'] != EDGE_IMAGE_ID
                    or hashlib.sha256(edge_bundle.read_bytes()).hexdigest() != edge_bundle_sha256
                    or hashlib.sha256(GATEWAY_SOURCE.read_bytes()).hexdigest() != GATEWAY_SOURCE_SHA256):
                raise RecoveryError('Archived Edge recovery input pin differs')
            report['edgeSourceBundleVerified'] = True
        stage = 'database_restore'
        target = RestoreSandbox(image=DB_IMAGE, network_extension=True,
                                private_diagnostics=source_dir/'auth-restore-private-error')
        with target:
            if target.image_id != DB_IMAGE_ID:
                raise RecoveryError('PostgreSQL image pin differs')
            prepare_archive_roles(target, inventory)
            # The inventory stores this list-valued GUC as one text field.
            # Replaying it as one SQL string makes PostgreSQL look for a single
            # library named "supautils, safeupdate". Preserve both original
            # libraries as separate list members for the isolated API login.
            target.query("alter role authenticator set session_preload_libraries "
                         "to 'supautils', 'safeupdate';")
            archive_receipt = target.restore_native_archive(archive)
            if archive_receipt != expected_archive:
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
            authn_check = target._run(['exec',target.name,'psql','-X','-h','127.0.0.1',
                '-U','authenticator','-d','postgres','-Atq','-v','ON_ERROR_STOP=1',
                '-c','select 1;'])
            if authn_check.strip() != b'1':
                raise RecoveryError('Restored API database login unconfirmed')
            report.update(state='isolated_auth_fresh_login_verified', syntheticLogin=True,
                          originalUsersPreserved=True, authUsersAfter=users_after['count'],
                          syntheticNewSigningSecretUsed=True,
                          oldSessionContinuationVerified=False)
            stage = 'tenant_api_boundary'
            rest_env = {
                'PGRST_DB_URI':'postgres://authenticator@127.0.0.1:5432/postgres?sslmode=disable',
                'PGRST_DB_SCHEMAS':'public', 'PGRST_DB_ANON_ROLE':'anon',
                'PGRST_DB_EXTRA_SEARCH_PATH':'public,extensions',
                'PGRST_DB_MAX_ROWS':'1000', 'PGRST_JWT_SECRET':secret,
                'PGRST_DB_USE_LEGACY_GUCS':'false',
                'PGRST_SERVER_HOST':'127.0.0.1', 'PGRST_SERVER_PORT':'3000',
                'PGRST_ADMIN_SERVER_HOST':'127.0.0.1', 'PGRST_ADMIN_SERVER_PORT':'3001',
            }
            rest_cmd = ['run','-d','--pull=never','--network','container:'+target.name,
                        '--ipc','private','--name',REST_NAME,'--label',REST_LABEL+'='+RUN,
                        '--log-driver','local','--log-opt','max-size=1m',
                        '--log-opt','max-file=2','--security-opt','no-new-privileges',
                        '--cap-drop','ALL','--memory','512m','--cpus','1','--pids-limit','128']
            for key,value in rest_env.items():
                rest_cmd.extend(['-e',key+'='+value])
            checked([*rest_cmd,REST_IMAGE_ID], timeout=30)
            rest_meta = json.loads(checked(['inspect',REST_NAME]))[0]
            if not (rest_meta['Name']=='/'+REST_NAME and rest_meta['State']['Running']
                    and rest_meta['HostConfig']['NetworkMode']=='container:'+target._inspect()['Id']
                    and not rest_meta['HostConfig'].get('PortBindings')
                    and not rest_meta.get('Mounts')
                    and not rest_meta['HostConfig'].get('Privileged')
                    and rest_meta['HostConfig']['LogConfig']['Type']=='local'
                    and rest_meta['Image']==REST_IMAGE_ID):
                raise RecoveryError('Offline REST containment changed')
            bearer = 'Authorization: Bearer ' + login['access_token']
            for _ in range(80):
                api_status,api_rows = curl_inside(target.name,
                    '/customer_cards?select=id,tenant_id&limit=5',
                    headers=(bearer,),port=3000)
                if api_status == 200:
                    break
                if not json.loads(checked(['inspect',REST_NAME]))[0]['State']['Running']:
                    raise RecoveryError('Offline REST exited before query')
                time.sleep(.25)
            if api_status != 200 or api_rows != []:
                report['restHttpStatus'] = api_status
                report['restErrorCode'] = api_rows.get('code') if isinstance(api_rows,dict) else None
                raise RecoveryError('Unassigned synthetic user card access differed: HTTP '+str(api_status))
            existing_bearer = None
            if recover_existing_user:
                stage = 'existing_user_disposable_reset'
                tenant = '00000000-0000-0000-0000-000000000001'
                candidate = json.loads(target.query(
                    "select coalesce((select row_to_json(chosen) from (select u.id,u.email "
                    "from auth.users u join public.profiles p on p.id=u.id "
                    "where p.tenant_id='"+tenant+"'::uuid and u.email is not null "
                    "and u.email<>'' order by u.created_at,u.id limit 1) chosen),"
                    "'{}'::json)::text;"))
                if not candidate or not candidate.get('id') or not candidate.get('email'):
                    raise RecoveryError('No preserved tenant user available for disposable reset')
                existing_id = str(uuid.UUID(candidate['id']))
                existing_password = secrets.token_urlsafe(32)
                reset_status,reset = curl_inside(target.name,'/admin/users/'+existing_id,
                    method='PUT',headers=('Authorization: Bearer '+token,
                                          'Content-Type: application/json'),
                    payload=json.dumps({'password':existing_password}).encode())
                if reset_status != 200 or reset.get('id') != existing_id:
                    raise RecoveryError('Disposable existing-user password reset unconfirmed')
                existing_login_status,existing_login = curl_inside(target.name,
                    '/token?grant_type=password',method='POST',
                    headers=('Content-Type: application/json',),
                    payload=json.dumps({'email':candidate['email'],
                                        'password':existing_password}).encode())
                if (existing_login_status != 200 or
                        existing_login.get('user',{}).get('id') != existing_id or
                        not existing_login.get('access_token')):
                    raise RecoveryError('Existing user failed fresh login after disposable reset')
                existing_bearer = 'Authorization: Bearer ' + existing_login['access_token']
                existing_status,existing_rows = curl_inside(target.name,
                    '/customer_cards?select=id,tenant_id&limit=5',
                    headers=(existing_bearer,),port=3000)
                if (existing_status != 200 or not isinstance(existing_rows,list)
                        or len(existing_rows) != 5 or
                        any(row.get('tenant_id') != tenant for row in existing_rows)):
                    raise RecoveryError('Existing recovered user tenant card read unconfirmed')
                report.update(existingUserDisposableResetVerified=True,
                              existingUserTenantCardPage=5,
                              realUserLoginAttempted=True,
                              realUserLoginWasOfflineDisposable=True)
            actor = str(uuid.UUID(created['id']))
            tenant = '00000000-0000-0000-0000-000000000001'
            changed = target.query("update public.profiles set tenant_id='"+tenant+
                "'::uuid where id='"+actor+"'::uuid returning id;")
            if changed != actor:
                raise RecoveryError('Synthetic profile assignment unconfirmed')
            api_status,api_rows = curl_inside(target.name,
                '/customer_cards?select=id,tenant_id&limit=5',headers=(bearer,),port=3000)
            if api_status != 200 or not isinstance(api_rows,list) or len(api_rows) != 5 or any(
                    row.get('tenant_id') != tenant for row in api_rows):
                raise RecoveryError('Restored tenant card read unconfirmed: HTTP '+str(api_status))
            if with_edge:
                stage = 'archived_edge_startup'
                network = 'container:' + target.name
                gateway_cmd = ['run','-d','--pull=never','--network',network,
                    '--ipc','private','--name',GATEWAY_NAME,'--label',GATEWAY_LABEL+'='+RUN,
                    '--log-driver','none','--security-opt','no-new-privileges',
                    '--cap-drop','ALL','--memory','512m','--cpus','1','--pids-limit','128',
                    '--mount','type=bind,src='+str(GATEWAY_SOURCE)+',dst=/recovery/gateway.mjs,readonly',
                    '--entrypoint','node']
                checked([*gateway_cmd,GATEWAY_IMAGE_ID,'/recovery/gateway.mjs'],timeout=30)
                edge_env = {
                    'SUPABASE_URL':'http://127.0.0.1:8000',
                    'SUPABASE_ANON_KEY':service_token(secret,'anon'),
                    'SUPABASE_SERVICE_ROLE_KEY':token,
                }
                edge_cmd = ['run','-d','--pull=never','--network',network,
                    '--ipc','private','--name',EDGE_NAME,'--label',EDGE_LABEL+'='+RUN,
                    '--log-driver','none','--security-opt','no-new-privileges',
                    '--cap-drop','ALL','--memory','512m','--cpus','1','--pids-limit','128',
                    '--mount','type=bind,src='+str(edge_bundle)+',dst=/recovery/launch.eszip,readonly']
                for key,value in edge_env.items():
                    edge_cmd.extend(['-e',key+'='+value])
                checked([*edge_cmd,EDGE_IMAGE_ID,'start','--main-service','/recovery/launch.eszip',
                    '--main-entrypoint','/recovery/learn-launch-status/index.ts',
                    '--ip','127.0.0.1','--port','9000'],timeout=30)
                for name,image,label in ((GATEWAY_NAME,GATEWAY_IMAGE_ID,GATEWAY_LABEL),
                                         (EDGE_NAME,EDGE_IMAGE_ID,EDGE_LABEL)):
                    meta = json.loads(checked(['inspect',name]))[0]
                    if (meta['Name']!='/'+name or not meta['State']['Running']
                            or meta['Image']!=image
                            or meta['HostConfig']['NetworkMode']!='container:'+target._inspect()['Id']
                            or meta['HostConfig'].get('PortBindings')
                            or len(meta.get('Mounts') or [])!=1
                            or meta['HostConfig'].get('Privileged')
                            or meta['HostConfig']['LogConfig']['Type']!='none'
                            or (meta.get('Config',{}).get('Labels') or {}).get(label)!=RUN):
                        raise RecoveryError('Archived Edge boundary changed')
                gateway_auth_status,gateway_user = 0,{}
                for _ in range(80):
                    gateway_auth_status,gateway_user = curl_inside(target.name,
                        '/auth/v1/user',headers=(bearer,),port=8000)
                    if gateway_auth_status:
                        break
                    if not json.loads(checked(['inspect',GATEWAY_NAME]))[0]['State']['Running']:
                        raise RecoveryError('Offline gateway exited before readiness')
                    time.sleep(.25)
                gateway_rest_status,gateway_rows = curl_inside(target.name,
                    '/rest/v1/customer_cards?select=id,tenant_id&limit=1',
                    headers=(bearer,),port=8000)
                report['gatewayAuthHttpStatus'] = gateway_auth_status
                report['gatewayRestHttpStatus'] = gateway_rest_status
                report['gatewayAuthUserMatched'] = (
                    gateway_auth_status == 200 and isinstance(gateway_user,dict)
                    and gateway_user.get('id') == actor)
                report['gatewayRestTenantMatched'] = (
                    gateway_rest_status == 200 and isinstance(gateway_rows,list)
                    and len(gateway_rows) == 1
                    and gateway_rows[0].get('tenant_id') == tenant)
                if not (report['gatewayAuthUserMatched'] and report['gatewayRestTenantMatched']):
                    raise RecoveryError('Archived Edge gateway preflight unconfirmed')
                payload = json.dumps({'tenant_id':tenant}).encode()
                edge_headers = (bearer,'Content-Type: application/json')
                edge_status,edge_page = 0,{}
                for _ in range(80):
                    edge_status,edge_page = curl_inside(target.name,'/',method='POST',
                        headers=edge_headers,payload=payload,port=9000)
                    if edge_status in (200,401,403,503):
                        break
                    if not json.loads(checked(['inspect',EDGE_NAME]))[0]['State']['Running']:
                        raise RecoveryError('Archived Edge runtime exited before read')
                    time.sleep(.25)
                if (edge_status != 200 or edge_page.get('version')!='learn-launch/1'
                        or edge_page.get('tenant_id')!=tenant
                        or edge_page.get('counts',{}).get('version')!='learn-status/1'
                        or edge_page.get('counts',{}).get('phone',{}).get('record_count',0)<1
                        or edge_page.get('counts',{}).get('email',{}).get('record_count',0)<1):
                    report['edgeHttpStatus'] = edge_status
                    report['edgeErrorCode'] = edge_page.get('error',{}).get('code') if isinstance(edge_page,dict) else None
                    raise RecoveryError('Archived Edge authenticated tenant read unconfirmed')
                report['edgeAuthenticatedReadVerified'] = True
                report['edgePhoneAndEmailNonempty'] = True
                if recover_existing_user:
                    existing_edge_status,existing_edge_page = curl_inside(target.name,
                        '/',method='POST',
                        headers=(existing_bearer,'Content-Type: application/json'),
                        payload=payload,port=9000)
                    if (existing_edge_status != 200 or
                            existing_edge_page.get('tenant_id') != tenant or
                            existing_edge_page.get('counts',{}).get('phone',{}).get('record_count',0)<1 or
                            existing_edge_page.get('counts',{}).get('email',{}).get('record_count',0)<1):
                        raise RecoveryError('Existing recovered user current Edge read unconfirmed')
                    report['existingUserCurrentEdgeReadVerified'] = True
                cleanup_optional(EDGE_NAME,EDGE_LABEL)
                report['edgeContainerRemoved'] = True
                cleanup_optional(GATEWAY_NAME,GATEWAY_LABEL)
                report['gatewayContainerRemoved'] = True
            synthetic_tenant = str(uuid.uuid4())
            synthetic_card = str(uuid.uuid4())
            target.query("insert into public.tenants(id,slug,display_name) values('"+
                synthetic_tenant+"'::uuid,'build01-"+RUN+"','Build 01 offline test');")
            target.query("insert into public.customer_cards(id,tenant_id,title) values('"+
                synthetic_card+"'::uuid,'"+synthetic_tenant+"'::uuid,'Offline boundary test');")
            changed = target.query("update public.profiles set tenant_id='"+synthetic_tenant+
                "'::uuid where id='"+actor+"'::uuid returning id;")
            if changed != actor:
                raise RecoveryError('Synthetic tenant switch unconfirmed')
            api_status,api_rows = curl_inside(target.name,
                '/customer_cards?select=id,tenant_id&limit=5',headers=(bearer,),port=3000)
            if api_status != 200 or api_rows != [{'id':synthetic_card,'tenant_id':synthetic_tenant}]:
                raise RecoveryError('Cross-tenant card isolation unconfirmed: HTTP '+str(api_status))
            stage = 'restored_operator_read'
            target.query("insert into public.platform_authority_grants"
                "(profile_id,permission,granted_by,reason,source) values('"+actor+
                "'::uuid,'platform.controlplane.admin','system:offline-restore',"
                "'Isolated Build 01 operator recovery rehearsal','offline-restore');")
            operator_request = json.dumps({
                'p_tenant':tenant, 'p_collection':'customers',
                'p_reason':'Isolated Build 01 operator recovery rehearsal',
            }).encode()
            operator_status,operator_page = curl_inside(target.name,
                '/rpc/openfolk_client_information',method='POST',
                headers=(bearer,'Content-Type: application/json'),
                payload=operator_request,port=3000)
            if (operator_status != 200 or not isinstance(operator_page,dict)
                or operator_page.get('tenant_id') != tenant
                or operator_page.get('actor_id') != actor
                or operator_page.get('collection') != 'customers'
                or not isinstance(operator_page.get('rows'),list)
                or not 1 <= len(operator_page['rows']) <= 25
                or not isinstance(operator_page.get('audit_id'),str)):
                raise RecoveryError('Restored operator client selection unconfirmed: HTTP '+str(operator_status))
            audit_id = str(uuid.UUID(operator_page['audit_id']))
            audit_count = target.query("select count(*) from public.controlplane_change_log "
                "where id='"+audit_id+"'::uuid and tenant_id='"+tenant+
                "'::uuid and actor='"+actor+"' and action='client_information.read' "
                "and resource_type='customers' and source='openfolk-client-information';")
            if audit_count != '1':
                raise RecoveryError('Restored operator read audit unconfirmed')
            revoked = target.query("update public.platform_authority_grants set "
                "effective_to=clock_timestamp() where profile_id='"+actor+
                "'::uuid and permission='platform.controlplane.admin' returning id;")
            if not revoked:
                raise RecoveryError('Synthetic operator revocation unconfirmed')
            denied_status,denied = curl_inside(target.name,
                '/rpc/openfolk_client_information',method='POST',
                headers=(bearer,'Content-Type: application/json'),
                payload=operator_request,port=3000)
            if denied_status not in (401,403) or denied.get('code') != '42501':
                raise RecoveryError('Revoked operator read was not denied: HTTP '+str(denied_status))
            api_status,api_rows = curl_inside(target.name,
                '/customer_cards?select=id,tenant_id&limit=5',headers=(bearer,),port=3000)
            if api_status != 200 or api_rows != [{'id':synthetic_card,'tenant_id':synthetic_tenant}]:
                raise RecoveryError('Operator rehearsal changed raw tenant isolation')
            report.update(state='isolated_auth_api_and_operator_boundary_verified',
                          unassignedUserSawCards=0,restoredTenantCardPage=5,
                          otherTenantCardPage=1,crossTenantCardLeak=0,
                          restoredOperatorSelection=True,
                          restoredOperatorReadAuditCount=1,
                          revokedOperatorReadDenied=True,
                          operatorRawCrossTenantRows=0)
            target.verify_boundary()
            cleanup_rest()
            report['restContainerRemoved'] = True
            cleanup_auth()
            report['authContainerRemoved'] = True
        report['databaseContainerRemoved'] = target.cleaned
        return report
    except BaseException as exc:
        report.update(state='isolated_auth_recovery_unverified',failureStage=stage,
                      safeFailure=(str(exc) if isinstance(exc,RecoveryError)
                                   else type(exc).__name__))
        if with_edge:
            for name,label,field in ((EDGE_NAME,EDGE_LABEL,'edgeContainerRemoved'),
                                      (GATEWAY_NAME,GATEWAY_LABEL,'gatewayContainerRemoved')):
                try:
                    cleanup_optional(name,label)
                    report[field] = True
                except BaseException:
                    report[field] = False
        if stage in ('tenant_api_boundary','restored_operator_read'):
            try:
                observed = subprocess.run([DOCKER,'logs','--tail','120',REST_NAME],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
                raw = observed.stdout + observed.stderr
                path = source_dir / ('auth-rest-private-' + RUN + '.log')
                fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                with os.fdopen(fd,'wb') as diagnostic:
                    diagnostic.write(raw[:131072])
                report['privateRestDiagnostic'] = str(path.relative_to(ROOT))
            except BaseException:
                pass
        try:
            cleanup_rest()
            report['restContainerRemoved'] = True
        except BaseException:
            report['restContainerRemoved'] = False
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
        mode = sys.argv[1:]
        current_source = None
        expected_archive = EXPECTED_ARCHIVE
        if (len(mode) == 3 and
                mode[0] == '--with-reviewed-v107-edge-and-existing-user-reset' and
                mode[1] == '--current-export-dir' and
                re.fullmatch(r'\.verification-results/production-database-daily-\d{8}-'
                             r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                             mode[2])):
            current_source = ROOT / mode[2]
            export = json.loads((current_source/'report.json').read_text())
            expected_archive = export.get('archive')
            if (export.get('state') != 'export_complete_restore_unverified' or
                    export.get('project') != 'tgbnakbxwcqjeimygroz' or
                    export.get('sourceCredential') != 'dedicated_reader_keychain' or
                    export.get('productionDataWrites') is not False or
                    export.get('clientTlsVerified') is not True or
                    export.get('snapshot',{}).get('readOnly') != 'on' or
                    not isinstance(expected_archive,dict) or
                    not isinstance(expected_archive.get('bytes'),int) or
                    expected_archive['bytes'] < 1_000_000_000 or
                    not re.fullmatch(r'[0-9a-f]{64}',expected_archive.get('sha256',''))):
                raise RecoveryError('Current private export boundary unverified')
            mode = mode[:1]
        elif (len(mode) == 3 and
                mode[0] == '--with-reviewed-v107-edge-and-existing-user-reset' and
                mode[1] == '--offsite-recovered-dir' and
                mode[2] == '.verification-results/build01-scheduled-database-20261017/offsite-restored'):
            recovered_root = ROOT / mode[2]
            recovery = json.loads((recovered_root/'report.json').read_text())
            current_source = recovered_root / 'snapshot'
            export = json.loads((current_source/'report.json').read_text())
            expected_archive = export.get('archive')
            if (recovery.get('state') != 'encrypted_package_database_and_vault_restored' or
                    recovery.get('originalPackageFilesUnchanged') is not True or
                    recovery.get('containerRemoved') is not True or
                    recovery.get('allPhysicalTablesCovered') is not True or
                    recovery.get('productionWrites') is not False or
                    recovery.get('snapshotAt') != export.get('snapshot',{}).get('observedAt') or
                    export.get('state') != 'export_complete_restore_unverified' or
                    export.get('project') != 'tgbnakbxwcqjeimygroz' or
                    export.get('productionDataWrites') is not False or
                    export.get('clientTlsVerified') is not True or
                    export.get('snapshot',{}).get('readOnly') != 'on' or
                    not isinstance(expected_archive,dict) or
                    not isinstance(expected_archive.get('bytes'),int) or
                    expected_archive['bytes'] < 1_000_000_000 or
                    not re.fullmatch(r'[0-9a-f]{64}',expected_archive.get('sha256',''))):
                raise RecoveryError('Scheduled off-site recovery boundary unverified')
            mode = mode[:1]
        if len(mode)>1 or (len(mode)==1 and mode[0] not in
            ('--with-archived-edge','--with-reviewed-v107-edge',
             '--with-reviewed-v107-edge-and-existing-user-reset')):
            raise RecoveryError('Exact archived Edge rehearsal mode required')
        print(json.dumps(run(with_edge=len(mode)==1,
            reviewed_v107=len(mode)==1 and mode[0] in
            ('--with-reviewed-v107-edge','--with-reviewed-v107-edge-and-existing-user-reset'),
            recover_existing_user=len(mode)==1 and
            mode[0]=='--with-reviewed-v107-edge-and-existing-user-reset',
            source_dir=current_source or SOURCE,
            expected_archive=expected_archive)))
    except BaseException:
        print(json.dumps({'state':'isolated_auth_recovery_unverified','report':str(REPORT)}))
        raise SystemExit(1)
