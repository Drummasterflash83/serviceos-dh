import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/lib/auth";
import { ClientPortal } from "@/components/client-portal/ClientPortal";
import { clientSearch } from "@/lib/client-workspace-nav";

export const Route = createFileRoute("/client")({
  validateSearch: clientSearch,
  head: () => ({
    meta: [
      { title: "Your workspace · OpenFolk" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ClientPage,
});
function ClientPage() {
  const { tenant, section } = Route.useSearch();
  return (
    <RequireAuth>
      <ClientPortal tenantId={tenant} section={section} />
    </RequireAuth>
  );
}
