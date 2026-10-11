/** Correction recovery metadata; normalize only the exact guarded cancellation insertion. */
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {RECEIPT_GUARD_CATALOG,RECEIPT_GUARD_SNAPSHOT,RECEIPT_GUARD_PRESERVED} from './learn-receipt-guards-catalog.mjs';
export const CORRECTION_RECOVERY_PATCH=` if exists(select 1 from public.learn_correction_cancellations where id=p_request) then
  raise exception 'Correction request cancelled; review evidence before a new correction' using errcode='PT409';end if;
`;
const normalized=`(case when p.oid='public.learn_performance_correct(uuid,uuid,uuid,integer,numeric,text)'::regprocedure then replace(pg_get_functiondef(p.oid),$recovery_patch$${CORRECTION_RECOVERY_PATCH}$recovery_patch$,'') else pg_get_functiondef(p.oid) end)`;
export const CORRECTION_RECOVERY_BASE=RECEIPT_GUARD_CATALOG.replace(/(?:pg_catalog\.)?pg_get_functiondef\(p\.oid\)/g,()=>normalized);
const table = (
  name,
) => `(select jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',x.conname,'definition',pg_get_constraintdef(x.oid)) order by x.conname) from pg_constraint x where x.conrelid=c.oid),
 'triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'indexes',(select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename=c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${name}')`;

export const CORRECTION_RECOVERY_CATALOG=`jsonb_build_object('base',${CORRECTION_RECOVERY_BASE},
 'tables',jsonb_build_array(${table('learn_correction_cancellations')}),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('learn_performance_correct','learn_performance_correction_resolve')),
 'ledger',(select jsonb_agg(jsonb_build_object('name',migration_name,'sha256',source_sha256,'project',project_ref) order by migration_name) from of_test_deploy.migrations))`;
export const CORRECTION_RECOVERY_SNAPSHOT=RECEIPT_GUARD_SNAPSHOT;
export const CORRECTION_RECOVERY_PRESERVED=RECEIPT_GUARD_PRESERVED;
export async function readCorrectionRecoveryCatalog(token,options){
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with snapshot as materialized(select ${CORRECTION_RECOVERY_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint,md5((catalog->'base')::text) as "baseFingerprint" from snapshot`,options);
 const r=rows[0];if(rows.length!==1||!/^[a-f0-9]{32}$/.test(r?.fingerprint)||![1,2].includes(r.catalog?.functions?.length)||r.catalog?.tables?.length!==1||!Array.isArray(r.catalog?.ledger))throw Error('Correction recovery catalog incomplete');return r;
}
