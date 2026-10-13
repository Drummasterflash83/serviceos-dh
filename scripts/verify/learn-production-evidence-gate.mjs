/** Bind a reviewed observation to one exact release check. Evidence is gathered
 * separately: this adapter never turns a missing check into a passing result. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const sha = value => createHash('sha256').update(value).digest('hex');
const check = (value, message) => { if (!value) throw Error(message); };
export function validateGateEvidence(record, operation, candidateSha256, { read = readFileSync, now = Date.now() } = {}) {
  check(operation.kind === 'check' && record.version === 'learn-production-gate-evidence/1' &&
    record.projectRef === 'tgbnakbxwcqjeimygroz' && record.candidateSha256 === candidateSha256 &&
    record.stepId === operation.id && record.stepPinSha256 === operation.pinSha256,
  'Gate evidence scope differs');
  check(Number.isFinite(Date.parse(record.observedAt)) && Number.isFinite(Date.parse(record.expiresAt)) &&
    Date.parse(record.observedAt) <= now && now < Date.parse(record.expiresAt) &&
    Date.parse(record.expiresAt) - Date.parse(record.observedAt) <= 86400000,
  'Gate evidence is expired or has invalid dates');
  check(Array.isArray(record.findings) && record.findings.length === operation.contract.requires.length &&
    new Set(record.findings.map(f => f.requirement)).size === record.findings.length &&
    operation.contract.requires.every(r => record.findings.some(f => f.requirement === r)),
  'Gate evidence does not cover every requirement');
  for (const finding of record.findings) {
    check(finding.verified === true && typeof finding.conclusion === 'string' && finding.conclusion.length >= 20 &&
      Array.isArray(finding.evidence) && finding.evidence.length > 0, 'Unverified gate finding');
    for (const evidence of finding.evidence) {
      check(typeof evidence.path === 'string' && !evidence.path.split('/').includes('..') &&
        /^(?:\.verification-results|docs\/operations(?:\/evidence)?)\/[a-zA-Z0-9_./-]+$/.test(evidence.path) &&
        /^[a-f0-9]{64}$/.test(evidence.sha256) && sha(read(evidence.path)) === evidence.sha256,
      'Gate evidence bytes differ');
    }
  }
  return sha(JSON.stringify(record));
}
export function createEvidenceGate({ operation, candidateSha256, loadEvidence, loadReceipt, saveReceipt }) {
  const verified = () => {
    const evidence = loadEvidence(operation.id);
    return { evidence, hash: validateGateEvidence(evidence, operation, candidateSha256) };
  };
  return {
    async observe() {
      const { hash } = verified(), receipt = loadReceipt(operation.id);
      if (receipt && (receipt.stepPinSha256 !== operation.pinSha256 || receipt.evidenceSha256 !== hash))
        throw Error('Gate receipt differs from reviewed evidence');
      return { state: receipt ? 'applied' : 'ready', evidenceSha256: hash };
    },
    async apply() {
      const { hash } = verified();
      saveReceipt(operation.id, { stepPinSha256: operation.pinSha256, evidenceSha256: hash });
    },
  };
}
