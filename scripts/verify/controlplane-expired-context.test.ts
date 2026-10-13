import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePlatformOperator } from '../../supabase/functions/_shared/controlplane/authz.ts';

function client(contexts: { expires_at: string | null }[]) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'operator', email: 'operator@example.invalid' } } }) },
    from(table: string) {
      let rows = table === 'view_as_context' ? contexts : [];
      let maximum = Infinity;
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; },
        or(filter: string) {
          const prefix = 'expires_at.is.null,expires_at.gt.';
          assert.ok(filter.startsWith(prefix));
          const now = Date.parse(filter.slice(prefix.length));
          rows = rows.filter(row => row.expires_at === null || Date.parse(row.expires_at) > now);
          return query;
        },
        limit(n: number) { maximum = n; return query; },
        async maybeSingle() {
          if (table === 'profiles') return { data: { role: 'owner' }, error: null };
          const result = rows.slice(0, maximum);
          return result.length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: result[0] ?? null, error: null };
        },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [{ permission: 'platform.controlplane.admin' }], error: null }).then(resolve); },
      };
      return query;
    },
  };
}
const req = () => new Request('https://example.invalid', { headers: { Authorization: 'Bearer existing-test-user' } });
const expired = { expires_at: '2020-01-01T00:00:00Z' };
const future = { expires_at: '2099-01-01T00:00:00Z' };
test('multiple expired contexts do not block a current operator', async () => {
  const result = await requirePlatformOperator(req(), client([expired, expired]) as never, { requireAdmin: true });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.ctx.viewAsActive, false);
});
for (const contexts of [[expired, future], [future, future], [{ expires_at: null }]]) {
  test('any current View-As context still prohibits configuration: ' + JSON.stringify(contexts), async () => {
    const result = await requirePlatformOperator(req(), client(contexts) as never, { requireAdmin: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'read_only_view_active');
    const read = await requirePlatformOperator(req(), client(contexts) as never);
    assert.equal(read.ok, true);
    if (read.ok) assert.equal(read.ctx.viewAsActive, true);
  });
}
