/**
 * OpenFolk Control Plane — customer list (/openfolk). PLATFORM-OPERATOR ONLY.
 *
 * Server-gated: the openfolk-control-plane function requires an OpenFolk role + active
 * platform.controlplane grant. A non-operator receives 403 and the access panel below —
 * this route is never surfaced in tenant navigation and relies on the server gate, not
 * frontend hiding.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck, ChevronRight } from "lucide-react";
import { RequireAuth } from "@/lib/auth";
import { listTenants, type TenantSummary } from "@/lib/openfolk";

export const Route = createFileRoute("/openfolk")({
  component: () => (
    <RequireAuth>
      <OpenfolkList />
    </RequireAuth>
  ),
});

function OpenfolkList() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listTenants();
    if (res.ok) {
      setTenants(res.data.tenants);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" />
          OpenFolk Control Plane — managed-service administration
        </div>

        {loading && <p className="px-1 text-sm text-muted-foreground">Loading…</p>}

        {!loading && error && (
          <div className="rounded-xl border border-hairline bg-white p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-display">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              {error.code === "forbidden" || error.code.startsWith("http_403")
                ? "Platform authority required"
                : "Could not load"}
            </div>
            <p className="text-xs text-muted-foreground">
              The Control Plane is restricted to authorised OpenFolk operators (an OpenFolk role
              plus an active platform.controlplane grant). Access is enforced server-side.
            </p>
          </div>
        )}

        {!loading && !error && tenants && (
          <div className="space-y-2">
            {tenants.map((t) => (
              <Link
                key={t.tenant_id}
                to="/openfolk/$tenantId"
                params={{ tenantId: t.tenant_id }}
                className="flex items-center justify-between rounded-xl border border-hairline bg-white p-4 hover:border-accent/40"
              >
                <div>
                  <div className="text-sm font-semibold text-display">
                    {t.display_name ?? t.slug ?? t.tenant_id.slice(0, 8)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.people} people · {t.endpoints_total} endpoints · {t.endpoints_unmapped}{" "}
                    unmapped
                    {t.ambiguous_assignments > 0 && (
                      <span className="text-amber-600"> · {t.ambiguous_assignments} conflicts</span>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
            {tenants.length === 0 && (
              <p className="px-1 text-xs italic text-muted-foreground">No tenants.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
