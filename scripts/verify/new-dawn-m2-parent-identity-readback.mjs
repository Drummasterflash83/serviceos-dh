/** Aggregate-only, read-only path from held jobs to reviewed customer identity. */
import { pathToFileURL } from "node:url";
import { QUERY as ROSTER_QUERY, PROJECT, TENANT } from "./new-dawn-m1-roster-first-hold.mjs";
import { savedCliToken } from "./learn-test-readiness.mjs";

export const HOLDS = [
  "parent_reference_invalid",
  "parent_source_missing_or_ambiguous",
  "parent_source_not_exact_customer",
  "customer_link_missing",
  "customer_link_multiple",
  "customer_link_stale_or_target",
  "unexpected_ready",
];
const marker = "), counts as (";
const cut = ROSTER_QUERY.indexOf(marker);
if (cut < 0) throw Error("First-hold SQL CTE contract changed");
export const QUERY = `${ROSTER_QUERY.slice(0, cut + 1)}, held_jobs as materialized (
 select connection_id,external_id,property_id from classified
 where first_hold='customer_identity_unreviewed'
), details as materialized (
 select h.connection_id,h.external_id,h.property_id,p.parent_id,p.parent_ref_valid,
  pa.source_version_id parent_version_id,pa.source_identity_valid parent_source_exact,
  pc.link_count,pc.mapped_target_valid
 from held_jobs h
 left join properties p on p.connection_id=h.connection_id and p.property_id=h.property_id
 left join parents pa on pa.connection_id=p.connection_id and pa.parent_id=p.parent_id
 left join parent_checks pc on pc.connection_id=p.connection_id and pc.parent_id=p.parent_id
), categorized as materialized (
 select *,case
  when not coalesce(parent_ref_valid,false) then 'parent_reference_invalid'
  when parent_version_id is null then 'parent_source_missing_or_ambiguous'
  when not coalesce(parent_source_exact,false) then 'parent_source_not_exact_customer'
  when coalesce(link_count,0)=0 then 'customer_link_missing'
  when link_count>1 then 'customer_link_multiple'
  when not coalesce(mapped_target_valid,false) then 'customer_link_stale_or_target'
  else 'unexpected_ready' end hold
 from details
), hold_totals as (
 select hold,count(*)::integer jobs,
  count(distinct (connection_id,property_id))::integer workaddresses,
  count(distinct (connection_id,parent_id)) filter(where parent_id is not null)::integer parent_ids
 from categorized group by hold
), held_parents as materialized (
 select distinct connection_id,parent_id from categorized
 where parent_id is not null and parent_ref_valid
), exact_clues as materialized (
 select h.connection_id,h.parent_id,
  (select count(*)::integer from public.import_entity_links l
   where l.tenant_id='${TENANT}'::uuid and l.source_system='commusoft'
    and l.entity_kind='customer' and l.external_id=h.parent_id) legacy_targets,
  (select count(*)::integer from public.people pe where pe.tenant_id='${TENANT}'::uuid
   and to_jsonb(pe)#>>'{metadata,learn_business_input,connection_id}'=h.connection_id::text
   and to_jsonb(pe)#>>'{metadata,learn_business_input,external_id}'=h.parent_id) direct_people,
  (select count(*)::integer from public.companies co where co.tenant_id='${TENANT}'::uuid
   and to_jsonb(co)#>>'{metadata,learn_business_input,connection_id}'=h.connection_id::text
   and to_jsonb(co)#>>'{metadata,learn_business_input,external_id}'=h.parent_id) direct_companies
 from held_parents h
), parent_shapes as materialized (
 select h.connection_id,h.parent_id,
  nullif(btrim(p.payload->>'companyName'),'') is not null company_name_present,
  nullif(btrim(concat_ws(' ',p.payload#>>'{contact,firstName}',
   p.payload#>>'{contact,lastName}')),'') is not null contact_name_present
 from held_parents h join parents p
  on p.connection_id=h.connection_id and p.parent_id=h.parent_id
 where p.source_identity_valid
), held_sites as materialized (
 select distinct connection_id,property_id from held_jobs
), site_checks as materialized (
 select s.connection_id,s.property_id,p.postcode_collision,p.has_address,
  p.postcode_key is not null postcode_present,
  not exists(select 1 from unnest(array['addressLine1','addressLine2','addressLine3',
   'town','province','postcode']) field where p.payload ? field
   and p.payload->field<>'null'::jsonb and
   (jsonb_typeof(p.payload->field)<>'string' or length(p.payload->>field)>1000)) fields_valid,
  (select count(*)::integer from public.sites x where x.tenant_id='${TENANT}'::uuid
   and x.source_system in ('commusoft','commusoft:connection:'||s.connection_id::text)
   and x.external_id=s.property_id) canonical_id_matches,
  (select count(*)::integer from public.import_entity_links x
   where x.tenant_id='${TENANT}'::uuid and x.source_system='commusoft'
   and x.entity_kind='site' and x.external_id=s.property_id) legacy_id_matches
 from held_sites s join property_checks p
  on p.connection_id=s.connection_id and p.property_id=s.property_id
), site_labeled as materialized (
 select connection_id,property_id,case
  when postcode_collision then 'postcode_collision'
  when not has_address or not postcode_present or not fields_valid then 'site_field_hold'
  when canonical_id_matches>0 or legacy_id_matches>0 then 'existing_identity_review'
  else 'source_shape_candidate_after_parent_review' end class
 from site_checks
)
select clock_timestamp() observed_at,
 (select count(*)::integer from held_jobs) held_jobs,
 (select count(distinct (connection_id,property_id))::integer from held_jobs) held_workaddresses,
 (select count(*)::integer from held_parents) held_parent_ids,
 coalesce((select jsonb_object_agg(hold,jsonb_build_object('jobs',jobs,
  'workaddresses',workaddresses,'parent_ids',parent_ids)) from hold_totals),'{}'::jsonb) holds,
 jsonb_build_object(
  'no_source_keyed_target',(select count(*)::integer from exact_clues
   where legacy_targets+direct_people+direct_companies=0),
  'one_source_keyed_target',(select count(*)::integer from exact_clues
   where legacy_targets+direct_people+direct_companies=1),
  'multiple_source_keyed_targets',(select count(*)::integer from exact_clues
   where legacy_targets+direct_people+direct_companies>1),
  'legacy_target_rows',(select coalesce(sum(legacy_targets),0)::integer from exact_clues),
  'direct_target_rows',(select coalesce(sum(direct_people+direct_companies),0)::integer from exact_clues)
 ) existing_target_clues,
 jsonb_build_object(
  'company_name_and_contact',(select count(*)::integer from parent_shapes
   where company_name_present and contact_name_present),
  'company_name_only',(select count(*)::integer from parent_shapes
   where company_name_present and not contact_name_present),
  'contact_name_only',(select count(*)::integer from parent_shapes
   where not company_name_present and contact_name_present),
  'neither_name_shape',(select count(*)::integer from parent_shapes
   where not company_name_present and not contact_name_present),
  'unresolved_source_kind',(select count(*)::integer from held_parents) -
   (select count(*)::integer from parent_shapes)
 ) parent_name_shapes,
 jsonb_build_object(
  'postcode_collision',(select count(*)::integer from site_labeled
   where class='postcode_collision'),
  'site_field_hold',(select count(*)::integer from site_labeled
   where class='site_field_hold'),
  'existing_identity_review',(select count(*)::integer from site_labeled
   where class='existing_identity_review'),
  'source_shape_candidate_after_parent_review',(select count(*)::integer from site_labeled
   where class='source_shape_candidate_after_parent_review')
 ) site_source_shapes,
 (select count(*)::integer from held_jobs h join site_labeled s
  on s.connection_id=h.connection_id and s.property_id=h.property_id
  where s.class='source_shape_candidate_after_parent_review')
  jobs_on_site_source_shape_candidates;`;

