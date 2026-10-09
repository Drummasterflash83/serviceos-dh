// Execute the actual Edge handler with I/O replaced. These tests cover request
// rejection before any CSV parsing/canonical mutation; they are not live HTTP
// integration or a substitute for Deno runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/data-import/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics, []);
const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const importId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const csv = 'external_id\n123';
const definition = { governed: true, columns: [] };
const sealed = () => ({
  profile: { id: profileId, definition, definition_sha256: 'incorrect' },
  mapping: {}, import_options: { source: 'commusoft' }, provenance_source: 'commusoft',
});

async function request({ entity = 'jobs', contract, profileDefinition = definition, checksum, body } = {}) {
  let handler;
  const mutations = [];
  const imp = { id: importId, tenant_id: 'tenant', profile_id: profileId,
    source_system: 'commusoft', entity_type: entity, status: 'previewed',
    file_checksum: checksum ?? createHash('sha256').update(csv).digest('hex'),
    preview: contract === undefined ? {} : { sealed: contract } };
  const db = {
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, or() { return query; },
        maybeSingle: async () => ({ data: table === 'data_imports' ? imp : { definition: profileDefinition } }),
        update() { mutations.push(table); throw Error('unexpected write'); },
        insert() { mutations.push(table); throw Error('unexpected write'); },
      };
      return query;
    },
    rpc() { mutations.push('rpc'); throw Error('unexpected RPC'); },
  };
  const context = createContext({
    Deno: { serve: fn => { handler = fn; } }, Response, Request, TextEncoder, exports: {},
    crypto: webcrypto,
    require: path => {
      if (path.endsWith('/simwood.ts')) return { createSupabaseAdmin: () => db };
      if (path.endsWith('/authz.ts')) return {
        requireTenantUser: async () => ({ ok: true, ctx: { role: 'owner', userId: 'actor', tenantId: 'tenant' } }),
        assertSameTenant: () => null,
      };
      // No imported mapper, parser, matcher or audit helper may execute on a
      // rejected contract. Make unexpected use fail the test explicitly.
      return new Proxy({}, { get: () => () => { throw Error('unexpected helper execution'); } });
    },
  });
  runInContext(compiled.outputText, context);
  const response = await handler(new Request('http://localhost/data-import', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? { action: 'apply', import_id: importId, csv_text: csv }),
  }));
  assert.deepEqual(mutations, []);
  return { status: response.status, body: await response.json() };
}

test('damaged governed contracts cannot downgrade to the legacy person/job importer', async () => {
  for (const entity of ['customers', 'jobs', 'sites']) {
    for (const bad of [undefined, null, {}, { ...sealed(), import_options: null },
      { ...sealed(), import_options: undefined }, { ...sealed(), profile: undefined },
      { ...sealed(), mapping: undefined }]) {
      const result = await request({ entity, contract: bad });
      assert.ok([400, 409].includes(result.status), `${entity}: ${JSON.stringify(bad)}`);
      assert.ok(['invalid_preview', 'unsupported_entity'].includes(result.body.error.code));
    }
  }
});

test('sealed governed marker remains authoritative if live profile changes', async () => {
  const result = await request({ contract: { ...sealed(), import_options: null }, profileDefinition: { columns: [] } });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'invalid_preview');
});

test('sealed definition hash failure rejects before any import status or source mutation', async () => {
  const result = await request({ contract: sealed() });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'invalid_preview');
});

test('changed CSV rejects before any import status or source mutation', async () => {
  const result = await request({ contract: sealed(), checksum: 'different' });
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'checksum_mismatch');
});

test('unknown source entity never enters a default person importer', async () => {
  const result = await request({ entity: 'surprise' });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'unknown_entity');
});
