/**
 * OpenFolk Control Plane — layout (/openfolk/*). PLATFORM-OPERATOR ONLY.
 *
 * Auth-gates BOTH the tenant list (openfolk.index.tsx, at /openfolk) and the tenant
 * workspace (openfolk.$tenantId.tsx, at /openfolk/$tenantId) via a shared Outlet. This
 * layout MUST render <Outlet/> — without it the child workspace never mounts and the
 * list shows at the tenant URL. The server gate is the real enforcement; this only
 * redirects unauthenticated users to login and is never in tenant navigation.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/auth";

export const Route = createFileRoute("/openfolk")({
  component: () => (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  ),
});
