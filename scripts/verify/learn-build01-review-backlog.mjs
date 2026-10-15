/** Read-only LIVE review counts and bounded processing candidates. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `begin transaction read only;
set local statement_timeout='30s';
select jsonb_build_object(
  'projectionReviewAll',public.learn_projection_review_count('${tenant}'::uuid,'all'),
  'projectionReviewEmail',public.learn_projection_review_count('${tenant}'::uuid,'email'),
  'projectionReviewPhone',public.learn_projection_review_count('${tenant}'::uuid,'phone'),
  'identityReview',public.learn_identity_review_count('${tenant}'::uuid),
  'projectionPendingSample',(select count(*)::int from public.learn_projection_pending(
    '${tenant}'::uuid,'all',20)),
  'identityPendingSample',(select count(*)::int from public.learn_identity_pending(
    '${tenant}'::uuid,20)),
  'observedAt',clock_timestamp()) as backlog;
rollback;`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!response.ok) {
  const issue = await response.json().catch(() => null);
  throw Error(`Review backlog unavailable (HTTP ${response.status}; ${
    typeof issue?.message === "string" ? issue.message.slice(0, 240) : "diagnostic withheld"})`);
}
const rows = await response.json();
const backlog = rows?.[0]?.backlog;
if (!Array.isArray(rows) || rows.length !== 1 ||
  !Number.isInteger(backlog?.projectionReviewAll) ||
  !Number.isInteger(backlog?.identityReview))
  throw Error("Review backlog shape changed");
console.log(JSON.stringify({ project, ...backlog,
  transactionReadOnly: true, productionDataWrites: false,
  customerContentReturned: false }));
