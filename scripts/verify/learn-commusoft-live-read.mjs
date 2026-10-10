/** Explicit, bounded diagnostic of Chris's existing private application.
 * Two GETs at most, one record each, no traversal, retry, database or provider
 * mutation. This does not establish a hosted tenant/connection authority.
 * Credential and raw records never enter the report or command arguments.
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readCommusoftPage, CommusoftReadError } from '../../supabase/functions/_shared/commusoft/read_page.ts';

const root = new URL('../../.verification-results/', import.meta.url);
const keyFile = new URL('commusoft-existing-private-key', root);
const journal = new URL('commusoft-live-read-journal.json', root);

// Keep a small classification, never response headers, error bodies or request IDs.
// An HTML denial cannot establish that the API key itself was evaluated.
export function responseFormat(headers) {
  const mime = (headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(mime)) return 'json';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  return mime ? 'other' : 'unknown';
}
function nextCheck(status, format) {
  if ([401, 403].includes(status) && format !== 'json') return 'confirm_account_and_access_layer_with_provider';
  if (status === 401) return 'confirm_existing_key_status_and_environment';
  if (status === 403) return 'confirm_resource_read_scope_and_account_access';
  if (status === 429) return 'respect_provider_retry_time';
  return null;
}

export async function inspectExistingApp(apiKey, { fetcher = fetch, recordAttempt, clock = Date.now } = {}) {
  if (typeof recordAttempt !== 'function') throw new Error('Attempt journal required');
  const checks = [];
  for (const resource of ['properties', 'jobs']) {
    await recordAttempt(resource);
    const check = { resource, method: 'GET', limit: 1, httpStatus: null, responseFormat: 'unknown' };
    try {
      const page = await readCommusoftPage({ region: 'uk', resource, limit: 1, after: null }, apiKey, {
        // Direct user-authorized diagnostic only; never use as a worker permit.
        stillAuthorized: async () => true,
        clock,
        fetcher: async (url, options) => {
          const response = await fetcher(url, options);
          check.httpStatus = response.status;
          check.responseFormat = responseFormat(response.headers);
          return response;
        },
      });
      checks.push({ ...check, state: 'passed', records: page.records.length,
        hasMore: !page.collectionExhausted, quota: page.quota });
      if (page.quota.retryAt !== null) break;
    } catch (error) {
      checks.push({ ...check, state: 'failed', nextCheck: nextCheck(check.httpStatus, check.responseFormat), code: error instanceof CommusoftReadError ? error.code : 'diagnostic_failed',
        retryAt: error instanceof CommusoftReadError ? error.retryAt : null });
      break;
    }
  }
  return checks;
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--existing-local-key') throw new Error('Explicit existing credential flag required');
  const metadata = await stat(keyFile);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0 || metadata.size > 4096) throw new Error('Private credential file required');
  const apiKey = (await readFile(keyFile, 'utf8')).trim();
  const report = { version: 'learn-commusoft-live-read/1', observedAt: new Date().toISOString(),
    application: 'OpenFolk — Drummonds read-only', observedScopes: ['crm.properties.read', 'jobs.jobs.read'],
    region: 'uk', attempts: [], checks: [], state: 'started',
    limitations: ['Direct provider diagnostic only; no hosted connection, account-identity proof, import, traversal or scheduling.',
      'Contacts access not requested or established. No source records or credentials in this report.'] };
  // Exclusive creation prevents repeating an ambiguous previous attempt.
  await writeFile(journal, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  report.checks = await inspectExistingApp(apiKey, { recordAttempt: async resource => {
    report.attempts.push({ resource, startedAt: new Date().toISOString() });
    await writeFile(journal, JSON.stringify(report, null, 2), { mode: 0o600 });
  } });
  report.state = report.checks.length === 2 && report.checks.every(c => c.state === 'passed') ? 'passed' : 'not_verified';
  report.completedAt = new Date().toISOString();
  await writeFile(journal, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('Diagnostic stopped; inspect the sanitized private journal before any further request.');
  process.exitCode = 1;
});
