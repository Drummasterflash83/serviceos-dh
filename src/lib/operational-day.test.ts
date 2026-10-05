// Run: node --test src/lib/operational-day.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOperationalDay, type DayEvidence } from "./operational-day.ts";

const NOW = "2026-07-24T09:00:00Z";
const MEMBER = { id: "mary", display_name: "Mary Paganga", formal_role: "Office" };

function evidence(over: Partial<DayEvidence> = {}): DayEvidence {
  return { member: MEMBER, confirmedIdentities: [], ownership: [], ...over };
}

test("honest gaps: with only identity + no evidence, comms/health areas are explicit gaps (not zeros)", () => {
  const day = buildOperationalDay(
    evidence({ confirmedIdentities: [{ provider: "google_workspace", external_ref: "mary@x" }] }),
    NOW,
  );
  assert.deepEqual(day.needsMeNow, []);
  assert.deepEqual(day.customerHealth, []);
  const areas = day.gaps.map((g) => g.area);
  assert.ok(areas.some((a) => /Commitments/.test(a)));
  assert.ok(areas.includes("Customer Health"));
  assert.ok(areas.includes("Job Health"));
  assert.equal(day.usesConfirmedEvidenceOnly, true);
});

test("Ownership Health derives NOW from confirmed ownership (real config evidence)", () => {
  const day = buildOperationalDay(
    evidence({
      ownership: [
        {
          id: "o1",
          assignment_role: "accountable",
          endpoint_label: "Main line",
          endpoint_id: "e1",
          review_state: "confirmed",
        },
      ],
    }),
    NOW,
  );
  assert.ok(day.ownershipHealth.some((s) => s.kind === "held" && /accountable/.test(s.detail)));
});

test("no confirmed ownership → no_accountable signal + a suggested intervention", () => {
  const day = buildOperationalDay(evidence(), NOW);
  assert.ok(day.ownershipHealth.some((s) => s.kind === "no_accountable"));
  assert.ok(day.interventions.some((i) => /accountable/.test(i.title)));
});

test("unconfirmed ownership is surfaced but never counted as confirmed", () => {
  const day = buildOperationalDay(
    evidence({
      ownership: [
        {
          id: "o1",
          assignment_role: "accountable",
          endpoint_label: "E1",
          endpoint_id: "e1",
          review_state: "confirmed",
        },
        {
          id: "o2",
          assignment_role: "cover",
          endpoint_label: "E2",
          endpoint_id: "e2",
          review_state: "proposed",
        },
      ],
    }),
    NOW,
  );
  assert.ok(day.ownershipHealth.some((s) => s.kind === "unconfirmed"));
  // the proposed cover role must NOT appear as a held role
  assert.ok(!day.ownershipHealth.some((s) => s.kind === "held" && /cover/.test(s.detail)));
});

test("a populated real day: confirmed commitments/waiting/health drive the seven areas", () => {
  const day = buildOperationalDay(
    evidence({
      confirmedIdentities: [
        { provider: "google_workspace", external_ref: "mary@x" },
        { provider: "voip", external_ref: "103" },
      ],
      ownership: [
        {
          id: "o1",
          assignment_role: "accountable",
          endpoint_label: "Clients line",
          endpoint_id: "e1",
          review_state: "confirmed",
        },
      ],
      commitments: [
        {
          id: "c1",
          title: "Call back about boiler",
          dueAt: NOW,
          state: "overdue",
          customerRef: "Customer ••••",
          jobRef: "JOB ••••",
          confidence: "high",
          provenance: "confirmed-callback",
        },
        {
          id: "c2",
          title: "Send quote",
          dueAt: NOW,
          state: "due_soon",
          confidence: "medium",
          provenance: "confirmed-email",
        },
      ],
      waiting: {
        onMe: [
          {
            id: "w1",
            title: "Approve variation",
            counterparty: "Rudi",
            sinceAt: NOW,
            confidence: "high",
            provenance: "confirmed-slack",
          },
        ],
        iAwait: [
          {
            id: "w2",
            title: "Parts ETA",
            counterparty: "Supplier",
            sinceAt: NOW,
            confidence: "medium",
            provenance: "confirmed-email",
          },
        ],
      },
      customerHealth: [
        {
          id: "h1",
          subject: "Customer ••••",
          subjectKind: "customer",
          state: "at_risk",
          driver: "repeated contact",
          evidence: "3 inbound this week",
          owner: "Mary",
          intervention: "prioritise callback",
          confidence: "high",
          provenance: "published-health",
        },
      ],
      jobHealth: [
        {
          id: "j1",
          subject: "JOB ••••",
          subjectKind: "job",
          state: "watch",
          driver: "on hold — awaiting parts",
          evidence: "held 4 days",
          owner: "Mary",
          intervention: "chase parts",
          confidence: "medium",
          provenance: "published-health",
        },
      ],
    }),
    NOW,
  );
  assert.equal(day.needsMeNow.length, 2, "two due/overdue commitments");
  assert.equal(day.waitingOnMe.length, 1);
  assert.equal(day.iAmWaitingOn.length, 1);
  assert.equal(day.customerHealth.length, 1);
  assert.equal(day.jobHealth.length, 1);
  assert.ok(day.ownershipHealth.some((s) => s.kind === "held"));
  // interventions from both Health findings surface
  assert.ok(day.interventions.some((i) => /callback/.test(i.title)));
  assert.ok(day.interventions.some((i) => /parts/.test(i.title)));
  // populated areas produce no gap for those areas
  assert.ok(!day.gaps.some((g) => g.area === "Customer Health"));
  assert.deepEqual(day.confirmedSources.sort(), ["email", "telephony"]);
});

test("open/resolved commitments do not appear in Needs me now (only due_soon/overdue)", () => {
  const day = buildOperationalDay(
    evidence({
      commitments: [
        {
          id: "c1",
          title: "Later thing",
          dueAt: null,
          state: "open",
          confidence: "high",
          provenance: "x",
        },
        {
          id: "c2",
          title: "Done thing",
          dueAt: null,
          state: "resolved",
          confidence: "high",
          provenance: "x",
        },
      ],
    }),
    NOW,
  );
  assert.deepEqual(day.needsMeNow, []);
});
