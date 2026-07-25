/**
 * Learning Centre Stage 1 — render proof (/demo/learning-centre).
 *
 * Renders the REAL LearningOverviewView component against a CAPTURED read-only snapshot of the
 * live Drummonds prod projection (aggregate counts + timestamps only; themes masked; no customer
 * records). The numbers below were produced by `scripts/learning-centre-proof.ts` on 2026-07-25 —
 * this route exists only to verify the UI renders the real shape + honest states. The LIVE view
 * queries the `learning.overview` projection dynamically; nothing is hard-coded in the component.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { LearningOverviewView } from "@/components/app/LearningOverviewView";
import type { LearningOverview } from "@/lib/openfolk";

export const Route = createFileRoute("/demo/learning-centre")({
  component: DemoLearningCentre,
});

// Captured real aggregate (Drummonds prod, 2026-07-25, read-only). Masked; render-proof only.
const SNAPSHOT: LearningOverview = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  generatedAt: "2026-07-25T07:44:29Z",
  sourceTruth: {
    summary: {
      sourcesLive: ["Telephony", "Email", "Canonical intelligence pipeline"],
      sourcesMissing: ["Commusoft", "Slack"],
      latestEvidenceAt: "2026-07-25T07:08:50Z",
      processingHealth: "attention",
      identityCoverage: { confirmed: 1, unresolved: 29, pct: 3 },
      majorBlindSpots: [
        "Commusoft not ingested",
        "Slack not connected",
        "Health inactive",
        "waiting relationships not derived",
        "identity mapping coverage very low",
      ],
    },
    sources: [
      {
        key: "telephony",
        label: "Telephony",
        connectionState: "live",
        scheduleState: "active",
        latestEvidenceAt: "2026-07-24T16:17:30Z",
        freshness: "fresh",
        received: 850,
        processed: 575,
        failedOrPending: 275,
        coverage: [
          { label: "recordings", value: "575" },
          { label: "transcripts", value: "575" },
          { label: "AI insights", value: "575" },
        ],
        confirmedIdentities: 0,
        unresolvedIdentities: 0,
        gaps: ["no extension/DDI confirmed to a team member"],
        actionRequired: "confirm telephony identities",
      },
      {
        key: "email",
        label: "Email",
        connectionState: "live",
        scheduleState: "active",
        latestEvidenceAt: "2026-07-25T07:08:50Z",
        freshness: "fresh",
        received: 3812,
        processed: 3824,
        failedOrPending: 0,
        coverage: [
          { label: "mailboxes active", value: "30 (+10 pending)" },
          { label: "attachments", value: "0" },
          { label: "AI insights", value: "0" },
        ],
        confirmedIdentities: 1,
        unresolvedIdentities: 29,
        gaps: ["attachments not captured", "no email classification"],
        actionRequired: "confirm mailbox → member links",
      },
      {
        key: "commusoft",
        label: "Commusoft",
        connectionState: "planned",
        scheduleState: "not_applicable",
        latestEvidenceAt: null,
        freshness: "none",
        received: 0,
        processed: 0,
        failedOrPending: null,
        coverage: [{ label: "seeded profiles", value: "3" }],
        confirmedIdentities: null,
        unresolvedIdentities: null,
        gaps: ["analysed but NOT ingested (importer built, never run)"],
        actionRequired: "approve bounded MVP import",
      },
      {
        key: "slack",
        label: "Slack",
        connectionState: "not_connected",
        scheduleState: "not_applicable",
        latestEvidenceAt: null,
        freshness: "none",
        received: null,
        processed: null,
        failedOrPending: null,
        coverage: [],
        confirmedIdentities: 0,
        unresolvedIdentities: null,
        gaps: ["not connected (Workspace Discovery designed only)"],
        actionRequired: "approve Workspace-Discovery OAuth",
      },
      {
        key: "pipeline",
        label: "Canonical intelligence pipeline",
        connectionState: "live",
        scheduleState: "active",
        latestEvidenceAt: null,
        freshness: "fresh",
        received: 4674,
        processed: 4674,
        failedOrPending: 0,
        coverage: [
          { label: "intelligence objects", value: "3157" },
          { label: "recommendations", value: "4107" },
        ],
        confirmedIdentities: null,
        unresolvedIdentities: null,
        gaps: ["waiting relationships not yet derived", "handoffs not captured"],
        actionRequired: null,
      },
    ],
  },
  existingIntelligence: {
    totals: {
      interactions: 4674,
      intelligenceObjects: 3157,
      observations: 2639,
      actions: 518,
      recommendations: 4107,
    },
    queues: [
      {
        key: "actions_with_deadline",
        label: "Actions with a deadline",
        count: 516,
        drill: { table: "intelligence_objects", filter: "object_type=Action & deadline not null" },
      },
      {
        key: "overdue_actions",
        label: "Overdue actions",
        count: 516,
        drill: { table: "intelligence_objects", filter: "object_type=Action & deadline < now" },
      },
      {
        key: "recs_awaiting_review",
        label: "Recommendations awaiting review",
        count: 0,
        drill: { table: "recommendations", filter: "status=pending" },
      },
      {
        key: "intel_no_owner",
        label: "Intelligence without confirmed ownership",
        count: 518,
        drill: { table: "intelligence_objects", filter: "no accountable_ref" },
      },
      {
        key: "intel_customer",
        label: "Intelligence linked to a customer",
        count: 3126,
        drill: { table: "intelligence_objects", filter: "source_entities → company" },
      },
      {
        key: "intel_low_conf",
        label: "Low-confidence intelligence",
        count: 395,
        drill: { table: "intelligence_objects", filter: "confidence < 0.5" },
      },
      {
        key: "comms_no_intel",
        label: "Communications that produced no intelligence",
        count: 0,
        drill: { table: "interactions", filter: "no intelligence_ingestion" },
      },
    ],
    repeatedThemes: [
      { subject: "Record a controlled internal note", count: 403 },
      { subject: "Inbound phone from an unknown contact", count: 11 },
      { subject: "Inbound email: training reminder", count: 10 },
      { subject: "Inbound email: API access request", count: 9 },
    ],
    waiting: { derived: false, note: "Waiting relationship not yet derived." },
  },
};

function DemoLearningCentre() {
  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Learning Centre — render proof · real read-only Drummonds aggregate (2026-07-25, masked) ·
          the live view queries dynamically
        </div>
        <LearningOverviewView overview={SNAPSHOT} />
      </div>
    </div>
  );
}
