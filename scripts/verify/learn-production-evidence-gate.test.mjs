import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateGateEvidence, createEvidenceGate } from './learn-production-evidence-gate.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const candidate = 'a'.repeat(64), bytes = 'verified observation';
const operation = { id: 'fresh-release-preflight', kind: 'check', pinSha256: 'b'.repeat(64), contract: { requires: ['recovery', 'callers'] } };
function fixture() {
  return { version: 'learn-production-gate-evidence/1', projectRef: 'tgbnakbxwcqjeimygroz', candidateSha256: candidate,
    stepId: operation.id, stepPinSha256: operation.pinSha256, observedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    findings: ['recovery', 'callers'].map(requirement => ({ requirement, verified: true,
      conclusion: 'Exact scoped observation was verified independently.', evidence: [{ path: '.verification-results/observation.json', sha256: hash(bytes) }] })) };
}
test('binds every requirement to unchanged bytes and candidate', () => {
  const r = fixture(); assert.equal(validateGateEvidence(r, operation, candidate, { read: () => bytes }), hash(JSON.stringify(r)));
  for (const mutate of [r => r.findings.pop(), r => r.findings[0].verified = false,
    r => r.findings[1].requirement = 'recovery', r => r.candidateSha256 = 'c'.repeat(64),
    r => r.expiresAt = new Date(Date.now() - 1).toISOString(), r => r.findings[0].evidence[0].path = '.verification-results/../secret']) {
    const changed = fixture(); mutate(changed); assert.throws(() => validateGateEvidence(changed, operation, candidate, { read: () => bytes }));
  }
  assert.throws(() => validateGateEvidence(r, operation, candidate, { read: () => 'changed evidence' }));
});
test('missing gate is never treated as applied', async () => {
  let saved = false;
  const gate = createEvidenceGate({ operation, candidateSha256: candidate, loadEvidence: () => { throw Error('missing'); }, loadReceipt: () => null, saveReceipt: () => { saved = true; } });
  await assert.rejects(gate.observe(), /missing/); await assert.rejects(gate.apply(), /missing/); assert.equal(saved, false);
});
