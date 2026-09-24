import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { canShowOpenFolkAdmin } from "@/lib/client-workspace-nav";

export function OpenFolkAdminLink({
  email,
  authorised,
}: {
  email?: string | null;
  authorised: unknown;
}) {
  if (!canShowOpenFolkAdmin(email, authorised)) return null;
  return (
    <Link to="/openfolk" className="of-admin-return">
      <ShieldCheck size={16} aria-hidden="true" />
      <span>OpenFolk admin</span>
      <ArrowLeft size={15} aria-hidden="true" />
    </Link>
  );
}
