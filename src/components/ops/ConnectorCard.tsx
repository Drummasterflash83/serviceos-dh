/**
 * ConnectorCard — renders any connector identically from its descriptor + state:
 * name, provider, status, health, version, generic metrics, and the shared
 * action toolbar. Gmail, Slack, QuickBooks or Commusoft all use this one card.
 */

import { Plug } from "lucide-react";
import type { ReactNode } from "react";

import { ConnectorHealthBadge, ConnectorStatusBadge } from "./StatusBadges";
import { ActionToolbar } from "./ActionToolbar";
import type { ConnectorAction, ConnectorView } from "@/lib/connectors/types";

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function ConnectorCard({
  connector,
  onAction,
  busy,
  reason,
  footer,
}: {
  connector: ConnectorView;
  onAction?: (action: ConnectorAction) => void;
  busy?: ConnectorAction | null;
  /** Short why-line shown when the connector is warning/error/offline. */
  reason?: string;
  /** Optional extra content (e.g. an expandable settings panel). */
  footer?: ReactNode;
}) {
  const { descriptor, state } = connector;
  const unhealthy =
    state.health === "warning" || state.health === "critical" || state.status === "offline";
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-alt">
            <Plug className="h-4 w-4 text-foreground" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{descriptor.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {descriptor.provider}
              {state.version ? ` · v${state.version}` : ""}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ConnectorStatusBadge status={state.status} />
          <ConnectorHealthBadge health={state.health} />
        </div>
      </div>

      {reason && unhealthy && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
            state.health === "critical" || state.status === "offline"
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : "border-warning/20 bg-warning/10 text-warning"
          }`}
        >
          {reason}
        </div>
      )}

      {state.metrics && state.metrics.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {state.metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {m.label}
              </dt>
              <dd className="text-display truncate text-lg font-semibold tabular">{m.value}</dd>
              {m.hint && <dd className="truncate text-[11px] text-muted-foreground">{m.hint}</dd>}
            </div>
          ))}
        </dl>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
        <span className="text-[11px] text-muted-foreground">
          Last sync · {timeAgo(state.lastSyncAt)}
          {state.errors ? ` · ${state.errors} error${state.errors === 1 ? "" : "s"}` : ""}
        </span>
        <ActionToolbar actions={descriptor.actions} onAction={onAction} busy={busy} />
      </div>

      {footer && <div className="mt-4">{footer}</div>}
    </div>
  );
}
