import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { migrationBody, rehearsalSql, rehearse } from './new-dawn-invoice-check-finish-rehearse.mjs';

const repair = readFileSync(new URL('../../supabase/migrations/20261106100000_new_dawn_invoice_check_finish_ambiguity.sql', import.meta.url), 'utf8');

test('installed finish repair resolves the result-column ambiguity without expanding grants', () => {
  assert.match(repair, /comparison_rows jsonb:='\[\]'::jsonb/);
  assert.match(repair, /set state='complete',result=comparison_rows where id=r\.id;/);
  assert.doesNotMatch(repair.replace(/^--.*$/gm, ''), /result=result\b/i);
  assert.match(repair, /'audit_id',audit,'rows',comparison_rows/);
  assert.doesNotMatch(repair, /\bgrant\b|\brevoke\b|\balter table\b/i);
});

test('TEST rehearsal is rollback-only and uses retained payloads without provider access', () => {
  const sql = rehearsalSql();
  assert.ok(migrationBody('20261106100000_new_dawn_invoice_check_finish_ambiguity.sql').includes('create or replace function'));
  assert.match(sql, /jsonb_build_object\('Invoice',v\.payload\)::text/);
  assert.match(sql, /set_config\('request\.jwt\.claim\.role','service_role',true\)/);
  assert.match(sql, /jsonb_array_length\(finished->'rows'\)<>2/);
  assert.match(sql, /rollback;$/);
  assert.doesNotMatch(sql, /\bcommit;/i);
  const fixture = sql.split('do $fixture$')[1];
  assert.doesNotMatch(fixture, /vault\.decrypted_secrets|invoice_read|quickbooks\.api/i);
});

test('rehearsal returns only a bounded receipt and masks database errors', async () => {
  const ok = await rehearse(async (_url, request) => {
    assert.match(_url, /projects\/saatxzwxvdvqevbnskxy\/database\/query$/);
    assert.match(JSON.parse(request.body).query, /rollback;$/);
    return { ok:true, json:async()=>[{marker:'new-dawn-invoice-check-finish/1'}] };
  }, 'synthetic-token');
  assert.deepEqual(ok, { state:'passed_rolled_back', project:'saatxzwxvdvqevbnskxy',
    providerRequests:0, fixtureInvoices:2, privateValuesReturned:false });
  await assert.rejects(() => rehearse(async () => ({ ok:false, status:400,
    json:async()=>({ code:'42702', message:'secret invoice payload' }) }), 'synthetic-token'),
  error => error.message === 'TEST rollback rehearsal failed (HTTP 400, SQLSTATE 42702)');
});
