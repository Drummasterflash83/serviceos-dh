/**
 * Operator preview of the ServiceOS experience generated for a canonical team member.
 *
 * NOT "logging in as" the person: an authenticated operator inspects the projection generated for
 * a `team_member` (keyed by tenant_id + team_member_id, no profile_id required). It reuses the REAL
 * <CommandCentreConsole> product surface in an explicit READ-ONLY capability — writeCapable={false}
 * AND no onTransition handler, so no mutation, communication, or external side effect can fire.
 * A persistent banner makes attribution impossible to miss; nothing is attributed to the actor.
 */
import { Eye, ChevronLeft, ShieldAlert } from "lucide-react";
import { OperationalDay } from "./OperationalDay";
import { buildTeamMemberPreview, type PreviewCoverage } from "@/lib/preview-projection";
import { buildOperationalDay, type DayEvidence } from "@/lib/operational-day";
import type { CpMember, Workspace } from "@/lib/openfolk";

const COVERAGE_TONE: Record<PreviewCoverage["status"], string> = {
  confirmed: "border-success/30 bg-success/10 text-success",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  not_connected: "border-hairline bg-surface-alt text-muted-foreground",
};

function PreviewBanner({
  actor,
  coverage,
  onExit,
}: {
  actor: CpMember;
  coverage: PreviewCoverage[];
  onExit: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 mb-4 rounded-xl border border-accent/40 bg-accent/10 p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
          <Eye className="h-3.5 w-3.5" /> Operator preview
        </span>
        <span className="text-sm text-display">
          Previewing the ServiceOS experience generated for <strong>{actor.display_name}</strong>.
          Read-only — <em>not</em> attributed to {actor.display_name.split(" ")[0]}.
        </span>
        <button
          type="button"
          onClick={onExit}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-hairline bg-white px-2.5 py-1 text-xs font-medium text-display hover:border-accent/50"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Exit preview · back to hub
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] text-muted-foreground">
          team_member · {actor.id.slice(0, 8)}…
        </span>
        {coverage.map((c) => (
          <span
            key={c.source}
            title={c.detail}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${COVERAGE_TONE[c.status]}`}
          >
            {c.source}: {c.status === "not_connected" ? "not connected" : c.status}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TeamMemberPreview({
  actor,
  workspace,
  onExit,
}: {
  actor: CpMember;
  workspace: Workspace;
  onExit: () => void;
}) {
  const result = buildTeamMemberPreview(
    { tenantId: workspace.summary.tenant_id, teamMemberId: actor.id },
    {
      members: workspace.members ?? [],
      identities: workspace.identities ?? [],
      ownership: workspace.ownership ?? [],
    },
    new Date().toISOString(),
  );

  if (!result.ok || !result.projection) {
    return (
      <div className="space-y-3">
        <PreviewBanner actor={actor} coverage={result.coverage} onExit={onExit} />
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-white p-4 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-destructive" />
          {result.error ?? "Cannot generate a preview for this actor."}
        </div>
      </div>
    );
  }

  // Mary's First Day — derive the operational day from CONFIRMED evidence in the workspace only:
  // verified identity links + confirmed ownership. Comms/Health-derived areas have no confirmed
  // evidence yet, so they surface as honest gaps (never fabricated). Display-only ⇒ read-only.
  const endpoints = workspace.endpoints ?? [];
  const epLabel = (id: string) => {
    const e = endpoints.find((x) => x.id === id);
    return e?.display_value ?? e?.normalized_value ?? id.slice(0, 8);
  };
  const dayEvidence: DayEvidence = {
    member: { id: actor.id, display_name: actor.display_name, formal_role: actor.formal_role },
    confirmedIdentities: (workspace.identities ?? [])
      .filter((i) => i.team_member_id === actor.id && i.verification_state === "verified")
      .map((i) => ({ provider: i.provider, external_ref: i.external_ref })),
    ownership: (workspace.ownership ?? [])
      .filter((o) => o.owner_member_id === actor.id)
      .map((o) => ({
        id: o.id,
        assignment_role: o.assignment_role,
        endpoint_label: epLabel(o.endpoint_id),
        endpoint_id: o.endpoint_id,
        review_state: o.review_state,
      })),
  };
  const day = buildOperationalDay(dayEvidence, new Date().toISOString());

  return (
    <div>
      <PreviewBanner actor={actor} coverage={result.coverage} onExit={onExit} />
      {/* The generated operational day (seven focus areas). Display-only — no action can fire. */}
      <OperationalDay day={day} />
    </div>
  );
}
