/** Read-only gateway compatibility probe on the retained production runtime.
 * GET stops at the reviewed method guard, before auth/database/provider logic.
 * This is NOT positive application authorization or candidate acceptance.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz', name = 'simwood-test-connection';
const output = process.argv[2];
if (process.env.LEARN_PRODUCTION_READ_ONLY_PROJECT !== project ||
    !/^\.verification-results\/[a-z0-9-]+\.json$/.test(output ?? ''))
  throw Error('Explicit production read-only target and private report required');
const sha = b => createHash('sha256').update(b).digest('hex');
const manifestBytes = readFileSync('supabase/release/learn-production/runtime-candidate.manifest.json');
const manifest = JSON.parse(manifestBytes);
const endpoint = manifest.endpoints.find(e => e.name === name);
const root = '.verification-results/production-runtime-backup-20261012/';
const backup = JSON.parse(readFileSync(root + 'report.json'));
const retained = backup.endpoints.find(e => e.name === name);
const sourcePath = `${name}/supabase/functions/${name}/index.ts`;
const source = readFileSync(root + sourcePath);
const fields = ['name', 'id', 'version', 'hash', 'jwt', 'status'];
const equal = (a, b) => a && b && fields.every(k => a[k] === b[k]);
if (manifest.projectRef !== project || backup.projectRef !== project ||
    backup.state !== 'source_retained_with_unchanged_deployment_metadata' ||
    !equal(retained, endpoint?.beforeProduction) || retained.jwt !== true ||
    retained.files.find(f => f.path === sourcePath)?.sha256 !== sha(source) ||
    // The reviewed guard is before date/input/environment/client/auth/provider work.
    !source.toString().includes('if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);\n  const startedAt'))
  throw Error('Retained method guard or production baseline differs');
const token = savedCliToken();
async function management(path) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error(`Management read failed (${r.status})`);
  return r.json();
}
async function metadata() {
  const f = await management('/functions/' + name);
  const value = { name: f.slug, id: f.id, version: f.version, hash: f.ezbr_sha256,
    jwt: f.verify_jwt, status: f.status };
  if (!equal(value, endpoint.beforeProduction)) throw Error('Production endpoint drift');
  return value;
}
const before = await metadata();
const keys = await management('/api-keys?reveal=true');
const service = keys.filter(k => k.name === 'service_role');
if (service.length !== 1 || typeof service[0].api_key !== 'string') throw Error('Existing service credential unavailable');
const key = service[0].api_key;
const parts = key.split('.');
if (parts.length !== 3) throw Error('Existing service credential is not a JWT');
const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
const claims = JSON.parse(Buffer.from(parts[1], 'base64url'));
if (claims.ref !== project || claims.role !== 'service_role' || header.alg !== 'HS256' ||
    !Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now())
  throw Error('Service credential does not match reviewed production JWT contract');
const checks = [];
// Invalid/missing bearers prove the gateway is being exercised. A successful GET
// must produce the exact method guard, not a provider or application response.
for (const variant of ['missing', 'invalid', 'existing_service']) {
  const r = await fetch(`https://${project}.supabase.co/functions/v1/${name}`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: variant === 'missing' ? {} : {
      Authorization: 'Bearer ' + (variant === 'existing_service' ? key : 'invalid-gateway-probe'),
      ...(variant === 'existing_service' ? { apikey: key } : {}),
    },
  });
  const body = await r.json().catch(() => null);
  checks.push({ variant, status: r.status, passed: variant === 'existing_service'
    ? r.status === 405 && body?.ok === false && body?.error?.code === 'method_not_allowed' && body?.error?.message === 'Use POST'
    : r.status === 401,
  });
}
const after = await metadata();
const passed = checks.every(c => c.passed) && equal(before, after);
const report = {
  version: 'learn-production-gateway-probe/1', observedAt: new Date().toISOString(), project,
  state: passed ? 'existing_service_jwt_gateway_verified_read_only' : 'gateway_check_failed',
  candidateManifestSha256: sha(manifestBytes), endpoint: before, retainedEntrypointSha256: sha(source),
  method: 'GET', checks, deploymentUnchanged: equal(before, after),
  credential: { existing: true, role: claims.role, algorithm: header.alg, projectMatches: true, valuesRetained: false },
  productionDataChanges: 0, providerRequests: 0,
  limitations: [
    'Verifies the current production gateway accepts its existing service JWT and rejects absent/invalid bearers on one unchanged protected endpoint.',
    'GET exits before application authorization. This does not verify tenant/user roles, candidate POST behavior, the thirteen proposed gateway changes or signed-in acceptance.',
    'Retained source hashes and before/after deployment metadata bound the method guard review. No deployment, credentials or permissions were changed.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ state: report.state, checks, productionDataChanges: 0, providerRequests: 0 }));
if (!passed) process.exitCode = 1;
