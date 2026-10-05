/**
 * SystemHealth — the executive "can I trust my AI today?" strip at the top of the Command
 * Centre. Human, not technical: each sensor (Calls, Email, Intelligence, Automation, plus
 * the session/tenant context derived client-side) shows a light, when it last succeeded and
 * a live count. Reads the unified system_health_checks rollup via getSystemHealth(); auth +
 * tenant health come from the live session. Reuses the house UI system + ApiResult.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Phone,
  Mail,
  Brain,
  Bot,
  Building2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { getSystemHealth, type HealthLight, type SystemHealthView } from "@/lib/system-health";
import type { ApiResult } from "@/lib/types";

const LIGHT: Record<HealthLight, { dot: string; label: string; text: string }> = {
  healthy: { dot: "bg-success", label: "Healthy", text: "text-success" },
  attention: { dot: "bg-warning", label: "Attention", text: "text-warning" },
  failed: { dot: "bg-destructive", label: "Failed", text: "text-destructive" },
  unknown: { dot: "bg-muted-foreground/40", label: "No signal", text: "text-muted-foreground" },
};

const ICON: Record<string, typeof Phone> = {
  phone_ingestion: Phone,
  email_sync: Mail,
  email_gmail: Mail,
  intelligence_processing: Brain,
  automation_execution: Bot,
  auth: ShieldCheck,
  tenant_context: Building2,
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (Number.isNaN(s)) return "—";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

interface Tile {
  key: string;
  label: string;
  light: HealthLight;
  lastLine: string;
  metricLine: string | null;
}

export function SystemHealth() {
  const { session, profile, configured } = useAuth();
  const [feed, setFeed] = useState<ApiResult<SystemHealthView> | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFeed(await getSystemHealth());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000); // refresh each minute
    return () => clearInterval(t);
  }, [load]);

  const tiles = useMemo<Tile[]>(() => {
    // Session + tenant health, derived live from the auth session (not a background job).
    const expiresAt = session?.expires_at ? session.expires_at * 1000 : null;
    const authLight: HealthLight = !configured
      ? "unknown"
      : !session
        ? "failed"
        : expiresAt && expiresAt - Date.now() < 60_000
          ? "attention"
          : "healthy";
    const tenantLight: HealthLight = !session
      ? "unknown"
      : profile?.tenant_id
        ? "healthy"
        : "attention";

    const sessionTiles: Tile[] = [
      {
        key: "auth",
        label: "Session",
        light: authLight,
        lastLine: session
          ? expiresAt
            ? `Renews in ${Math.max(0, Math.round((expiresAt - Date.now()) / 60000))} min`
            : "Signed in"
          : "Signed out",
        metricLine: null,
      },
      {
        key: "tenant_context",
        label: "Workspace",
        light: tenantLight,
        lastLine: profile?.tenant_id ? "Context loaded" : session ? "Resolving…" : "—",
        metricLine: profile?.role ? `Role: ${profile.role}` : null,
      },
    ];

    const data = feed && feed.ok ? feed.data : null;
    const pipelineTiles: Tile[] = (data?.components ?? []).map((c) => ({
      key: c.component,
      label: c.label,
      light: c.light,
      lastLine:
        c.light === "unknown" && !c.lastSuccessAt
          ? "No signal yet"
          : `Last: ${ago(c.lastSuccessAt)}`,
      metricLine: c.count != null && c.countLabel ? `${c.count} ${c.countLabel}` : null,
    }));

    return [...sessionTiles, ...pipelineTiles];
  }, [feed, session, profile, configured]);

  const unavailable = feed && !feed.ok ? feed.error : null;
  const overall: HealthLight = feed && feed.ok ? feed.data.overall : "unknown";

  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          ServiceOS Health
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <span className={cn("h-1.5 w-1.5 rounded-full", LIGHT[overall].dot)} />
          <span className={LIGHT[overall].text}>
            {overall === "healthy"
              ? "All sensors healthy"
              : overall === "failed"
                ? "Sensor failure"
                : overall === "attention"
                  ? "Needs attention"
                  : "Awaiting signal"}
          </span>
        </div>
      </div>

      {unavailable ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          Health signals unavailable — {unavailable.code}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {tiles.map((t) => {
            const Icon = ICON[t.key] ?? ShieldCheck;
            const l = LIGHT[t.light];
            return (
              <div key={t.key} className="rounded-xl border border-hairline bg-surface-alt p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    {t.label}
                  </span>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", l.dot)} title={l.label} />
                </div>
                <div className={cn("mt-2 text-[11px] font-medium", l.text)}>{l.label}</div>
                <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                  {t.lastLine}
                </div>
                {t.metricLine && (
                  <div className="mt-1 text-[10px] leading-tight text-muted-foreground">
                    {t.metricLine}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
