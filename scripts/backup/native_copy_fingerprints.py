"""Streaming comparison of native PostgreSQL COPY data, without executing SQL.

Rows remain opaque native text-protocol bytes. Sorted SHA-256 row hashes preserve
duplicates while ignoring physical row order. Only hashes/counts leave this module.
Unknown data formats, truncated COPY, duplicate tables and bounds fail closed.
"""
import hashlib
import io
import json
import re
import subprocess
import tempfile
import threading
import uuid
from database_restore_sandbox import RecoveryError

IDENT = r'(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)'
HEADER = re.compile(r'^COPY (' + IDENT + r')\.(' + IDENT + r') \((.*)\) FROM stdin;$')
COLUMN = re.compile(r'\s*(' + IDENT + r')\s*(,|$)')
SEQUENCE = re.compile(r"^SELECT pg_catalog\.setval\('((?:[^']|'')*)', (-?\d+), (true|false)\);$")
MAX_LINE = 256 * 1024 * 1024
MAX_ROWS_PER_TABLE = 2_000_000
MAX_TABLES = 1000
MAX_BYTES = 16 * 1024 * 1024 * 1024


def decode_ident(value):
    return value[1:-1].replace('""', '"') if value.startswith('"') else value


def copy_fingerprints(stream):
    tables, sequences = {}, {}
    current = None
    total = 0
    while True:
        raw = stream.readline(MAX_LINE + 1)
        if not raw:
            break
        total += len(raw)
        if len(raw) > MAX_LINE:
            raise RecoveryError('Native COPY line exceeds bound')
        if total > MAX_BYTES:
            raise RecoveryError('Native COPY stream exceeds total bound')
        if not raw.endswith(b'\n'):
            raise RecoveryError('Native COPY stream line is truncated')
        if current is not None:
            if raw == b'\\.\n':
                digest = hashlib.sha256(b'native-copy-multiset/1\0')
                for row_hash in sorted(current.pop('hashes')):
                    digest.update(row_hash)
                current['sha256'] = digest.hexdigest()
                tables[(current['schema'], current['table'])] = current
                current = None
            else:
                if len(current['hashes']) >= MAX_ROWS_PER_TABLE:
                    raise RecoveryError('Native COPY table exceeds row bound')
                current['hashes'].append(hashlib.sha256(raw[:-1]).digest())
                current['rows'] += 1
            continue
        try:
            line = raw[:-1].decode('utf8')
        except UnicodeDecodeError:
            raise RecoveryError('Native COPY metadata is not UTF-8') from None
        if not line or line.startswith('--') or re.fullmatch(r'\\(?:un)?restrict [A-Za-z0-9]+', line):
            continue
        header = HEADER.fullmatch(line)
        if header:
            schema, table = map(decode_ident, header.group(1, 2))
            if (schema, table) in tables or len(tables) >= MAX_TABLES:
                raise RecoveryError('Duplicate or excessive native COPY tables')
            column_text, columns, offset = header.group(3), [], 0
            while offset < len(column_text):
                match = COLUMN.match(column_text, offset)
                if not match:
                    raise RecoveryError('Unrecognised native COPY column list')
                columns.append(decode_ident(match.group(1)))
                offset = match.end()
                if not match.group(2) and offset != len(column_text):
                    raise RecoveryError('Native COPY columns are incomplete')
            if not columns or len(columns) != len(set(columns)) or column_text.endswith(','):
                raise RecoveryError('Native COPY columns are ambiguous')
            current = {'schema': schema, 'table': table, 'columns': columns, 'rows': 0, 'hashes': []}
            continue
        sequence = SEQUENCE.fullmatch(line)
        if sequence:
            name = sequence.group(1).replace("''", "'")
            if name in sequences:
                raise RecoveryError('Duplicate sequence state in native export')
            sequences[name] = {'name': name, 'lastValue': int(sequence.group(2)),
                               'isCalled': sequence.group(3) == 'true'}
            continue
        # pg_restore/pg_dump setup only. These bytes are inspected, never executed.
        if re.fullmatch(r'SET [a-z_]+ = [^;]+;', line) or line == "SELECT pg_catalog.set_config('search_path', '', false);":
            continue
        raise RecoveryError('Unsupported statement outside native COPY data')
    if current is not None or not tables:
        raise RecoveryError('Native COPY stream did not complete')
    ordered = [tables[k] for k in sorted(tables)]
    return {'version': 'native-copy-comparison/1', 'tables': ordered,
            'sequences': [sequences[k] for k in sorted(sequences)],
            'rows': sum(t['rows'] for t in ordered), 'streamBytes': total}


