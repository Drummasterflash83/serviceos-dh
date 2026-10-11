import { CARD_SOURCE_FIELDS } from "../../src/lib/learn-card-sources";
// Synthetic records only. Used by the local UI review; never imported by src.
const tenant_id = "11111111-1111-4111-8111-111111111111";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  tenant_id,
  updated_at: new Date(Date.now() - 120000).toISOString(),
  ...extra,
});
const drafts: any[] = [];
const performanceEnd = new Date().toISOString().slice(0,10)+"T00:00:00.000Z";
const performanceObserved = new Date(Date.now()-60000).toISOString();
const performancePolicy = {tenantId:tenant_id,id:id(30),version:1,status:"draft",name:"Synthetic service response",subjectKind:"member",groupId:null,scaleMax:100,
 metrics:[{key:"response.within_target",label:"Responses within the agreed time",unit:"percent",weight:1,zeroAt:0,fullAt:100,minSamples:5,minCoverage:1,maxAgeHours:72,sourceSystems:["communications"]}]};
const workFixtureKey='serviceos:synthetic:work-ui:1:'+new URLSearchParams(location.search).get('collection');
const workFixture=JSON.parse(sessionStorage.getItem(workFixtureKey)??'{"rows":[],"reviews":[]}');
export const handoffRows:any[]=workFixture.rows;
export function persistWorkFixture(){sessionStorage.setItem(workFixtureKey,JSON.stringify({rows:handoffRows,reviews:performanceReviews}));}
const handoffRuns:any[]=[];
const handoffPolicy={...performancePolicy,name:"Synthetic recorded handoffs",metrics:[{key:"work.recorded_handoffs",
 label:"Recorded outgoing ownership handoffs",unit:"handoffs",weight:1,zeroAt:0,fullAt:10,minSamples:1,minCoverage:1,
 maxAgeHours:72,sourceSystems:["serviceos.work.handoffs@1"]}]};
const residencePolicy={...performancePolicy,name:"Synthetic elapsed ownership",metrics:[{key:"work.owned_item_minutes",
 label:"Elapsed owned item-minutes (all states)",unit:"item_minutes",weight:1,zeroAt:480,fullAt:60,minSamples:1,minCoverage:1,
 maxAgeHours:72,sourceSystems:["serviceos.work.residence@1"]}]};
