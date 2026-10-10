/** Synthetic dependency, exact-site and immutable terminal-outcome checks. */
export async function exerciseImportConflicts({expect,session,previewBody,apply,sql,q,tenant,plan,save,counts,checks}){
 const check=(v,s)=>{if(!v)throw Error(s);};
 async function preview(entity,csv){const p=await expect(session,previewBody(entity,csv),200);plan.imports.push(p.import_id);save();return p;}
 const customer='source_system,external_id,record_kind,display_name,active\ncommusoft,C2,person,SYNTHETIC Second Customer,true';
 const site='source_system,external_id,customer_external_id,label,address_text,postcode,active\ncommusoft,S2,C2,SYNTHETIC Second Site,2 Synthetic Road,SW1A 1AA,true';
 const job='source_system,external_id,job_number,customer_external_id,site_external_id,title,status,active\ncommusoft,J2,700002,C2,S2,SYNTHETIC Held Job,open,true';
 const held=await preview('jobs',job);check(held.preview.will_hold===1&&held.preview.will_create===0,'Missing customer must hold job preview');
 const first=await expect(session,apply(held.import_id,job),200);check(first.status==='needs_review'&&first.held===1&&first.created===0,'Missing customer must retain held outcome');
 check((await counts()).jobs===1,'Held row created an orphan job');
 const heldRows=await expect(session,{action:'row_results',import_id:held.import_id,outcomes:['held']},200);check(heldRows.rows.length===1&&heldRows.rows[0].reason==='customer_not_imported'&&heldRows.rows[0].attempt===1,'Held evidence differs');
 for(const [entity,csv]of [['customers',customer],['sites',site]]){const p=await preview(entity,csv),a=await expect(session,apply(p.import_id,csv),200);check(a.status==='completed'&&a.created===1,`Dependency ${entity} not imported`);}
 const retry=await expect(session,apply(held.import_id,job),200);check(retry.status==='completed'&&retry.created===1&&retry.held===0&&retry.this_run.created===1,'Exact held import did not recover');
 const retryRows=await expect(session,{action:'row_results',import_id:held.import_id},200);check(retryRows.rows.length===1&&retryRows.rows[0].attempt===2&&retryRows.rows[0].outcome==='created','Held retry did not retain one incremented row outcome');
 await expect(session,apply(held.import_id,job),200);check((await counts()).jobs===2,'Recovered replay duplicated job');
 const relationship=await sql(`select j.customer_person_id=s.person_id as same_customer,j.site_id=s.id as exact_site from jobs j join sites s on s.id=j.site_id and s.tenant_id=j.tenant_id where j.tenant_id=${q(tenant)} and j.external_id='J2'`,true);check(relationship.length===1&&relationship[0].same_customer&&relationship[0].exact_site,'Recovered job linkage differs');
 checks.push('Missing customer holds a job without creating an orphan; importing its customer/site then retrying the exact saved file creates one correctly linked job with attempt 2. Replaying remains idempotent.');
 // Give the bad exact reference a valid-looking address for this customer: it
 // must still refuse rather than fall back to address/postcode matching.
 const bad='source_system,external_id,job_number,customer_external_id,site_external_id,site_address_text,site_postcode,title,status,active\ncommusoft,J3,700003,C2,S1,2 Synthetic Road,SW1A 1AA,SYNTHETIC Contradictory Job,open,true';
 const conflict=await preview('jobs',bad);check(conflict.preview.will_conflict===1&&conflict.preview.will_create===0,'Cross-customer exact site not surfaced at preview');
 const refused=await expect(session,apply(conflict.import_id,bad),200);check(refused.status==='needs_review'&&refused.conflicts===1&&refused.created===0,'Cross-customer exact site did not produce durable conflict');
 check((await counts()).jobs===2,'Contradictory exact site created a job');
 const retained=await sql(`select conflict_type,blocking,detail->>'reason' as reason from import_conflicts where tenant_id=${q(tenant)} and import_id=${q(conflict.import_id)}`,true);check(retained.length===1&&retained[0].blocking&&retained[0].conflict_type==='site_exact_unresolvable'&&retained[0].reason==='exact_site_belongs_to_a_different_customer','Ownership conflict evidence differs');
 const again=await expect(session,apply(conflict.import_id,bad),200);check(again.status==='needs_review'&&again.conflicts===1&&again.this_run.already===1,'Terminal conflict must not be silently retried');
 // A reviewed correction is a NEW sealed file, never an edit to prior evidence.
 const fixed=bad.replace('C2,S1,','C2,S2,');await expect(session,apply(conflict.import_id,fixed),409,'checksum_mismatch');
 const corrected=await preview('jobs',fixed),done=await expect(session,apply(corrected.import_id,fixed),200);check(done.status==='completed'&&done.created===1,'Corrected file did not create job');
 const old=await expect(session,{action:'row_results',import_id:conflict.import_id},200);check(old.rows.length===1&&old.rows[0].outcome==='conflict'&&old.rows[0].attempt===1,'New file rewrote old terminal evidence');
 checks.push('A contradictory exact site is shown before apply, retained as a blocking conflict and never falls back to a matching address. Exact replay preserves it; corrected bytes require a new preview and leave the old outcome intact.');
 const duplicate=await preview('jobs',fixed);check(duplicate.preview.duplicate_upload===true&&duplicate.preview.will_update===1,'Repeated file not labelled as duplicate/linked');
 const linked=await expect(session,apply(duplicate.import_id,fixed),200);check(linked.status==='completed'&&linked.linked===1&&linked.created===0,'Duplicate package row must link instead of duplicate');
 check(JSON.stringify(await counts())===JSON.stringify({people:2,sites:2,jobs:3}),'Final dependency/conflict canonical counts differ');
 checks.push('A separately previewed duplicate upload is flagged and links the existing source identity; canonical counts remain two customers, two sites and three jobs.');
}
