/**
 * Customer Health — shadow surface presentation render (/demo/customer-health).
 *
 * PRESENTATION MODE. Mounts the REAL <CustomerHealthShadowConsole> component (the exact
 * component the authenticated Tenant-Superadmin surface ships) against clearly-labelled
 * DEMO fixtures — the same ShadowSurface contract the customer-health-shadow Edge
 * Function returns. It needs no login, no anon key, and never touches Supabase, so it is
 * safe to screenshot. Actions are disabled (Preview) here; the authenticated surface
 * routes them through the real, superadmin-gated review endpoint. Fixtures are synthetic
 * demo data, never live tenant data or PII.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";

import { CustomerHealthShadowConsole } from "@/components/app/CustomerHealthShadow";
import type { ShadowSurface } from "@/lib/health-shadow";

export const Route = createFileRoute("/demo/customer-health")({
  component: DemoCustomerHealth,
});

const TERMINOLOGY: Record<string, string> = {
  healthy: "No callback owed",
  watch: "Callback owed (in time)",
  at_risk: "Callback overdue",
  critical: "Callback overdue — repeated contact",
  recovering: "Callback made (verifying)",
};

// Synthetic demo surface (no PII). Mirrors loadShadowSurface output.
const DEMO_SURFACE: ShadowSurface = {
  objects: [
    {
      id: "obj-1",
      subject_type: "company",
      subject_id: "c0000001-0000-0000-0000-000000000001",
      active_policy_version_id: "pv-1",
      accountable_ref: { responsibility: "team:scheduling" },
      updated_at: "2026-07-22T11:40:00Z",
      latestAssessment: {
        id: "as-1b",
        state: "at_risk",
        trend: "worsening",
        drivers: [
          { code: "explicit_callback_open", detail: "An explicit callback obligation is open." },
          { code: "callback_overdue", detail: "Callback is overdue." },
        ],
        risks: ["Callback is overdue."],
        opportunities: [],
        confidence: 0.82,
        freshness: "fresh",
        evidence: [
          { source: "phone_call", detail: "…please [number] call me back about the quote…" },
        ],
        changed: { state: { from: "watch", to: "at_risk" } },
        evaluated_at: "2026-07-22T11:40:00Z",
        supersedes_id: "as-1a",
      },
      assessmentHistory: [
        {
          id: "as-1b",
          state: "at_risk",
          trend: "worsening",
          drivers: [],
          risks: [],
          opportunities: [],
          confidence: 0.82,
          freshness: "fresh",
          evidence: [],
          changed: {},
          evaluated_at: "2026-07-22T11:40:00Z",
          supersedes_id: "as-1a",
        },
        {
          id: "as-1a",
          state: "watch",
          trend: "unknown",
          drivers: [],
          risks: [],
          opportunities: [],
          confidence: 0.9,
          freshness: "fresh",
          evidence: [],
          changed: {},
          evaluated_at: "2026-07-22T09:05:00Z",
          supersedes_id: null,
        },
      ],
      proposals: [
        {
          id: "prop-1",
          commitment_type: "callback",
          proposed_title: "Call the customer back",
          proposed_outcome: "The customer receives the return call they asked for.",
          proposed_done_when: "The customer has been called back and the request addressed.",
          proposed_due_at: "2026-07-22T13:00:00Z",
          proposed_accountable_ref: {
            responsibility: "team:scheduling",
            source: "queue",
            label: "Scheduling queue",
            explanation: "Call entered the Scheduling queue.",
          },
          state: "proposed",
          confidence: 0.92,
          ambiguity: 0.1,
          group_key: "callback:company:c000…:quote",
          resolution_state: "none",
          created_at: "2026-07-22T09:05:00Z",
          updated_at: "2026-07-22T11:40:00Z",
          sources: [
            {
              id: "s1",
              source_kind: "interaction",
              source_ref: "int-a1",
              role: "candidate_evidence",
              excerpt: "…please [number] call me back about the quote…",
              confidence: 0.92,
              observed_at: "2026-07-22T09:00:00Z",
            },
            {
              id: "s2",
              source_kind: "interaction",
              source_ref: "int-a2",
              role: "candidate_evidence",
              excerpt: "…chasing a callback on my quote…",
              confidence: 0.9,
              observed_at: "2026-07-22T11:30:00Z",
            },
          ],
          decisions: [],
        },
      ],
    },
    {
      id: "obj-2",
      subject_type: "person",
      subject_id: "p0000002-0000-0000-0000-000000000002",
      active_policy_version_id: "pv-1",
      accountable_ref: { responsibility: "member:synthia" },
      updated_at: "2026-07-22T10:20:00Z",
      latestAssessment: {
        id: "as-2",
        state: "watch",
        trend: "stable",
        drivers: [
          { code: "explicit_callback_open", detail: "An explicit callback obligation is open." },
          { code: "callback_due_soon", detail: "Callback is open and within the due window." },
        ],
        risks: [],
        opportunities: [],
        confidence: 0.9,
        freshness: "fresh",
        evidence: [{ source: "phone_call", detail: "…asked for Synthia to call back…" }],
        changed: {},
        evaluated_at: "2026-07-22T10:20:00Z",
        supersedes_id: null,
      },
      assessmentHistory: [
        {
          id: "as-2",
          state: "watch",
          trend: "stable",
          drivers: [],
          risks: [],
          opportunities: [],
          confidence: 0.9,
          freshness: "fresh",
          evidence: [],
          changed: {},
          evaluated_at: "2026-07-22T10:20:00Z",
          supersedes_id: null,
        },
      ],
      proposals: [
        {
          id: "prop-2",
          commitment_type: "callback",
          proposed_title: "Call the customer back (asked for Synthia).",
          proposed_outcome: "Call the customer back (asked for Synthia).",
          proposed_done_when: "The customer has been called back and the request addressed.",
          proposed_due_at: "2026-07-22T14:20:00Z",
          proposed_accountable_ref: {
            responsibility: "member:synthia",
            source: "named_recipient",
            label: "Synthia",
            explanation: "Caller requested Synthia.",
          },
          state: "proposed",
          confidence: 0.92,
          ambiguity: 0.15,
          group_key: "callback:person:p000…:general",
          resolution_state: "possible",
          created_at: "2026-07-22T10:20:00Z",
          updated_at: "2026-07-22T10:20:00Z",
          sources: [
            {
              id: "s3",
              source_kind: "interaction",
              source_ref: "int-b1",
              role: "candidate_evidence",
              excerpt: "…asked for Synthia to call back…",
              confidence: 0.92,
              observed_at: "2026-07-22T10:15:00Z",
            },
            {
              id: "s4",
              source_kind: "resolution_interaction",
              source_ref: "int-b2",
              role: "resolution_possible",
              excerpt: "outbound call to same number",
              confidence: 0.6,
              observed_at: "2026-07-22T12:05:00Z",
            },
          ],
          decisions: [
            {
              id: "d1",
              decision: "confirm",
              actor: "superadmin@demo",
              from_state: "proposed",
              to_state: "confirmed",
              reason: null,
              created_at: "2026-07-22T10:25:00Z",
              supersedes_id: null,
            },
          ],
        },
      ],
    },
    {
      id: "obj-3",
      subject_type: "company",
      subject_id: "c0000003-0000-0000-0000-000000000003",
      active_policy_version_id: "pv-1",
      accountable_ref: null,
      updated_at: "2026-07-22T08:10:00Z",
      latestAssessment: {
        id: "as-3",
        state: "recovering",
        trend: "improving",
        drivers: [
          { code: "resolution_evidence_verified", detail: "A verified callback was observed." },
        ],
        risks: [],
        opportunities: ["Confirm the customer is satisfied and close the loop."],
        confidence: 0.9,
        freshness: "fresh",
        evidence: [{ source: "review", detail: "Verified in shadow by Tenant Superadmin." }],
        changed: { resolution: { to: "verified" } },
        evaluated_at: "2026-07-22T08:10:00Z",
        supersedes_id: null,
      },
      assessmentHistory: [
        {
          id: "as-3",
          state: "recovering",
          trend: "improving",
          drivers: [],
          risks: [],
          opportunities: [],
          confidence: 0.9,
          freshness: "fresh",
          evidence: [],
          changed: {},
          evaluated_at: "2026-07-22T08:10:00Z",
          supersedes_id: null,
        },
      ],
      proposals: [
        {
          id: "prop-3",
          commitment_type: "callback",
          proposed_title: "Call the customer back",
          proposed_outcome: "The customer receives the return call they asked for.",
          proposed_done_when: "The customer has been called back and the request addressed.",
          proposed_due_at: "2026-07-22T09:00:00Z",
          proposed_accountable_ref: {
            responsibility: "role:coordinator",
            source: "fallback_role",
            label: "Coordinator (fallback)",
            explanation: "No specific owner resolved — routed to the Coordinator role.",
          },
          state: "resolved_shadow",
          confidence: 0.9,
          ambiguity: 0.1,
          group_key: "callback:company:c000…:service",
          resolution_state: "verified",
          created_at: "2026-07-22T07:30:00Z",
          updated_at: "2026-07-22T08:10:00Z",
          sources: [
            {
              id: "s5",
              source_kind: "interaction",
              source_ref: "int-c1",
              role: "candidate_evidence",
              excerpt: "…call me back about the boiler…",
              confidence: 0.92,
              observed_at: "2026-07-22T07:25:00Z",
            },
            {
              id: "s6",
              source_kind: "resolution_interaction",
              source_ref: "int-c2",
              role: "resolution_verifying",
              excerpt: "spoke to customer, resolved",
              confidence: 0.9,
              observed_at: "2026-07-22T08:00:00Z",
            },
          ],
          decisions: [
            {
              id: "d2",
              decision: "confirm_resolution",
              actor: "superadmin@demo",
              from_state: "confirmed",
              to_state: "resolved_shadow",
              reason: "Confirmed callback made",
              created_at: "2026-07-22T08:10:00Z",
              supersedes_id: null,
            },
          ],
        },
      ],
    },
  ],
};

function DemoCustomerHealth() {
  // Preview toggle only: the authenticated surface is gated by the tenant.superadmin
  // grant (server-side + RLS). In this fixtures demo the review handler is a no-op.
  const [showActions, setShowActions] = useState(false);
  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" />
            Customer Health — Tenant-Superadmin shadow (demo fixtures · presentation mode)
          </div>
          <button
            onClick={() => setShowActions((v) => !v)}
            className="rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-display"
          >
            {showActions ? "Hide review actions" : "Preview review actions"}
          </button>
        </div>
        <CustomerHealthShadowConsole
          surface={DEMO_SURFACE}
          terminology={TERMINOLOGY}
          writeCapable={showActions}
          onReview={() => {}}
        />
      </div>
    </div>
  );
}
