/** Read-only exact-source check for the currently deployed card handler. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const LIVE_PROJECT = 'tgbnakbxwcqjeimygroz';
const mode = process.argv.slice(2).join(' ');
const project = mode === '--test-read-only' ? TEST_PROJECT
  : mode === '--live-read-only' ? LIVE_PROJECT : null;
if (!project) throw Error('Exact read-only project mode required');
const token = savedCliToken();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: 'error',
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw Error('Runtime inventory unavailable');
const worker = (await response.json()).find((row) => row.slug === 'platform-worker');
if (!worker || worker.status !== 'ACTIVE') throw Error('Active worker unavailable');
const work = mkdtempSync(join(tmpdir(), 'learn-card-batch-source-'));
try {
  const cli = '/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase';
  const downloaded = spawnSync(cli, ['functions', 'download', 'platform-worker',
    '--project-ref', project, '--workdir', work], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: 'utf8',
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (downloaded.status !== 0) throw Error('Current source download unavailable');
  const source = readFileSync(join(work, 'supabase/functions/platform-worker/functions/_shared/worker_handlers/customer_card_sync.ts'), 'utf8');
  const local = readFileSync('supabase/functions/_shared/worker_handlers/customer_card_sync.ts', 'utf8')
    .replace('// A full sweep performs per-card source reads and graph-edge pagination. Keep its\n' +
      '// unattended batch below the five-minute platform-job lease under LIVE load.\n' +
      'const DEFAULT_LIMIT = 40;', 'const DEFAULT_LIMIT = 200;');
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  console.log(JSON.stringify({ project, version: worker.version, wire: worker.ezbr_sha256,
    cardSourceSha256: sha256(source), localBaselineSha256: sha256(local),
    exactLocalBaseline: source === local, sourcePrinted: false, productionWrites: false }));
} finally {
  rmSync(work, { recursive: true, force: true });
}
