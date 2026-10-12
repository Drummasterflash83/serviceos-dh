/** Read-only download of the exact observed production runtime source versions.
 * Private output only; does not deploy or invoke an endpoint. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, relative } from 'node:path';
import { savedCliToken } from './learn-test-readiness.mjs';
import { PRODUCTION_PROJECT, validateInventory } from './learn-production-runtime-candidate.mjs';

const [out] = process.argv.slice(2);
if (process.argv.length !== 3 || !out ||
    !resolve(out).startsWith(resolve('.verification-results') + '/') ||
    process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT !== PRODUCTION_PROJECT)
  throw Error('Explicit production read-only project and fresh private output required');
const manifestPath = 'supabase/release/learn-production/runtime-candidate.manifest.json';
const manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes);
if (manifest.projectRef !== PRODUCTION_PROJECT) throw Error('Manifest target differs');
const sha = b => createHash('sha256').update(b).digest('hex');
const token = savedCliToken();
async function inventory() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PRODUCTION_PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Function inventory HTTP ${response.status}`);
  return validateInventory((await response.json()).map(f => ({ name: f.slug, id: f.id,
    version: f.version, hash: f.ezbr_sha256, jwt: f.verify_jwt, status: f.status })));
}
function same(a, b) { return a && b && ['name','id','version','hash','jwt','status'].every(k => a[k] === b[k]); }
const before = await inventory();
for (const e of manifest.endpoints) {
  const actual = before.find(f => f.name === e.name);
  if (e.beforeProduction ? !same(actual, e.beforeProduction) : actual)
    throw Error('Production endpoint drift: ' + e.name);
}
mkdirSync(out, { mode: 0o700 });
const report = { version: 'learn-production-runtime-backup/1', projectRef: PRODUCTION_PROJECT,
  startedAt: new Date().toISOString(), candidateManifestSha256: sha(manifestBytes),
  state: 'downloading', endpoints: [], absentEndpoints: manifest.endpoints.filter(e => !e.beforeProduction).map(e => e.name),
  productionChanged: false, limitations: [
    'Retains downloaded source, dependency files and observed deployment metadata, not an exact prior executable artifact.',
    'Rollback deployment and positive authorization have not been rehearsed.',
  ] };
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
save();
function files(dir) {
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name), st = lstatSync(path);
    if (st.isSymbolicLink()) throw Error('Unexpected symlink in downloaded source');
    return st.isDirectory() ? files(path) : [{ path: relative(out, path), bytes: st.size, sha256: sha(readFileSync(path)) }];
  });
}
try {
  for (const e of manifest.endpoints.filter(e => e.beforeProduction)) {
    const workdir = join(out, e.name);
    mkdirSync(workdir, { mode: 0o700 });
    const result = spawnSync('/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase',
      ['functions','download',e.name,'--project-ref',PRODUCTION_PROJECT,'--workdir',workdir],
      { env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: 'utf8', timeout: 60000, maxBuffer: 4194304 });
    if (result.status !== 0) throw Error('Source download unconfirmed: ' + e.name);
    const entry = join(workdir, 'supabase/functions', e.name, 'index.ts');
    if (!readFileSync(entry).length) throw Error('Empty entry point: ' + e.name);
    report.endpoints.push({ ...e.beforeProduction, files: files(workdir) });
    save();
    console.log(JSON.stringify({ saved: e.name, completed: report.endpoints.length }));
  }
  const after = await inventory();
  for (const e of manifest.endpoints) {
    const actual = after.find(f => f.name === e.name);
    if (e.beforeProduction ? !same(actual, e.beforeProduction) : actual)
      throw Error('Endpoint changed during backup: ' + e.name);
  }
  report.state = 'source_retained_with_unchanged_deployment_metadata';
  report.completedAt = new Date().toISOString();
  report.files = report.endpoints.reduce((n,e) => n + e.files.length, 0);
  save();
  console.log(JSON.stringify({ state: report.state, endpoints: report.endpoints.length, files: report.files }));
} catch (error) {
  report.state = 'incomplete'; report.error = error.message; save(); throw error;
}
