/**
 * Command Centre — role proof / presentation render (/demo/command-centre).
 *
 * PRESENTATION MODE. Mounts the REAL <CommandCentreConsole> product component (the exact
 * component the authenticated app ships) against clearly-labelled DEMO role fixtures — the
 * same WorkProjection contract the live work-projection Edge Function returns. It needs no
 * login, no anon key, and never touches Supabase, so it is safe to screenshot as a role
 * proof. Actions are disabled (Preview) here — the authenticated app routes them through the
 * real work-transition endpoint. Fixtures are demo data, never live tenant data.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { CommandCentreConsole } from "@/components/app/command-centre/CommandCentreConsole";
import { ROLE_FIXTURES, ROLE_NAMES } from "@/components/app/command-centre/fixtures";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/demo/command-centre")({
  component: DemoCommandCentre,
});

function DemoCommandCentre() {
  const [role, setRole] = useState(ROLE_NAMES[0]);
  const projection = ROLE_FIXTURES[role];
  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Command Centre — role proof (demo fixtures · presentation mode)
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Role proof">
          {ROLE_NAMES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={r === role}
              onClick={() => setRole(r)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                r === role
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-hairline bg-white text-muted-foreground hover:bg-surface-alt",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <CommandCentreConsole
          projection={projection}
          writeCapable={false}
          writeLabel="Preview — demo data"
          extras={{
            objectives:
              role === "Tenant Superadmin / MD" || role === "Senior leader"
                ? [
                    {
                      title: "Grow contracted ARR",
                      metric: "contracted_arr",
                      target: "£700k+ (Mar 2028)",
                      current: null,
                      health: "at_risk",
                      freshness: "Target configured; live actual unavailable",
                      note: "Finance source not connected",
                    },
                    {
                      title: "Protect gross margin",
                      metric: "gross_margin",
                      target: "35% (Y1)",
                      current: null,
                      health: "at_risk",
                      freshness: "Baseline unavailable",
                      note: null,
                    },
                  ]
                : undefined,
            cadence: null,
            health:
              role === "Tenant Superadmin / MD"
                ? [{ label: "Gmail", status: "reconnect", detail: "Reconnect required" }]
                : [],
          }}
        />
      </div>
    </div>
  );
}
