import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const migration = 'supabase/migrations/20261104080000_learn_customer_card_provenance.sql';
const release = resolve('scripts/verify/learn-build01-customer-provenance-release.mjs');
const token = `sbp_${'a'.repeat(40)}`;

test('customer provenance release stays TEST-first, reconciles exact catalog and never asks for a credential', () => {
  const root = mkdtempSync(join(tmpdir(), 'serviceos-provenance-release-'));
  try {
    mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
    copyFileSync(migration, join(root, migration));
    const callsPath = join(root, 'mock-calls.jsonl');
    const preload = join(root, 'mock-fetch.mjs');
    writeFileSync(preload, `
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = readFileSync('supabase/migrations/20261104080000_learn_customer_card_provenance.sql','utf8');
const sha = createHash('sha256').update(source).digest('hex');
let writes = 0;
globalThis.fetch = async (url, options = {}) => {
  const project = url.match(/^https:\\/\\/api\\.supabase\\.com\\/v1\\/projects\\/([a-z]{20})(.*)$/);
  if (!project) throw Error('Unexpected destination');
  appendFileSync(process.env.MOCK_CALLS_PATH, JSON.stringify({ project: project[1], path: project[2], write: project[2] === '/database/query' }) + '\\n');
  if (!project[2]) return Response.json({ id: process.env.MOCK_WRONG_PROJECT ? 'wrong-project' : project[1], status: 'ACTIVE_HEALTHY' });
  if (project[2] === '/database/query') { writes++; return Response.json([], { status: 201 }); }
  if (project[2] !== '/database/query/read-only') throw Error('Unexpected API path');
  const present = process.env.MOCK_PHASE === 'verify' || (process.env.MOCK_PHASE === 'install' && writes > 0);
  const audit = { functionPresent: present,
    function: present ? { owner: 'postgres', definer: true, searchPath: ['search_path=pg_catalog'],
      authenticatedExecute: true, anonExecute: false,
      comment: 'serviceos:learn-customer-card-provenance/1:' + sha } : null,
    index: present ? { valid: true, ready: true,
      definition: "CREATE INDEX learn_business_input_customer_card_lookup ON public.learn_business_input_links USING btree (tenant_id, card_id) WHERE ((entity_kind = 'customer'::text) AND (card_id IS NOT NULL))" } : null,
    sourceLinksPresent: true, quickbooksLinksPresent: true, cardsPresent: true,
    sourceLinksAuthenticatedSelect: false };
  return Response.json([{ audit }], { status: 201 });
};
`);
    function run(environment, phase, extraEnv = {}) {
      const result = spawnSync(process.execPath,
        ['--import', preload, release, environment, phase], {
          cwd: root, encoding: 'utf8', timeout: 10000,
          env: { ...process.env, SUPABASE_ACCESS_TOKEN: token,
            MOCK_CALLS_PATH: callsPath, MOCK_PHASE: phase, ...extraEnv },
        });
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout.trim());
    }
    assert.equal(run('test', 'prepare').noHostedRequest, true);
    const denied = spawnSync(process.execPath, ['--import', preload, release, 'test', 'rehearse'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token, MOCK_CALLS_PATH: callsPath,
        MOCK_PHASE: 'rehearse', MOCK_WRONG_PROJECT: '1' },
    });
    assert.notEqual(denied.status, 0);
    assert.equal(readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse).some(call => call.write), false);
    assert.equal(run('test', 'rehearse').state, 'rehearsed_rolled_back');
    assert.equal(run('test', 'install').state, 'installed_verified');
    assert.equal(run('test', 'verify').state, 'installed_verified');
    assert.equal(run('live', 'rehearse').state, 'rehearsed_rolled_back');
    assert.equal(run('live', 'install').state, 'installed_verified');
    const calls = readFileSync(callsPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(call => call.write).length, 4);
    assert.equal(calls.filter(call => call.project === 'tgbnakbxwcqjeimygroz' && call.write).length, 2);
    assert.equal(calls.some(call => call.path.includes('secrets') || call.path.includes('keys')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
