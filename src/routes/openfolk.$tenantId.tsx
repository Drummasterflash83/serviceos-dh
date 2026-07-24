/**
 * OpenFolk Control Plane — tenant workspace (/openfolk/$tenantId). PLATFORM-OPERATOR ONLY.
 *
 * Loads the workspace + readiness + audit from the gated openfolk-control-plane function
 * and renders the real OpenfolkWorkspace. Writes (discover / manual inventory / assign
 * ownership) require an admin grant server-side; a viewer's write returns 403 (surfaced
 * inline). Never in tenant navigation.
 */
import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { OpenfolkShell } from "@/components/app/OpenfolkShell";
import { OpenfolkWorkspace, type WorkspaceActions } from "@/components/app/OpenfolkWorkspace";
import {
  resolveSection,
  sectionSearchValue,
  type WorkspaceSection,
} from "@/lib/openfolk-workspace-nav";
import {
  archiveEndpoint,
  assignOwnership,
  createManualEndpoint,
  discoverEmail,
  discoverTelephony,
  endOwnership,
  getAudit,
  getDelegatedSubmission,
  getReadiness,
  getWorkspace,
  issueDelegatedTask,
  listDelegatedTasks,
  restoreEndpoint,
  reviewIdentity,
  revokeDelegatedTask,
  updateManualEndpoint,
  validateEndpoint,
  type AuditEntry,
  type SourceReadiness,
  type Workspace,
} from "@/lib/openfolk";
import type { DelegatedActions } from "@/components/app/OpenfolkConnections";

// The active workspace section + selected endpoint are durable URL state, so a mutation
// refetch, a reload, or Back/Forward all keep the operator where they were. An absent or
// invalid `?section=` fails safely to Overview.
type WorkspaceSearch = { section?: WorkspaceSection; endpoint?: string };

export const Route = createFileRoute("/openfolk/$tenantId")({
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => ({
    section: sectionSearchValue(search.section),
    endpoint: typeof search.endpoint === "string" && search.endpoint ? search.endpoint : undefined,
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { tenantId } = Route.useParams();
  const { user } = useAuth();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [readiness, setReadiness] = useState<SourceReadiness | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>("");

  const section = resolveSection(search.section);
  const setSection = useCallback(
    (s: WorkspaceSection) =>
      navigate({
        // Push a history entry so Back/Forward move between sections. Drop the endpoint
        // selection when leaving Ownership so it doesn't leak into other sections.
        search: (prev) => ({
          ...prev,
          section: sectionSearchValue(s),
          endpoint: s === "ownership" ? prev.endpoint : undefined,
        }),
      }),
    [navigate],
  );
  const setEndpoint = useCallback(
    (endpointId: string | null) =>
      navigate({
        // Selecting the endpoint you're editing isn't a navigation event — replace, don't push.
        search: (prev) => ({ ...prev, endpoint: endpointId ?? undefined }),
        replace: true,
      }),
    [navigate],
  );

  // fetchAll refreshes data IN PLACE. It never toggles `loading`, so the workspace is
  // not unmounted on a mutation refetch — the durable section/endpoint, expanded role
  // form, and scroll position all survive. Only the first load gates the render.
  const fetchAll = useCallback(async () => {
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
  }, [tenantId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetchAll().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchAll]);

  const guard = async (fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    if (busy) return false;
    setBusy(true);
    setActionError(null);
    const res = await fn();
    if (!res.ok) setActionError(res.error?.message ?? "Action failed");
    else await fetchAll(); // in-place refresh — no unmount, section/endpoint preserved
    setBusy(false);
    return res.ok;
  };

  // Delegated setup-request operator actions → the gated Control Plane. Raw tokens are
  // generated server-side and returned once by `issue`; the client never stores the hash.
  const delegatedActions: DelegatedActions = {
    list: async () => {
      const r = await listDelegatedTasks(tenantId);
      return r.ok ? r.data.tasks : [];
    },
    issue: async (input) => {
      const r = await issueDelegatedTask({ tenant_id: tenantId, ...input });
      return r.ok ? r.data : { error: r.error.message };
    },
    revoke: async (taskId, reasonText) => {
      const r = await revokeDelegatedTask({
        tenant_id: tenantId,
        task_id: taskId,
        reason: reasonText,
      });
      return r.ok && r.data.revoked;
    },
    getSubmission: async (taskId) => {
      const r = await getDelegatedSubmission({ tenant_id: tenantId, task_id: taskId });
      return r.ok ? (r.data.task.submission ?? null) : null;
    },
  };

  const actions: WorkspaceActions = {
    onDiscoverTelephony: (reason) => void guard(() => discoverTelephony(tenantId, reason)),
    onDiscoverEmail: (reason) => void guard(() => discoverEmail(tenantId, reason)),
    onAssign: (endpoint_id, owner_member_id, assignment_role, reason) =>
      guard(() =>
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
      await fetchAll();
      setBusy(false);
      return { ok: true, outcome: res.data.outcome };
    },
  };

  // Loading / access-denied render without the shell (there is no tenant to frame yet).
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-alt/30">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  if (error || !workspace)
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-alt/30 p-6">
        <div className="max-w-md rounded-xl border border-hairline bg-white p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-display">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            {error && (error.code === "forbidden" || error.code.startsWith("http_403"))
              ? "Platform authority required"
              : "Could not load"}
          </div>
          <p className="text-xs text-muted-foreground">
            Restricted to authorised OpenFolk operators (server-enforced).
          </p>
          <Link to="/openfolk" className="mt-3 inline-flex items-center gap-1 text-xs text-accent">
            <ChevronLeft className="h-3.5 w-3.5" /> All tenants
          </Link>
        </div>
      </div>
    );

  const tenantName = workspace.summary.display_name ?? tenantId.slice(0, 8);
  return (
    <OpenfolkShell
      tenantName={tenantName}
      section={section}
      onSectionChange={setSection}
      readiness={readiness}
      operatorLabel={user?.email ?? undefined}
    >
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
        tenantName={tenantName}
        workspace={workspace}
        readiness={readiness}
        audit={audit}
        writeCapable={true}
        busy={busy}
        lastRefresh={lastRefresh}
        actions={actions}
        section={section}
        onSectionChange={setSection}
        selectedEndpoint={search.endpoint ?? null}
        onSelectEndpoint={setEndpoint}
        delegatedActions={delegatedActions}
      />
    </OpenfolkShell>
  );
}
