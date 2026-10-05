/**
 * OpenFolk Control Plane workspace — presentation demo (/demo/openfolk).
 *
 * Renders the REAL OpenfolkWorkspace against clearly-synthetic fixtures (no login, no
 * Supabase). The live workspace at /openfolk/$tenantId is gated by platform authority
 * (OpenFolk role + active platform.controlplane grant) and is never in tenant navigation.
 *
 * The demo is write-capable against IN-MEMORY state (no backend calls): it exercises the
 * exact ownership-confirmation flow — durable `?section=`/`?endpoint=` URL state, in-place
 * refresh (never a section reset), inline success, and auto-advance to the next missing
 * role — so the behaviour is verifiable without the gated live workspace.
 */
import { useCallback, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { OpenfolkWorkspace } from "@/components/app/OpenfolkWorkspace";
import { OpenfolkShell } from "@/components/app/OpenfolkShell";
import type { DelegatedActions } from "@/components/app/OpenfolkConnections";
import {
  resolveSection,
  sectionSearchValue,
  type WorkspaceSection,
} from "@/lib/openfolk-workspace-nav";
import type {
  AuditEntry,
  CpOwnership,
  DelegatedTask,
  SourceReadiness,
  Workspace,
} from "@/lib/openfolk";

type DemoSearch = { section?: WorkspaceSection; endpoint?: string };

export const Route = createFileRoute("/demo/openfolk")({
  validateSearch: (search: Record<string, unknown>): DemoSearch => ({
    section: sectionSearchValue(search.section),
    endpoint: typeof search.endpoint === "string" && search.endpoint ? search.endpoint : undefined,
  }),
  component: DemoOpenfolk,
});

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
      source: "discovery",
      updated_at: "2026-07-23T00:00:00Z",
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
      source: "discovery",
      updated_at: "2026-07-23T00:00:00Z",
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
      source: "discovery",
      updated_at: "2026-07-23T00:00:00Z",
    },
    {
      id: "ep-slack-carol",
      channel: "slack",
      endpoint_kind: "slack_user",
      normalized_value: "U0CAROL",
      display_value: "carol",
      provider: "slack",
      is_shared: false,
      status: "active",
      source: "discovery",
      updated_at: "2026-07-23T00:00:00Z",
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
      effective_to: null,
      confidence: 0.95,
      review_state: "confirmed",
    },
  ],
  dataQuality: [
    { kind: "unmapped_endpoint", detail: "extension 210 has no accountable owner", ref: EP_EXT },
    { kind: "unmapped_endpoint", detail: "queue scheduling has no accountable owner", ref: EP_Q },
    { kind: "unverified_identity", detail: "slack U0BOB unverified", ref: "i2" },
  ],
  // Synthetic connections payload shaped like the real Drummonds tenant, so the generic
  // Connections projection renders end-to-end without the gated live workspace.
  connections: {
    google_workspace: {
      status: "connected",
      connections: [{ domain: "drummondheating.co.uk", status: "connected" }],
      approved_domains: ["drummondheating.co.uk"],
      imported: 32,
      excluded: 8,
      excluded_domains: { "allkin.co": 8 },
      read_only: true,
    },
    telephony: {
      commercial_provider: "Birchills",
      underlying_provider: "sipcentric",
      account_ref: "3950",
      status: "manual",
      credentials: "configured (never displayed)",
      capabilities: {
        ddi_discovery: "planned",
        extension_discovery: "manual",
        device_discovery: "manual",
        endpoint_discovery: "supported",
        call_direction: "supported",
        recording_access: "supported",
        queue_metadata: "planned",
        provisioning: "unavailable",
      },
      external_write: "disabled",
      evidence_count: 10,
    },
    slack: { status: "not_connected", note: "Identity model ready — ingestion not connected" },
  },
  // Email identity suggestion (review-only) — exercises the Person Intelligence Hub email source.
  identityResolution: {
    classifications: [],
    suggestions: [
      {
        endpoint_id: "ep-email-carol",
        endpoint_email: "carol@demo.example",
        provider_mailbox_type: "user",
        operational_class: "unknown",
        suggested_member_id: "m3",
        suggested_kind: "person",
        confidence: "high",
        evidence: 'verified Workspace display name "Carol Vine" exactly matches this member',
        provenance: "workspace-display-name-exact",
        ambiguity: [],
      },
    ],
    reviews: [],
  },
  // Slack identity candidates — discovered read-only from the user directory (never messages).
  slackIdentityResolution: {
    workspace: { team_id: "T012DEMO", team_name: "Demo Heating HQ" },
    candidates: [
      {
        endpoint_id: "ep-slack-carol",
        slack_user_id: "U0CAROL",
        suggested_member_id: "m3",
        suggested_kind: "person",
        confidence: "high",
        evidence: "Slack email matches this member's confirmed mailbox exactly",
        provenance: "slack-verified-email",
        matched_by: "verified_email",
        ambiguity: [],
        deactivated: false,
        classification: "person",
        display_name: "carol",
        real_name: "Carol Vine",
        email: "carol@demo.example",
        title: "Engineer",
        tz: "Europe/London",
        is_guest: false,
      },
    ],
  },
  // Telephony extension candidates (provider-neutral; labels = evidence, never identity).
  telephonyIdentityResolution: {
    candidates: [
      {
        endpoint_id: EP_EXT,
        endpoint_extension: "210",
        display_value: "Carol - Service",
        suggested_member_id: "m3",
        suggested_kind: "person",
        confidence: "high",
        evidence: "provider extension label consistently names this member",
        provenance: "telephony-extension-label",
        ambiguity: [],
        named_members: ["m3"],
        unknown_label_names: [],
        observed_labels: ["Carol - Service"],
        call_count: 47,
        last_activity: "2026-07-21T10:15:00Z",
      },
    ],
  },
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

