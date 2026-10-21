/** One aggregate-only post-release check against immutable source history. */
import { pathToFileURL } from 'node:url';
import { savedCliToken } from './learn-test-readiness.mjs';
import { assess, readStage } from './new-dawn-current-job-source-release.mjs';

const project = 'tgbnakbxwcqjeimygroz';
export const paritySql = `with latest_time as materialized (
 select v.tenant_id,v.connection_id,v.external_id,max(p.committed_at) observed_at
 from public.learn_business_input_versions v
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id
  and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id
  and p.provider=v.provider and p.collection=v.collection
 where v.provider='commusoft' and v.collection='jobs'
 group by v.tenant_id,v.connection_id,v.external_id
), expected as (
 select t.tenant_id,t.connection_id,t.external_id,t.observed_at,
  case when count(distinct v.id)=1 then min(v.id::text)::uuid end version_id,
  count(distinct v.id)<>1 ambiguous
 from latest_time t
 join public.learn_business_input_versions v
  on v.tenant_id=t.tenant_id and v.connection_id=t.connection_id
   and v.provider='commusoft' and v.collection='jobs'
   and v.external_id=t.external_id
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id
  and p.tenant_id=t.tenant_id and p.connection_id=t.connection_id
  and p.provider='commusoft' and p.collection='jobs'
  and p.committed_at=t.observed_at
 group by t.tenant_id,t.connection_id,t.external_id,t.observed_at
)
select count(*) filter(where e.tenant_id is not null)::int source_keys,
 count(*) filter(where c.tenant_id is not null)::int projected_keys,
 count(*) filter(where e.tenant_id is null or c.tenant_id is null
  or e.observed_at is distinct from c.observed_at
  or e.version_id is distinct from c.source_version_id
  or e.ambiguous is distinct from c.ambiguous)::int mismatches
from expected e full join public.new_dawn_commusoft_current_job_source c
 on c.tenant_id=e.tenant_id and c.connection_id=e.connection_id
  and c.external_id=e.external_id`;

export async function readParity(token = savedCliToken(), fetcher = fetch) {
  assess(await readStage(token,fetcher),2);
  const response=await fetcher(
    `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
      headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({query:paritySql}),
    });
  if(!response.ok) throw Error(`current_job_source_parity_http_${response.status}`);
  const rows=await response.json();
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(!row || !Number.isInteger(row.source_keys) ||
    !Number.isInteger(row.projected_keys) || !Number.isInteger(row.mismatches) ||
    row.source_keys!==row.projected_keys || row.mismatches!==0)
    throw Error('current_job_source_parity_failed');
  return {state:'source_projection_equal',sourceKeys:row.source_keys,
    projectedKeys:row.projected_keys,mismatches:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==3 || process.argv[2]!=='--live-read-only')
      throw Error('current_job_source_parity_exact_mode_required');
    console.log(JSON.stringify(await readParity()));
  } catch(error) {
    console.error(JSON.stringify({state:'current_job_source_parity_stopped',
      reason:error instanceof Error?error.message:'unknown'}));
    process.exitCode=1;
  }
}