const teamResidencePolicy={...residencePolicy,name:"Synthetic team ownership",subjectKind:"team",metrics:[{...residencePolicy.metrics[0],key:"work.team_owned_item_minutes",label:"Team-owned item-minutes",sourceSystems:["serviceos.work.team-residence@1"]}]};
const workingPolicy={...performancePolicy,name:"Synthetic working-time ownership",metrics:[{...residencePolicy.metrics[0],key:"work.working_item_minutes",label:"Owned work during company hours",unit:"working_item_minutes",sourceSystems:["serviceos.work.working-time@1"],workStates:["ready","waiting"]}]};
const teamWorkingPolicy={...workingPolicy,name:"Synthetic team working-time ownership",subjectKind:"team",metrics:[{...workingPolicy.metrics[0],key:"work.team_working_item_minutes",sourceSystems:["serviceos.work.team-working-time@1"]}]};
const initialPolicy=()=>new URLSearchParams(location.search).has("teamWorkingTime")?teamWorkingPolicy:new URLSearchParams(location.search).has("workingTime")?workingPolicy:new URLSearchParams(location.search).has("teamResidence")?teamResidencePolicy:new URLSearchParams(location.search).has("residence")?residencePolicy:new URLSearchParams(location.search).has("handoffs")?handoffPolicy:performancePolicy;
export const selectedPolicy=()=>drafts.find(d=>d.scope_ref===`${initialPolicy().subjectKind}:all`)?.value??initialPolicy();
export function collectHandoffFixture(args:any,residence=false,team=false){
 const metric=team?"work.team_owned_item_minutes":residence?"work.owned_item_minutes":"work.recorded_handoffs",source=team?"serviceos.work.team-residence@1":residence?"serviceos.work.residence@1":"serviceos.work.handoffs@1",unit=residence?"item_minutes":"handoffs",value=residence?120:2;
 const prior=handoffRows.find(r=>r.id===args.p_request);
 if(prior)return {data:{measurementId:prior.id,reused:true},error:null};
 const incomplete=new URLSearchParams(location.search).get(team?"teamResidence":residence?"residence":"handoffs")==="partial";
 const observed=new Date().toISOString();
 handoffRows.push({id:args.p_request,tenant_id,subject_kind:team?"team":"member",subject_id:team?args.p_team:args.p_member,policy_id:args.p_policy,
 policy_revision:args.p_revision,metric_key:metric,value:incomplete?null:value,unit,
 window_start:args.p_start,window_end:args.p_end,measured_at:observed,source,
 source_through:incomplete?null:args.p_end,sample_count:incomplete?1:3,covered_count:incomplete?1:3,eligible_count:3,
 review_state:"inferred",evidence:[{table:team?"learn_team_work_measurement_runs":"learn_work_measurement_runs",id:args.p_request}],exclusions:[],supersedes:null,group_ids:[]});
 handoffRuns.push({id:args.p_request,tenant_id,[team?"team_id":"member_id"]:team?args.p_team:args.p_member,request:{[team?"teamId":"memberId"]:team?args.p_team:args.p_member,policyId:args.p_policy,policyVersion:args.p_revision,start:args.p_start,end:args.p_end},source_system:source,metric_key:metric,
 observed_at:observed,explanation:incomplete?"Synthetic missing history: value withheld.":residence?"Synthetic capture: 120 item-minutes across all states; 3 of 3 retained items covered. Concurrent items add separately. No calendar or delay exclusion.":"Synthetic capture: 2 outgoing transfers; 3 of 3 retained items covered. Not speed or quality.",
 proof:{contract:team?"team-work-residence@1":residence?"work-residence@1":"work-handoffs@1",value:incomplete?null:value,coveredItems:incomplete?1:3,eligibleItems:3,items:[{objectId:id(11),complete:!incomplete}],credited:[],membership:{synthetic:true}}});
 return {data:{measurementId:args.p_request,reused:false},error:null};
}
const publications:any[]=[];
function publicationFixtureRows(){
 const policy=selectedPolicy();
 return new URLSearchParams(location.search).get("publication")==="historical" ? [{id:id(50),tenant_id,
 policy_id:policy.id,revision:1,effective_from:new Date(Date.parse(performanceEnd)-30*86400000).toISOString(),
 scope:"member:all",policy:{...policy,status:"published"}}] : publications;
}
export function publishScorecardFixture(args:any){
 const prior=publications.find(r=>r.id===args.p_request);
 if(prior)return {data:{publicationId:prior.id,policyId:prior.policy_id,revision:prior.revision,effectiveFrom:prior.effective_from,reused:true},error:null};
 const policy=drafts.find(d=>d.value.id===args.p_policy&&d.value.version===args.p_revision)?.value??(selectedPolicy());
 if(policy.id!==args.p_policy||policy.version!==args.p_revision)return {data:null,error:{code:"PT409"}};
 const at=new Date().toISOString();
 publications.push({id:args.p_request,tenant_id,policy_id:policy.id,revision:policy.version,effective_from:at,
 scope:policy.subjectKind+":"+(policy.groupId??"all"),policy:{...policy,status:"published"}});
 return {data:{publicationId:args.p_request,policyId:policy.id,revision:policy.version,effectiveFrom:at,reused:false},error:null};
}
export function publishedPeriodFixture(args:any){
 const rows=publicationFixtureRows().filter(r=>r.scope===args.p_kind+":"+(args.p_group??"all")&&Date.parse(r.effective_from)<=Date.parse(args.p_start));
 const row=rows.at(-1);if(!row)return {data:null,error:null};
 return {data:{...row.policy,publication:{id:row.id,effectiveFrom:row.effective_from,effectiveUntil:null}},error:null};
}
const correctionRecoveryKey='serviceos:synthetic:correction-recovery:1:'+new URLSearchParams(location.search).get('correctionRecovery');
const correctionRecoveryState=JSON.parse(sessionStorage.getItem(correctionRecoveryKey)??'{"rows":null,"corrections":[],"cancelled":{},"lostBefore":false}');
const performanceRows:any[]=correctionRecoveryState.rows??[{id:id(31),tenant_id,subject_kind:"member",subject_id:id(6),policy_id:id(30),policy_revision:1,metric_key:"response.within_target",value:80,unit:"percent",window_start:new Date(Date.parse(performanceEnd)-7*86400000).toISOString(),window_end:performanceEnd,measured_at:performanceObserved,source:"communications",source_through:performanceEnd,sample_count:10,covered_count:10,eligible_count:10,review_state:"inferred",evidence:[{table:"interactions",id:id(8)},{table:"email_messages",id:id(18)},{table:"phone_calls",id:id(19)},{table:"phone_recordings",id:id(21)}],exclusions:[],supersedes:null,group_ids:[]}];
const assessmentFixtureKey = 'serviceos:synthetic:assessments:2';
const assessmentFixture = JSON.parse(sessionStorage.getItem(assessmentFixtureKey) ?? '{"rows":[],"cancelled":{}}');
const assessmentRows:any[]=assessmentFixture.rows;
const cancelledAssessments:Record<string,string>=assessmentFixture.cancelled;
const persistAssessments=()=>sessionStorage.setItem(assessmentFixtureKey,JSON.stringify({rows:assessmentRows,cancelled:cancelledAssessments}));
const assessmentIdentity=(args:any)=>JSON.stringify(Object.fromEntries(['p_tenant','p_request','p_publication','p_kind','p_subject','p_group','p_start','p_end','p_expected','p_reason'].map(k=>[k,args[k]])));
export function resolveAssessmentFixture(args:any){
 const identity=assessmentIdentity(args),prior=assessmentRows.find(r=>r.id===args.p_request),cancelled=cancelledAssessments[args.p_request];
 if ((prior&&prior.request!==identity)||(cancelled&&cancelled!==identity))return {data:null,error:{code:'PT409'}};
 if (!prior&&args.p_cancel) {cancelledAssessments[args.p_request]=identity;persistAssessments();}
 return {data:{state:prior?'recorded':cancelledAssessments[args.p_request]?'cancelled':'pending',assessmentId:args.p_request,
 tenantId:tenant_id,actorId:'22222222-2222-4222-8222-222222222222',...(prior?{recordedAt:prior.recorded_at}:{})},error:null};
}
// Bounded, synthetic history fixture; never reads or writes hosted records.
if(new URLSearchParams(location.search).has('assessmentHistory')&&!assessmentRows.some(r=>r.reason.startsWith('Synthetic historical assessment '))){
 const period={start:new Date(Date.parse(performanceEnd)-7*86400000).toISOString(),end:performanceEnd};
 const policy=publishedPeriodFixture({p_kind:'member',p_group:null,p_start:period.start}).data;
 if(policy)for(let n=1;n<=43;n++){
  const at=performanceEnd.slice(0,10)+'T00:01:00.'+String(Math.floor(n/17)).padStart(6,'0')+'Z';
  assessmentRows.push({id:id(1000+n),tenant_id,publication_id:policy.publication.id,subject_kind:'member',subject_id:id(6),window_start:period.start,window_end:period.end,recorded_at:at,recorded_by:'22222222-2222-4222-8222-222222222222',reason:'Synthetic historical assessment '+n,
   snapshot:{version:'learn-assessment/1',engine:'learn-scorecards/1',policy,subject:{kind:'member',id:id(6),groupIds:[]},period,assessedAt:at,measurements:[],reviews:[],corrections:[]}});
 }
 persistAssessments();
}
let historyPageFailed=false;
const fixtureMicros=(s:string)=>BigInt(Date.parse(s.replace(/\.\d+(?=Z|[+-])/,'')))*1000n+BigInt((s.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0'));
const performanceCorrections:any[]=correctionRecoveryState.corrections;
const persistCorrections=()=>{persistWorkFixture();sessionStorage.setItem(correctionRecoveryKey,JSON.stringify({...correctionRecoveryState,rows:performanceRows,corrections:performanceCorrections}));};
const correctionIdentity=(args:any)=>JSON.stringify([args.p_tenant,args.p_measurement,args.p_request,args.p_expected_review_revision,args.p_value,args.p_reason]);
export function resolveCorrectionFixture(args:any){
 const prior=performanceCorrections.find(r=>r.id===args.p_request),identity=correctionIdentity(args),cancelled=correctionRecoveryState.cancelled[args.p_request];
 if(prior&&(prior.tenant_id!==args.p_tenant||prior.predecessor_id!==args.p_measurement||prior.corrected_value!==args.p_value||prior.reason!==args.p_reason||prior.expected_review_revision!==args.p_expected_review_revision))return{data:null,error:{code:'PT409'}};
 if(cancelled&&cancelled!==identity)return{data:null,error:{code:'PT409'}};
 if(!prior&&args.p_cancel){correctionRecoveryState.cancelled[args.p_request]=identity;persistCorrections();}
 return{data:{state:prior?'recorded':args.p_cancel||cancelled?'cancelled':'pending',tenantId:args.p_tenant,actorId:'22222222-2222-4222-8222-222222222222',measurementId:args.p_request,predecessorId:args.p_measurement,recordedAt:prior?.created_at},error:null};
}
const performanceReviews:any[]=workFixture.reviews;
export function correctPerformanceFixture(args:any){
 if(correctionRecoveryState.cancelled[args.p_request])return{data:null,error:{code:'PT409'}};
 if(new URLSearchParams(location.search).get('correctionRecovery')==='before'&&!correctionRecoveryState.lostBefore){correctionRecoveryState.lostBefore=true;persistCorrections();return{data:null,error:{code:'synthetic_lost_response'}};}

 const rows=(new URLSearchParams(location.search).has("workingTime")||new URLSearchParams(location.search).has("teamWorkingTime")||new URLSearchParams(location.search).has("teamResidence")||new URLSearchParams(location.search).has("handoffs")||new URLSearchParams(location.search).has("residence"))?handoffRows:performanceRows;
 const prior=performanceCorrections.find(r=>r.id===args.p_request);
 if(prior)return {data:{measurementId:prior.id,predecessorId:prior.predecessor_id,reused:true},error:null};
 const parent=rows.find(r=>r.id===args.p_measurement);
 const revision=performanceReviews.filter(r=>r.measurement_id===args.p_measurement).length;
 if(!parent||rows.some(r=>r.supersedes===parent.id)||revision!==args.p_expected_review_revision)return {data:null,error:{code:"PT409"}};
 const observed=new Date().toISOString();
 const earlier=performanceCorrections.find(r=>r.id===parent.id);
 rows.push({...parent,id:args.p_request,value:args.p_value,supersedes:parent.id,measured_at:observed,review_state:"inferred",correction_request_id:args.p_request});
 performanceCorrections.push({id:args.p_request,tenant_id,predecessor_id:parent.id,previous_value:parent.value,corrected_value:args.p_value,
 source_observed_at:earlier?.source_observed_at??parent.measured_at,expected_review_revision:revision,corrected_by:'22222222-2222-4222-8222-222222222222',reason:args.p_reason,created_at:observed});
 persistCorrections();
 if(new URLSearchParams(location.search).get('correctionRecovery')==='lost')return{data:null,error:{code:'synthetic_lost_response'}};
 return {data:{measurementId:args.p_request,predecessorId:parent.id,reused:false},error:null};
}
export function reviewPerformanceFixture(args:any){
 const prior=performanceReviews.find(r=>r.id===args.p_request_id);
 if(prior)return {data:{reviewId:prior.id,measurementId:prior.measurement_id,revision:prior.revision,decision:prior.decision,reused:true},error:null};
 const revision=performanceReviews.filter(r=>r.measurement_id===args.p_measurement_id).length;
 if(args.p_expected_revision!==revision)return {data:null,error:{code:"PT409"}};
 const r={id:args.p_request_id,tenant_id,measurement_id:args.p_measurement_id,revision:revision+1,decision:args.p_decision,reviewed_by:id(40),reason:args.p_reason,created_at:new Date().toISOString()};
 performanceReviews.push(r);
 persistWorkFixture();
 return {data:{reviewId:r.id,measurementId:r.measurement_id,revision:r.revision,decision:r.decision,reused:false},error:null};
}

export async function saveDraftFixture(args: any) {
  const scope = `${args.p_definition.subjectKind}:${args.p_definition.groupId ?? "all"}`;
  const previous = drafts.find((d) => d.scope_ref === scope) ??
    (new URLSearchParams(location.search).has("performance") && `${initialPolicy().subjectKind}:all` === scope ? {value:initialPolicy()} : undefined);
  if (args.p_expected_version !== (previous?.value.version ?? 0))
    return { data: null, error: { code: "PT409" } };
  const value = {
    ...args.p_definition,
    tenantId: tenant_id,
    id: previous?.value.id ?? crypto.randomUUID(),
    version: args.p_expected_version + 1,
    status: "draft",
  };
  drafts.unshift({
    tenant_id,
    scope_kind: "tenant",
    scope_ref: scope,
    namespace: "learn_scorecards",
    value,
  });
  return { data: value, error: null };
}
function records(): Record<string, any[]> {
  const time = new Date(Date.now() - 3600000).toISOString();
  const data:Record<string,any[]> = {
    provider_connections: new URLSearchParams(location.search).get('slack')==='empty'?[]:[row(25,{provider:'slack',status:'configured',revoked_at:null,team_id:'TFIXTURE',team_name:'Synthetic Slack workspace'})],
    operating_profile_entries: drafts.length ? drafts : new URLSearchParams(location.search).has("performance") ? [{tenant_id,scope_kind:"tenant",scope_ref:"member:all",namespace:"learn_scorecards",value:selectedPolicy()}] : [],
    learn_scorecard_publications: publicationFixtureRows(),
    learn_work_measurement_runs: handoffRuns.filter(r=>r.source_system!=="serviceos.work.team-residence@1"),
    learn_team_work_measurement_runs:handoffRuns.filter(r=>r.source_system==="serviceos.work.team-residence@1"),
    measurements: (new URLSearchParams(location.search).has("workingTime") || new URLSearchParams(location.search).has("teamWorkingTime") || new URLSearchParams(location.search).has("teamResidence") || new URLSearchParams(location.search).has("handoffs") || new URLSearchParams(location.search).has("residence")) ? handoffRows : new URLSearchParams(location.search).has("performance") ? performanceRows : [],
    learn_performance_reviews: performanceReviews,
    learn_performance_corrections: performanceCorrections,
    learn_assessments: assessmentRows,
    customer_cards: [row(1, { title: "Example customer · synthetic", company_id: id(2) })],
    jobs: [
      row(3, {
        title: "Example boiler service · synthetic",
        job_number: "REVIEW-001",
        verified: true,
      }),
    ],
    org_units: [row(4, { name: "Office" }), row(5, { name: "Engineers" })],
    team_members: [
      row(6, {
        display_name: "Example coordinator",
        formal_role: "Office coordinator",
        org_unit_id: id(4),
        effective_to: null,
      }),
      row(7, {
        display_name: "Example engineer",
        formal_role: "Service engineer",
        org_unit_id: id(5),
        effective_to: null,
      }),
    ],
    email_messages: [row(18,{subject:"Synthetic appointment request",snippet:"Please confirm a morning visit.",sent_at:time,received_at:time,direction:"inbound"})],
    phone_calls: [row(19,{provider:"simwood",direction:"IN",started_at:time,duration_seconds:120,outcome:"completed"})],
    phone_recordings: [row(21,{provider:"simwood",started_at:time,duration_seconds:115})],
    interactions: [
      row(8, {
        related_company_id: id(2),
        related_job_id: id(3),
        source_connector_id: "gmail",
        source_table: "email_messages",
        source_id: id(18),
        subject: "Service appointment request",
        body_preview: "Synthetic example: Please confirm a morning visit.",
        occurred_at: time,
      }),
      row(9, {
        related_company_id: id(2),
        related_job_id: id(3),
        source_connector_id: "simwood",
        source_table: "phone_calls",
        source_id: id(19),
        subject: "Customer callback",
        summary: "Synthetic example: the office promised to confirm the appointment.",
        occurred_at: time,
      }),
      row(10, {
        source_connector_id: "slack",
        source_table: "slack_messages",
        source_id: id(20),
        subject: "Engineer availability",
        body_preview: "Synthetic example: waiting for the parts delivery before confirming.",
        occurred_at: time,
      }),
    ],
    intelligence_objects: [
      row(12, {object_type:"commitment",subject:"Review team dispatch queue · synthetic",status:"open",responsible_ref:{kind:"org_unit",ref:id(4)},source_interactions:[id(8)],source_entities:[]}),
      row(11, {
        object_type: "commitment",
        subject: "Confirm the service appointment",
        status: "waiting",
        accountable_ref: { kind: "member", ref: id(6) },
        waiting_on_ref: { kind: "member", ref: id(7) },
        deadline: new Date(Date.now() - 86400000).toISOString(),
        confidence: 0.82,
        source_interactions: [id(8), id(9), id(10)],
        source_entities: [],
      }),
    ],
    graph_nodes: [],
  };
  if(new URLSearchParams(location.search).has('groupPicker')) {
    data.org_units.push(...Array.from({length:253},(_,i)=>row(2000+i,{name:`Service team ${String(i+1).padStart(3,'0')} · synthetic`,kind:'Service team'})),row(2300,{name:'Literal 100%_* (A,B) group · synthetic'}));
    data.team_members.push(row(2400,{display_name:'Member in team 253 · synthetic',org_unit_id:id(2252),effective_to:null}));
  }
  if(new URLSearchParams(location.search).has('cardSearch')) {
    data.customer_cards.push(...Array.from({length:61},(_,i)=>row(1000+i,{title:`Search customer ${String(i+1).padStart(3,'0')} · synthetic`})),row(1100,{title:'Literal 100%_* (A,B) "quoted" customer · synthetic'}));
    data.jobs.push(row(1200,{title:'Search installation · synthetic',job_number:'DH-2048',verified:false}));
  }
  return data;
}
let cardSearchFailed=false;
let groupPickerFailed=false;
export async function searchCardFixture(args:any){
 const scenario=new URLSearchParams(location.search).get('cardSearch');
 if(scenario==='retry'&&!cardSearchFailed){cardSearchFailed=true;return {data:null,error:{code:'synthetic_read_failure'}};}
 if(args.p_query==='slow')await new Promise(r=>setTimeout(r,1500));
 const names:Record<string,string>={customer:'customer_cards',job:'jobs',member:'team_members',team:'org_units'};
 const fields:Record<string,string[]>={customer:['title'],job:['title','job_number'],member:['display_name','formal_role'],team:['name']};
 const term=args.p_query.trim();
 const rows=(records()[names[args.p_kind]]??[]).filter(r=>r.tenant_id===args.p_tenant &&
  (args.p_kind!=='member'||r.effective_to===null)&&(!args.p_group||(args.p_kind==='team'?r.id:r.org_unit_id)===args.p_group)&&
  fields[args.p_kind].some(f=>String(r[f]??'').toLowerCase().includes(term.toLowerCase())))
  .sort((a,b)=>Date.parse(b.updated_at)-Date.parse(a.updated_at)||a.id.localeCompare(b.id))
  .slice(args.p_page*24,args.p_page*24+25);
 return {data:{version:'learn-card-search/1',tenantId:args.p_tenant,kind:args.p_kind,query:term,page:args.p_page,groupId:args.p_group,rows:rows.slice(0,24),hasMore:rows.length>24},error:null};
}
export function cardFixture(table: string, supplied?: any[]) {
  if (!supplied && !Object.hasOwn(records(), table)) return null;
  let data = [...(supplied ?? records()[table])];
  let selected = "";
  if (table === "learn_work_collection_runs" && new URLSearchParams(location.search).get("receiptBinding") === "wrong-person")
    data = data.map(r => ({ ...r, subject_id: id(999) }));
  let olderPage=false; const orders:{key:string;ascending:boolean}[]=[];
  const scenario = new URLSearchParams(location.search).get("cards");
  if (scenario === "empty") data = [];
  const simple = (s: string, r: any) => {
    const m = /^(\w+)\.(eq|in|lt)\.(.*)$/.exec(s);
    if (!m) throw Error("Unsupported fixture filter");
    if(table==='learn_assessments'&&m[1]==='recorded_at')return m[2]==='eq'?fixtureMicros(r[m[1]])===fixtureMicros(m[3]):fixtureMicros(r[m[1]])<fixtureMicros(m[3]);
    return m[2]==='lt'?r[m[1]]<m[3]:m[2] === "eq" ? r[m[1]] === m[3] : m[3].slice(1, -1).split(",").includes(r[m[1]]);
  };
  function split(s: string) {
    let depth = 0,
      start = 0;
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      if (s[i] === ")") depth--;
      if (s[i] === "," && !depth) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    return [...out, s.slice(start)];
  }
  let exactCount: number | undefined;
  const q: any = {
    select: (columns = "") => { selected = columns; return q; },
    eq: (key: string, value: unknown) => {
      data = data.filter((r) => r[key] === value);
      return q;
    },
    is: (key: string, value: unknown) => {
      data = data.filter((r) => (r[key] ?? null) === value);
      return q;
    },
    or: (s: string) => {
      if(table==='learn_assessments')olderPage=true;
      data = data.filter((r) =>
        split(s).some((p) =>
          p.startsWith("and(") ? split(p.slice(4, -1)).every((c) => simple(c, r)) : simple(p, r),
        ),
      );
      return q;
    },
    in: (key: string, values: unknown[]) => {
      data = data.filter((r) => values.includes(r[key]));
      return q;
    },
    overlaps: (key: string, values: unknown[]) => {
      data = data.filter((r) => r[key]?.some((v: unknown) => values.includes(v)));
      return q;
    },
    contains: (key: string, value: Record<string, unknown>) => {
      data = data.filter((r) => Object.entries(value).every(([k, v]) => r[key]?.[k] === v));
      return q;
    },
    order: (key:string,options:{ascending?:boolean}={}) => {
      if(table==='learn_assessments'){
        orders.push({key,ascending:options.ascending!==false});
        data.sort((a,b)=>{for(const o of orders){const av=o.key==='recorded_at'?fixtureMicros(a[o.key]):a[o.key],bv=o.key==='recorded_at'?fixtureMicros(b[o.key]):b[o.key];if(av!==bv)return (av<bv?-1:1)*(o.ascending?1:-1);}return 0;});
      }return q;
    },
    limit: (n: number) => {
      exactCount = data.length;
      data = data.slice(0, n);
      return q;
    },
    range: (a: number, b: number) => {
      data = data.slice(a, b + 1);
      return q;
    },
    then: (resolve: any) => {
      const failPage=table==='learn_assessments'&&olderPage&&!historyPageFailed&&new URLSearchParams(location.search).get('assessmentHistory')==='retry';
      if(failPage)historyPageFailed=true;
      const failGroup=table==='org_units'&&!groupPickerFailed&&new URLSearchParams(location.search).get('groupPicker')==='retry';
      if(failGroup)groupPickerFailed=true;
      return Promise.resolve(
        scenario === "error" || failPage || failGroup
          ? { data: null, error: { message: "Synthetic denied read" } }
          : { data: selected && ["learn_work_measurement_runs", "learn_team_work_measurement_runs", "learn_work_collection_runs"].includes(table)
              ? data.map(r => Object.fromEntries(selected.split(",").map(field => {
                  const [alias, path] = field.includes(":") ? field.split(":") : [field, field];
                  return [alias, path.split("->").reduce((v: any, k: string) => v?.[k], r) ?? null];
                }))) : data, count: exactCount ?? data.length, error: null },
      ).then(resolve);
    },
  };
  return q;
}

export function readDraftFixture(args:any){
 const value=drafts.find(d=>d.scope_ref===`${args.p_kind}:${args.p_group??"all"}`)?.value??(new URLSearchParams(location.search).has("performance")?selectedPolicy():null);
 return {data:value&&value.tenantId===args.p_tenant&&value.subjectKind===args.p_kind&&(value.groupId??null)===(args.p_group??null)?value:null,error:null};
}

export async function communicationFixture(args:any) {
 const query=cardFixture("interactions");
 if(!query||args.p_tenant!==tenant_id||new URLSearchParams(location.search).has("viewer"))return {data:null,error:{code:"42501"}};
 const result=await query.select().eq("tenant_id",args.p_tenant);
 const fields="id,tenant_id,source_connector_id,source_type,source_table,source_id,occurred_at,subject,summary,body_preview,status,related_person_id,related_company_id,related_job_id".split(",");
 const rows=(result.data??[]).filter((r:any)=>!["deleted","removed"].includes(r.status)&&(args.p_ids?.includes(r.id)||(args.p_person&&r.related_person_id===args.p_person)||(args.p_company&&r.related_company_id===args.p_company)||(args.p_job&&r.related_job_id===args.p_job))).slice(0,51).map((r:any)=>Object.fromEntries(fields.map(k=>[k,r[k]??null])));
 return {data:{version:"learn-card-communications/1",tenant_id,rows},error:null};
}

const sourceReadAttempts = new Map<string, number>();
export async function sourceFixture(args:any){
 const scenario = new URLSearchParams(location.search).get("sourceRead");
 const identity = `${args.p_tenant}:${args.p_table}:${args.p_id}`;
 const attempt = (sourceReadAttempts.get(identity) ?? 0) + 1;
 sourceReadAttempts.set(identity, attempt);
 if(scenario === "denied" || (scenario === "retry" && attempt === 1)) return {data:null,error:{code:"42501"}};
 const names=(CARD_SOURCE_FIELDS as Record<string,readonly string[]>)[args.p_table];
 if(!names||args.p_tenant!==tenant_id||new URLSearchParams(location.search).has("viewer"))return {data:null,error:{code:"42501"}};
 const query=cardFixture(args.p_table);
 const result=await query.select().eq("tenant_id",args.p_tenant).eq("id",args.p_id);
 if(result.error)return result;
 const row=result.data[0];
 const record=row?Object.fromEntries(["id","tenant_id",...names].map(k=>[k,row[k]??null])):null;
 return {data:{version:"learn-card-source/1",tenant_id,table:args.p_table,id:args.p_id,record},error:null};
}

export function saveAssessmentFixture(args:any){
 if(cancelledAssessments[args.p_request])return {data:null,error:{code:'PT409'}};
 if(new URLSearchParams(location.search).get('assessments')==='pending')return {data:null,error:{code:'network'}};
 const prior=assessmentRows.find(r=>r.id===args.p_request);
 if(prior)return prior.request!==assessmentIdentity(args)?{data:null,error:{code:'PT409'}}:{data:{assessmentId:prior.id,recordedAt:prior.recorded_at,reused:true},error:null};
 const policy=publishedPeriodFixture(args).data;
 if(!policy||policy.publication.id!==args.p_publication)return {data:null,error:{code:"PT409"}};
 const available=(new URLSearchParams(location.search).has("workingTime")||new URLSearchParams(location.search).has("teamWorkingTime")||new URLSearchParams(location.search).has("teamResidence")||new URLSearchParams(location.search).has("handoffs")||new URLSearchParams(location.search).has("residence"))?handoffRows:performanceRows;
 const measurements=available.filter(m=>m.subject_id===args.p_subject&&m.policy_id===policy.id&&m.policy_revision===policy.version&&Date.parse(m.window_start)===Date.parse(args.p_start)&&Date.parse(m.window_end)===Date.parse(args.p_end));
 const ids=measurements.map(m=>m.id),reviews=performanceReviews.filter(r=>ids.includes(r.measurement_id)),corrections=performanceCorrections.filter(r=>ids.includes(r.id));
 const expected=measurements.map(m=>({id:m.id,reviewRevision:reviews.filter(r=>r.measurement_id===m.id).length})).sort((a,b)=>a.id.localeCompare(b.id));
 if(JSON.stringify(expected)!==JSON.stringify(args.p_expected))return {data:null,error:{code:"PT409"}};
 const at=new Date().toISOString();
 assessmentRows.unshift({request:assessmentIdentity(args),id:args.p_request,tenant_id,publication_id:args.p_publication,subject_kind:args.p_kind,subject_id:args.p_subject,window_start:args.p_start,window_end:args.p_end,recorded_at:at,recorded_by:"22222222-2222-4222-8222-222222222222",reason:args.p_reason,
 snapshot:structuredClone({version:"learn-assessment/1",engine:"learn-scorecards/1",policy,subject:{kind:args.p_kind,id:args.p_subject,groupIds:args.p_group?[args.p_group]:[]},period:{start:args.p_start,end:args.p_end},assessedAt:at,measurements,reviews,corrections})});
 persistAssessments();
 if(new URLSearchParams(location.search).get("assessments")==="uncertain")return {data:null,error:{code:"network"}};
 return {data:{assessmentId:args.p_request,recordedAt:at,reused:false},error:null};
}
