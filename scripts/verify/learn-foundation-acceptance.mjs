/** Fixed synthetic foundation extension for the existing TEST Auth acceptance. */
import { randomUUID } from 'node:crypto';
const q=s=>`'${String(s).replaceAll("'","''")}'`;
const tables=['companies','people','customer_cards','org_units','team_members','sites','jobs','graph_nodes','graph_edges','intelligence_objects','ownership_assignments'];
const check=(ok,label)=>{if(!ok)throw Error(label);};
export function addFoundationFixtures(plan){
 return {...plan,foundation:plan.tenants.map(t=>({tenant:t.id,user:plan.users.find(u=>u.tenant===t.id&&u.role==='owner').id,
  ...Object.fromEntries(tables.map(name=>[name,randomUUID()]))}))};
}
export function foundationRows(f){
 const id=t=>({id:f[t],tenant_id:f.tenant});
 return [
 ['companies',{...id('companies'),name:'Synthetic foundation company'}],
 ['people',{...id('people'),company_id:f.companies,display_name:'Synthetic person'}],
 ['customer_cards',{...id('customer_cards'),company_id:f.companies,person_id:f.people,title:'Synthetic card'}],
 ['org_units',{...id('org_units'),kind:'team',name:'Synthetic team'}],
 ['org_unit_members',{org_unit_id:f.org_units,user_id:f.user}],
 ['team_members',{...id('team_members'),org_unit_id:f.org_units,profile_id:f.user,display_name:'Synthetic staff'}],
 ['sites',{...id('sites'),company_id:f.companies,person_id:f.people}],
 ['jobs',{...id('jobs'),site_id:f.sites,customer_person_id:f.people,title:'Synthetic job'}],
 ['graph_nodes',{...id('graph_nodes'),node_type:'person',label:'Synthetic node'}],
 ['graph_edges',{...id('graph_edges'),edge_type:'self',from_node_id:f.graph_nodes,to_node_id:f.graph_nodes}],
 ['intelligence_objects',{...id('intelligence_objects'),domain:'core',object_type:'Task',subject:'Synthetic task'}],
 ['ownership_assignments',{...id('ownership_assignments'),object_id:f.intelligence_objects,raci_role:'responsible',party_kind:'user',party_ref:f.user}],
 ];
}
export function foundationAbsenceSql(plan){
 return `select count(*)::integer as remaining from (${plan.foundation.flatMap(f=>[
  ...tables.map(t=>`select 1 from public.${t} where id=${q(f[t])}`),
  `select 1 from public.org_unit_members where org_unit_id=${q(f.org_units)} and user_id=${q(f.user)}`,
 ]).join(' union all ')}) fixtures;`;
}
export function foundationCleanupSql(plan){
 let sql="begin;set local statement_timeout='15s';";
 for(const f of plan.foundation){
  const owns=`exists(select 1 from public.tenants where id=${q(f.tenant)} and metadata->>'learn_acceptance_run'=${q(plan.runId)})`;
  sql+=`delete from public.org_unit_members where org_unit_id=${q(f.org_units)} and user_id=${q(f.user)} and ${owns};`;
  for(const t of [...tables].reverse())sql+=`delete from public.${t} where id=${q(f[t])} and tenant_id=${q(f.tenant)} and ${owns};`;
 }
 return sql+'commit;';
}
export async function exerciseFoundation({plan,request,origin,userHeaders,adminHeaders,sessions,sql,pass}){
 const [a,b]=plan.foundation;
 // Existing service key, exact generated fixtures; dependency order is explicit.
 for(let i=0;i<foundationRows(a).length;i++){
  const [table,rowA]=foundationRows(a)[i],rowB=foundationRows(b)[i][1];
  const r=await request(`${origin}/rest/v1/${table}`,{method:'POST',headers:adminHeaders,body:[rowA,rowB]});
  check(r.status===201,`Synthetic foundation seed failed: ${table}`);
 }
 pass('Service-role PostgREST creates linked synthetic customer, staff, job and work records');
 const read=async(jwt,path)=>request(`${origin}/rest/v1/${path}`,{headers:userHeaders(jwt)});
 async function verifyUser(u){
  const own=plan.foundation.find(f=>f.tenant===u.tenant),jwt=sessions.get(u.id);
  for(const table of tables){
   const r=await read(jwt,`${table}?select=id,tenant_id&id=in.(${a[table]},${b[table]})`);
   check(r.status===200&&r.data?.length===1&&r.data[0].id===own[table]&&r.data[0].tenant_id===u.tenant,`Foundation tenant read failed: ${table}/${u.role} (HTTP ${r.status}, code ${/^[A-Z0-9]{5}$/.test(r.data?.code??'')?r.data.code:'none'}, rows ${Array.isArray(r.data)?r.data.length:'unavailable'})`);
  }
  const members=await read(jwt,`org_unit_members?select=org_unit_id,user_id&org_unit_id=in.(${a.org_units},${b.org_units})`);
  check(members.status===200&&members.data?.length===1&&members.data[0].org_unit_id===own.org_units,'Organisation membership leaked or missing');
 }
 for(const u of plan.users)await verifyUser(u);
 pass('Owner/admin/viewer/ops and second-company JWTs see only their own foundation records');
 const ops=plan.users.find(u=>u.role==='ops');
 await sql(`update public.profiles set role='openfolk' where id=${q(ops.id)} and email=${q(ops.email)} and tenant_id=${q(ops.tenant)};`);
 await verifyUser(ops);
 await sql(`update public.profiles set role='ops' where id=${q(ops.id)} and email=${q(ops.email)} and tenant_id=${q(ops.tenant)};`);
 pass('Historical OpenFolk role cannot bypass tenant boundaries through PostgREST');
 const owner=sessions.get(plan.users[0].id);
 const denied=await request(`${origin}/rest/v1/customer_cards?id=eq.${a.customer_cards}`,{method:'PATCH',headers:userHeaders(owner),body:{title:'Unexpected client update'}});
 check(denied.status===403,'Authenticated foundation write accepted');
 check([401,403].includes((await read(undefined,`customer_cards?select=id&id=eq.${a.customer_cards}`)).status),'Anonymous foundation read accepted');
 for(const [table,body] of [['customer_cards',{person_id:b.people}],['jobs',{site_id:b.sites}],['team_members',{org_unit_id:b.org_units}],['graph_edges',{to_node_id:b.graph_nodes}],['ownership_assignments',{object_id:b.intelligence_objects}],['companies',{tenant_id:b.tenant}]]){
  const r=await request(`${origin}/rest/v1/${table}?id=eq.${a[table]}`,{method:'PATCH',headers:adminHeaders,body});
  check(r.status===400&&r.data?.code==='23514',`Service foreign reference/identity accepted: ${table}`);
 }
 const valid=await request(`${origin}/rest/v1/customer_cards?id=eq.${a.customer_cards}`,{method:'PATCH',headers:adminHeaders,body:{title:'Synthetic service update'}});
 check(valid.status===204,'Valid service foundation update failed');
 const changed=await read(owner,`customer_cards?select=title,person_id&id=eq.${a.customer_cards}`);
 check(changed.status===200&&changed.data?.[0]?.title==='Synthetic service update'&&changed.data[0].person_id===a.people,'Rejected update damaged existing card reference');
 pass('Client writes and anonymous reads denied; service cross-company writes rejected; valid service update works');
}
