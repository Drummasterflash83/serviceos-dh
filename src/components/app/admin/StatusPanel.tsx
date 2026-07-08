/**
 * StatusPanel — the shared "latest result" panel used by the Email and Phone
 * operations dashboards. Extracted verbatim from the former AdminView so both
 * connectors render run results identically.
 */

import { CheckCircle2, Loader2, PlayCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import type { ApiResult } from "@/lib/types";

export type StatusRow = { label: string; value: string };

export function StatusPanel<T>({
  running,
  result,
  renderOk,
  renderExtra,
}: {
  running: boolean;
  result: ApiResult<T> | null;
  renderOk: (data: T) => StatusRow[];
  renderExtra?: (data: T) => ReactNode;
}) {
  let tone: "idle" | "running" | "ok" | "error" = "idle";
  if (running) tone = "running";
  else if (result) tone = result.ok ? "ok" : "error";

  const badge =
    tone === "ok"
      ? {
          cls: "bg-success/10 text-success border-success/20",
          label: "Success",
          Icon: CheckCircle2,
        }
      : tone === "error"
        ? {
            cls: "bg-destructive/10 text-destructive border-destructive/20",
            label: "Failed",
            Icon: XCircle,
          }
        : tone === "running"
          ? { cls: "bg-accent/10 text-accent border-accent/20", label: "Running", Icon: Loader2 }
          : {
              cls: "bg-surface-alt text-muted-foreground border-hairline",
              label: "Not run",
              Icon: PlayCircle,
            };

  const rows: StatusRow[] = result && result.ok ? renderOk(result.data) : [];

  return (
    <div className="mt-3 rounded-xl border border-hairline bg-surface-alt/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Latest result
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
        >
          <badge.Icon className={`h-3 w-3 ${tone === "running" ? "animate-spin" : ""}`} />
          {badge.label}
        </span>
      </div>

      {tone === "idle" && (
        <p className="mt-2 text-xs text-muted-foreground">No run yet. Use the button above.</p>
      )}

      {result && result.ok && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {r.label}
              </dt>
              <dd className="truncate font-mono text-xs text-foreground">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {result && result.ok && renderExtra && <div className="mt-2">{renderExtra(result.data)}</div>}

      {result && !result.ok && (
        <div className="mt-2 space-y-1">
          <div className="font-mono text-xs text-destructive">{result.error.code}</div>
          <div className="text-xs text-muted-foreground">{result.error.message}</div>
        </div>
      )}
    </div>
  );
}

/** Shared role gate for the operations dashboards (owner/admin/ops). */
export const ADMIN_ROLES = ["owner", "admin", "ops"] as const;

export function RestrictedNotice({ role }: { role: string | null }) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-8 text-center">
      <div className="text-display text-lg font-semibold">Restricted</div>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This console is available to owner, admin and ops roles only.
        {role ? ` Your role is "${role}".` : " Your account has no role assigned."}
      </p>
    </div>
  );
}
