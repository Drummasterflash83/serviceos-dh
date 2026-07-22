/**
 * Command Centre role FIXTURES — presentation/proof only.
 *
 * These are DEMO WorkProjection objects for the /demo/command-centre proof route and
 * frontend tests. They are NOT live tenant data and must never be imported by the
 * authenticated container (which calls the real work-projection Edge Function). They mirror
 * the exact server contract so what you see in the proof is what the live surface renders.
 * Drummond-flavoured (Deployment 001) but every value is illustrative, with honest
 * unmeasured/null states preserved.
 */
import type { WorkItem, WorkProjection, RankExplanation } from "@/lib/command-work";

function expl(o: Partial<RankExplanation>): RankExplanation {
  return {
    whyHere: o.whyHere ?? "in your active work",
    whyYours: o.whyYours ?? "within your area",
    whyAboveNext: o.whyAboveNext ?? null,
    objective: o.objective ?? null,
    kpi: o.kpi ?? null,
    consequenceOfDelay: o.consequenceOfDelay ?? null,
    recommends: o.recommends ?? null,
    aiCanHandle: o.aiCanHandle ?? null,
    humanJudgement: o.humanJudgement ?? null,
    proofOfDone: o.proofOfDone ?? null,
    missingOrStale: o.missingOrStale ?? [],
    factors: o.factors ?? [{ factor: "ownership", contribution: 30 }],
  };
}
function item(o: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    outcome: null,
    state: "ready",
    accountableOwner: null,
    operationalOwner: null,
    assignee: null,
    team: null,
    role: null,
    objectiveId: null,
    objectiveTitle: null,
    kpi: null,
    objectiveHealth: null,
    priority: null,
    urgency: null,
    dueAt: null,
    waitingOn: null,
    blocker: null,
    recommendedAction: null,
    consequenceOfDelay: null,
    doneWhen: null,
    completionEvidenceRequired: false,
    evidence: [],
    evidenceAgeHours: 2,
    confidence: null,
    customerRef: null,
    jobRef: null,
    siteRef: null,
    relatedRecommendationIds: [],
    possibleDuplicateOf: [],
    agentActivity: [],
    score: 0,
    explanation: expl({}),
    capabilityStatus: "LIVE",
    unresolved: [],
    ...o,
  };
}
const AT = "2026-07-22T08:30:00Z";
function proj(
  o: Partial<WorkProjection> & { user: WorkProjection["user"]; doNext: WorkItem[] },
): WorkProjection {
  const all = o.all ?? o.doNext;
  return {
    generatedAt: AT,
    weightsVersion: "cc-rank-2026-07-22.1",
    position: o.position ?? {
      urgent: 0,
      dueToday: 0,
      waitingOnYou: 0,
      handledAutomatically: 0,
      automationActive: 0,
      blocked: 0,
      objectivesAtRisk: 0,
    },
    user: o.user,
    oversight: o.oversight ?? null,
    doNext: o.doNext,
    all,
    consolidation: o.consolidation ?? {
      recommendationsFoldedAsEvidence: 0,
      standaloneRecommendations: 0,
      routedToReview: 0,
    },
  };
}

// ── shared illustrative items ────────────────────────────────────────────────
const safety = item({
  id: "w-rams",
  title: "RAMS missing before Kingsway plant-room works",
  state: "blocked",
  objectiveTitle: "Zero safety incidents",
  objectiveHealth: "at_risk",
  blocker: "No RAMS on file",
  accountableOwner: "rob@drummonds",
  confidence: 0.9,
  doneWhen: "Approved RAMS uploaded and countersigned",
  consequenceOfDelay: "H&S exposure; work cannot lawfully start",
  explanation: expl({
    whyHere: "safety/compliance gate",
    whyYours: "you are accountable",
    consequenceOfDelay: "H&S exposure; work cannot start",
    humanJudgement: "confirm RAMS adequacy",
    factors: [
      { factor: "safety/compliance floor", contribution: 1000 },
      { factor: "blocked", contribution: 14 },
    ],
  }),
});

