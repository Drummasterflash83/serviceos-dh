/**
 * ModuleSection — renders every module in a category as a uniform card, driven
 * by the module registry. Used by Business Systems, Documents, Calendar, AI and
 * Automations so adding a future module needs only a registry entry, no UI.
 *
 * `available` modules render as connected/live; `planned` modules render as
 * placeholders with their licence tier. Nothing is hardcoded per vendor.
 */

import type { LucideIcon } from "lucide-react";

import { useModules } from "@/lib/modules/useModules";
import type { ModuleCategory } from "@/lib/modules/types";

export function ModuleSection({
  icon: Icon,
  category,
  title,
  description,
}: {
  icon: LucideIcon;
  category: ModuleCategory;
  title: string;
  description: string;
}) {
  const { byCategory, isEnabled } = useModules();
  const modules = byCategory(category);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-display text-lg font-semibold">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const enabled = isEnabled(m.id);
          return (
            <div key={m.id} className="rounded-2xl border border-hairline bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-alt">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </span>
                <span
                  className={
                    enabled
                      ? "inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-success"
                      : "rounded-full border border-hairline bg-surface-alt px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  }
                >
                  {enabled ? "Enabled" : "Planned"}
                </span>
              </div>
              <div className="mt-3 text-sm font-semibold">{m.name}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                {m.license}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
