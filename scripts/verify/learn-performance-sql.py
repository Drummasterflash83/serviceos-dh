"""Run synthetic performance measurement checks in disposable, network-isolated Postgres.

Requires Docker and a locally cached postgres:15 image. No host mounts, published
ports, credentials, or connection to a ServiceOS database are used.
"""
import shutil
import subprocess
import time
import uuid
from pathlib import Path

root = Path(__file__).resolve().parents[2]
docker = shutil.which('docker') or '/usr/local/bin/docker'
name = 'serviceos-learn-performance-' + uuid.uuid4().hex[:8]
try:
    subprocess.run([docker, 'run', '-d', '--pull=never', '--network', 'none',
                    '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                    'postgres:15'], check=True, capture_output=True)
    ready = False
    for attempt in range(40):
        result = subprocess.run([docker, 'exec', name, 'pg_isready', '-h',
                                 '127.0.0.1', '-U', 'postgres'], capture_output=True)
        if result.returncode == 0:
            ready = True
            break
        time.sleep(.25)
    if not ready:
        raise RuntimeError('Local PostgreSQL not ready')
    paths = [
        'scripts/verify/learn-performance.fixture.sql',
        'supabase/migrations/20260720120000_objectives.sql',
        'supabase/migrations/20260720120100_objectives_hardening.sql',
        'supabase/migrations/20261029150000_learn_performance_measurements.sql',
        'scripts/verify/learn-performance.assert.sql',
        'scripts/verify/learn-performance-review.fixture.sql',
        'supabase/migrations/20261029160000_learn_performance_reviews.sql',
        'scripts/verify/learn-performance-review.assert.sql',
    ]
    sql = '\n'.join((root / path).read_text() for path in paths)
    result = subprocess.run([docker, 'exec', '-i', name, 'psql', '-h',
                             '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                            input=sql, text=True, capture_output=True)
    print(result.stdout[-2500:])
    print(result.stderr[-1500:])
    raise SystemExit(result.returncode)
finally:
    subprocess.run([docker, 'rm', '-f', name], capture_output=True)
