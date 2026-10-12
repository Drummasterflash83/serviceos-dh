"""Disposable, offline destination for reviewed PostgreSQL logical SQL restores.

This does not acquire a backup, connect to a source, restore Storage bytes, or
prove Supabase service/Vault recovery. SQL executes only inside a fresh Docker
container, never in an existing database. Callers keep private results private.
"""
import hashlib
import json
import os
import shutil
import stat
import subprocess
import time
import uuid

IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.165'
LABEL = 'ai.openfolk.serviceos.database-recovery'


class RecoveryError(RuntimeError):
    """Only fixed, non-sensitive messages; never attach subprocess output."""


class RestoreSandbox:
    def __init__(self, *, image=IMAGE, private_diagnostics=None, network_extension=False,
                 synthetic_vault=False, storage_policy_hook=False):
        if image not in (IMAGE, 'public.ecr.aws/supabase/postgres:17.6.1.141'):
            raise RecoveryError('Unreviewed recovery image')
        self.image = image
        self.network_extension = network_extension
        self.preloaded_libraries = 'pg_cron,pg_net' if network_extension else 'pg_cron'
        # The pinned image generates its own key inside this disposable container.
        # This enables synthetic round trips, not recovery of source Vault secrets.
        if synthetic_vault:
            self.preloaded_libraries += ',pgsodium,supabase_vault'
        self.storage_policy_hook = storage_policy_hook
        if storage_policy_hook:
            self.preloaded_libraries += ',supautils'
        self.private_diagnostics = private_diagnostics
        self.failed_command_count = 0
        self.docker = shutil.which('docker') or '/usr/local/bin/docker'
        self.run_id = uuid.uuid4().hex
        self.name = 'serviceos-db-recovery-' + self.run_id
        self.image_id = None
        self.created = False
        self.cleaned = False
        self.restore_receipts = []

    def _run(self, args, *, data=None, stdin=None, timeout=60):
        try:
            result = subprocess.run(
                [self.docker, *args], input=data, stdin=stdin,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            raise RecoveryError('Recovery container command unavailable or timed out') from None
        if result.returncode:
            if self.private_diagnostics is not None:
                self.failed_command_count += 1
                # Optional caller-owned private file, never included in raised
                # errors or console output. Each failure gets an exclusive file.
                path = str(self.private_diagnostics) + '-' + self.run_id + '-' + str(self.failed_command_count) + '.log'
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as log:
                    log.write(result.stderr)
            raise RecoveryError('Recovery container command failed; raw output withheld')
        return result.stdout

    def _inspect(self):
        try:
            return json.loads(self._run(['inspect', self.name]))[0]
        except (ValueError, KeyError, IndexError):
            raise RecoveryError('Invalid recovery container metadata') from None

    def verify_boundary(self):
        meta = self._inspect()
        host = meta['HostConfig']
        labels = meta['Config'].get('Labels') or {}
        valid = (
            meta['Name'] == '/' + self.name and labels.get(LABEL) == self.run_id
            and meta['Image'] == self.image_id and meta['State']['Running']
            and host['NetworkMode'] == 'none' and not host.get('PortBindings')
            and not meta['NetworkSettings'].get('Ports') and not meta['Mounts']
            and not host.get('Privileged') and not host.get('CapAdd')
            and host['LogConfig']['Type'] == 'none'
            and 'no-new-privileges' in host.get('SecurityOpt', [])
            and host.get('PidMode', '') == '' and host.get('IpcMode') == 'private'
        )
        if not valid:
            raise RecoveryError('Recovery containment check failed')
        settings = self.query("select current_setting('cron.launch_active_jobs') || '|' || "
                              "current_setting('shared_preload_libraries') || '|' || "
                              "current_setting('listen_addresses');")
        if settings != 'off|' + self.preloaded_libraries + '|127.0.0.1':
            raise RecoveryError('Recovery scheduler or listener configuration changed')
        if self.query("show max_worker_processes;") != '0':
            raise RecoveryError('Recovery background worker slots are not disabled')
        if self.storage_policy_hook and json.loads(self.query(
                "show supautils.policy_grants;")) != {'postgres': ['storage.objects']}:
            raise RecoveryError('Local storage policy hook differs')
        if self.network_extension and self.query(
                "select current_setting('pg_net.database_name') || '|' || "
                "exists(select 1 from pg_database where datname='serviceos_network_disabled')::text;") != 'serviceos_network_disabled|false':
            raise RecoveryError('Network extension is not isolated from the restored database')
        return {'network': 'none', 'hostMounts': 0, 'publishedPorts': 0,
                'cronLaunchActiveJobs': False, 'preloadedLibraries': self.preloaded_libraries.split(','),
                'maxWorkerProcesses': 0,
                'networkWorkerDatabaseAbsent': self.network_extension,
                'containerLogging': 'none'}

    def __enter__(self):
        try:
            image = json.loads(self._run(['image', 'inspect', self.image]))[0]
            self.image_id = image['Id']
            if image['Config'].get('Volumes'):
                raise RecoveryError('Image would introduce persistent volumes')
            # Use the resolved installed image ID, not a mutable tag at launch.
            # Flags are server arguments from first startup, before any SQL loads.
            self._run([
                'run', '-d', '--pull=never', '--network', 'none', '--ipc', 'private',
                '--name', self.name, '--label', LABEL + '=' + self.run_id,
                '--log-driver', 'none', '--security-opt', 'no-new-privileges',
                '--memory', '2g', '--cpus', '2', '--pids-limit', '256',
                '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', self.image_id,
                'postgres', '-D', '/etc/postgresql',
                '-c', 'shared_preload_libraries=' + self.preloaded_libraries,
                '-c', 'max_worker_processes=0',
                '-c', 'pg_net.database_name=serviceos_network_disabled',
                '-c', 'cron.launch_active_jobs=off',
                '-c', 'listen_addresses=127.0.0.1',
                *(['-c', 'supautils.policy_grants={"postgres":["storage.objects"]}']
                  if self.storage_policy_hook else []),
                '-c', 'log_min_error_statement=panic'])
            self.created = True
            # TCP waits for final startup, not the image's temporary init server.
            for attempt in range(120):
                try:
                    if self.query('select 1;') == '1':
                        break
                except RecoveryError:
                    pass
                time.sleep(.25)
            else:
                raise RecoveryError('Recovery database startup did not complete')
            self.verify_boundary()
            return self
        except BaseException:
            self.close()
            raise

    def _psql(self):
        return ['exec', '-i', self.name, 'psql', '-X', '-h', '127.0.0.1',
                '-U', 'supabase_admin', '-d', 'postgres', '-Atq',
                '-v', 'ON_ERROR_STOP=1', '-f', '-']

    def query(self, sql):
        # SQL and credentials never enter command arguments or shell expansion.
        return self._run(self._psql(), data=sql.encode()).decode().strip()

    def restore_sql_files(self, files):
        """Apply reviewed local files in order; stop on the first SQL error.

        Caller supplies compatible roles/schema/data/migration-history SQL.
        No filtering, removal of failed statements or ignoring of errors occurs.
        Call within a `with RestoreSandbox()` block so failure removes target.
        A successful return is SQL load evidence, not application acceptance.
        """
        self.verify_boundary()
        for path in files:
            digest = hashlib.sha256()
            length = 0
            # Same open descriptor for digest and restore; contents remain local.
            with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
                before = os.fstat(source.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_mode & 0o077:
                    raise RecoveryError('Restore SQL must be a private regular file (0600)')
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
                    length += len(chunk)
                source.seek(0)
                self._run(self._psql(), stdin=source, timeout=600)
                after = os.fstat(source.fileno())
                if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                        after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                    raise RecoveryError('Restore input changed during verification')
            self.verify_boundary()
            self.restore_receipts.append({'bytes': length, 'sha256': digest.hexdigest()})
        return list(self.restore_receipts)

    def dump_sql(self, schema=None, *, data_only=False, tables=()):
        """Local rehearsal helper; no remote source or database URL is accepted."""
        self.verify_boundary()
        def identifier(value):
            return bool(value) and all(c.isalnum() or c == '_' for c in value)
        if bool(schema) == bool(tables) or (schema and not identifier(schema)):
            raise RecoveryError('Invalid local rehearsal schema')
        args = ['exec', self.name, 'pg_dump', '-h', '127.0.0.1',
                '-U', 'supabase_admin', '-d', 'postgres']
        if schema:
            args += ['--schema', schema]
        for table in tables:
            parts = table.split('.')
            if len(parts) != 2 or not all(identifier(part) for part in parts):
                raise RecoveryError('Invalid local rehearsal table')
            args += ['--table', table]
        if data_only:
            args.append('--data-only')
        return self._run(args, timeout=120)

    def restore_native_archive(self, path):
        """Replace only this newly created offline container's bootstrap DB.

        The original native archive recreates its database and all contents.
        No existing/external destination can be supplied. Failures are fatal;
        the context manager removes the entire disposable destination.
        """
        self.verify_boundary()
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_mode & 0o077:
                raise RecoveryError('Native archive must be a private regular file (0600)')
            if source.read(5) != b'PGDMP':
                raise RecoveryError('Expected a native PostgreSQL custom archive')
            source.seek(0)
            digest = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
            source.seek(0)
            # Only the nonce-labelled, isolated container can reach this command.
            self._run(['exec', self.name, 'psql', '-X', '-h', '127.0.0.1',
                       '-U', 'supabase_admin', '-d', 'template1',
                       '-v', 'ON_ERROR_STOP=1', '-c',
                       'DROP DATABASE postgres WITH (FORCE);'])
            self._run(['exec', '-i', self.name, 'pg_restore', '--exit-on-error',
                       '--create', '-h', '127.0.0.1', '-U', 'supabase_admin',
                       '-d', 'template1'], stdin=source, timeout=900)
            after = os.fstat(source.fileno())
            if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise RecoveryError('Native archive changed during restore')
            self.verify_boundary()
            receipt = {'bytes': before.st_size, 'sha256': digest.hexdigest()}
            self.restore_receipts.append(receipt)
            return receipt

    def close(self):
        # Handle even an uncertain `docker run` reply by checking the exact nonce.
        found = self._run(['ps', '-aq', '--filter', 'name=^/' + self.name + '$'])
        if found.strip():
            meta = self._inspect()
            if (meta['Config'].get('Labels') or {}).get(LABEL) != self.run_id:
                raise RecoveryError('Refusing cleanup of an unowned container')
            self._run(['rm', '-f', self.name])
        if self._run(['ps', '-aq', '--filter', 'name=^/' + self.name + '$']).strip():
            raise RecoveryError('Recovery container cleanup unconfirmed')
        self.cleaned = True

    def __exit__(self, *_):
        self.close()

