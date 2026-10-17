/** Owner-only, bounded adoption of source-equivalent legacy Email links. */
import assert from 'node:assert/strict';
import { savedCliToken } from './learn-test-readiness.mjs';

const project = 'tgbnakbxwcqjeimygroz';
const tenant = '00000000-0000-0000-0000-000000000001';
const mode = process.argv.slice(2).join(' ');
if (!['--rollback-first-page', '--adopt'].includes(mode) ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error('Exact LIVE mode and project allowlist required');
const uuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: false }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`LIVE legacy adoption HTTP ${response.status}: ${String(detail.message ?? detail.code ?? '').slice(0, 240)}`);
  }
  return response.json();
}
if (mode === '--rollback-first-page') {
  const rehearsal = `begin;
set local lock_timeout='5s';set local statement_timeout='40s';
create temp table legacy_before on commit drop as
 select i.id,i.source_id,to_jsonb(i)-'metadata'-'updated_at' canonical
 from public.interactions i
 where i.tenant_id='${tenant}'::uuid and i.source_table='email_messages'
  and not(i.metadata?'source_projection')
 order by i.id limit 50;
do $check$ declare result jsonb;adopted integer;begin
 result:=public.learn_email_adopt_equivalent_legacy('${tenant}'::uuid,null,50);
 if (result->>'checked')::int<>(select count(*) from legacy_before)
 then raise exception 'legacy_page_changed_during_rehearsal';end if;
 if exists(select 1 from legacy_before b join public.interactions i on i.id=b.id
  where to_jsonb(i)-'metadata'-'updated_at' is distinct from b.canonical)
 then raise exception 'legacy_canonical_field_changed';end if;
 select count(*) into adopted from legacy_before b join public.interactions i on i.id=b.id
  where i.metadata?'source_projection';
 if adopted<>(result->>'adopted')::int or adopted=0
 then raise exception 'legacy_adoption_count_unexpected';end if;
 if adopted<>(select count(*) from public.learn_interaction_projection_receipts r
   join legacy_before b on b.source_id=r.source_id
   where r.tenant_id='${tenant}'::uuid and r.receipt->>'action'='legacy_equivalent_adopted')
 then raise exception 'legacy_receipt_count_unexpected';end if;
end $check$;
select jsonb_build_object('first_page_checked',(select count(*) from legacy_before),
 'first_page_adopted',(select count(*) from legacy_before b join public.interactions i on i.id=b.id
  where i.metadata?'source_projection'),'canonical_fields_preserved',true,'rollback_only',true) result;
rollback;`;
  const rows = await query(rehearsal);
  assert(rows?.[0]?.result?.rollback_only === true &&
    rows[0].result.first_page_adopted > 0);
  const after = await query(`begin read only;select count(*)::int adopted_receipts
    from public.learn_interaction_projection_receipts
    where tenant_id='${tenant}'::uuid and receipt->>'action'='legacy_equivalent_adopted';rollback;`);
  assert(after?.[0]?.adopted_receipts === 0, 'Rollback retained adoption receipts');
  console.log(JSON.stringify({ state: 'live_legacy_first_page_rollback_verified',
    ...rows[0].result, retainedAdoptionReceipts: 0,
    productionDataWrites: false }));
} else {
  let cursor = null;
  let checked = 0;
  let adopted = 0;
  let pages = 0;
  while (pages < 500) {
    const after = cursor ? `'${cursor}'::uuid` : 'null::uuid';
    const rows = await query(`select public.learn_email_adopt_equivalent_legacy(
      '${tenant}'::uuid,${after},50) result`);
    const result = rows?.[0]?.result;
    assert(result?.version === 'learn-email-legacy-adoption/1' &&
      Number.isInteger(result.checked) && result.checked >= 0 && result.checked <= 50 &&
      Number.isInteger(result.adopted) && result.adopted >= 0 &&
      result.adopted <= result.checked && typeof result.end_of_scan === 'boolean',
      'LIVE legacy adoption receipt shape changed');
    if (result.checked) {
      assert(uuid(result.next_after) &&
        (cursor === null || result.next_after > cursor),
        'LIVE legacy adoption cursor did not advance');
      cursor = result.next_after;
    }
    checked += result.checked;
    adopted += result.adopted;
    pages++;
    if (pages % 25 === 0 || result.end_of_scan)
      console.log(JSON.stringify({ state: result.end_of_scan ? 'complete' : 'in_progress',
        pages, checked, adopted, sourceIdsReturned: false,
        messageContentReturned: false }));
    if (result.end_of_scan) break;
  }
  assert(pages < 500, 'LIVE legacy adoption page budget exceeded');
}
