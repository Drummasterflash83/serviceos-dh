import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/auth";
import { ReceptionistWorkspace } from "@/components/receptionist/ReceptionistWorkspace";
export const Route = createFileRoute("/receptionist")({
  validateSearch: (s: Record<string, unknown>) => ({
    tenant: typeof s.tenant === "string" ? s.tenant : undefined,
    demo: s.demo === "1" || s.demo === 1 ? "1" : undefined,
    view: typeof s.view === "string" ? s.view : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Your receptionist · OpenFolk" },
      { name: "robots", content: "noindex, nofollow" },
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