function count(value) { return Number.isSafeInteger(value) && value >= 0; }
export function assessParentPath(row) {
  if (!row || !Number.isFinite(Date.parse(row.observed_at)) ||
      !["held_jobs", "held_workaddresses", "held_parent_ids"].every(k => count(row[k])) ||
      !row.holds || typeof row.holds !== "object" || Array.isArray(row.holds) ||
      !row.existing_target_clues || typeof row.existing_target_clues !== "object" ||
      !row.parent_name_shapes || typeof row.parent_name_shapes !== "object" ||
      !row.site_source_shapes || typeof row.site_source_shapes !== "object" ||
      !count(row.jobs_on_site_source_shape_candidates))
    throw Error("Parent-path readback contract changed");
  const holds = Object.fromEntries(HOLDS.map(k => [k, {jobs:0,workaddresses:0,parent_ids:0}]));
  for (const [key,value] of Object.entries(row.holds)) {
    if (!(key in holds) || !value || !["jobs","workaddresses","parent_ids"]
      .every(k => count(value[k]))) throw Error("Unexpected parent hold or count");
    holds[key] = value;
  }
  if (Object.values(holds).reduce((n,h) => n+h.jobs,0) !== row.held_jobs ||
      Object.values(holds).some(h => h.workaddresses > h.jobs || h.parent_ids > h.jobs) ||
      holds.unexpected_ready.jobs !== 0)
    throw Error("Parent holds do not reconcile or an unreviewed job is unexpectedly ready");
  const clues = row.existing_target_clues;
  if (!["no_source_keyed_target","one_source_keyed_target","multiple_source_keyed_targets",
        "legacy_target_rows","direct_target_rows"].every(k => count(clues[k])) ||
      clues.no_source_keyed_target+clues.one_source_keyed_target+
        clues.multiple_source_keyed_targets !== row.held_parent_ids)
    throw Error("Exact source-keyed target clues do not cover held parent IDs");
  const shapes=row.parent_name_shapes;
  if (!["company_name_and_contact","company_name_only","contact_name_only",
        "neither_name_shape","unresolved_source_kind"].every(k=>count(shapes[k])) ||
      Object.values(shapes).reduce((n,v)=>n+v,0)!==row.held_parent_ids)
    throw Error("Parent source name shapes do not cover held parent IDs");
  const sites=row.site_source_shapes;
  if (!["postcode_collision","site_field_hold","existing_identity_review",
        "source_shape_candidate_after_parent_review"].every(k=>count(sites[k])) ||
      Object.values(sites).reduce((n,v)=>n+v,0)!==row.held_workaddresses ||
      row.jobs_on_site_source_shape_candidates>row.held_jobs)
    throw Error("Held site source shapes do not cover held work addresses");
  return {observed_at:row.observed_at,project:PROJECT,tenant:TENANT,
    held_jobs:row.held_jobs,held_workaddresses:row.held_workaddresses,
    held_parent_ids:row.held_parent_ids,holds,existing_target_clues:clues,
    parent_name_shapes:shapes,site_source_shapes:sites,
    jobs_on_site_source_shape_candidates:row.jobs_on_site_source_shape_candidates,
    customer_links_applied_by_verifier:0,site_links_applied_by_verifier:0,
    automatic_identity_batch_proven:false,
    limitation:"An existing source-keyed target is only a review clue. Customer kind, account-holder identity, version, target/card and rollback must be reviewed before any site or job link."};
}

export async function readParentPath({token=savedCliToken(),fetcher=fetch}={}) {
  const response=await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`,{
    method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({query:QUERY}),redirect:"error",signal:AbortSignal.timeout(120000),
  });
  if(!response.ok){const e=await response.json().catch(()=>({}));
    throw Error(`Parent-path read-only query failed HTTP ${response.status}: ${String(e.message??e.code??"unknown").slice(0,200)}`)}
  const rows=await response.json();
  if(!Array.isArray(rows)||rows.length!==1)throw Error("Parent-path response incomplete");
  return assessParentPath(rows[0]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await readParentPath()));
