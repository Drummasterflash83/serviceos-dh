/** Actual signed-in RLS reads through the same customer-card loader as LEARN. */
import {createClient} from '@supabase/supabase-js';
import {readLearnCards} from '../../src/lib/learn-cards.ts';
export async function exerciseImportedCards({base,anon,sessions,fetcher,tenant,sql,q,checks}){
 const check=(v,s)=>{if(!v)throw Error(s);};
 const client=jwt=>createClient(base,anon,{global:{headers:{Authorization:`Bearer ${jwt}`},fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const owner=await readLearnCards(client(sessions[0]),tenant,'customer');
 const viewer=await readLearnCards(client(sessions[1]),tenant,'customer');
 const foreign=await readLearnCards(client(sessions[2]),tenant,'customer');
 check(owner.cards.length===2&&!owner.hasMore&&owner.cards.every(c=>c.kind==='customer'&&c.recordState==='Stored customer record'),'Signed-in imported card projection differs');
 check(JSON.stringify(owner)===JSON.stringify(viewer),'Viewer card visibility differs');
 check(foreign.cards.length===0&&!foreign.hasMore,'Foreign company can read imported cards');
 const rows=await sql(`select c.id,c.person_id,c.company_id,c.title,c.summary,c.latest_activity_at,c.owner_id,c.confidence,c.priority_score,c.metadata,p.display_name,l.id as link_id,l.import_id from customer_cards c join people p on p.id=c.person_id and p.tenant_id=c.tenant_id join import_entity_links l on l.tenant_id=c.tenant_id and l.entity_kind='customer' and l.entity_table='people' and l.entity_id=p.id where c.tenant_id=${q(tenant)} order by c.id,l.id`,true);
 check(new Set(rows.map(r=>r.id)).size===2,'Customer cards do not map to canonical identities');
 for(const r of rows){const m=r.metadata?.learn_import_identity;check(r.title===r.display_name&&r.company_id===null&&r.summary===null&&r.latest_activity_at===null&&r.owner_id===null&&r.confidence===null&&r.priority_score===null&&m?.source_system==='commusoft'&&rows.some(x=>x.id===r.id&&x.link_id===m.link_id&&x.import_id===m.import_id),'Imported card has unsupported detail or lacks source identity');}
 checks.push('Actual signed-in LEARN card loader shows two imported customers to owner and viewer, hides them from the other company, and retains source links without invented summaries, activity, ownership or scores.');
 return {cards:owner.cards.length,foreignCards:foreign.cards.length};
}
