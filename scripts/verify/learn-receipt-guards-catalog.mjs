/** Complete preceding release plus the four private functions and three constraints. */
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { CARD_SEARCH_CATALOG, CARD_SEARCH_SNAPSHOT, CARD_SEARCH_PRESERVED } from './learn-card-search-catalog.mjs';
export const RECEIPT_GUARD_NAMES=['learn_measurement_receipt_guard','learn_review_receipt_guard','learn_assessment_receipt_guard'];
const names=RECEIPT_GUARD_NAMES.map(n=>`'${n}'`).join(',');
const filters=[
 ['from pg_constraint where conrelid=c.oid',`from pg_constraint where conrelid=c.oid and conname not in (${names})`],
 ['from pg_constraint x where x.conrelid=c.oid',`from pg_constraint x where x.conrelid=c.oid and x.conname not in (${names})`],
 ['from pg_trigger where tgrelid=c.oid and not tgisinternal',`from pg_trigger where tgrelid=c.oid and not tgisinternal and tgname not in (${names})`],
 ['from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal',`from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal and t.tgname not in (${names})`],
];
export const RECEIPT_GUARD_BASE=filters.reduce((sql,[from,to])=>{if(!sql.includes(from))throw Error('Prior catalog normalization anchor changed');return sql.replaceAll(from,to)},CARD_SEARCH_CATALOG);
export const RECEIPT_GUARD_FUNCTIONS=['learn_work_measurement_receipt_check','learn_measurement_receipt_constraint','learn_review_receipt_constraint','learn_assessment_receipt_constraint'];
export const RECEIPT_GUARD_CATALOG=`jsonb_build_object('base',${RECEIPT_GUARD_BASE},
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${RECEIPT_GUARD_FUNCTIONS.map(n=>`'${n}'`).join(',')})),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled,'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred) order by c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and t.tgname in (${names})),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid),'type',x.contype,'deferrable',x.condeferrable,'initiallyDeferred',x.condeferred) order by c.relname,x.conname),'[]') from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and x.conname in (${names})),
 'ledger',(select jsonb_agg(jsonb_build_object('name',migration_name,'sha256',source_sha256,'project',project_ref) order by migration_name) from of_test_deploy.migrations))`;
export const RECEIPT_GUARD_SNAPSHOT=CARD_SEARCH_SNAPSHOT;
export const RECEIPT_GUARD_PRESERVED=CARD_SEARCH_PRESERVED;
export async function readReceiptGuardCatalog(token,options){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with snapshot as materialized(select ${RECEIPT_GUARD_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint,md5((catalog->'base')::text) as "baseFingerprint" from snapshot`,options);
 const r=rows[0];if(rows.length!==1||!/^[a-f0-9]{32}$/.test(r?.fingerprint)||![0,4].includes(r.catalog?.functions?.length)||![0,3].includes(r.catalog?.triggers?.length)||![0,3].includes(r.catalog?.constraints?.length)||!Array.isArray(r.catalog.ledger))throw Error('Receipt guard catalog incomplete');return r;
}
