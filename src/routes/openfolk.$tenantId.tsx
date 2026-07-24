/**
 * OpenFolk Control Plane — tenant workspace (/openfolk/$tenantId). PLATFORM-OPERATOR ONLY.
 *
 * Loads the workspace + readiness + audit from the gated openfolk-control-plane function
 * and renders the real OpenfolkWorkspace. Writes (discover / manual inventory / assign
 * ownership) require an admin grant server-side; a viewer's write returns 403 (surfaced
 * inline). Never in tenant navigation.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { BuildBadge } from "@/components/BuildBadge";
import { OpenfolkWorkspace, type WorkspaceActions } from "@/components/app/OpenfolkWorkspace";
import {
  archiveEndpoint,
  assignOwnership,
  createManualEndpoint,
  discoverEmail,
  discoverTelephony,
  endOwnership,
  getAudit,
  getReadiness,
  getWorkspace,
  restoreEndpoint,
  reviewIdentity,
  updateManualEndpoint,
  validateEndpoint,
  type AuditEntry,
  type SourceReadiness,
  type Workspace,
} from "@/lib/openfolk";

export const Route = createFileRoute("/openfolk/$tenantId")({
  component: WorkspacePage,
});

function WorkspacePage() {
  const { tenantId } = Route.useParams();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [readiness, setReadiness] = useState<SourceReadiness | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const [w, r, a] = await Promise.all([
      getWorkspace(tenantId),
      getReadiness(tenantId),
      getAudit(tenantId),
    ]);
    if (w.ok) {
      setWorkspace(w.data);
      setError(null);
    } else {
      setError(w.error);
    }
    if (r.ok) setReadiness(r.data);
    if (a.ok) setAudit(a.data.entries);
    setLastRefresh(new Date().toISOString());
    setLoading(false);
  }, [tenantId]);
  useEffect(() => {
    void load();
  }, [load]);

  const guard = async (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    if (busy) return false;
    setBusy(true);
    setActionError(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error?.message ?? "Action failed");
    else await load();
    setBusy(false);
    return res.ok;
  };

  const actions: WorkspaceActions = {
    onDiscoverTelephony: (reason) => void guard(() => discoverTelephony(tenantId, reason)),
    onDiscoverEmail: (reason) => void guard(() => discoverEmail(tenantId, reason)),
    onAssign: (endpoint_id, owner_member_id, assignment_role, reason) =>
      void guard(() =>
        assignOwnership({
          tenant_id: tenantId,
          endpoint_id,
          owner_kind: "person",
          owner_member_id,
          assignment_role,
          confidence: 0.95,
          reason,
        }),
      ),
    onArchiveEndpoint: (endpoint_id, reason) =>
      void guard(() => archiveEndpoint({ tenant_id: tenantId, endpoint_id, reason })),
    onReviewIdentity: (input) =>
      void guard(() => reviewIdentity({ tenant_id: tenantId, ...input })),
    onEndOwnership: (input) => void guard(() => endOwnership({ tenant_id: tenantId, ...input })),
    onRestoreEndpoint: (endpoint_id, reason) =>
      void guard(() => restoreEndpoint({ tenant_id: tenantId, endpoint_id, reason })),
    onValidateEndpoint: async (input) => {
      const res = await validateEndpoint({ tenant_id: tenantId, ...input });
      return res.ok ? res.data : null;
    },
    onCreateEndpoint: async (input) =>
      guard(() => createManualEndpoint({ tenant_id: tenantId, ...input })),
    onUpdateEndpoint: async (input) => {
      if (busy) return { ok: false, error: "busy" };
      setBusy(true);
      setActionError(null);
      const res = await updateManualEndpoint({ tenant_id: tenantId, ...input });
      if (!res.ok) {
        setActionError(res.error?.message ?? "Update failed");
        setBusy(false);
        return { ok: false, error: res.error?.message };
      }
      await load();
      setBusy(false);
      return { ok: true, outcome: res.data.outcome };
    },
  };

  return (
    <div className="min-h-screen bg-surface-alt/30">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Link
          to="/openfolk"
          className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-display"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> All tenants
        </Link>

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
              Restricted to authorised OpenFolk operators (server-enforced).
            </p>
          </div>
        )}
        {!loading && !error && workspace && (
          <>
            {actionError && (
              <div
                role="alert"
                className="mb-3 rounded-xl border border-destructive/30 bg-white p-3 text-xs text-muted-foreground"
              >
                <span className="font-semibold text-display">Action failed — </span>
                {actionError}
              </div>
            )}
            <OpenfolkWorkspace
              tenantName={workspace.summary.display_name ?? tenantId.slice(0, 8)}
              workspace={workspace}
              readiness={readiness}
              audit={audit}
              writeCapable={true}
              busy={busy}
              lastRefresh={lastRefresh}
              actions={actions}
            />
            <BuildBadge />
          </>
        )}
      </div>
    </div>
  );
}
