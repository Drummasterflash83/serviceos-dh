import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSourceCursor } from './new-dawn-m2-identity-page.mjs';

test('a tied final source key stays together and next page advances after it', () => {
  const first = Array.from({ length: 200 }, (_, i) => ({
    collection: 'jobs', external_id: String(i + 1).padStart(4, '0'),
    version_id: String(i + 1) }));
  first.push({ collection: 'jobs', external_id: '0200', version_id: 'tie' });
  const cursor = nextSourceCursor(first, null);
  assert.deepEqual(cursor, { collection: 'jobs', external_id: '0200' });
  const second = [{ collection: 'jobs', external_id: '0201', version_id: 'next' }];
  assert.deepEqual(nextSourceCursor(second, cursor),
    { collection: 'jobs', external_id: '0201' });
  assert.throws(() => nextSourceCursor(first.slice(-1), cursor), /source_page_order/);
});
