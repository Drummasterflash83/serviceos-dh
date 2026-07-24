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
import { CommandCentreConsole } from "./command-centre/CommandCentreConsole";
import { buildTeamMemberPreview, type PreviewCoverage } from "@/lib/preview-projection";
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

  return (
    <div>
      <PreviewBanner actor={actor} coverage={result.coverage} onExit={onExit} />
      {result.confirmedSources.length === 0 && (
        <p className="mb-3 rounded-lg border border-dashed border-hairline bg-surface-alt/40 px-3 py-2 text-xs text-muted-foreground">
          No confirmed source contributes yet — confirm this actor&rsquo;s identities in the Person
          Intelligence Hub to generate a populated experience. Empty sections below are honest gaps,
          not fabricated activity.
        </p>
      )}
      {/* REAL product surface, explicitly read-only. No onTransition ⇒ no mutation can fire. */}
      <CommandCentreConsole
        projection={result.projection}
        writeCapable={false}
        writeLabel="Operator preview — read-only"
      />
    </div>
  );
}
