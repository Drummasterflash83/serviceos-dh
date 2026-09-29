/**
 * OpenFolk Control Plane — layout (/openfolk/*). PLATFORM-OPERATOR ONLY.
 *
 * Auth-gates BOTH the tenant list (openfolk.index.tsx, at /openfolk) and the tenant
 * workspace (openfolk.$tenantId.tsx, at /openfolk/$tenantId) via a shared Outlet. This
 * layout MUST render <Outlet/> — without it the child workspace never mounts and the
 * list shows at the tenant URL. Server gates remain the real enforcement. This
 * layout also requires Chris's verified admin authority before mounting children.
 */
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RequireAuth, useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { canShowOpenFolkAdmin } from "@/lib/client-workspace-nav";

/** UI gate only: every server read/write still independently enforces authority. */
function OperatorAccess() {
  const { user } = useAuth();
  const eligible = canShowOpenFolkAdmin(user?.email, true);
  const authority = useQuery({
    queryKey: ["openfolk-route-authority", user?.id],
    enabled: Boolean(user?.id) && eligible,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    queryFn: async () => {
      const { data, error } = await getSupabaseClient()
        .rpc("current_user_is_openfolk_operator", {
          required_permission: "platform.controlplane.admin",
        })
        .abortSignal(AbortSignal.timeout(15_000));
      if (error) throw new Error("Administrator access could not be verified.");
      return data === true;
    },
  });
  if (eligible && (authority.isPending || authority.isFetching)) {
    return (
      <div className="p-8" role="status">
        Checking OpenFolk access…
      </div>
    );
  }
  if (authority.isError || !canShowOpenFolkAdmin(user?.email, authority.data)) {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-8">
        <h1 className="text-xl font-semibold">OpenFolk administrator access required</h1>
        <p>This area is reserved for OpenFolk. Your client workspace is separate.</p>
        <Link to="/client" search={{ section: "home" }} className="underline">
          Go to your workspace
        </Link>
        {eligible && (
          <button className="block underline" onClick={() => void authority.refetch()}>
            Try again
          </button>
        )}
      </main>
    );
  }
  return <Outlet />;
}

export const Route = createFileRoute("/openfolk")({
  head: () => ({
    meta: [
      { title: "OpenFolk · Your clients, working better" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#242337" },
    ],
  }),
  component: () => (
    <RequireAuth>
      <OperatorAccess />
    </RequireAuth>
  ),
});