export const ROLE_FIXTURES: Record<string, WorkProjection> = {
  "Tenant Superadmin / MD": proj({
    user: {
      userRef: "chris@allkin.co",
      memberId: "m-chris",
      role: "owner",
      formalRole: "Tenant Superadmin (MD)",
      isLeadership: true,
      authority: [
        "tenant.superadmin",
        "work.approve",
        "work.assign",
        "objective.publish",
        "ownership.confirm",
      ],
    },
    oversight: {
      period: "all_time",
      inputs: { total: 3690, phone: 1210, email: 2480, other: 0 },
      identity: {
        peopleIdentified: 1049,
        companiesIdentified: 461,
        unresolvedIdentity: 612,
        jobsMatched: 0,
        sitesMatched: 0,
      },
      interpretation: { observations: 939, recommendations: 3088, recommendationsOpen: 2530 },
      work: { meaningfulActions: 3, totalActionObjects: 518, handledAutomatically: 8, outcomes: 6 },
      automation: { activeRuns: 0, awaitingApproval: 237, executions: 18 },
      exceptions: {
        fallbackNonActionable: {
          count: 513,
          policy: "Propose a controlled internal note (vertical)",
          policyState: "disabled",
          note: "now-disabled observe policy; evidence preserved",
        },
        awaitingIdentityResolution: 612,
      },
    },
    position: {
      urgent: 3,
      dueToday: 4,
      waitingOnYou: 2,
      handledAutomatically: 5,
      automationActive: 2,
      blocked: 1,
      objectivesAtRisk: 2,
    },
    consolidation: {
      recommendationsFoldedAsEvidence: 9,
      standaloneRecommendations: 2,
      routedToReview: 1,
    },
    doNext: [
      safety,
      item({
        id: "w-arr",
        title: "Approve New Dawn ARR target amendment (£700k+)",
        objectiveTitle: "Grow contracted ARR",
        objectiveHealth: "at_risk",
        accountableOwner: "chris@allkin.co",
        unresolved: ["review_required"],
        doneWhen: "Amendment confirmed active & published",
        recommendedAction: "Confirm £700k supersedes £1.8m",
        explanation: expl({
          whyHere: "objective at risk, needs your authority",
          whyYours: "publishing is your authority",
          whyAboveNext: "objective governance outranks routine ops",
          humanJudgement: "confirm the superseding target",
          factors: [
            { factor: "objective at risk", contribution: 22 },
            { factor: "authority to act", contribution: 4 },
          ],
        }),
      }),
      item({
        id: "w-fw",
        title: "Further Works SLA breach — 3 quotes >48h",
        objectiveTitle: "Protect Further Works margin",
        objectiveHealth: "at_risk",
        operationalOwner: "larne@drummonds",
        kpi: "fw_quote_turnaround",
        dueAt: "2026-07-22T16:00:00Z",
        explanation: expl({
          whyHere: "KPI at risk + due today",
          whyYours: "within your leadership remit",
          consequenceOfDelay: "conversion & margin slip",
          factors: [{ factor: "due soon", contribution: 14 }],
        }),
      }),
    ],
  }),
  "Senior leader": proj({
    user: {
      userRef: "heidi@drummonds",
      memberId: "m-heidi",
      role: "admin",
      formalRole: "Managing Director",
      isLeadership: true,
      authority: ["work.approve", "work.assign", "ownership.confirm"],
    },
    position: {
      urgent: 2,
      dueToday: 3,
      waitingOnYou: 1,
      handledAutomatically: 4,
      automationActive: 1,
      blocked: 0,
      objectivesAtRisk: 1,
    },
    consolidation: {
      recommendationsFoldedAsEvidence: 6,
      standaloneRecommendations: 1,
      routedToReview: 0,
    },
    doNext: [
      item({
        id: "w-cap",
        title: "Engineer capacity shortfall next week",
        objectiveTitle: "Increase capacity without proportional overhead",
        objectiveHealth: "at_risk",
        accountableOwner: "heidi@drummonds",
        explanation: expl({
          whyHere: "objective at risk",
          whyYours: "you own this objective",
          factors: [
            { factor: "owns linked objective", contribution: 18 },
            { factor: "objective at risk", contribution: 22 },
          ],
        }),
      }),
      item({
        id: "w-appr",
        title: "Approve specialist-client rate override",
        state: "in_progress",
        accountableOwner: "heidi@drummonds",
        doneWhen: "Override approved with authority basis recorded",
        explanation: expl({
          whyHere: "awaiting your approval",
          whyYours: "you are accountable",
          factors: [{ factor: "authority to act", contribution: 4 }],
        }),
      }),
    ],
  }),
  Operations: proj({
    user: {
      userRef: "rudi@drummonds",
      memberId: "m-rudi",
      role: "ops",
      formalRole: "Operations Coordinator",
      isLeadership: false,
      authority: ["work.assign"],
    },
    position: {
      urgent: 2,
      dueToday: 3,
      waitingOnYou: 1,
      handledAutomatically: 2,
      automationActive: 1,
      blocked: 1,
      objectivesAtRisk: 1,
    },
    consolidation: {
      recommendationsFoldedAsEvidence: 5,
      standaloneRecommendations: 1,
      routedToReview: 1,
    },
    doNext: [
      safety,
      item({
        id: "w-jobsheet",
        title: "3 job sheets unprocessed >24h",
        operationalOwner: "rudi@drummonds",
        objectiveTitle: "Operational excellence",
        kpi: "commusoft_compliance",
        dueAt: "2026-07-22T17:00:00Z",
        agentActivity: [{ intentId: "i-1", status: "queued", outcome: null }],
        explanation: expl({
          whyHere: "assigned to you, due today",
          whyYours: "assigned to you",
          aiCanHandle: "automation is engaged",
          factors: [
            { factor: "direct owner", contribution: 30 },
            { factor: "due soon", contribution: 14 },
          ],
        }),
        evidence: [
          {
            kind: "recommendation",
            ref: "r1",
            detail: "Call: engineer flagged incomplete sheet",
            source: "phone",
            ageHours: 3,
            confidence: 0.8,
          },
        ],
      }),
      item({
        id: "w-parts",
        title: "Parts blocker: boiler flue kit on backorder",
        state: "blocked",
        operationalOwner: "rudi@drummonds",
        blocker: "Supplier backorder ETA 5d",
        waitingOn: "Tony (procurement)",
        explanation: expl({
          whyHere: "blocked work you own",
          whyYours: "assigned to you",
          factors: [{ factor: "blocked", contribution: 14 }],
        }),
      }),
    ],
  }),
  "Scheduling / office": proj({
    user: {
      userRef: "julie@drummonds",
      memberId: "m-julie",
      role: "ops",
      formalRole: "Scheduling Coordinator",
      isLeadership: false,
      authority: [],
    },
    position: {
      urgent: 1,
      dueToday: 4,
      waitingOnYou: 2,
      handledAutomatically: 3,
      automationActive: 0,
      blocked: 0,
      objectivesAtRisk: 0,
    },
    consolidation: {
      recommendationsFoldedAsEvidence: 7,
      standaloneRecommendations: 2,
      routedToReview: 0,
    },
    doNext: [
      item({
        id: "w-intake",
        title: "New enquiry — Mrs Okafor, no-heat callout",
        operationalOwner: "julie@drummonds",
        dueAt: "2026-07-22T11:00:00Z",
        customerRef: "cust-okafor",
        doneWhen: "Visit booked & customer confirmed",
        recommendedAction: "Book emergency slot today",
        explanation: expl({
          whyHere: "urgent customer intake, due today",
          whyYours: "assigned to you",
          factors: [
            { factor: "direct owner", contribution: 30 },
            { factor: "due soon", contribution: 14 },
          ],
        }),
        evidence: [
          {
            kind: "recommendation",
            ref: "r2",
            detail: "Call transcript: no heat, elderly",
            source: "phone",
            ageHours: 1,
            confidence: 0.9,
          },
          {
            kind: "recommendation",
            ref: "r3",
            detail: "Email: availability tomorrow AM",
            source: "email",
            ageHours: 1,
            confidence: 0.7,
          },
        ],
      }),
      item({
        id: "w-accepted",
        title: "Accepted quote — schedule follow-up (Harden Ltd)",
        state: "waiting",
        operationalOwner: "julie@drummonds",
        waitingOn: "customer (site access)",
        explanation: expl({
          whyHere: "waiting on customer",
          whyYours: "assigned to you",
          factors: [{ factor: "waiting", contribution: 8 }],
        }),
      }),
    ],
  }),
  Finance: proj({
    user: {
      userRef: "elaine@drummonds",
      memberId: "m-elaine",
      role: "ops",
      formalRole: "Finance & Operations Coordinator",
      isLeadership: false,
      authority: ["work.approve"],
    },
    position: {
      urgent: 1,
      dueToday: 2,
      waitingOnYou: 3,
      handledAutomatically: 1,
      automationActive: 0,
      blocked: 0,
      objectivesAtRisk: 1,
    },
    consolidation: {
      recommendationsFoldedAsEvidence: 4,
      standaloneRecommendations: 1,
      routedToReview: 0,
    },
    doNext: [
      item({
        id: "w-gp",
        title: "GP exception on invoice INV-4821 (margin 21%)",
        operationalOwner: "elaine@drummonds",
        objectiveTitle: "Protect gross margin",
        objectiveHealth: "at_risk",
        kpi: "gross_margin",
        doneWhen: "Margin corrected or exception approved",
        explanation: expl({
          whyHere: "margin below floor",
          whyYours: "assigned to you",
          consequenceOfDelay: "margin leakage compounds",
          humanJudgement: "approve exception or correct",
          factors: [
            { factor: "direct owner", contribution: 30 },
            { factor: "objective at risk", contribution: 22 },
          ],
        }),
      }),
      item({
        id: "w-invready",
        title: "5 jobs invoice-ready, evidence gaps on 2",
        operationalOwner: "elaine@drummonds",
        unresolved: ["review_required"],
        explanation: expl({
          whyHere: "invoice-ready work you own",
          whyYours: "assigned to you",
          factors: [{ factor: "direct owner", contribution: 30 }],
        }),
      }),
    ],
  }),
  Engineer: proj({
    user: {
      userRef: "tony@drummonds",
      memberId: "m-tony",
      role: "viewer",
      formalRole: "Field Engineer",
      isLeadership: false,
      authority: [],
    },
    position: {
      urgent: 1,
      dueToday: 3,
      waitingOnYou: 0,
      handledAutomatically: 0,
      automationActive: 0,
      blocked: 1,
      objectivesAtRisk: 0,
    },
    consolidation: {
      recommendationsFoldedAsEvidence: 2,
      standaloneRecommendations: 0,
      routedToReview: 0,
    },
    doNext: [
      safety,
      item({
        id: "w-svc",
        title: "Boiler service — 14 Meadow Rd, 15:00",
        operationalOwner: "tony@drummonds",
        dueAt: "2026-07-22T15:00:00Z",
        siteRef: "site-meadow",
        doneWhen: "Service sheet completed & signed on site",
        explanation: expl({
          whyHere: "your job, due today",
          whyYours: "assigned to you",
          proofOfDone: "signed service sheet",
          factors: [
            { factor: "direct owner", contribution: 30 },
            { factor: "due soon", contribution: 14 },
          ],
        }),
      }),
      item({
        id: "w-fwprompt",
        title: "Further Works prompt — flag corrosion at site 12",
        operationalOwner: "tony@drummonds",
        objectiveTitle: "Capture Further Works",
        recommendedAction: "Photograph & log opportunity",
        explanation: expl({
          whyHere: "FW opportunity on your route",
          whyYours: "assigned to you",
          factors: [{ factor: "direct owner", contribution: 30 }],
        }),
      }),
    ],
  }),
};

export const ROLE_NAMES = Object.keys(ROLE_FIXTURES);
