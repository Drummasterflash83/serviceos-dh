// Read-only, explicitly scoped snapshot for customer review. Never prints rows.
import { savedCliToken } from '../verify/learn-test-readiness.mjs';
import { writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
const args = process.argv.slice(2), options = {};
for (let i=0; i<args.length; i+=2) {
  if (!['--project','--tenant','--connection','--output'].includes(args[i]) || !args[i+1] || options[args[i]]) throw Error('Expected unique --project --tenant --connection --output arguments');
  options[args[i]]=args[i+1];
}
const project=options['--project'], tenant=options['--tenant'], connection=options['--connection'];
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
if (!/^[a-z]{20}$/.test(project??'') || !uuid.test(tenant??'') || !uuid.test(connection??'') || !options['--output']) throw Error('Explicit project, tenant and connection required');
const output=resolve(options['--output']), parent=realpathSync(dirname(output));
const roots=['/private/tmp',resolve('.verification-results')].filter(existsSync).map(root=>realpathSync(root));
if (existsSync(output) || !roots.some(root=>{ const r=relative(root,parent); return !r.startsWith('..') && !isAbsolute(r); })) throw Error('Choose a new file in an existing private directory under /private/tmp or .verification-results');

const q=`begin read only;set local statement_timeout='30s';set local enable_nestloop=off;
with heads as materialized(select v.id,v.collection,v.external_id,v.payload,max(p.committed_at) observed_at from public.learn_business_input_versions v join public.learn_business_input_observations o on o.version_id=v.id join public.learn_business_input_pages p on p.id=o.page_id where v.tenant_id='${tenant}' and v.connection_id='${connection}' and v.provider='commusoft' and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection group by v.id),ranked as materialized(select *,dense_rank()over(partition by collection,external_id order by observed_at desc) recency from heads),current as materialized(select * from ranked where recency=1)
select jsonb_build_object('scope',jsonb_build_object('tenant','${tenant}','connection','${connection}','observedAt',clock_timestamp(),'connectionValid',exists(select 1 from public.provider_connections where tenant_id='${tenant}' and id='${connection}' and provider='commusoft')),
'customers',(select coalesce(jsonb_agg(jsonb_build_object('externalId',external_id,'versionId',id,'payload',payload,'observedAt',observed_at) order by external_id,id),'[]'::jsonb) from current where collection='properties' and payload->>'type'='customer'),
'existing',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from(select id,'person' kind,display_name name,primary_email email,primary_phone phone,postcode from public.people where tenant_id='${tenant}' union all select id,'company',name,null,phone,postcode from public.companies where tenant_id='${tenant}')x),
'contactPoints',(select coalesce(jsonb_agg(jsonb_build_object('personId',person_id,'channel',channel,'value',normalized_value)),'[]') from public.contact_points where tenant_id='${tenant}' and channel in('email','phone')),
'links',(select coalesce(jsonb_agg(jsonb_build_object('externalId',external_id,'versionId',source_version_id,'kind',entity_kind,'id',entity_id)),'[]') from public.learn_business_input_links where tenant_id='${tenant}' and connection_id='${connection}' and entity_kind='customer'),
'relationships',(select coalesce(jsonb_agg(jsonb_build_object('kind',case when collection='jobs' then 'job' else 'site' end,'externalId',external_id,'parentId',case when collection='jobs' then payload->>'propertyID' else payload->>'parentPropertyID' end)),'[]'::jsonb) from current where collection='jobs' or (collection='properties' and payload->>'type'='workaddress'))) evidence;commit;`;
const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+savedCliToken(),'Content-Type':'application/json'},body:JSON.stringify({query:q}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Read-only inventory HTTP '+r.status);const d=(await r.json())[0].evidence;if(!d.scope.connectionValid)throw Error('Connection does not match the selected tenant');writeFileSync(output,JSON.stringify(d),{mode:0o600,flag:'wx'});console.log(JSON.stringify({at:d.scope.observedAt,customers:d.customers.length,existing:d.existing.length,contactPoints:d.contactPoints.length,links:d.links.length,relationships:d.relationships.length}));
