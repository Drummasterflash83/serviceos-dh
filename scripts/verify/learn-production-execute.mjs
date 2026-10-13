/** Advance the approved, pinned release to an explicit boundary. No automatic
 * gate acceptance, capture approvals, retries, rollbacks or goal completion. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { savedCliToken } from './learn-test-readiness.mjs';
import { openReleaseJournal } from './learn-production-release-journal.mjs';
import { createProductionReleaseCoordinator } from './learn-production-release-coordinator.mjs';
import { openConfigurationReceiptStore } from './learn-production-release-receipts.mjs';
import { loadSqlAdapter, productionSqlTransport } from './learn-production-sql-adapter.mjs';
import { loadRuntimeAdapter, productionManagementTransport } from './learn-production-runtime-adapter.mjs';
import { loadConfigurationAdapter, productionConfigurationTransport } from './learn-production-configuration-adapter.mjs';
import { createEvidenceGate } from './learn-production-evidence-gate.mjs';
const project = 'tgbnakbxwcqjeimygroz';
const [root, through] = process.argv.slice(2);
const check = (v, m) => { if (!v) throw Error(m); };
const sha = b => createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(readFileSync(p));
check(process.env.LEARN_PRODUCTION_RELEASE_PROJECT === project && /^\.verification-results\/production-execution-[a-z0-9-]+$/.test(root ?? ''), 'Explicit production execution scope required');
const base = 'supabase/release/learn-production/';
const plan = read(base + 'release-sequence.plan.json'), operations = read(base + 'release-operations.manifest.json');
const boundary = plan.steps.findIndex(s => s.id === through);
// Frontend promotion must be wired separately after signed-in protected-preview
// acceptance. This runner can install the backend and record its readback only.
check(boundary >= 0 && boundary <= plan.steps.findIndex(s => s.id === 'paired-runtime-acceptance'), 'Unsupported execution boundary');
const authorityBytes = readFileSync(join(root, 'authority.json')), authority = JSON.parse(authorityBytes);
check(authority.projectRef === project && authority.candidateSha256 === plan.candidateSha256 &&
  authority.planSha256 === sha(JSON.stringify(plan)) && authority.deploymentApproved === true &&
  authority.source === 'direct_user_in_this_chat' && Array.isArray(authority.userInstructions) && authority.userInstructions.length > 0 &&
  Date.parse(authority.expiresAt) > Date.now(), 'Current recorded user release authority required');
function save(path, value) {
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  const dir = openSync(root, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
const token = savedCliToken();
async function safetyObservation() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "begin transaction read only;select (select count(*) from cron.job where jobid in (35,36,37,38,39,40,41,42,44) and active=false) paused,(select count(*) from public.platform_jobs where status='running' and lease_expires_at>now()) active_leases;commit;" }),
  });
  check(response.ok, 'Current pause/lease observation unavailable');
  const rows = await response.json();
  check(rows.length === 1 && rows[0].paused === 9 && rows[0].active_leases === 0, 'Schedules or live leases changed');
}
const authorize = async step => {
  check(Date.parse(authority.expiresAt) > Date.now(), 'Release authority observation expired');
  if (['database', 'configuration', 'runtime'].includes(step.kind)) {
    const drain = read(join(root, 'verify-in-flight-drain.receipt.json'));
    check(drain.stepPinSha256 === operations.operations.find(o => o.id === 'verify-in-flight-drain').pinSha256, 'Verified drain receipt required');
    await safetyObservation();
  }
  return { projectRef: project, stepPinSha256: step.pinSha256, approvalEvidenceSha256: sha(authorityBytes) };
};
let sqlQuery;
const sql = loadSqlAdapter((query, options) => sqlQuery(query, options), { allowWrite: true, assertApprovedRelease: authorize });
sqlQuery = productionSqlTransport(token, { allowWrite: true, writeStatements: sql.writeStatements });
const receiptPath = join(root, 'configuration');
const configurationReceipts = openConfigurationReceiptStore(receiptPath, { create: !existsSync(receiptPath) });
const journalPath = join(root, 'journal');
const journal = openReleaseJournal(journalPath, plan, { create: !existsSync(journalPath) });
const checks = Object.fromEntries(operations.operations.filter(o => o.kind === 'check').map(operation => [operation.id,
  createEvidenceGate({ operation, candidateSha256: plan.candidateSha256,
    loadEvidence: id => read(join(root, id + '.evidence.json')),
    loadReceipt: id => existsSync(join(root, id + '.receipt.json')) ? read(join(root, id + '.receipt.json')) : null,
    saveReceipt: (id, receipt) => save(join(root, id + '.receipt.json'), receipt),
  })]));
const coordinator = createProductionReleaseCoordinator({ plan, operations, journal, sql, configurationReceipts, checks, authorize,
  createRuntime: async receipt => loadRuntimeAdapter(productionManagementTransport(token, { allowWrite: true }), {
    allowWrite: true, assertApprovedAndDrained: authorize, configurationRefresh: receipt,
    readBody: name => readFileSync(join('.verification-results/production-runtime-wire-20261013-campaign', name)),
  }),
  createConfiguration: async operation => {
    check(operation.id === 'matching-server-configuration', 'Capture activation excluded from this runner');
    const preparation = read(join(root, 'configuration-preflight.json'));
    const allowedDigests = { ...preparation.desiredSecretDigests,
      LEARN_STATUS_READ_MODE: sha('production_metadata_views'), LEARN_INPUT_DISPATCH_ENABLED: sha('false') };
    const api = productionConfigurationTransport(token, { allowWrite: true, allowedDigests });
    return loadConfigurationAdapter(api, { baseline: preparation.baseline, desiredSecretDigests: preparation.desiredSecretDigests,
      allowWrite: true, assertApprovedRelease: authorize,
      readSecret: async name => {
        check(['LEARN_COMMUSOFT_WORKER_KEY', 'LEARN_SLACK_WORKER_KEY'].includes(name), 'Unexpected credential request');
        const r = await fetch(`https://api.supabase.com/v1/projects/${project}/api-keys?reveal=true`, {
          headers: { Authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(30000) });
        check(r.ok, 'Existing credential unavailable');
        const matches = (await r.json()).filter(k => k.name === 'service_role');
        check(matches.length === 1 && sha(matches[0].api_key) === allowedDigests[name], 'Existing credential binding changed');
        return matches[0].api_key;
      },
    });
  },
});
try {
  while (coordinator.status().completed <= boundary) {
    const prior = coordinator.status();
    console.log(JSON.stringify({ step: prior.nextStep, phase: 'starting', completed: prior.completed }));
    const result = await coordinator.next();
    console.log(JSON.stringify(result));
    if (result.state === 'unknown_outcome' || result.completed === prior.completed) { process.exitCode = 2; break; }
  }
} finally { journal.close(); }
