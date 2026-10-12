"""Synthetic-only round trip for the stdin key loader; never calls a live service."""
import hashlib
import json
import os
import tempfile
from pathlib import Path
from database_restore_sandbox import RestoreSandbox, RecoveryError

IMAGE = 'public.ecr.aws/supabase/postgres:17.6.1.141'
key = b'12' * 32
with tempfile.TemporaryDirectory(prefix='serviceos-vault-recovery-') as folder:
    os.chmod(folder, 0o700)
    with RestoreSandbox(image=IMAGE, root_key=key) as source:
        source.query('create extension if not exists supabase_vault cascade;')
        source.query("select vault.create_secret('synthetic-recovery-sentinel','recovery-test');")
        expected = source.query("select encode(extensions.digest(decrypted_secret,'sha256'),'hex') from vault.decrypted_secrets where name='recovery-test';")
        assert expected == hashlib.sha256(b'synthetic-recovery-sentinel').hexdigest()
        source.verify_boundary()
        meta = source._inspect()
        assert key.decode() not in json.dumps(meta)
        data = source.dump_sql(tables=('vault.secrets',), data_only=True)
        path = Path(folder) / 'vault.sql'
        path.write_bytes(data)
        path.chmod(0o600)
    with RestoreSandbox(image=IMAGE, root_key=key) as target:
        target.query('create extension if not exists supabase_vault cascade;')
        target.restore_sql_files([path])
        assert target.query("select encode(extensions.digest(decrypted_secret,'sha256'),'hex') from vault.decrypted_secrets where name='recovery-test';") == expected
        containment = target.verify_boundary()
    with RestoreSandbox(image=IMAGE, root_key=b'34' * 32) as wrong:
        wrong.query('create extension if not exists supabase_vault cascade;')
        wrong.restore_sql_files([path])
        try:
            wrong.query("select count(decrypted_secret) from vault.decrypted_secrets;")
        except RecoveryError:
            wrong_key_rejected = True
        else:
            raise AssertionError('Incorrect recovery key unexpectedly decrypted the secret')
    assert source.cleaned and target.cleaned and wrong.cleaned
    print(json.dumps({'state':'synthetic_vault_recovery_verified','sameKeyDecrypts':True,
        'wrongKeyRejected':wrong_key_rejected,'keyAbsentFromDockerMetadata':True,
        'allContainersRemoved':True,'containment':containment}))