let demoSeq = 1000;

function DemoOpenfolk() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const section = resolveSection(search.section);

  // In-memory workspace state — synthetic mutations mirror what the live route does after a
  // successful server write, so the demo proves the same in-place-refresh behaviour.
  const [workspace, setWorkspace] = useState<Workspace>(WORKSPACE);
  const [audit, setAudit] = useState<AuditEntry[]>(AUDIT);
  const [busy, setBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const setSection = useCallback(
    (s: WorkspaceSection) =>
      navigate({
        search: (prev) => ({
          ...prev,
          section: sectionSearchValue(s),
          endpoint: s === "ownership" ? prev.endpoint : undefined,
        }),
      }),
    [navigate],
  );
  const setEndpoint = useCallback(
    (endpointId: string | null) =>
      navigate({
        search: (prev) => ({ ...prev, endpoint: endpointId ?? undefined }),
        replace: true,
      }),
    [navigate],
  );

  // Simulate the network round-trip + in-place refresh (no unmount, no section reset).
  const withRefresh = useCallback(async (mutate: () => void): Promise<boolean> => {
    setBusy(true);
    await new Promise((r) => setTimeout(r, 150));
    mutate();
    setLastRefresh(new Date().toISOString());
    setBusy(false);
    return true;
  }, []);

  const onAssign = useCallback(
    (endpointId: string, memberId: string, role: string, reason: string) =>
      withRefresh(() => {
        const row: CpOwnership = {
          id: `demo-own-${demoSeq++}`,
          endpoint_id: endpointId,
          owner_kind: "person",
          owner_member_id: memberId,
          owner_org_unit_id: null,
          owner_role: null,
          assignment_role: role,
          effective_from: new Date().toISOString(),
          effective_to: null,
          confidence: 0.95,
          review_state: "confirmed",
        };
        setWorkspace((w) => {
          // Idempotent per (endpoint, role): never create a duplicate active assignment.
          const exists = w.ownership.some(
            (o) =>
              o.endpoint_id === endpointId &&
              o.assignment_role === role &&
              o.review_state !== "rejected",
          );
          if (exists) return w;
          return { ...w, ownership: [...w.ownership, row] };
        });
        setAudit((a) => [
          {
            actor: "demo-operator",
            action: "controlplane.ownership.assign",
            resource_type: "endpoint_ownership_assignment",
            resource_id: endpointId,
            reason,
            view_as_active: false,
            created_at: new Date().toISOString(),
          },
          ...a,
        ]);
      }),
    [withRefresh],
  );

  // Identity confirm/reject in-memory — mirrors the live cp_review_identity: a confirmed_person
  // creates a verified identity link; the candidate is then cleared from the review queue.
  const onReviewIdentity = useCallback(
    (input: {
      endpoint_id: string;
      decision: string;
      team_member_id?: string | null;
      confidence?: string;
      reason: string;
    }) =>
      void withRefresh(() => {
        setWorkspace((w) => {
          const ep = w.endpoints.find((e) => e.id === input.endpoint_id);
          const identities = [...w.identities];
          if (input.decision === "confirmed_person" && input.team_member_id) {
            const provider = ep
              ? ep.channel === "phone"
                ? (ep.provider ?? "voip")
                : ep.channel === "slack"
                  ? "slack"
                  : "google_workspace"
              : "google_workspace";
            identities.push({
              id: `demo-id-${demoSeq++}`,
              team_member_id: input.team_member_id,
              provider,
              identity_kind: "user",
              external_ref: ep?.normalized_value ?? input.endpoint_id,
              display: null,
              verification_state: "verified",
            });
          }
          const reviews = [
            {
              endpoint_id: input.endpoint_id,
              decision: input.decision,
              team_member_id: input.team_member_id ?? null,
              created_at: new Date().toISOString(),
            },
            ...(w.identityResolution?.reviews ?? []),
          ];
          return {
            ...w,
            identities,
            identityResolution: {
              classifications: w.identityResolution?.classifications ?? [],
              suggestions: (w.identityResolution?.suggestions ?? []).filter(
                (s) => s.endpoint_id !== input.endpoint_id,
              ),
              reviews,
            },
            telephonyIdentityResolution: {
              candidates: (w.telephonyIdentityResolution?.candidates ?? []).filter(
                (c) => c.endpoint_id !== input.endpoint_id,
              ),
            },
            slackIdentityResolution: w.slackIdentityResolution
              ? {
                  workspace: w.slackIdentityResolution.workspace,
                  candidates: w.slackIdentityResolution.candidates.filter(
                    (c) => c.endpoint_id !== input.endpoint_id,
                  ),
                }
              : undefined,
          };
        });
        setAudit((a) => [
          {
            actor: "demo-operator",
            action: "controlplane.identity.review",
            resource_type: "communication_endpoint",
            resource_id: input.endpoint_id,
            reason: input.reason,
            view_as_active: false,
            created_at: new Date().toISOString(),
          },
          ...a,
        ]);
      }),
    [withRefresh],
  );

  // Synthetic in-memory delegated setup requests (demo only — the live route calls the
  // gated Control Plane). Mirrors the security model: tokens are never stored; a one-time
  // link is returned at issue.
  const [demoTasks, setDemoTasks] = useState<DelegatedTask[]>([]);
  const delegatedActions: DelegatedActions = {
    list: async () => demoTasks,
    issue: async (input) => {
      const id = `demo-task-${demoSeq++}`;
      const last4 = Math.random().toString(36).slice(-4);
      const task: DelegatedTask = {
        id,
        tenant_id: "demo",
        provider: null,
        connection_id: null,
        task_type: input.task_type,
        requested_action: input.requested_action,
        recipient_email: input.recipient_email.toLowerCase(),
        recipient_name: input.recipient_name ?? null,
        status: "created",
        token_last4: last4,
        single_use: true,
        max_uses: 1,
        use_count: 0,
        expires_at: new Date(Date.now() + (input.ttl_seconds ?? 604800) * 1000).toISOString(),
        opened_at: null,
        submitted_at: null,
        completed_at: null,
        revoked_at: null,
        created_by: null,
        correlation_id: id,
        created_at: new Date().toISOString(),
        submission_present: false,
      };
      setDemoTasks((t) => [task, ...t]);
      return {
        task_id: id,
        task_type: input.task_type,
        recipient_email: task.recipient_email,
        token_last4: last4,
        setup_url: `${input.origin ?? ""}/setup/demo-${Math.random().toString(36).slice(2, 10)}`,
        warning: "This setup link is shown once and cannot be recovered. Copy it now.",
      };
    },
    revoke: async (taskId) => {
      setDemoTasks((t) =>
        t.map((x) =>
          x.id === taskId ? { ...x, status: "revoked", revoked_at: new Date().toISOString() } : x,
        ),
      );
      return true;
    },
    getSubmission: async () => null,
  };

  return (
    <OpenfolkShell
      tenantName="Demo Heating"
      section={section}
      onSectionChange={setSection}
      readiness={READINESS}
      operatorLabel="demo-operator"
    >
      <div className="mb-4 flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-accent" />
        Demo fixtures · in-memory · OpenFolk-operated
      </div>
      <OpenfolkWorkspace
        tenantName="Demo Heating"
        workspace={workspace}
        readiness={READINESS}
        audit={audit}
        writeCapable={true}
        busy={busy}
        lastRefresh={lastRefresh}
        section={section}
        onSectionChange={setSection}
        selectedEndpoint={search.endpoint ?? null}
        onSelectEndpoint={setEndpoint}
        actions={{ onAssign, onReviewIdentity }}
        delegatedActions={delegatedActions}
      />
    </OpenfolkShell>
  );
}
