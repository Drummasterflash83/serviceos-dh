"""Boot the reviewed LIVE v107 worker with no network, credentials or data.

This is a fail-closed startup check, not an authenticated queue or restore test.
"""

import hashlib
import json
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / '.verification-results/build01-edge-bundles-v107/platform-worker.eszip'
BUNDLE_SHA256 = '7abe5188435f8bab777eb8fc31fb72ede1c191fc8f37c354f122c9680e2acd72'
MANIFEST_SHA256 = '4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488'
EDGE_IMAGE = 'sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c'
PROBE_IMAGE = 'sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518'
LABEL = 'ai.openfolk.serviceos.v107-worker-startup'
RUN = uuid.uuid4().hex
NAME = 'serviceos-v107-worker-startup-' + RUN


def docker(*args, timeout=30):
    result = subprocess.run(['/usr/local/bin/docker', *args], capture_output=True,
                            text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Isolated Docker operation failed; details withheld')
    return result.stdout.strip()


def probe(method):
    result = subprocess.run(['/usr/local/bin/docker', 'run', '--rm', '--pull=never',
                             '--network', 'container:' + NAME, '--entrypoint', 'curl',
                             PROBE_IMAGE, '--silent', '--show-error', '--max-time', '5',
                             '--output', '/dev/null', '--write-out', '%{http_code}',
                             '-X', method, 'http://127.0.0.1:9000/'],
                            capture_output=True, text=True, timeout=15)
    return result.stdout.strip() if result.returncode == 0 else None


def main():
    if hashlib.sha256(BUNDLE.read_bytes()).hexdigest() != BUNDLE_SHA256:
        raise RuntimeError('Reviewed v107 worker bundle changed')
    report = json.loads((BUNDLE.parent / 'report.private.json').read_text())
    worker = next((x for x in report['results'] if x['slug'] == 'platform-worker'), None)
    if (report['sourceManifestSha256'] != MANIFEST_SHA256 or
            report['bundledCount'] != 103 or worker is None or
            worker['sha256'] != BUNDLE_SHA256):
        raise RuntimeError('Reviewed v107 bundle report changed')
    if docker('image', 'inspect', EDGE_IMAGE, '--format', '{{.Id}}') != EDGE_IMAGE:
        raise RuntimeError('Pinned Edge runtime image changed')
    if docker('image', 'inspect', PROBE_IMAGE, '--format', '{{.Id}}') != PROBE_IMAGE:
        raise RuntimeError('Pinned probe image changed')

    started = False
    try:
        docker('run', '-d', '--pull=never', '--network', 'none', '--ipc', 'private',
               '--name', NAME, '--label', LABEL + '=' + RUN, '--log-driver', 'none',
               '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL',
               '--memory', '512m', '--cpus', '1', '--pids-limit', '128',
               '--mount', f'type=bind,src={BUNDLE},dst=/recovery/worker.eszip,readonly',
               EDGE_IMAGE, 'start', '--main-service', '/recovery/worker.eszip',
               '--main-entrypoint', '/recovery/platform-worker/index.ts',
               '--ip', '127.0.0.1', '--port', '9000')
        started = True
        meta = json.loads(docker('inspect', NAME))[0]
        if (meta['Image'] != EDGE_IMAGE or
                meta['HostConfig']['NetworkMode'] != 'none' or
                meta['HostConfig'].get('PortBindings') or
                (meta['Config'].get('Labels') or {}).get(LABEL) != RUN or
                len(meta.get('Mounts') or []) != 1 or
                meta['Mounts'][0]['RW'] is not False):
            raise RuntimeError('Isolated worker boundary changed')
        options = None
        for _ in range(40):
            options = probe('OPTIONS')
            if options is not None:
                break
            if not json.loads(docker('inspect', NAME))[0]['State']['Running']:
                raise RuntimeError('Reviewed worker exited before readiness')
            time.sleep(.25)
        post = probe('POST')
        if options != '200' or post != '403':
            raise RuntimeError('Reviewed worker did not fail closed as expected')
        return {
            'contract': 'learn-build01-v107-worker-isolated-startup/1',
            'observedAtUtc': datetime.now(timezone.utc).isoformat(),
            'sourceManifestSha256': MANIFEST_SHA256,
            'workerBundleSha256': BUNDLE_SHA256,
            'workerBundleBytes': BUNDLE.stat().st_size,
            'edgeImageId': EDGE_IMAGE,
            'network': 'none', 'hostPorts': 0, 'runtimeSecrets': 0,
            'optionsHttp': int(options), 'unauthorizedPostHttp': int(post),
            'productionDataWrites': False, 'providerWrites': False,
            'authenticatedQueueExecutionVerified': False,
            'fullApplicationAuthRecoveryVerified': False,
        }
    finally:
        if started:
            meta = json.loads(docker('inspect', NAME))[0]
            if (meta['Config'].get('Labels') or {}).get(LABEL) != RUN:
                raise RuntimeError('Refusing to remove an unowned container')
            docker('rm', '-f', NAME)
            if docker('ps', '-aq', '--filter', 'name=^/' + NAME + '$'):
                raise RuntimeError('Isolated worker cleanup unconfirmed')


if __name__ == '__main__':
    print(json.dumps(main(), sort_keys=True))
