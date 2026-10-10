/** Hosted schema metadata and aggregate fingerprints only; no source values. */
import { SETTLEMENT_CATALOG } from "./learn-phone-settlement-catalog.mjs";
import {
  RUNTIME_CATALOG_EXPRESSION,
  RUNTIME_FUNCTIONS,
  RUNTIME_TABLES,
} from "./learn-email-runtime-catalog.mjs";
import {
  COMMUSOFT_AUTH_PRESERVED,
  COMMUSOFT_AUTH_SNAPSHOT,
  commusoftAuthSnapshot,
} from "./learn-test-commusoft-auth-deploy.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const TRAVERSAL_FUNCTIONS = [
  "learn_operator_input_request",
  "learn_operator_inputs",
  "learn_operator_resume_commusoft",
  "learn_commusoft_acquire_page",
  "learn_commusoft_commit_page",
  "learn_commusoft_contact_target",
  "learn_commusoft_committed_page",
  "learn_commusoft_finish_job",
  "learn_commusoft_claim_jobs",
  "learn_business_input_retain",
];
export const TRAVERSAL_TABLES = [
  "learn_commusoft_contact_targets",
  "learn_business_input_pages",
  "learn_business_input_versions",
  "learn_business_input_observations",
  "learn_business_input_request_permits",
  "learn_business_input_request_gates",
  "learn_operator_input_requests",
  "provider_connections",
  "connector_accounts",
  "tenant_connectors",
  "feature_flags",
  "tenants",
  "platform_jobs",
];
const list = (xs) => xs.map((x) => `'${x}'`).join(",");
const selected = RUNTIME_CATALOG_EXPRESSION.replace(
  list(RUNTIME_FUNCTIONS),
  list(TRAVERSAL_FUNCTIONS),
).replace(list(RUNTIME_TABLES), list(TRAVERSAL_TABLES));
export const TRAVERSAL_CATALOG = `jsonb_build_object('base',${SETTLEMENT_CATALOG},'contacts',${selected})`;
export const TRAVERSAL_SNAPSHOT = COMMUSOFT_AUTH_SNAPSHOT;
export const TRAVERSAL_PRESERVED = COMMUSOFT_AUTH_PRESERVED;
export const traversalSnapshot = commusoftAuthSnapshot;
export async function readTraversalCatalog(token, options) {
  const rows = await communicationQuery(
    token,
    `set local search_path=public,pg_catalog;select ${TRAVERSAL_CATALOG} as catalog,md5((${TRAVERSAL_CATALOG})::text) as fingerprint`,
    options,
  );
  if (
    rows.length !== 1 ||
    !/^[a-f0-9]{32}$/.test(rows[0].fingerprint) ||
    !Array.isArray(rows[0].catalog?.contacts?.functions)
  )
    throw Error("Contact traversal catalog incomplete");
  return rows[0];
}
