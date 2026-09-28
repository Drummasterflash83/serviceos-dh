// Local-only: application-schema tests roll back. Real concurrent-session tests
// use a unique isolated schema, copy the actual claim SQL, and remove only that schema.
import { readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const hasPractice = execFileSync("docker", ["exec", "supabase_db_serviceos-dh", "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", "select to_regclass('public.receptionist_practice_sessions') is not null"], { encoding: "utf8" }).trim() === "t";
const migrations = [...(hasPractice ? [] : ["20261020120000_receptionist_practice.sql"]), "20261022120000_receptionist_care_loop.sql", "20261022130000_receptionist_care_delivery.sql"]
  .map((name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/^begin;\s*$/gim, "").replace(/^commit;\s*$/gim, ""));
const deliveryMigration = migrations.pop();
const sql = `begin;
${migrations.join("\n")}
create temp table ids as select gen_random_uuid() tenant,gen_random_uuid() other_tenant,gen_random_uuid() admin_id,gen_random_uuid() client_id,gen_random_uuid() call_id,gen_random_uuid() call_two,gen_random_uuid() feedback,gen_random_uuid() practice,gen_random_uuid() historic_call,gen_random_uuid() historic_practice;
grant select on ids to authenticated;
insert into public.tenants(id,slug,display_name) select tenant,'delivery-proof-'||tenant,'Delivery proof' from ids union all select other_tenant,'delivery-proof-'||other_tenant,'Other proof' from ids;
insert into auth.users(id,email) select admin_id,'delivery-admin-'||admin_id||'@example.invalid' from ids union all select client_id,'delivery-client-'||client_id||'@example.invalid' from ids;
insert into public.profiles(id,tenant_id,role) select admin_id,tenant,'owner' from ids union all select client_id,other_tenant,'viewer' from ids on conflict(id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
insert into public.platform_authority_grants(profile_id,permission,granted_by) select admin_id,'platform.controlplane.admin','proof' from ids;
insert into public.receptionist_workspaces(tenant_id,company,name,assistant_id,vapi_secret_name) select tenant,'Proof','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF' from ids union all select other_tenant,'Other proof','Emma',gen_random_uuid(),'RECEPTIONIST_VAPI_PROOF_OTHER' from ids;
insert into public.receptionist_practice_sessions(id,tenant_id,author_id,call_id,state) select historic_practice,other_tenant,client_id,historic_call,'ended' from ids;
insert into public.receptionist_feedback(tenant_id,author_id,call_id,practice_session_id,title,body) select other_tenant,client_id,historic_call,historic_practice,'Historical feedback','An earlier practice report.' from ids;
insert into public.phone_calls(tenant_id,provider,provider_call_id,outcome,duration_seconds) select other_tenant,'vapi',historic_call::text,'ended',30 from ids union all select other_tenant,'simwood',gen_random_uuid()::text,'answered',45 from ids;
${deliveryMigration}
create function pg_temp.ok(b boolean,t text) returns void language plpgsql as $$begin if b is distinct from true then raise exception 'FAIL %',t;end if;raise notice 'PASS %',t;end$$;
create function pg_temp.refuses(q text,t text,expected text default null) returns void language plpgsql as $$declare b boolean:=false;begin begin execute q;exception when others then if expected is not null and sqlstate<>expected then raise;end if;b:=true;end;perform pg_temp.ok(b,t);end$$;
select pg_temp.ok((select count(*)=1 from public.receptionist_review_queue q,ids p where q.tenant_id=p.other_tenant),'historical practice and mirror deduplicate to one call');
select pg_temp.ok((select generation=3 from public.receptionist_review_queue q,ids p where q.call_id=p.historic_call),'historical practice feedback and Vapi evidence all retained');
select pg_temp.ok((select count(distinct source)=3 from public.receptionist_review_observations o,ids p where o.call_id=p.historic_call),'backfill carries separate evidence origins');
select pg_temp.ok((select count(*)=1 from public.receptionist_alert_outbox o,ids p where o.tenant_id=p.other_tenant),'historical issue receives one initial alert');
select pg_temp.ok(not public.care_enqueue_review(other_tenant,historic_call,'practice:'||historic_practice||':ended:'||historic_call,now(),'practice'),'historical practice backfill replays idempotently') from ids;

select pg_temp.ok(public.care_enqueue_review(tenant,call_id,'provider:first',now(),'provider'),'first observation queues work') from ids;
select pg_temp.ok(not public.care_enqueue_review(tenant,call_id,'provider:first',now(),'provider'),'duplicate observation is idempotent') from ids;
select pg_temp.ok((select generation=1 from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant),'duplicate did not advance generation');
select pg_temp.ok((select count(*)=0 from public.care_claim_reviews()),'disabled tenant never consumes review budget');
insert into public.receptionist_review_settings(tenant_id,enabled,approved_rules,daily_review_limit) select tenant,true,'Do not repeat opening hours.',2 from ids;
create temp table claimed as select * from public.care_claim_reviews(1,180);
select pg_temp.ok((select count(*)=1 from claimed),'first claimant obtains lease');
select pg_temp.ok((select count(*)=0 from public.care_claim_reviews(1,180)),'competing claimant cannot take active lease');
select pg_temp.ok(not public.care_complete_review(tenant,call_id,gen_random_uuid(),repeat('a',64),'proof','{"summary":"Fine","findings":[],"limitations":[]}'),'stale review ack refused') from ids;
select pg_temp.ok(public.care_enqueue_review(tenant,call_id,'feedback:later',now()-interval '1 day','feedback'),'late-arriving feedback is not lost') from ids;
select pg_temp.ok((select latest_observed_at=now() and generation=2 from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant),'older observation cannot rewind latest timestamp');
select pg_temp.ok(public.care_complete_review(tenant_id,call_id,lease_id,repeat('a',64),'proof','{"summary":"Fine","findings":[],"limitations":[]}'),'leased review stores and acknowledges atomically') from claimed;
select pg_temp.ok((select state='queued' and completed_generation=1 and generation=2 from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant),'evidence arriving during review remains queued');
truncate claimed;insert into claimed select * from public.care_claim_reviews(1,180);
select pg_temp.ok(public.care_fail_review(tenant_id,call_id,lease_id,'provider_temporarily_unavailable',true,60),'retryable failure releases lease') from claimed;
select pg_temp.ok((select state='retry' and available_at>now() and last_error='provider_temporarily_unavailable' from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant),'retry has bounded delayed backoff');
select pg_temp.refuses(format('select public.care_fail_review(%L,%L,%L,%L)',tenant_id,call_id,lease_id,'Raw provider error with /customer/path'),'raw error text refused') from claimed;
update public.receptionist_review_queue set available_at=now() where tenant_id=(select tenant from ids);
select pg_temp.ok((select count(*)=0 from public.care_claim_reviews()),'daily budget prevents additional reviews');
update public.receptionist_review_settings set daily_review_limit=100 where tenant_id=(select tenant from ids);
truncate claimed;insert into claimed select * from public.care_claim_reviews(1,180);
update public.receptionist_review_queue set lease_until=now()-interval '1 second' where tenant_id=(select tenant from ids);
select pg_temp.ok(not public.care_complete_review(tenant_id,call_id,lease_id,repeat('b',64),'proof','{"summary":"Fine","findings":[],"limitations":[]}'),'expired worker cannot store review') from claimed;
create temp table re_claimed as select * from public.care_claim_reviews(1,180);
select pg_temp.ok((select n.lease_id<>o.lease_id from re_claimed n,claimed o),'lease expiry grants a new token');
select pg_temp.ok((select a.state='lease_expired' from public.receptionist_review_attempts a,claimed c where a.id=c.lease_id),'expired attempt retained in audit');
select pg_temp.ok(not public.care_fail_review(tenant_id,call_id,lease_id,'late_worker',true,60),'old lease cannot fail new worker') from claimed;
select pg_temp.ok(public.care_fail_review(tenant_id,call_id,lease_id,'review_credit_required',true,60),'credit exhaustion recorded safely') from re_claimed;
select pg_temp.ok((select available_at>now()+interval '1 minute' from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant),'credit retry deferred to next UTC day');

create temp table scans as select * from public.care_claim_scans(1,180);
select pg_temp.ok((select count(*)=1 from scans),'scanner obtains tenant lease');
select pg_temp.ok((select count(*)=0 from public.care_claim_scans(1,180)),'competing scanner cannot duplicate tenant');
select pg_temp.ok(public.care_fail_scan(tenant_id,lease_id,'scan_population_incomplete'),'incomplete scan fails') from scans;
select pg_temp.ok((select last_scan_at is null and scan_state='failed' from public.receptionist_review_settings r,ids p where r.tenant_id=p.tenant),'failed scan never advances watermark');
update public.receptionist_review_settings set scan_available_at=now() where tenant_id=(select tenant from ids);
truncate scans;insert into scans select * from public.care_claim_scans(1,180);
select pg_temp.ok(public.care_complete_scan(tenant_id,lease_id,now()-interval '1 minute',2),'complete scan advances watermark') from scans;
select pg_temp.ok(not public.care_complete_scan(tenant_id,lease_id,now(),3),'replayed scanner ack refused') from scans;

insert into public.receptionist_practice_sessions(id,tenant_id,author_id,call_id,state) select practice,tenant,admin_id,call_two,'active' from ids;
select pg_temp.ok((select count(*)=1 from public.receptionist_review_queue q,ids p where q.tenant_id=p.tenant and q.call_id=p.call_two),'bound practice automatically queued');
update public.receptionist_practice_sessions set state='ended' where id=(select practice from ids);
select pg_temp.ok((select generation=2 from public.receptionist_review_queue q,ids p where q.call_id=p.call_two),'completed practice queues fresh provider check');
insert into public.receptionist_feedback(id,tenant_id,author_id,call_id,practice_session_id,title,body,priority) select feedback,tenant,admin_id,call_two,practice,'Opening hours repeated','Please check this repeated sentence.','urgent' from ids;
select pg_temp.ok((select generation=3 from public.receptionist_review_queue q,ids p where q.call_id=p.call_two),'submitted practice feedback queues refreshed review');
select pg_temp.ok((select count(*)=1 from public.receptionist_alert_outbox o,ids p where o.tenant_id=p.tenant),'feedback has atomic alert receipt');
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts()),'unverified or missing Slack route cannot deliver');
insert into public.module_alert_routes(tenant_id,kind,team_id,channel_id,enabled,verified_at) select tenant,'urgent','TPROOF','CPROOF',true,now() from ids;
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts()),'verified route cannot bypass explicit notification cutover');
update public.receptionist_review_settings set care_notifications_enabled=true where tenant_id=(select tenant from ids);
create temp table alerts as select * from public.care_claim_alerts(1,180);
select pg_temp.ok((select count(*)=1 from alerts),'verified route can claim delivery');
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts(1,180)),'competing alert claimant cannot duplicate send');
select pg_temp.refuses(format('select public.care_ack_alert(%L,%L,%L,null)',id,lease_id,channel_id),'missing Slack receipt cannot become sent') from alerts;
select pg_temp.ok(not public.care_ack_alert(id,lease_id,'CWRONG','1790600000.123456'),'wrong Slack destination cannot become sent') from alerts;
select pg_temp.ok(public.care_fail_alert(id,lease_id,'slack_response_lost',true,60),'lost Slack response held as uncertain') from alerts;
select pg_temp.ok((select o.state='delivery_unknown' and o.sent_at is null from public.receptionist_alert_outbox o,alerts a where o.id=a.id),'uncertain delivery does not falsely claim success');
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts()),'uncertain delivery never blindly resends');
select pg_temp.refuses(format('select public.care_reconcile_alert(%L,%L,null,false)',id,channel_id),'failed history lookup is not proof of absence') from alerts;
select pg_temp.ok(public.care_reconcile_alert(id,channel_id,'1790600000.123456',false),'provider receipt resolves uncertain delivery') from alerts;
select pg_temp.ok((select o.state='sent' and o.receipt_ts='1790600000.123456' from public.receptionist_alert_outbox o,alerts a where o.id=a.id),'confirmed Slack receipt persisted');
select pg_temp.ok(not public.care_ack_alert(id,lease_id,channel_id,'1790600000.123456'),'stale delivery ack cannot rewrite receipt') from alerts;

update public.receptionist_care_issues set created_at=now()-interval '1 hour' where feedback_id=(select feedback from ids);
select pg_temp.ok(public.care_schedule_escalations()=1,'urgent unowned issue schedules reminder');
select pg_temp.ok(public.care_schedule_escalations()=0,'same reminder window deduplicated');
update public.receptionist_care_issues set owner_id=(select admin_id from ids),due_at=now()+interval '4 hours' where feedback_id=(select feedback from ids);
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts()),'taking ownership cancels unsent unowned reminder');
select pg_temp.ok(public.care_schedule_escalations()=0,'owned issue does not nag before deadline');
update public.receptionist_care_issues set due_at=now()-interval '1 minute' where feedback_id=(select feedback from ids);
select pg_temp.ok(public.care_schedule_escalations()=1,'owned overdue issue escalates');
truncate alerts;insert into alerts select * from public.care_claim_alerts(1,180);
update public.receptionist_alert_outbox set lease_until=now()-interval '1 second' where id=(select id from alerts);
select pg_temp.ok((select count(*)=0 from public.care_claim_alerts()),'expired send lease held for receipt reconciliation');
select pg_temp.ok((select o.state='delivery_unknown' from public.receptionist_alert_outbox o,alerts a where o.id=a.id),'expired send is not treated as absent');
select pg_temp.refuses(format('insert into public.receptionist_alert_outbox(tenant_id,issue_id,kind,reason,dedup_key,issue_version) values(%L,%L,%L,%L,%L,1)',p.other_tenant,i.id,'urgent','event','bad-tenant'),'cross-tenant alert references refused','23503') from ids p join public.receptionist_care_issues i on i.feedback_id=p.feedback;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select client_id::text from ids),true);
select pg_temp.ok((select count(*)=0 from public.receptionist_review_queue),'client cannot read operator review queue');
select pg_temp.ok((select count(*)=0 from public.receptionist_alert_outbox),'client cannot read private Slack delivery state');
select pg_temp.refuses('select * from public.care_claim_reviews()','client cannot lease service work','42501');
select pg_temp.refuses(format('select public.care_operating_summary(%L)',tenant),'client cannot view operator health','42501') from ids;
select set_config('request.jwt.claim.sub',(select admin_id::text from ids),true);
select pg_temp.ok((public.care_operating_summary(tenant)#>>'{reviews,observed}')::integer=2,'operator summary counts actual locally observed calls') from ids;
select pg_temp.ok((public.care_operating_summary(tenant)#>>'{practice,with_feedback}')::integer=1,'operator summary shows saved practice feedback') from ids;
select pg_temp.refuses('select * from public.care_claim_alerts()','operator cannot bypass service delivery gate','42501');
reset role;
select pg_temp.refuses('select * from public.care_claim_reviews(null,180)','null review limit refused');
select pg_temp.refuses('select * from public.care_claim_scans(1,null)','null scan lease refused');
select pg_temp.refuses('select * from public.care_claim_alerts(null,180)','null alert limit refused');

-- New approved rules invalidate all known calls, including work already leased.
update public.receptionist_review_queue set available_at=now(),attempts=0 where tenant_id=(select tenant from ids);
truncate claimed;insert into claimed select * from public.care_claim_reviews(1,180);
create temp table generation_before as select tenant_id,call_id,generation from public.receptionist_review_queue;
update public.receptionist_review_settings set version=version+1,approved_rules='State opening hours once.' where tenant_id=(select tenant from ids);
select pg_temp.ok((select bool_and(q.generation=b.generation+1) from public.receptionist_review_queue q join generation_before b using(tenant_id,call_id) where q.tenant_id=(select tenant from ids)),'new approved rules queue every known call');
select pg_temp.ok(not public.care_complete_review(tenant_id,call_id,lease_id,repeat('c',64),'proof','{"summary":"Fine","findings":[],"limitations":[]}'),'old-rules result cannot acknowledge current rules') from claimed;
select pg_temp.ok((select count(*)=0 from public.receptionist_call_reviews where evidence_hash=repeat('c',64)),'old-rules result was not stored');
update public.receptionist_review_queue set available_at=now(),attempts=7 where tenant_id=(select tenant from ids);
truncate claimed;insert into claimed select * from public.care_claim_reviews(1,180);
select pg_temp.ok(public.care_fail_review(tenant_id,call_id,lease_id,'provider_temporarily_unavailable',true,60),'eighth failed attempt is recorded') from claimed;
select pg_temp.ok((select q.state='dead_letter' from public.receptionist_review_queue q join claimed c using(tenant_id,call_id)),'retry exhaustion goes to dead letter');

-- One very busy tenant cannot take every first-round claim from another tenant.
insert into public.receptionist_review_settings(tenant_id,enabled,approved_rules) select other_tenant,true,'Use approved rules.' from ids;
select public.care_enqueue_review(other_tenant,gen_random_uuid(),'provider:fairness',now(),'provider') from ids;
select public.care_enqueue_review(tenant,gen_random_uuid(),'provider:busy1',now(),'provider') from ids;
select public.care_enqueue_review(tenant,gen_random_uuid(),'provider:busy2',now(),'provider') from ids;
create temp table fair_claims as select * from public.care_claim_reviews(2,180);
select pg_temp.ok((select count(distinct tenant_id)=2 from fair_claims),'two-tenant queue uses fair first-round claims');

insert into public.receptionist_alert_outbox(tenant_id,issue_id,kind,reason,dedup_key,issue_version)
select p.tenant,i.id,'attention','event','priority:normal',i.version from ids p join public.receptionist_care_issues i on i.feedback_id=p.feedback;
insert into public.receptionist_alert_outbox(tenant_id,issue_id,kind,reason,dedup_key,issue_version)
select p.tenant,i.id,'urgent','event','priority:urgent',i.version from ids p join public.receptionist_care_issues i on i.feedback_id=p.feedback;
insert into public.module_alert_routes(tenant_id,kind,team_id,channel_id,enabled,verified_at) select tenant,'attention','TPROOF','CPROOF',true,now() from ids;
truncate alerts;insert into alerts select * from public.care_claim_alerts(1,180);
select pg_temp.ok((select kind='urgent' from alerts),'urgent delivery is claimed before ordinary attention');
select pg_temp.ok(not public.care_ack_alert(id,gen_random_uuid(),channel_id,'1790600001.123456'),'wrong delivery lease refused') from alerts;
select pg_temp.refuses(format('select public.care_fail_alert(%L,%L,%L,false,null)',id,lease_id,'safe_code'),'null delivery retry delay refused') from alerts;
select pg_temp.ok(public.care_enqueue_reviews_batch(other_tenant,jsonb_build_array(jsonb_build_object('call_id',call_id,'observation_key','batch:one','observed_at',now(),'source','provider')))=1,'bounded batch queues observations') from ids;
select pg_temp.ok(public.care_enqueue_reviews_batch(other_tenant,jsonb_build_array(jsonb_build_object('call_id',call_id,'observation_key','batch:one','observed_at',now(),'source','provider')))=0,'batch replay is idempotent') from ids;
select pg_temp.refuses(format('select public.care_enqueue_reviews_batch(%L,%L)',other_tenant,'[{"call_id":"not-a-uuid"}]'),'invalid batch fails atomically') from ids;

update public.receptionist_review_settings set scan_available_at=now() where tenant_id=(select tenant from ids);
truncate scans;insert into scans select * from public.care_claim_scans(20,180) where tenant_id=(select tenant from ids);
select pg_temp.ok(public.care_pause_scan(tenant_id,lease_id,now(),jsonb_build_array(jsonb_build_object('from',now()-interval '1 year','to',now())),15),'partial backfill persists continuation') from scans;
select pg_temp.ok((select scan_state='backfilling' and last_scan_at=now()-interval '1 minute' and scan_pending_count=15 from public.receptionist_review_settings r,ids p where r.tenant_id=p.tenant),'partial backfill never advances complete watermark');
update public.receptionist_review_settings set scan_available_at=now() where tenant_id=(select tenant from ids);
truncate scans;insert into scans select * from public.care_claim_scans(20,180) where tenant_id=(select tenant from ids);
select pg_temp.ok((select jsonb_array_length(scan_pending_windows)=1 and scan_pending_count=15 and scan_cutoff=now() from scans),'next worker receives same cutoff and pending work');
select pg_temp.ok(not public.care_pause_scan(tenant_id,lease_id,now()-interval '1 second',jsonb_build_array(jsonb_build_object('from',now()-interval '1 year','to',now()-interval '1 second')),16),'continuation cannot change snapshot cutoff') from scans;
select pg_temp.ok(not public.care_pause_scan(tenant_id,lease_id,now(),scan_pending_windows,14),'continuation cannot rewind covered count') from scans;
select pg_temp.ok(public.care_complete_scan(tenant_id,lease_id,now(),16),'final resumed scan can complete') from scans;
select pg_temp.ok((select scan_pending_windows is null and scan_pending_count=0 and last_scan_count=16 from public.receptionist_review_settings r,ids p where r.tenant_id=p.tenant),'completion clears durable continuation');
rollback;`;
execFileSync("docker", ["exec", "-i", "supabase_db_serviceos-dh", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, stdio: ["pipe", "pipe", "inherit"] });
console.log("Care delivery proof passed; application schema and synthetic fixtures rolled back.");

// An uncommitted migration is invisible to a second connection. Use an isolated
// schema containing ONLY synthetic tables and the exact claim function body,
// with schema qualification changed. No application table or customer row is copied.
const isolatedSchema = `care_concurrency_proof_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
if (!/^care_concurrency_proof_[a-f0-9]{16}$/.test(isolatedSchema)) throw Error("Invalid proof schema");
const psqlArgs = ["exec", "-i", "supabase_db_serviceos-dh", "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"];
const db = (input) => execFileSync("docker", psqlArgs, { input, encoding: "utf8" }).trim();
const tenantA = randomUUID(), tenantB = randomUUID();
const tableSql = ["receptionist_review_queue", "receptionist_review_budgets", "receptionist_review_attempts"].map((name) => {
  const found = deliveryMigration.match(new RegExp(`create table public\\.${name} \\([\\s\\S]+?^\\);`, "m"));
  if (!found) throw Error(`Missing proof source ${name}`);
  return found[0].replaceAll("public.", `${isolatedSchema}.`);
}).join("\n");
const claimSql = deliveryMigration.match(/create function public\.care_claim_reviews\([\s\S]+?^end \$\$;/m)?.[0].replaceAll("public.", `${isolatedSchema}.`);
if (!claimSql) throw Error("Missing actual claim SQL");
function holder() {
  const child = spawn("docker", psqlArgs, { stdio: ["pipe", "pipe", "pipe"] });
  let output = "", errors = "";
  let releaseReady;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Concurrent holder did not acquire lease")), 10000);
    releaseReady = () => { clearTimeout(timer); resolve(); };
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); if (output.includes("CLAIM_LOCKED")) releaseReady(); });
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(Error(`Concurrent proof session failed: ${errors}`)));
  });
  child.stdin.end(`begin; select count(*) from ${isolatedSchema}.care_claim_reviews(1,180); select 'CLAIM_LOCKED'; select pg_sleep(2); commit;`);
  return { ready, done };
}
let isolatedCreated = false;
try {
  db(`begin; create schema ${isolatedSchema};
  create table ${isolatedSchema}.receptionist_workspaces(tenant_id uuid primary key);
  create table ${isolatedSchema}.receptionist_review_settings(tenant_id uuid primary key,enabled boolean,daily_review_limit integer,version integer);
  ${tableSql}
  ${claimSql}
  insert into ${isolatedSchema}.receptionist_workspaces values('${tenantA}'),('${tenantB}');
  insert into ${isolatedSchema}.receptionist_review_settings values('${tenantA}',true,1,1),('${tenantB}',true,100,1);
  insert into ${isolatedSchema}.receptionist_review_queue(tenant_id,call_id,latest_observed_at) values('${tenantA}',gen_random_uuid(),now()),('${tenantA}',gen_random_uuid(),now()); commit;`);
  isolatedCreated = true;
  let active = holder();
  try {
    await active.ready;
    const second = db(`select count(*) from ${isolatedSchema}.care_claim_reviews(1,180);`);
    if (second !== "0") throw Error("Concurrent worker exceeded tenant budget lock");
  } finally { await active.done; }
  console.log("PASS concurrent second session skips locked tenant budget and active lease");
  if (db(`select reserved=1 and (select count(*)=1 from ${isolatedSchema}.receptionist_review_queue where state='leased') from ${isolatedSchema}.receptionist_review_budgets where tenant_id='${tenantA}';`) !== "t") throw Error("Concurrent budget was exceeded");
  console.log("PASS concurrent sessions reserve one daily budget unit exactly");
  db(`update ${isolatedSchema}.receptionist_review_settings set daily_review_limit=100 where tenant_id='${tenantA}'; insert into ${isolatedSchema}.receptionist_review_queue(tenant_id,call_id,latest_observed_at) values('${tenantB}',gen_random_uuid(),now());`);
  active = holder();
  try {
    await active.ready;
    const other = db(`select tenant_id from ${isolatedSchema}.care_claim_reviews(1,180);`);
    if (other !== tenantB) throw Error("Unrelated tenant blocked behind another worker");
  } finally { await active.done; }
  console.log("PASS concurrent session can claim a different tenant while first worker holds locks");
} finally {
  if (isolatedCreated) db(`drop schema ${isolatedSchema} cascade;`);
}
console.log("Concurrent proof passed; its isolated synthetic schema was removed. No application state was changed.");
