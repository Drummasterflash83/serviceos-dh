import { lazy, Suspense } from "react";
import { useAuth } from "@/lib/auth";
import { LearnLaunchPortal } from "./LearnLaunchPortal";
import "@/styles/learn-launch.css";

const OperatorClientInformation = lazy(() =>
  import("@/components/app/OperatorClientInformation").then((module) => ({
    default: module.OperatorClientInformation,
  })),
);

/** Presentation routing only: every operator read still checks and audits authority
 * on the server. A selected client never changes the signed-in user's profile. */
export function LearnWorkspace({
  tenantId,
  company,
  operatorAuthorised,
}: {
  tenantId: string;
  company: string;
  operatorAuthorised: boolean;
}) {
  const { user, profile } = useAuth();
  if (!user) return <p role="status">Sign in to open LEARN.</p>;
  if (profile?.tenant_id === tenantId)
    return <LearnLaunchPortal key={`${user.id}:${tenantId}`} tenantId={tenantId} />;
  if (!operatorAuthorised)
    return <p role="status">This company’s LEARN workspace is unavailable for your account.</p>;
  return (
    <div className="lr-page">
      <header className="cp-page-heading lr-heading">
        <div>
          <p className="of-eyebrow">STAGE 1 · LEARN · OPENFOLK SUPPORT</p>
          <h1>{company}, coming into view.</h1>
          <p>Review this company’s retained information using your OpenFolk access.</p>
        </div>
      </header>
      <p className="lr-notice">
        You are viewing as an OpenFolk operator. Each record load checks your access and records
        your reason. Customer sign-in and customer-only actions are separate.
      </p>
      <div className="flex flex-wrap gap-3">
        <a className="cp-secondary" href={`/openfolk/${encodeURIComponent(tenantId)}?module=modules`}>
          Input health and capture controls
        </a>
        <a className="cp-secondary" href={`/openfolk/${encodeURIComponent(tenantId)}?module=information`}>
          Review and link retained business inputs
        </a>
      </div>
      <Suspense fallback={<p role="status">Opening audited company records…</p>}>
        <OperatorClientInformation
          key={`${user.id}:${tenantId}`}
          tenantId={tenantId}
          actorId={user.id}
          company={company}
          initialCollection="customers"
          embedded
        />
      </Suspense>
    </div>
  );
}
