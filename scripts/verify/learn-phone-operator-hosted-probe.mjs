/** Positive operator checks confined to the caller's rolled-back TEST transaction.
 * Banned synthetic identities have no password/session and never become visible
 * outside that transaction. No provider or Auth API calls are made. */
import { readFileSync } from 'node:fs';
import { phoneProcessingHostedProbe } from './learn-phone-processing-hosted-probe.mjs';
export function phoneOperatorHostedProbe() {
 let sql=readFileSync('scripts/verify/learn-phone-operator-attempts.assert.sql','utf8');
 const replaceOnce=(from,to)=>{if(sql.split(from).length!==2)throw Error('Operator assertion adapter changed');sql=sql.replace(from,to);};
 replaceOnce('insert into profiles(id) values(fixture_id(800)),(fixture_id(801)),(fixture_id(802));',
 `insert into auth.users(id,email,banned_until) select fixture_id(n),'phone-rollback-'||n||'@example.invalid','infinity'::timestamptz from generate_series(800,802)n;
 insert into profiles(id) values(fixture_id(800)),(fixture_id(801)),(fixture_id(802)) on conflict(id) do nothing;`);
 replaceOnce('platform_authority_grants(profile_id,permission,effective_from,effective_to)',
 'platform_authority_grants(profile_id,permission,effective_from,effective_to,granted_by,reason)');
 sql=sql.replaceAll("now()+interval '1 hour'),","now()+interval '1 hour','rollback-probe','Uncommitted synthetic assertion'),")
  .replaceAll("now()+interval '1 hour');","now()+interval '1 hour','rollback-probe','Uncommitted synthetic assertion');");
 sql=sql.replace(/00000000-0000-4000-8000-00000000080([012])/g,'fae019ce-714a-4f0f-971b-00000000080$1');
 sql=sql.replace(/\bfixture_(id|derived|operator_audit_failure)\(/g,'pg_temp.fixture_$1(');
 sql=sql.replace(/set request\.jwt/g,'set local request.jwt').replace(/set role /g,'set local role ');
 sql=sql.replace(/^select 'PASS:[^\n]*';$/gm,'');
 return phoneProcessingHostedProbe()+`
 do $grant_probe$declare fn record;begin
 for fn in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace=pg_my_temp_schema() and p.proname like 'fixture_%'
 loop execute format('grant execute on function %s to authenticated',fn.signature);end loop;
 end $grant_probe$;
 ${sql}
 `;
}
