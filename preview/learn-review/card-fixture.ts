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
const handoffRows:any[]=[];
const handoffRuns:any[]=[];
const handoffPolicy={...performancePolicy,name:"Synthetic recorded handoffs",metrics:[{key:"work.recorded_handoffs",
 label:"Recorded outgoing ownership handoffs",unit:"handoffs",weight:1,zeroAt:0,fullAt:10,minSamples:1,minCoverage:1,
 maxAgeHours:72,sourceSystems:["serviceos.work.handoffs@1"]}]};
const residencePolicy={...performancePolicy,name:"Synthetic elapsed ownership",metrics:[{key:"work.owned_item_minutes",
 label:"Elapsed owned item-minutes (all states)",unit:"item_minutes",weight:1,zeroAt:480,fullAt:60,minSamples:1,minCoverage:1,
 maxAgeHours:72,sourceSystems:["serviceos.work.residence@1"]}]};
const selectedPolicy=()=>new URLSearchParams(location.search).has("residence")?residencePolicy:new URLSearchParams(location.search).has("handoffs")?handoffPolicy:performancePolicy;
export function collectHandoffFixture(args:any,residence=false){
 const metric=residence?"work.owned_item_minutes":"work.recorded_handoffs",source=residence?"serviceos.work.residence@1":"serviceos.work.handoffs@1",unit=residence?"item_minutes":"handoffs",value=residence?120:2;
 const prior=handoffRows.find(r=>r.id===args.p_request);
 if(prior)return {data:{measurementId:prior.id,reused:true},error:null};
 const incomplete=new URLSearchParams(location.search).get(residence?"residence":"handoffs")==="partial";
 const observed=new Date().toISOString();
 handoffRows.push({id:args.p_request,tenant_id,subject_kind:"member",subject_id:args.p_member,policy_id:args.p_policy,
 policy_revision:args.p_revision,metric_key:metric,value:incomplete?null:value,unit,
 window_start:args.p_start,window_end:args.p_end,measured_at:observed,source,
 source_through:incomplete?null:args.p_end,sample_count:incomplete?1:3,covered_count:incomplete?1:3,eligible_count:3,
 review_state:"inferred",evidence:[{table:"learn_work_measurement_runs",id:args.p_request}],exclusions:[],supersedes:null,group_ids:[]});
 handoffRuns.push({id:args.p_request,tenant_id,source_system:source,metric_key:metric,
 observed_at:observed,explanation:incomplete?"Synthetic missing history: value withheld.":residence?"Synthetic capture: 120 item-minutes across all states; 3 of 3 retained items covered. Concurrent items add separately. No calendar or delay exclusion.":"Synthetic capture: 2 outgoing transfers; 3 of 3 retained items covered. Not speed or quality.",
 proof:{contract:residence?"work-residence@1":"work-handoffs@1",value:incomplete?null:value,items:[{objectId:id(11),complete:!incomplete}],credited:[],membership:{synthetic:true}}});
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
 const policy=drafts[0]?.value??(selectedPolicy());
 if(policy.id!==args.p_policy||policy.version!==args.p_revision)return {data:null,error:{code:"40001"}};
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
const performanceReviews:any[]=[];
export function reviewPerformanceFixture(args:any){
 const prior=performanceReviews.find(r=>r.id===args.p_request_id);
 if(prior)return {data:{reviewId:prior.id,measurementId:prior.measurement_id,revision:prior.revision,decision:prior.decision,reused:true},error:null};
 const revision=performanceReviews.filter(r=>r.measurement_id===args.p_measurement_id).length;
 if(args.p_expected_revision!==revision)return {data:null,error:{code:"40001"}};
 const r={id:args.p_request_id,tenant_id,measurement_id:args.p_measurement_id,revision:revision+1,decision:args.p_decision,reviewed_by:id(40),reason:args.p_reason,created_at:new Date().toISOString()};
 performanceReviews.push(r);
 return {data:{reviewId:r.id,measurementId:r.measurement_id,revision:r.revision,decision:r.decision,reused:false},error:null};
}

export async function saveDraftFixture(args: any) {
  const scope = `${args.p_definition.subjectKind}:${args.p_definition.groupId ?? "all"}`;
  const previous = drafts.find((d) => d.scope_ref === scope);
  if (args.p_expected_version !== (previous?.value.version ?? 0))
    return { data: null, error: { code: "40001" } };
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
  return {
    provider_connections: new URLSearchParams(location.search).get('slack')==='empty'?[]:[row(25,{provider:'slack',status:'configured',revoked_at:null,team_id:'TFIXTURE',team_name:'Synthetic Slack workspace'})],
    operating_profile_entries: drafts.length ? drafts : new URLSearchParams(location.search).has("performance") ? [{tenant_id,scope_kind:"tenant",scope_ref:"member:all",namespace:"learn_scorecards",value:selectedPolicy()}] : [],
    learn_scorecard_publications: publicationFixtureRows(),
    learn_work_measurement_runs: handoffRuns,
    measurements: (new URLSearchParams(location.search).has("handoffs") || new URLSearchParams(location.search).has("residence")) ? handoffRows : new URLSearchParams(location.search).has("performance") ? [{id:id(31),tenant_id,subject_kind:"member",subject_id:id(6),policy_id:id(30),policy_revision:1,metric_key:"response.within_target",value:80,unit:"percent",window_start:new Date(Date.parse(performanceEnd)-7*86400000).toISOString(),window_end:performanceEnd,measured_at:performanceObserved,source:"communications",source_through:performanceEnd,sample_count:10,covered_count:10,eligible_count:10,review_state:"inferred",evidence:[{table:"interactions",id:id(8)}],exclusions:[],supersedes:null,group_ids:[]}] : [],
    learn_performance_reviews: performanceReviews,
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
    interactions: [
      row(8, {
        related_company_id: id(2),
        related_job_id: id(3),
        source_connector_id: "gmail",
        source_table: "emails",
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
}
export function cardFixture(table: string) {
  if (!Object.hasOwn(records(), table)) return null;
  let data = records()[table];
  const scenario = new URLSearchParams(location.search).get("cards");
  if (scenario === "empty") data = [];
  const simple = (s: string, r: any) => {
    const m = /^(\w+)\.(eq|in)\.(.*)$/.exec(s);
    if (!m) throw Error("Unsupported fixture filter");
    return m[2] === "eq" ? r[m[1]] === m[3] : m[3].slice(1, -1).split(",").includes(r[m[1]]);
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
    select: () => q,
    eq: (key: string, value: unknown) => {
      data = data.filter((r) => r[key] === value);
      return q;
    },
    is: (key: string, value: unknown) => {
      data = data.filter((r) => (r[key] ?? null) === value);
      return q;
    },
    or: (s: string) => {
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
    order: () => q,
    limit: (n: number) => {
      exactCount = data.length;
      data = data.slice(0, n);
      return q;
    },
    range: (a: number, b: number) => {
      data = data.slice(a, b + 1);
      return q;
    },
    then: (resolve: any) =>
      Promise.resolve(
        scenario === "error"
          ? { data: null, error: { message: "Synthetic denied read" } }
          : { data, count: exactCount ?? data.length, error: null },
      ).then(resolve),
  };
  return q;
}
