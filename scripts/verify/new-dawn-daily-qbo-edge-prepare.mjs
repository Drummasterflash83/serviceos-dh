/** Compile the exact daily-report Edge source locally; never deploy. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { edgeRuntimeBundle } from './learn-email-runtime-edge-bundle.mjs';

const PROJECT = 'tgbnakbxwcqjeimygroz';
const ENDPOINT = 'learn-quickbooks-daily-reports';
const SOURCE_CLOSURE_SHA256 = '1f86201a20b360dd908d6bc2e04a8af894e8029b253da01771b3d611fdd86a2e';
const IMAGE = 'public.ecr.aws/supabase/edge-runtime:v1.74.3';
const IMAGE_ID = 'sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c';
const DOCKER = '/usr/local/bin/docker';
const sha = value => createHash('sha256').update(value).digest('hex');

export function reviewedBundle() {
  const bundle = edgeRuntimeBundle([{ name: ENDPOINT, verifyJwt: false }]);
  if (bundle.sha256 !== SOURCE_CLOSURE_SHA256 || bundle.files.length !== 10 ||
    JSON.stringify(bundle.external) !== JSON.stringify(['https://esm.sh/@supabase/supabase-js@2.45.4']) ||
    !bundle.files.some(file => file.path === 'learn-quickbooks-daily-reports/index.ts' &&
      file.source.includes('Deno.env.get("LEARN_QUICKBOOKS_DAILY_REPORT_KEY")')))
    throw Error('daily_report_edge_source_changed');
  return bundle;
}

export function prepare(out, runner = spawnSync) {
  const root = resolve('.verification-results') + '/', target = resolve(out);
  if (!target.startsWith(root) || existsSync(target)) throw Error('fresh_private_output_required');
  const bundle = reviewedBundle();
  const inspected = runner(DOCKER, ['image', 'inspect', IMAGE, '--format', '{{.Id}}'],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (inspected.status !== 0 || inspected.stdout.trim() !== IMAGE_ID)
    throw Error('pinned_edge_runtime_unavailable');
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const stage = join(target, 'stage'), artifacts = join(target, 'artifacts'), cache = join(target, 'cache');
  for (const folder of [stage, artifacts, cache]) mkdirSync(folder, { mode: 0o700 });
  for (const file of bundle.files) {
    const path = join(stage, 'supabase/functions', file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.source, { mode: 0o600 });
  }
  writeFileSync(join(stage, 'supabase/config.toml'),
    `project_id = "${PROJECT}"\n[functions.${ENDPOINT}]\nverify_jwt = false\n`, { mode: 0o600 });
  writeFileSync(join(stage, 'deno.json'), JSON.stringify({ nodeModulesDir: 'auto' }), { mode: 0o600 });
  const report = { state: 'building', project: PROJECT, endpoint: ENDPOINT, verifyJwt: false,
    image: IMAGE, imageId: IMAGE_ID, sourceClosureSha256: bundle.sha256,
    sourceFiles: bundle.files.map(file => ({ path: file.path, sha256: sha(file.source) })),
    external: bundle.external, productionChanged: false, providerRequests: 0,
    preparedAt: new Date().toISOString() };
  const save = () => writeFileSync(join(target, 'candidate.private.json'),
    JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  save();
  const built = runner(DOCKER, ['run', '--rm', '--pull=never', '--network', 'bridge',
    '--memory', '768m', '--cpus', '2', '--env', 'DENO_DIR=/cache',
    '--mount', `type=bind,source=${stage},target=/work`,
    '--mount', `type=bind,source=${artifacts},target=/artifacts`,
    '--mount', `type=bind,source=${cache},target=/cache`, '--workdir', '/work', IMAGE,
    'bundle', '--entrypoint', `/work/supabase/functions/${ENDPOINT}/index.ts`,
    '--output', `/artifacts/${ENDPOINT}.eszip`, '--checksum', 'sha256', '--timeout', '55'],
  { encoding: 'utf8', timeout: 65000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(target, 'compile.log'), (built.stdout ?? '') + (built.stderr ?? ''), { mode: 0o600 });
  if (built.status !== 0) { report.state = 'compile_unconfirmed'; save();
    throw Error('daily_report_edge_compile_unconfirmed'); }
  if (bundle.files.some(file => readFileSync(join(stage, 'supabase/functions', file.path), 'utf8') !== file.source))
    throw Error('daily_report_stage_changed_during_compile');
  const bytes = readFileSync(join(artifacts, `${ENDPOINT}.eszip`));
  if (bytes.length < 1000 || bytes.length > 20 * 1024 * 1024)
    throw Error('daily_report_eszip_size_unverified');
  const wire = Buffer.concat([Buffer.from('EZBR'), brotliCompressSync(bytes,
    { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })]);
  if (!brotliDecompressSync(wire.subarray(4)).equals(bytes))
    throw Error('daily_report_wire_roundtrip_changed');
  writeFileSync(join(artifacts, `${ENDPOINT}.ezbr`), wire, { mode: 0o600, flag: 'wx' });
  Object.assign(report, { state: 'compiled_local_candidate', eszipSha256: sha(bytes),
    eszipBytes: bytes.length, ezbrSha256: sha(wire), ezbrBytes: wire.length,
    completedAt: new Date().toISOString() });
  save();
  return { state: report.state, project: PROJECT, sourceClosureSha256: bundle.sha256,
    eszipSha256: report.eszipSha256, ezbrSha256: report.ezbrSha256,
    productionChanged: false, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== '--prepare-only' ||
      process.argv[3] !== '--out' || process.env.NEW_DAWN_QBO_PROJECT !== PROJECT)
      throw Error('exact_prepare_scope_required');
    console.log(JSON.stringify(prepare(process.argv[4])));
  } catch (error) {
    console.error(JSON.stringify({ state: 'stopped', reason: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  }
}
