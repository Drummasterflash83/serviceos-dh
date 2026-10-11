/** Exact TEST metadata and source fingerprints; never returns message content. */
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { CORRECTION_RECOVERY_CATALOG, CORRECTION_RECOVERY_SNAPSHOT, CORRECTION_RECOVERY_PRESERVED } from './learn-correction-recovery-catalog.mjs';
export const EMAIL_DIAGNOSTIC_FUNCTIONS = ['email_ingestion_payload_v2', 'learn_email_job_fail', 'learn_operator_capture_health'];
const normalizedBase = CORRECTION_RECOVERY_CATALOG.replace(/(?:pg_catalog\.)?pg_get_functiondef\((\w+)\.oid\)/g, (call, alias) =>
 `(case when ${alias}.oid in ('email_ingestion_payload_v2(text,text,jsonb)'::regprocedure,'learn_email_job_fail(uuid,uuid,uuid,text,integer)'::regprocedure,'learn_operator_capture_health(uuid,text)'::regprocedure) then '[definition checked separately]' else ${call} end)`);
export const EMAIL_DIAGNOSTIC_CATALOG = `jsonb_build_object('base',${normalizedBase},
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'securityDefiner',p.prosecdef,'settings',p.proconfig) order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('email_ingestion_payload_v2','learn_email_job_fail','learn_operator_capture_health')),
 'ledger',(select jsonb_agg(jsonb_build_object('name',migration_name,'sha256',source_sha256,'project',project_ref) order by migration_name) from of_test_deploy.migrations))`;
export const EMAIL_DIAGNOSTIC_SNAPSHOT = CORRECTION_RECOVERY_SNAPSHOT;
export const EMAIL_DIAGNOSTIC_PRESERVED = CORRECTION_RECOVERY_PRESERVED;
export async function readEmailDiagnosticCatalog(token, options) {
 const rows=await communicationQuery(token,`set local search_path=public,pg_catalog;with snapshot as materialized(select ${EMAIL_DIAGNOSTIC_CATALOG} as catalog) select catalog,md5(catalog::text) as fingerprint from snapshot`,options);
 const r=rows[0];if(rows.length!==1||!/^[a-f0-9]{32}$/.test(r?.fingerprint)||r.catalog?.functions?.length!==3||!Array.isArray(r.catalog?.ledger))throw Error('Email diagnostic catalog incomplete');return r;
}
