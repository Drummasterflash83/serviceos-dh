/**
 * Command Centre — derived ownership display (truthful).
 *
 * Renders a DerivedOwnership from the tenant projection. §4 truthfulness: shows
 * Unresolved / Team-role fallback / Needs OpenFolk configuration / Low-confidence /
 * Historical-mapping-unavailable rather than manufacturing a named owner; an observed
 * transfer changes the LIKELY HANDLER without rewriting accountable ownership.
 */
import { AlertTriangle, CheckCircle2, HelpCircle, UserCog, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DerivedOwnership } from "@/lib/ownership-projection";

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  resolved: { label: "Owner confirmed", cls: "text-success", icon: CheckCircle2 },
  team_role_fallback: { label: "Team / role fallback", cls: "text-amber-600", icon: Users },
  unresolved: { label: "Unresolved ownership", cls: "text-orange-600", icon: HelpCircle },
  unmapped: {
    label: "Needs OpenFolk configuration",
    cls: "text-muted-foreground",
    icon: AlertTriangle,
  },
};
const WARNING_LABEL: Record<string, string> = {
  needs_configuration: "Needs OpenFolk configuration",
  low_confidence: "Low-confidence attribution",
  shared_endpoint: "Shared endpoint",
  team_or_role_fallback: "Team/role fallback",
  no_effective_owner: "No owner effective at this time",
  handler_from_observed_handoff: "Handler from an observed transfer",
  ambiguous_endpoint_match: "Ambiguous endpoint match",
};

export function OwnershipPanel({
  ownership,
  title = "Ownership & flow",
}: {
  ownership: DerivedOwnership;
  title?: string;
}) {
  const meta = STATUS_META[ownership.status] ?? STATUS_META.unmapped;
  const Icon = meta.icon;
  const pct = Math.round(ownership.confidence * 100);
  return (
    <div className="rounded-xl border border-hairline bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className={cn("h-4 w-4", meta.cls)} />
        <span className={cn("text-sm font-semibold", meta.cls)}>{meta.label}</span>
        {ownership.status !== "unmapped" && (
          <span className="ml-auto text-[11px] tabular text-muted-foreground">
            confidence {pct}%
          </span>
        )}
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        {ownership.needsConfiguration
          ? (ownership.unresolvedReason ?? "This endpoint is not yet mapped.")
          : ownership.explanation}
      </p>

      {ownership.status !== "unmapped" && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Field
            label="Accountable"
            value={ownership.accountable?.label}
            kind={ownership.accountable?.kind}
          />
          <Field
            label="Likely handler"
            value={ownership.likelyHandler?.label}
            kind={ownership.likelyHandler?.kind}
          />
          <Field label="Cover" value={ownership.cover?.label} kind={ownership.cover?.kind} />
          <Field
            label="Escalation"
            value={ownership.escalation?.label}
            kind={ownership.escalation?.kind}
          />
        </dl>
      )}

      {ownership.warnings.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ownership.warnings.map((w) => (
            <span
              key={w}
              className="rounded-md border border-hairline bg-surface-alt px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {WARNING_LABEL[w] ?? w}
            </span>
          ))}
        </div>
      )}
      {ownership.historicalAssignmentRef && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Historical assignment {ownership.historicalAssignmentRef.slice(0, 8)} · resolved at the
          interaction time.
        </p>
      )}
    </div>
  );
}

function Field({ label, value, kind }: { label: string; value?: string | null; kind?: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 font-medium text-display">
        {kind === "team" ? (
          <Users className="h-3 w-3 text-muted-foreground" />
        ) : kind === "person" ? (
          <UserCog className="h-3 w-3 text-muted-foreground" />
        ) : null}
        {value ?? "—"}
      </dd>
    </div>
  );
}
