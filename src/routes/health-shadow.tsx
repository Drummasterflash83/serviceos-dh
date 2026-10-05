/**
 * Customer Health — authenticated Tenant-Superadmin shadow surface (/health-shadow).
 *
 * The REAL surface. Data comes from the customer-health-shadow Edge Function, which
 * enforces the tenant.superadmin grant SERVER-SIDE (and RLS enforces it again at the
 * data layer) — this route relies on that, not on frontend hiding. A non-superadmin
 * gets a 403 and an explanatory panel, never the data.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { RequireAuth } from "@/lib/auth";
import { CustomerHealthShadowConsole } from "@/components/app/CustomerHealthShadow";
import {
  listShadow,
  reviewShadow,
  type ReviewPayload,
  type ShadowSurface,
} from "@/lib/health-shadow";

export const Route = createFileRoute("/health-shadow")({
  component: () => (
    <RequireAuth>
      <HealthShadowPage />
    </RequireAuth>
  ),
});

const TERMINOLOGY: Record<string, string> = {
  healthy: "No callback owed",
  watch: "Callback owed (in time)",
  at_risk: "Callback overdue",
  critical: "Callback overdue — repeated contact",
  recovering: "Callback made (verifying)",
};

function HealthShadowPage() {
  const [surface, setSurface] = useState<ShadowSurface | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listShadow();
    if (res.ok) {
      setSurface(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A FAILED review action never blanks the loaded surface and never pretends the
  // state changed: the current data stays on screen with an inline error; a
  // successful action reloads from the server (the only source of displayed state).
  const onReview = useCallback(
    async (p: ReviewPayload) => {
      const res = await reviewShadow(p);
      if (res.ok) {
        setActionError(null);
        await load();
      } else {
        setActionError(res.error);
      }
    },
    [load],
  );

  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" />
          Customer Health — Tenant-Superadmin shadow
        </div>

        {loading && <p className="px-1 text-sm text-muted-foreground">Loading…</p>}

        {!loading && error && (
          <div className="rounded-xl border border-hairline bg-white p-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-display">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              {error.code === "forbidden" ? "Tenant-Superadmin only" : "Could not load"}
            </div>
            <p className="text-xs text-muted-foreground">
              {error.code === "forbidden"
                ? "The Customer Health shadow surface is restricted to Tenant-Superadmins. Access is enforced server-side and by row-level security."
                : error.message}
            </p>
          </div>
        )}

        {!loading && !error && surface && (
          <>
            {actionError && (
              <div
                role="alert"
                className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-white p-3.5"
              >
                <div className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span>
                    <span className="font-semibold text-display">Review action failed — </span>
                    {actionError.message} The displayed state was not changed.
                  </span>
                </div>
                <button
                  onClick={() => setActionError(null)}
                  className="rounded-md border border-hairline px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-display"
                >
                  Dismiss
                </button>
              </div>
            )}
            <CustomerHealthShadowConsole
              surface={surface}
              terminology={TERMINOLOGY}
              writeCapable={true}
              onReview={onReview}
            />
          </>
        )}
      </div>
    </div>
  );
}
