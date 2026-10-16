/** Rollback-only synthetic draft/tenant/window check on released TEST function. */
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { TEST_PROJECT, savedCliToken } from './learn-test-readiness.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
if(process.argv.slice(2).join(' ')!=='--test-rollback-only'||
 process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
 throw Error('Exact TEST rollback-only mode required');
const token=savedCliToken();
const stem=randomBytes(3).toString('hex');
const fixtureAbsent=`select not exists(select 1 from public.tenants where id in
 ('${stem}00-aaaa-4000-8000-000000000001'::uuid,
  '${stem}00-aaaa-4000-8000-000000000009'::uuid)) absent`;
const before=await communicationQuery(token,fixtureAbsent);
if(before.length!==1||before[0].absent!==true)throw Error('Synthetic fixture baseline changed');
const fn=await communicationQuery(token,`select pg_get_functiondef(
 'public.learn_card_projection_inputs(uuid,uuid)'::regprocedure) definition`);
const sha=value=>createHash('sha256').update(value).digest('hex');
if(fn.length!==1||sha(fn[0].definition)!==
 '756f137b80b5fa9a89c2d47d451a7453b47e238ef588a47ac9dddd269f0aeb5f')
 throw Error('TEST card function source changed');
const assertions=readFileSync('scripts/verify/learn-production-card-draft.assert.sql','utf8')
 .replaceAll('ed3900',stem)
 .replace('card-draft-rehearsal',`card-prefilter-${stem}`)
 .replace('card-draft-other',`card-prefilter-other-${stem}`);
const rows=await communicationQuery(token,`begin;
 set local lock_timeout='3s';set local statement_timeout='30s';
 ${assertions}
 select 'card_draft_prefilter_passed' marker;rollback;`,{readOnly:false});
if(!Array.isArray(rows)||!rows.some(r=>r.marker==='card_draft_prefilter_passed'))
 throw Error('Card draft assertion marker missing');
const after=await communicationQuery(token,fixtureAbsent);
if(after.length!==1||after[0].absent!==true)throw Error('Synthetic fixture not rolled back');
console.log(JSON.stringify({state:'test_card_draft_prefilter_rehearsed',project:TEST_PROJECT,
 functionSha256:sha(fn[0].definition),draftInteractionsExcluded:110,
 retainedInteractions:105,draftRecommendationsExcluded:1,
 retainedRecommendations:51,tenantIsolationVerified:true,fixtureRolledBack:true,
 productionChanged:false}));
