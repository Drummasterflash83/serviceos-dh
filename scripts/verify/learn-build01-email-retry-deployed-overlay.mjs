/** One exact patch to the downloaded TEST/LIVE platform-worker closure. */
import { createHash } from 'node:crypto';

const BASELINE = 'c3c005dac0aca97ffeaa2b871854dfba1934221199a71d3c001d81e862165187';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const BEFORE = '  const limit = Math.max(1, Math.min(currentEmail ? 100 : 200, typeof payload.limit === "number" && Number.isFinite(payload.limit) ? Math.trunc(payload.limit) : 20));';
const AFTER = `  const requestedLimit = Math.max(1, Math.min(currentEmail ? 100 : 200, typeof payload.limit === "number" && Number.isFinite(payload.limit) ? Math.trunc(payload.limit) : 20));
  // Reduce only a retried older Email batch; keep its continuation at this limit.
  const limit = !currentEmail && source === "email" && (ctx.claim?.attemptCount ?? 1) > 1
    ? Math.min(requestedLimit, 50) : requestedLimit;`;

export function patchDeployedEmailRetry(source) {
  if (sha256(source) !== BASELINE) throw Error('Deployed Email retry baseline changed');
  const first = source.indexOf(BEFORE);
  if (first < 0 || source.indexOf(BEFORE, first + BEFORE.length) >= 0)
    throw Error('Deployed Email retry anchor changed');
  return source.slice(0, first) + AFTER + source.slice(first + BEFORE.length);
}
