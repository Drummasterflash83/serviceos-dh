/**
 * Communications section — fully data-driven. Tabs are derived from the enabled
 * communications connectors in the Connector Runtime (deduped by their settings
 * surface, so Gmail + Google Workspace share one "Email" tab). Each tab renders
 * that surface's management component — the unchanged EmailOperations /
 * PhoneOperations UIs. Adding a connector (e.g. Slack) adds a tab automatically;
 * no switch statements, no edits here.
 */

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { useModules } from "@/lib/modules/useModules";
import { connectorRuntime } from "@/lib/runtime";
import type { ConnectorSettingsSurface } from "@/lib/runtime/types";
import { PlaceholderPanel } from "./PlaceholderPanel";
import { MessageSquare } from "lucide-react";

export function Communications() {
  const { isEnabled, byCategory } = useModules();

  // Distinct settings surfaces from the enabled communications connectors.
  const surfaces = useMemo<ConnectorSettingsSurface[]>(() => {
    const seen = new Set<string>();
    const out: ConnectorSettingsSurface[] = [];
    for (const provider of connectorRuntime.enabledByCategory("communications", isEnabled)) {
      const s = provider.settings();
      if (!seen.has(s.surface)) {
        seen.add(s.surface);
        out.push(s);
      }
    }
    return out;
  }, [isEnabled]);

  const [active, setActive] = useState<string>(surfaces[0]?.surface ?? "");
  const current = surfaces.find((s) => s.surface === active) ?? surfaces[0] ?? null;
  const Current = current?.Component;

  // Planned communications channels (not yet available for this tenant).
  const planned = byCategory("communications").filter((m) => !isEnabled(m.id));

  return (
    <div className="space-y-5">
      {surfaces.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {surfaces.map((s) => (
            <button
              key={s.surface}
              onClick={() => setActive(s.surface)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition",
                (current?.surface ?? "") === s.surface
                  ? "border-foreground bg-foreground text-background"
                  : "border-hairline text-muted-foreground hover:bg-surface-alt hover:text-foreground",
              )}
            >
              {s.icon && <s.icon className="h-3.5 w-3.5" />}
              {s.title}
            </button>
          ))}
        </div>
      )}

      {Current ? (
        <Current />
      ) : (
        <PlaceholderPanel
          icon={MessageSquare}
          title="No communications channels"
          description="No communications connectors are enabled for this tenant."
        />
      )}

      {planned.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            More channels · planned
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {planned.map((m) => (
              <div key={m.id} className="rounded-2xl border border-hairline bg-white p-4">
                <div className="flex items-center justify-between">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-alt">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Planned
                  </span>
                </div>
                <div className="mt-3 text-sm font-semibold">{m.name}</div>
                <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {m.license}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
