/** TEST/LIVE aggregate-only source, relationship and card readback. No raw records. */
import { savedCliToken } from "./learn-test-readiness.mjs";
import { writeFileSync } from "node:fs";
const [environment] = process.argv.slice(2);
if (process.argv.length !== 3 || !["test", "live"].includes(environment))
  throw Error("Exact test/live read-only target required");
const project = environment === "live" ? "tgbnakbxwcqjeimygroz" : "saatxzwxvdvqevbnskxy",
  tenant =
    environment === "live"
      ? "00000000-0000-0000-0000-000000000001"
      : "f8c114fa-fee7-4983-8970-f6e7f5fd3129";
const query = `with observed as materialized (
 select v.id,v.connection_id,v.collection,v.external_id,p.committed_at,
 dense_rank() over(partition by v.connection_id,v.collection,v.external_id order by p.committed_at desc) recency
 from public.learn_business_input_versions v join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection
 where v.tenant_id='${tenant}' and v.provider='commusoft'
), latest as materialized (
 select connection_id,collection,external_id,case when count(distinct id)=1 then min(id::text)::uuid end version_id,max(committed_at) observed_at
 from observed where recency=1 group by connection_id,collection,external_id
), linked as materialized (
 select x.*,v.payload,l.id link_id,l.entity_id,l.entity_kind,l.card_id,l.request link_request,l.source_version_id linked_version
 from latest x left join public.learn_business_input_versions v on v.id=x.version_id and v.tenant_id='${tenant}'
 left join public.learn_business_input_current_links l on l.tenant_id='${tenant}' and l.connection_id=x.connection_id and l.provider='commusoft' and l.collection=x.collection and l.external_id=x.external_id
), jobs as materialized (
 select x.*,p.version_id parent_version,p.link_id parent_link,j.id canonical_job,j.status canonical_status,
 j.customer_person_id,j.customer_company_id,j.site_id,j.completed_date,
 j.metadata#>>'{learn_business_input,source_version_id}' canonical_version,
 p.payload->>'type' parent_type,
 cp.version_id site_customer_version,cp.link_id site_customer_link
 from linked x left join linked p on p.connection_id=x.connection_id and p.collection='properties' and p.external_id=x.payload->>'propertyID'
 left join linked cp on cp.connection_id=x.connection_id and cp.collection='properties' and cp.external_id=p.payload->>'parentPropertyID'
 left join public.jobs j on j.id=x.entity_id and j.tenant_id='${tenant}' and x.entity_kind='job'
 where x.collection='jobs'
) select jsonb_build_object(
 'sources',(select jsonb_agg(s order by collection) from(select collection,count(*)::int identities,
 count(*) filter(where version_id is null)::int ambiguous_latest,
 count(*) filter(where link_id is not null)::int reviewed_links,
 count(*) filter(where link_id is not null and linked_version=version_id)::int links_on_latest_version,
 min(observed_at) oldest_record_observation,max(observed_at) newest_record_observation
 from linked group by collection)s),
 'jobs',(select jsonb_build_object('retained',count(*),'published',count(canonical_job),
 'published_latest_version',count(*) filter(where canonical_version=version_id::text),
 'open_source',count(*) filter(where payload->>'status' in('Open','ongoing','pending','on_hold')),
 'open_published',count(*) filter(where payload->>'status' in('Open','ongoing','pending','on_hold') and canonical_job is not null),
 'missing_parent_source',count(*) filter(where parent_version is null),
 'missing_reviewed_parent',count(*) filter(where parent_link is null),
 'unreviewed_site_customer',count(*) filter(where parent_type='workaddress' and site_customer_link is null),
 'published_missing_customer',count(*) filter(where canonical_job is not null and customer_person_id is null and customer_company_id is null),
 'published_with_explicit_completion_instant',count(*) filter(where canonical_job is not null and completed_date is not null)) from jobs),
 'open_work_relationships',(select jsonb_agg(s order by parent_type) from(select coalesce(parent_type,'missing') parent_type,
 parent_link is not null parent_reviewed,site_customer_link is not null site_customer_reviewed,
 count(*)::int jobs,count(canonical_job)::int published from jobs where payload->>'status' in('Open','ongoing','pending','on_hold')
 group by parent_type,parent_link is not null,site_customer_link is not null)s),
 'missing_open_parent_references',(select jsonb_build_object('jobs',count(*),'distinct_references',count(distinct payload->>'propertyID'),
 'missing_reference_values',count(*) filter(where nullif(payload->>'propertyID','') is null),
 'zero_reference_values',count(*) filter(where payload->>'propertyID'='0')) from jobs
 where parent_version is null and payload->>'status' in('Open','ongoing','pending','on_hold')),
 'contact_relationships',(select jsonb_build_object('reviewed',count(*),
 'unreviewed_source_parent',count(*) filter(where parent.link_id is null),
 'customer_card_mismatch',count(*) filter(where x.card_id is distinct from parent.card_id),
 'site_reference_mismatch',count(*) filter(where parent.entity_kind='site' and x.link_request#>>'{relationships,site_id}' is distinct from parent.entity_id::text),
 'missing_canonical_person',count(*) filter(where not exists(select 1 from public.people person where person.tenant_id='${tenant}' and person.id=x.entity_id)),
 'missing_customer_card',count(*) filter(where not exists(select 1 from public.customer_cards card where card.tenant_id='${tenant}' and card.id=x.card_id)),
 'missing_active_customer_edge',count(*) filter(where not exists(select 1 from public.graph_nodes pn join public.graph_edges e on e.tenant_id=pn.tenant_id and e.from_node_id=pn.id join public.graph_nodes cn on cn.tenant_id=e.tenant_id and cn.id=e.to_node_id
 where pn.tenant_id='${tenant}' and pn.node_type='person' and pn.source_table='people' and pn.source_id=x.entity_id and e.edge_type='contact_for' and e.status='active' and cn.node_type='customer_card' and cn.source_table='customer_cards' and cn.source_id=x.card_id)),
 'site_links',count(*) filter(where x.link_request#>>'{relationships,site_id}' is not null),
 'missing_active_site_edge',count(*) filter(where x.link_request#>>'{relationships,site_id}' is not null and not exists(select 1 from public.graph_nodes pn join public.graph_edges e on e.tenant_id=pn.tenant_id and e.from_node_id=pn.id join public.graph_nodes sn on sn.tenant_id=e.tenant_id and sn.id=e.to_node_id
 where pn.tenant_id='${tenant}' and pn.node_type='person' and pn.source_table='people' and pn.source_id=x.entity_id and e.edge_type='contact_for' and e.status='active' and sn.node_type='site' and sn.source_table='sites' and sn.source_id::text=x.link_request#>>'{relationships,site_id}')))
 from linked x left join linked parent on parent.connection_id=x.connection_id and parent.collection='properties' and parent.external_id=x.payload->>'propertyID' where x.collection='propertyContacts' and x.link_id is not null),
 'pages',(select jsonb_agg(s order by collection) from(select collection,count(*)::int retained_pages,
 max(committed_at) newest_page_at,count(*) filter(where committed_at>now()-interval '1 hour')::int pages_last_hour,
 sum(record_count) filter(where committed_at>now()-interval '1 hour') observations_last_hour
 from public.learn_business_input_pages where tenant_id='${tenant}' and provider='commusoft' group by collection)s),
 'recurring',(select jsonb_agg(jsonb_build_object('enabled',s.enabled,'phase',s.phase,'state',s.last_state,'watermark',s.watermark,
 'resource',a.settings->'commusoft_import'->>'resource','contact_targets',a.settings->'commusoft_import'->'contactTargetCount',
 'contacts_completed',a.sync_cursor->'propertiesCompleted')) from public.learn_commusoft_recurring s join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id where s.tenant_id='${tenant}'),
 'job_source_field_types',(select jsonb_agg(s order by field,type) from(select kv.key field,jsonb_typeof(kv.value) type,count(*)::int records
 from linked x cross join lateral jsonb_each(x.payload) kv where x.collection='jobs' and kv.key in('jobNumber','jobCode','jobType','jobDescription','description','id') group by kv.key,jsonb_typeof(kv.value))s),
 'job_assignment_field_presence',(select jsonb_agg(s order by field) from(select kv.key field,count(*)::int records
 from linked x cross join lateral jsonb_each(x.payload) kv where x.collection='jobs'
 and kv.key ~* '(assign|engineer|appointment|schedule|user|staff)'
 group by kv.key)s)
 ) report`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query:
        "begin read only;set local enable_nestloop=off;set local statement_timeout='45s';" +
        query +
        ";commit;",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  },
);
if (!response.ok) {
  writeFileSync(
    `.verification-results/commusoft-current-jobs-20261016/${environment}-coverage-error.txt`,
    await response.text(),
    { mode: 0o600 },
  );
  throw Error(`Commusoft aggregate ${environment} HTTP ${response.status}`);
}
const data = await response.json();
if (!Array.isArray(data) || data.length !== 1 || !data[0].report?.sources)
  throw Error("Unexpected aggregate shape");
const report = {
  version: "learn-commusoft-build01-readback/1",
  environment,
  project,
  observedAt: new Date().toISOString(),
  ...data[0].report,
  interpretation:
    "Retained source versions and reviewed relationships. A recent empty changed-record page proves the traversal time, not that every job changed or that all cards are reviewed. Unzoned completion dates remain unresolved. No inferred cross-provider mapping.",
  providerSettingsChanged: false,
  productionDataWrites: false,
  customerContentReturned: false,
};
writeFileSync(
  `.verification-results/commusoft-current-jobs-20261016/${environment}-coverage.json`,
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
