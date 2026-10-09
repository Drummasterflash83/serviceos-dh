import test from 'node:test';
import assert from 'node:assert/strict';
import { fixturePlan } from './learn-test-launch-acceptance.mjs';
import { addFoundationFixtures,foundationRows,foundationCleanupSql,foundationAbsenceSql } from './learn-foundation-acceptance.mjs';
test('foundation fixtures stay within two new synthetic tenants with distinct linked IDs',()=>{
 const base=fixturePlan(),p=addFoundationFixtures(base);
 const ids=[];
 for(const f of p.foundation){
  assert.ok(base.tenants.some(t=>t.id===f.tenant));assert.ok(base.users.some(u=>u.id===f.user&&u.tenant===f.tenant));
  const rows=foundationRows(f);assert.equal(rows.length,12);
  for(const [t,r] of rows){if(t!=='org_unit_members'){assert.equal(r.tenant_id,f.tenant);ids.push(r.id);}}
  const card=rows.find(([t])=>t==='customer_cards')[1];assert.equal(card.person_id,f.people);assert.equal(card.company_id,f.companies);
 }
 assert.equal(new Set(ids).size,22);assert.equal(JSON.stringify(p).includes('password'),false);
});
test('cleanup requires exact fixture identity plus tenant ownership marker, with absence checks independent of marker',()=>{
 const p=addFoundationFixtures(fixturePlan()),sql=foundationCleanupSql(p),absence=foundationAbsenceSql(p);
 assert.match(sql,/^begin;/);assert.match(sql,/commit;$/);
 for(const f of p.foundation){
  for(const [table,row] of foundationRows(f)){
   const lines=sql.split(';').filter(s=>s.startsWith(`delete from public.${table} where`));
   assert.ok(lines.some(s=>s.includes(row.id??row.org_unit_id)&&s.includes(f.tenant)&&s.includes(p.runId)));
   assert.ok(absence.includes(row.id??row.org_unit_id));
  }
 }
 assert.doesNotMatch(sql,/delete from public\.(tenants|profiles|email_messages|phone_calls)/);
 assert.doesNotMatch(absence,/learn_acceptance_run/);
});
