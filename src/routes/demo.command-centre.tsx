/**
 * Demo render harness — /demo/command-centre
 *
 * PRESENTATION / PROOF MODE. Renders the REAL <CommandCentreView> product component with
 * a REAL Command Centre feed exported from the live remote (the seeded Sarah Mitchell
 * scenario, mapped by the same src/lib/command-feed.ts the authenticated app uses). It
 * needs no login, no anon key, and never touches Supabase — the feed is a static export,
 * so this is safe to screenshot for a demo. Approval here is a local acknowledgement (the
 * authenticated app routes approval through the real endpoint). No UI logic is duplicated:
 * this mounts the exact same component the product ships.
 */

import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

import { CommandCentreView } from "@/components/app/CommandCentre";
import { demoCommandFeed } from "@/lib/demo-command-feed";

export const Route = createFileRoute("/demo/command-centre")({
  component: DemoCommandCentre,
});

function DemoCommandCentre() {
  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground w-fit">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          Command Centre — demo render (real seeded data · presentation mode)
        </div>
        <CommandCentreView data={demoCommandFeed} profileName="Chris Drummond" />
      </div>
    </div>
  );
}
