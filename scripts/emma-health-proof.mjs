// Rollback-only proof against the production schema. No fixtures or DDL persist.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261023200000_receptionist_health_snapshot.sql",
    import.meta.url,
  ),
  "utf8",
)
  .replace(/^begin;|^commit;/gm, "")
  .replace(
    "create function public.care_health_snapshot",
    "create or replace function public.care_health_snapshot",
  );
const sql = `begin;
${migration}
create temp table proof_ids as select gen_random_uuid() tenant,gen_random_uuid() other_tenant,gen_random_uuid() client_id,gen_random_uuid() feedback,gen_random_uuid() call_id;
grant select on proof_ids to authenticated;
insert into public.tenants(id,slug,display_name) select tenant,'health-proof-'||tenant,'Health proof' from proof_ids union all select other_tenant,'health-proof-'||other_tenant,'Other proof' from proof_ids;
insert into auth.users(id,email) select client_id,'health-proof-'||client_id||'@example.invalid' from proof_ids;
insert into public.profiles(id,tenant_id,role) select client_id,tenant,'viewer' from proof_ids on conflict(id) do update set tenant_id=excluded.tenant_id;
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) select tenant,'Proof','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF' from proof_ids;
insert into public.receptionist_access(tenant_id,profile_id) select tenant,client_id from proof_ids;
insert into public.receptionist_feedback(id,tenant_id,author_id,title,body,category,call_id) select feedback,tenant,client_id,'A routing concern','Proof feedback only','routing',call_id from proof_ids;
update public.receptionist_care_issues set diagnosis='INTERNAL-DO-NOT-EXPOSE',proposal='PRIVATE-PROPOSAL' where tenant_id=(select tenant from proof_ids);
insert into public.receptionist_care_issues(tenant_id,source_key,title,detail) select tenant,'call:'||call_id||':repetition','INTERNAL-TITLE','INTERNAL-DETAIL' from proof_ids;
insert into public.receptionist_care_issues(tenant_id,source_key,title,archived_at) select tenant,'archive-proof','Archived test',now() from proof_ids;
insert into public.receptionist_care_issues(tenant_id,source_key,title,stage) select tenant,'resolved-proof','Resolved test','resolved' from proof_ids;
insert into public.receptionist_call_reviews(tenant_id,call_id,evidence_hash,reviewer_version,state,assessment) select tenant,call_id,'proof-hash','proof-v1','reviewed','{"internal":"PRIVATE-ASSESSMENT"}' from proof_ids;
create function pg_temp.ok(b boolean,t text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',t;end if;end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from proof_ids),true);
select pg_temp.ok(jsonb_array_length(public.care_health_snapshot(tenant)->'issues')=2,'only active issues included') from proof_ids;
select pg_temp.ok((public.care_health_snapshot(tenant)->>'resolved_reports')::int=1,'resolved count distinct from open') from proof_ids;
select pg_temp.ok((public.care_health_snapshot(tenant)->>'reviewed_calls')::int=1,'actual review count') from proof_ids;
select pg_temp.ok(public.care_health_snapshot(tenant)::text not like '%INTERNAL%' and public.care_health_snapshot(tenant)::text not like '%PRIVATE%','no internal text exposed') from proof_ids;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.care_health_snapshot(tenant)->'issues') i where i->'categories' ? 'handover'),'routing mapped to handovers') from proof_ids;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.care_health_snapshot(tenant)->'issues') i where i->'categories' ? 'experience'),'automated repetition mapped to experience') from proof_ids;
do $$ begin
 begin perform public.care_health_snapshot((select other_tenant from proof_ids)); raise exception 'FAIL cross-tenant permitted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.care_health_snapshot((select tenant from proof_ids)); raise exception 'FAIL unauthenticated permitted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: own-tenant projection, cross-tenant denial, unauthenticated denial, archive/resolution filtering, review counts, category mapping and internal-data exclusion; all rolled back' proof;
`;
const cli = process.env.SUPABASE_CLI;
if (!cli) throw Error("Set SUPABASE_CLI to the installed CLI path");
const result = execFileSync(
  cli,
  ["db", "query", "--linked", "--project-ref", "tgbnakbxwcqjeimygroz", sql],
  { encoding: "utf8" },
);
if (!result.includes("PASS:")) throw Error("Proof did not return its completion marker");
console.log(result);
