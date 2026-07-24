/**
 * OpenFolk Control Plane workspace — presentation demo (/demo/openfolk).
 *
 * Renders the REAL OpenfolkWorkspace against clearly-synthetic fixtures (no login, no
 * Supabase). The live workspace at /openfolk/$tenantId is gated by platform authority
 * (OpenFolk role + active platform.controlplane grant) and is never in tenant navigation.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { OpenfolkWorkspace } from "@/components/app/OpenfolkWorkspace";
import type { AuditEntry, SourceReadiness, Workspace } from "@/lib/openfolk";

export const Route = createFileRoute("/demo/openfolk")({ component: DemoOpenfolk });

const M_ALICE = "11111111-0000-0000-0000-0000000000a1";
const M_BOB = "11111111-0000-0000-0000-0000000000a2";
const EP_DDI = "22222222-0000-0000-0000-0000000000e1";
const EP_EXT = "22222222-0000-0000-0000-0000000000e2";
const EP_Q = "22222222-0000-0000-0000-0000000000e3";

const WORKSPACE: Workspace = {
  summary: {
    tenant_id: "demo",
    slug: "demo",
    display_name: "Demo Heating",
    people: 3,
    endpoints_total: 3,
    endpoints_unmapped: 2,
    identities_unverified: 1,
    ambiguous_assignments: 0,
  },
  members: [
    {
      id: M_ALICE,
      display_name: "Alice Nunez",
      formal_role: "Office Manager",
      org_unit_id: null,
      effective_to: null,
    },
    {
      id: M_BOB,
      display_name: "Bob Draper",
      formal_role: "Coordinator",
      org_unit_id: null,
      effective_to: null,
    },
    {
      id: "m3",
      display_name: "Carol Vine",
      formal_role: "Engineer",
      org_unit_id: null,
      effective_to: null,
    },
  ],
  identities: [
    {
      id: "i1",
      team_member_id: M_ALICE,
      provider: "google_workspace",
      identity_kind: "user",
      external_ref: "alice@demo.example",
      display: "Alice",
      verification_state: "verified",
    },
    {
      id: "i2",
      team_member_id: M_BOB,
      provider: "slack",
      identity_kind: "user",
      external_ref: "U0BOB",
      display: "bob",
      verification_state: "unverified",
    },
  ],
  endpoints: [
    {
      id: EP_DDI,
      channel: "phone",
      endpoint_kind: "ddi",
      normalized_value: "+441111888999",
      display_value: "Main line",
      provider: "simwood",
      is_shared: false,
      status: "active",
    },
    {
      id: EP_EXT,
      channel: "phone",
      endpoint_kind: "extension",
      normalized_value: "210",
      display_value: "Ext 210",
      provider: "simwood",
      is_shared: false,
      status: "active",
    },
    {
      id: EP_Q,
      channel: "phone",
      endpoint_kind: "queue",
      normalized_value: "scheduling",
      display_value: "Scheduling queue",
      provider: "simwood",
      is_shared: true,
      status: "active",
    },
  ],
  ownership: [
    {
      id: "o1",
      endpoint_id: EP_DDI,
      owner_kind: "person",
      owner_member_id: M_BOB,
      owner_org_unit_id: null,
      owner_role: null,
      assignment_role: "accountable",
      effective_from: "2026-07-23T00:00:00Z",
      confidence: 0.95,
      review_state: "confirmed",
    },
  ],
  dataQuality: [
    { kind: "unmapped_endpoint", detail: "extension 210 has no accountable owner", ref: EP_EXT },
    { kind: "unmapped_endpoint", detail: "queue scheduling has no accountable owner", ref: EP_Q },
    { kind: "unverified_identity", detail: "slack U0BOB unverified", ref: "i2" },
  ],
};
const READINESS: SourceReadiness = {
  channel: "phone",
  level: "ready_for_evaluation",
  summary: "Ready for evaluation — enough mapping to label real calls; not yet ready for shadow.",
  checks: [
    { key: "ddis_discovered", ok: true, detail: "1 DDI(s) discovered" },
    { key: "extensions_discovered", ok: true, detail: "1 extension(s) discovered" },
    { key: "queues_discovered", ok: true, detail: "1 queue/ring-group(s) discovered" },
    { key: "ddis_mapped", ok: true, detail: "1/1 DDIs have accountable ownership" },
    { key: "accountable_ownership", ok: true, detail: "1 endpoint(s) with accountable owner" },
    { key: "primary_handling", ok: false, detail: "0 endpoint(s) with a primary handler" },
    { key: "no_conflicts", ok: true, detail: "no conflicting assignments" },
    { key: "confidence_sufficient", ok: true, detail: "ownership confidence sufficient" },
    { key: "health_policy_state", ok: true, detail: "Customer Health policy: draft" },
    { key: "source_allowlist_state", ok: true, detail: "source allowlist: disabled" },
  ],
};
const AUDIT: AuditEntry[] = [
  {
    actor: "operator@openfolk.example",
    action: "controlplane.ownership.assign",
    resource_type: "endpoint_ownership_assignment",
    resource_id: "o1",
    reason: "map main line to Bob",
    view_as_active: false,
    created_at: "2026-07-23T09:12:00Z",
  },
  {
    actor: "operator@openfolk.example",
    action: "controlplane.endpoint.upsert",
    resource_type: "communication_endpoint",
    resource_id: EP_DDI,
    reason: "telephony discovery refresh",
    view_as_active: false,
    created_at: "2026-07-23T09:05:00Z",
  },
];

function DemoOpenfolk() {
  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" />
          OpenFolk Control Plane — Demo Heating workspace (demo fixtures · OpenFolk-operated)
        </div>
        <OpenfolkWorkspace
          tenantName="Demo Heating"
          workspace={WORKSPACE}
          readiness={READINESS}
          audit={AUDIT}
          writeCapable={false}
          actions={{}}
        />
      </div>
    </div>
  );
}