def fingerprints_from_command(command, *, stdin=None, timeout=900):
    # A tempfile drains stderr without deadlock or accidental console disclosure.
    # Contents stay private and are removed when this call ends.
    with tempfile.TemporaryFile() as error_log:
        proc = subprocess.Popen(command, stdin=stdin, stdout=subprocess.PIPE,
                                stderr=error_log)
        expired = threading.Event()

        def stop():
            expired.set()
            proc.kill()

        timer = threading.Timer(timeout, stop)
        timer.daemon = True
        timer.start()
        try:
            result = copy_fingerprints(proc.stdout)
            status = proc.wait(timeout=30)
            if status or expired.is_set():
                raise RecoveryError('Native COPY export process did not complete')
            return result
        finally:
            timer.cancel()
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=30)
            proc.stdout.close()


def archive_fingerprints(path, *, docker, image):
    name = 'serviceos-archive-fingerprint-' + uuid.uuid4().hex
    try:
        with open(path, 'rb') as source:
            return fingerprints_from_command([
                docker, 'run', '--rm', '-i', '--pull=never', '--name', name,
                '--network', 'none', '--log-driver', 'none',
                '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '1',
                '--entrypoint', 'pg_restore', image, '--file=-', '--data-only', '--no-owner', '--no-privileges'],
                stdin=source)
    finally:
        subprocess.run([docker, 'rm', '-f', name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30)


def restored_fingerprints(target):
    target.verify_boundary()
    result = fingerprints_from_command([
        target.docker, 'exec', target.name, 'pg_dump', '-h', '127.0.0.1',
        '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--no-owner', '--no-privileges'])
    target.verify_boundary()
    return result


def compare_native_data(expected, actual):
    # streamBytes include comments/headers, which may legitimately differ.
    if expected['tables'] != actual['tables']:
        raise RecoveryError('Archived COPY rows differ from restored COPY rows')
    if expected['sequences'] != actual['sequences']:
        raise RecoveryError('Archived sequence states differ from restored database')
    payload = {'tables': expected['tables'], 'sequences': expected['sequences']}
    return {'state': 'all_archived_copy_rows_and_sequences_match',
            'tables': len(expected['tables']), 'rows': expected['rows'],
            'sequences': len(expected['sequences']),
            'comparisonSha256': hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'scope': 'all COPY table data present in the native archive; omitted source objects are not covered'}


def compare_network_supplement(path, target):
    """Check the two reviewed pg_net tables which pg_dump does not export."""
    raw = path.read_bytes()
    if len(raw) > 16 * 1024 * 1024:
        raise RecoveryError('Network supplement exceeds private comparison bound')
    expected = copy_fingerprints(io.BytesIO(raw))
    if [(t['schema'], t['table']) for t in expected['tables']] != [
            ('net', '_http_response'), ('net', 'http_request_queue')]:
        raise RecoveryError('Unreviewed network supplement table identity')
    if len(expected['sequences']) != 1 or expected['sequences'][0]['name'] != 'net.http_request_queue_id_seq':
        raise RecoveryError('Unreviewed network supplement sequence identity')
    target.verify_boundary()
    def ident(value):
        return '"' + value.replace('"', '""') + '"'
    chunks = []
    for table in expected['tables']:
        qualified = ident(table['schema']) + '.' + ident(table['table'])
        literal = "'" + qualified.replace("'", "''") + "'"
        columns = json.loads(target.query('select json_agg(attname order by attnum) from pg_attribute '
            'where attrelid=' + literal + '::regclass and attnum>0 and not attisdropped;'))
        if columns != table['columns']:
            raise RecoveryError('Restored network table columns differ')
        rows = target._run(target._psql(), data=("set timezone='UTC';set datestyle='ISO, MDY';"
            "set extra_float_digits=3;set bytea_output='hex';COPY " + qualified + ' TO STDOUT;').encode())
        if len(rows) > 8 * 1024 * 1024:
            raise RecoveryError('Restored network rows exceed comparison bound')
        chunks.append(('COPY ' + qualified + ' (' + ', '.join(map(ident, columns))
            + ') FROM stdin;\n').encode() + rows + b'\\.\n')
    sequence = json.loads(target.query("select json_build_object('lastValue',last_value,"
        "'isCalled',is_called) from net.http_request_queue_id_seq;"))
    chunks.append(("SELECT pg_catalog.setval('net.http_request_queue_id_seq', "
        + str(sequence['lastValue']) + ', ' + str(sequence['isCalled']).lower() + ');\n').encode())
    result = compare_native_data(expected, copy_fingerprints(io.BytesIO(b''.join(chunks))))
    target.verify_boundary()
    result['scope'] = 'two explicitly captured pg_net COPY tables and separately observed nontransactional sequence'
    return result
