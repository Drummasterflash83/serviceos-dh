/**
 * ConnectorHealthPanel — a right-hand drawer showing one connector's real
 * diagnostics. It renders whatever `DiagnosticGroup[]` the connector's provider
 * derived from the live snapshot; it holds NO vendor knowledge, so every
 * connector (now and future) gets a Health panel for free.
 */

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConnectorStatusBadge, ConnectorHealthBadge } from "./StatusBadges";
import { toBadge } from "@/lib/runtime/ConnectorHealth";
import type { RuntimeConnector, DiagnosticTone } from "@/lib/runtime/types";

const TONE: Record<DiagnosticTone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
  muted: "text-muted-foreground",
};

export function ConnectorHealthPanel({
  connector,
  open,
  onOpenChange,
}: {
  connector: RuntimeConnector | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const badge = connector ? toBadge(connector.status) : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {connector && badge && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2 text-base">
                {connector.descriptor.name}
                <span className="text-xs font-normal text-muted-foreground">Health</span>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-3 flex items-center gap-2">
              <ConnectorStatusBadge status={badge.status} />
              <ConnectorHealthBadge health={badge.health} />
            </div>

            {connector.health.reasons.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {connector.health.reasons.map((r) => (
                  <li
                    key={r}
                    className="rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-xs text-warning"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 space-y-5">
              {connector.diagnostics.map((group) => (
                <div key={group.title}>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group.title}
                  </div>
                  <dl className="mt-2 divide-y divide-hairline rounded-xl border border-hairline">
                    {group.rows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-start justify-between gap-3 px-3 py-2"
                      >
                        <dt className="text-xs text-muted-foreground">{row.label}</dt>
                        <dd
                          className={`min-w-0 break-words text-right text-xs font-medium ${
                            TONE[row.tone ?? "default"]
                          }`}
                        >
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
