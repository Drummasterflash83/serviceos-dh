/** Read-only contact projection dependencies from the named TEST backend. */
import {
  readConnectionSetupCatalog,
  CONNECTION_BASE_TABLES,
  CONNECTION_TABLES,
  CONNECTION_FUNCTION_QUERY,
} from "./learn-commusoft-setup-catalog.mjs";
import {
  COMMUSOFT_FUNCTION_QUERY,
  COMMUSOFT_GRANTS_QUERY,
  COMMUSOFT_MANIFEST,
} from "./learn-commusoft-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const CONTACT_FUNCTIONS = [
  "learn_business_contact_phone",
  "learn_commusoft_confirm_contact",
  "learn_commusoft_contact_candidates",
];
export const CONTACT_CHANGED_FUNCTIONS = [
  "learn_commusoft_work_batch",
  "learn_commusoft_work_review_page",
];
export const CONTACT_DEPENDENCIES = [
  "contact_points",
  "graph_nodes",
  "graph_edges",
  "graph_events",
];
export const CONTACT_BASE_TABLES = [
  ...new Set([
    ...CONNECTION_BASE_TABLES,
    ...CONNECTION_TABLES,
    ...COMMUSOFT_MANIFEST.tables,
    ...CONTACT_DEPENDENCIES,
  ]),
];
const quoted = (xs) => xs.map((x) => `'${x}'`).join(",");
export const CONTACT_FUNCTION_QUERY = COMMUSOFT_FUNCTION_QUERY.replace(
  /p\.proname in \(([^)]*)\)/,
  (_, names) =>
    `p.proname in (${names},${CONNECTION_FUNCTION_QUERY.match(/p\.proname in \(([^)]*)\)/)[1]},${quoted([...CONTACT_FUNCTIONS, "import_normalize_phone_uk"])})`,
);
export const CONTACT_GRANTS_QUERY = COMMUSOFT_GRANTS_QUERY.replace(
  /c\.relname in \([^)]*\)/g,
  `c.relname in (${quoted(CONTACT_BASE_TABLES)})`,
);
export async function readContactCatalog(args) {
  const c = await readConnectionSetupCatalog(args);
  const results = await Promise.allSettled(
    [CONTACT_FUNCTION_QUERY, CONTACT_GRANTS_QUERY].map((q) =>
      communicationQuery(args.token, q, args),
    ),
  );
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length) throw Error("Contact schema metadata unavailable");
  const [f, g] = results.map((r) => r.value);
  if (
    f?.length !== 1 ||
    !Array.isArray(f[0]?.functions) ||
    g?.length !== 1 ||
    !Array.isArray(g[0]?.grants)
  )
    throw Error("Contact schema metadata incomplete");
  return { ...c, contactFunctions: f[0].functions, contactGrants: g[0].grants };
}
