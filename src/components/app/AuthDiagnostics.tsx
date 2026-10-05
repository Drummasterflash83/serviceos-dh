/**
 * AuthDiagnostics — development-only observability for the auth/session/tenant chain.
 * Renders nothing in production (gated on import.meta.env.DEV). Surfaces exactly the facts
 * needed to diagnose "keeps logging out" / tenant-context issues: who's signed in, whether
 * the session is valid, minutes to token expiry, tenant id and role. No data mutation.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

export function AuthDiagnostics() {
  const { user, profile, session, loading, sessionExpiresAt, configured } = useAuth();
  // Re-render each second so the expiry countdown is live.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!import.meta.env.DEV) return null;

  const expiryMin =
    sessionExpiresAt != null ? Math.round((sessionExpiresAt - Date.now()) / 60000) : null;

  return (
    <details className="rounded-xl border border-dashed border-hairline bg-surface-alt/40 px-3 py-2 text-[11px]">
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        Auth diagnostics (dev)
      </summary>
      <div className="mt-2 space-y-0.5">
        <Row label="Configured" value={configured ? "yes" : "no"} />
        <Row label="Loading" value={loading ? "resolving…" : "resolved"} />
        <Row label="User" value={profile?.full_name || user?.email || "—"} />
        <Row label="Session" value={session ? "valid" : "none"} />
        <Row label="Token expiry" value={expiryMin != null ? `${expiryMin} min` : "—"} />
        <Row label="Tenant" value={profile?.tenant_id ?? "—"} />
        <Row label="Role" value={profile?.role ?? "—"} />
      </div>
    </details>
  );
}
