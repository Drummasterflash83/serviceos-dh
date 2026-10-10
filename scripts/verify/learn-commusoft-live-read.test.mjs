import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectExistingApp } from './learn-commusoft-live-read.mjs';

test('bounded reads use existing transport and retain no source values', async () => {
  const attempts = []; const requests = [];
  const result = await inspectExistingApp('synthetic-test-key', {
    recordAttempt: async resource => attempts.push(resource),
    fetcher: async (url, options) => {
      requests.push({ url, options });
      assert.equal(attempts.length, requests.length);
      return new Response(JSON.stringify({ data: [{ id: 1, name: 'PRIVATE SOURCE VALUE' }], pagination: { hasMore: true, nextCursor: 1 } }),
        { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(attempts, ['properties', 'jobs']);
  assert.equal(result.length, 2);
  assert.ok(result.every(r => r.state === 'passed' && r.records === 1));
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  for (const request of requests) {
    assert.equal(new URL(request.url).origin, 'https://app.commusoft.co.uk');
    assert.equal(new URL(request.url).search, '?limit=1');
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'error');
  }
  assert.equal(requests[1].options.headers['X-API-VERSION'], '2.1');
});

test('denied or throttled reads do not retry or request another collection', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const result = await inspectExistingApp('synthetic-test-key', {
      recordAttempt: async () => {},
      fetcher: async () => { calls++; return new Response('PRIVATE ERROR VALUE', { status }); },
    });
    assert.equal(calls, 1);
    assert.equal(result[0].state, 'failed');
    assert.equal(result[0].httpStatus, status);
    assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
});

test('failed journal prevents provider access', async () => {
  let calls = 0;
  await assert.rejects(inspectExistingApp('synthetic-test-key', {
    recordAttempt: async () => { throw Error('journal unavailable'); },
    fetcher: async () => { calls++; throw Error('must not call'); },
  }));
  assert.equal(calls, 0);
});
