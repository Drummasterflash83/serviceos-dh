import type { ReviewClient } from "./learn-commusoft-review";

const actions = new Set([
  "learn_commusoft_review_connections",
  "learn_commusoft_review_page",
  "learn_commusoft_review_search",
  "learn_commusoft_customer_candidates",
  "learn_commusoft_contact_candidates",
  "learn_commusoft_confirm_customer",
  "learn_commusoft_confirm_customer_identity",
  "learn_commusoft_work_review_page",
  "learn_commusoft_work_review_search",
  "learn_commusoft_work_batch_result",
  "learn_commusoft_work_batch",
  "learn_commusoft_job_details",
]);
const uuid = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
/** Reuse the governed review UI without changing the user's tenant or role. */
export function operatorBusinessReviewClient(
  db: ReviewClient,
  scope: { tenant: string; actor: string; reason: string },
  active: () => boolean,
): ReviewClient {
  return {
    async rpc(action, args) {
      const denied = () => ({
        data: null,
        error: new Error("Operator review unavailable. Reopen this client review to check access."),
      });
      if (
        !active() ||
        !uuid(scope.tenant) ||
        !uuid(scope.actor) ||
        scope.reason.trim().length < 3 ||
        scope.reason.trim().length > 1000 ||
        !actions.has(action) ||
        args.p_tenant !== scope.tenant ||
        ("p_expected_actor" in args && args.p_expected_actor !== scope.actor)
      )
        return denied();
      try {
        const { data, error } = await db.rpc("openfolk_business_review", {
          p_tenant: scope.tenant,
          p_action: action,
          p_reason: scope.reason.trim(),
          p_args: args,
        });
        const r = data as Record<string, unknown> | null;
        if (
          error ||
          !active() ||
          !r ||
          r.version !== "openfolk-business-review/1" ||
          r.tenant_id !== scope.tenant ||
          r.actor_id !== scope.actor ||
          r.action !== action ||
          !uuid(r.audit_id) ||
          typeof r.observed_at !== "string" ||
          !Number.isFinite(Date.parse(r.observed_at)) ||
          Math.abs(Date.now() - Date.parse(r.observed_at)) > 120000 ||
          !("result" in r)
        )
          return denied();
        return { data: r.result, error: null };
      } catch {
        return denied();
      }
    },
  };
}
