/**
 * Command Centre ownership seam — presentation demo (/demo/ownership).
 *
 * Renders the derived ownership panel across its truthful states with SYNTHETIC data
 * (no login, no Supabase). Demonstrates §4: unresolved / team-role fallback / needs
 * OpenFolk configuration / low-confidence / observed-transfer-changes-handler — never a
 * manufactured named owner. The live Command Centre feeds these panels from the
 * tenant-gated ownership-projection function (raw Control Plane tables never exposed).
 */
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { OwnershipPanel } from "@/components/app/OwnershipPanel";
import type { DerivedOwnership } from "@/lib/ownership-projection";

export const Route = createFileRoute("/demo/ownership")({ component: DemoOwnership });

const CASES: { caption: string; o: DerivedOwnership }[] = [
  {
    caption: "Configured DDI → confirmed accountable owner",
    o: {
      status: "resolved",
      accountable: { kind: "person", label: "Bob Draper" },
      likelyHandler: { kind: "person", label: "Bob Draper" },
      cover: { kind: "person", label: "Carol Vine" },
      escalation: { kind: "team", label: "Duty Manager" },
      explanation: "ddi +44…123 → accountable person Bob (cover configured).",
      confidence: 0.95,
      historicalAssignmentRef: "a1b2c3d4",
      unresolvedReason: null,
      warnings: [],
      needsConfiguration: false,
    },
  },
  {
    caption: "Observed transfer — likely handler changes, accountable does not",
    o: {
      status: "resolved",
      accountable: { kind: "person", label: "Bob Draper" },
      likelyHandler: { kind: "person", label: "Carol Vine" },
      cover: null,
      escalation: null,
      explanation: "ddi +44…123 → accountable person Bob.",
      confidence: 0.9,
      historicalAssignmentRef: "a1b2c3d4",
      unresolvedReason: null,
      warnings: ["handler_from_observed_handoff"],
      needsConfiguration: false,
    },
  },
  {
    caption: "Queue → team/role fallback (no specific accountable person)",
    o: {
      status: "team_role_fallback",
      accountable: null,
      likelyHandler: null,
      cover: null,
      escalation: null,
      explanation: "queue scheduling → team Scheduling (no specific accountable person).",
      confidence: 0.6,
      historicalAssignmentRef: null,
      unresolvedReason: null,
      warnings: ["team_or_role_fallback"],
      needsConfiguration: false,
    },
  },
  {
    caption: "Endpoint mapped but no owner effective at the interaction time",
    o: {
      status: "unresolved",
      accountable: null,
      likelyHandler: null,
      cover: null,
      escalation: null,
      explanation: "extension 210 is mapped but unowned at this time.",
      confidence: 0.3,
      historicalAssignmentRef: null,
      unresolvedReason: "Endpoint is mapped but has no owner effective at the interaction time.",
      warnings: ["no_effective_owner", "low_confidence"],
      needsConfiguration: false,
    },
  },
  {
    caption: "Unknown endpoint — needs OpenFolk configuration (never a guessed name)",
    o: {
      status: "unmapped",
      accountable: null,
      likelyHandler: null,
      cover: null,
      escalation: null,
      explanation: "No configured endpoint matched this interaction — needs OpenFolk mapping.",
      confidence: 0,
      historicalAssignmentRef: null,
      unresolvedReason: "No configured endpoint matched this interaction — needs OpenFolk mapping.",
      warnings: ["needs_configuration"],
      needsConfiguration: true,
    },
  },
];

function DemoOwnership() {
  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" />
          Command Centre ownership seam — derived projection (demo, synthetic)
        </div>
        <p className="mb-4 px-1 text-xs text-muted-foreground">
          The Command Centre consumes only this derived projection. Ownership is shown truthfully —
          unresolved, team/role fallback, or “needs OpenFolk configuration” — and a
          classifier-extracted name is never promoted to a confirmed owner.
        </p>
        <div className="space-y-4">
          {CASES.map((c, i) => (
            <div key={i}>
              <div className="mb-1.5 px-1 text-xs font-medium text-display">{c.caption}</div>
              <OwnershipPanel ownership={c.o} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
