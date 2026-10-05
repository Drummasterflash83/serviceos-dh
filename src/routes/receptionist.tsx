import { createFileRoute, redirect } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/auth";
import { ReceptionistWorkspace } from "@/components/receptionist/ReceptionistWorkspace";
import { receptionistView } from "@/lib/client-workspace-nav";
export const Route = createFileRoute("/receptionist")({
  validateSearch: (s: Record<string, unknown>) => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
    demo: s.demo === "1" || s.demo === 1 ? "1" : undefined,
    view: typeof s.view === "string" ? s.view : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!(import.meta.env.DEV && search.demo === "1"))
      throw redirect({
        to: "/client",
        search: {
          tenant: search.tenant,
          section: "receptionist",
          view: receptionistView(search.view),
        },
        replace: true,
      });
  },
  head: () => ({
    meta: [
      { title: "Your receptionist · OpenFolk" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "theme-color", content: "#242337" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
  }),
  component: Page,
});
function Page() {
  const { tenant, demo, view } = Route.useSearch();
  if (import.meta.env.DEV && demo === "1")
    return <ReceptionistWorkspace demo tenantId={tenant} initialView={view} />;
  return (
    <RequireAuth>
      <ReceptionistWorkspace tenantId={tenant} initialView={view} />
    </RequireAuth>
  );
}
