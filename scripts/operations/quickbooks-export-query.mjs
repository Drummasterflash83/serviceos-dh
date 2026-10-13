/** Prepare a read-only, tenant/environment-scoped NDJSON export query.
 * No database connection, credentials, provider requests or file export occur here.
 * Run only through an authorised operations session and write results privately.
 */
import { pathToFileURL } from 'node:url';

export function quickBooksExportQuery(tenant, environment) {
  if (typeof tenant !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant))
    throw new Error('A tenant UUID is required');
  if (!['sandbox', 'production'].includes(environment)) throw new Error('An explicit environment is required');
  const tenantSql = `'${tenant.toLowerCase()}'::uuid`, envSql = `'${environment}'`;
  const scope = alias => `${alias}.tenant_id=${tenantSql} and ${alias}.environment=${envSql}`;
  const sections = [
    ['connection', `select c.id,c.tenant_id,c.environment,c.realm_id,c.company_name,c.status,c.created_at,c.verified_at,c.confirmed_at from public.learn_quickbooks_connections c where ${scope('c')}`, 'id'],
    ['import', `select i.id,i.tenant_id,i.connection_id,i.environment,i.realm_id,i.entities,i.entity_index,i.start_position,i.page_size,i.minor_version,i.requests_used,i.pages_saved,i.records_observed,i.state,i.last_error,i.created_at,i.updated_at from public.learn_quickbooks_imports i where ${scope('i')}`, 'id'],
    ['source_version', `select v.id,v.tenant_id,v.environment,v.realm_id,v.entity,v.external_id,v.content_hash,v.payload::text payload_text,v.sync_token::text sync_token,v.source_updated_at,v.first_seen_at from public.learn_quickbooks_source_versions v where ${scope('v')}`, 'id'],
    ['latest', `select l.tenant_id,l.environment,l.realm_id,l.entity,l.external_id,l.version_id,l.sync_token::text sync_token,l.source_updated_at,l.conflicted,l.last_observed_at from public.learn_quickbooks_latest l where ${scope('l')}`, 'realm_id,entity,external_id'],
    ['page', `select p.id,p.run_id,p.tenant_id,p.raw_envelope,p.envelope_hash,p.records,p.checkpoint_after,p.saved_at from public.learn_quickbooks_pages p join public.learn_quickbooks_imports i on i.id=p.run_id and i.tenant_id=p.tenant_id where ${scope('i')} and p.tenant_id=${tenantSql}`, 'id'],
    ['observation', `select o.page_id,o.version_id,o.ordinal from public.learn_quickbooks_observations o join public.learn_quickbooks_pages p on p.id=o.page_id join public.learn_quickbooks_imports i on i.id=p.run_id and i.tenant_id=p.tenant_id join public.learn_quickbooks_source_versions v on v.id=o.version_id where ${scope('i')} and ${scope('v')} and p.tenant_id=${tenantSql} and v.realm_id=i.realm_id`, 'page_id,ordinal'],
    ['customer_link', `select k.tenant_id,k.environment,k.realm_id,k.external_id,k.card_id,k.reviewed_version,k.identity,k.revision::text revision,k.reviewed_at from public.learn_quickbooks_customer_links k where ${scope('k')}`, 'realm_id,external_id'],
  ];
  const manifest = `select jsonb_build_object('kind','manifest','format','serviceos-quickbooks-export/1','tenant_id',${tenantSql},'environment',${envSql},'generated_at',transaction_timestamp(),'payload_encoding','payload_text and raw_envelope are JSON strings; parse monetary numbers with decimal precision','scope','Retained QuickBooks accounting evidence only; excludes credentials, authorisation state, internal audit, other connectors and source-system data not imported')::text;`;
  return `begin isolation level repeatable read read only;\nset local statement_timeout='60s';\nset local lock_timeout='5s';\n${manifest}\n` + sections.map(([kind,query,order]) => `select jsonb_build_object('kind','${kind}','data',to_jsonb(x))::text from (${query}) x order by ${order};`).join('\n') + '\ncommit;\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: node quickbooks-export-query.mjs TENANT_UUID sandbox|production');
  process.stdout.write(quickBooksExportQuery(process.argv[2], process.argv[3]));
}
