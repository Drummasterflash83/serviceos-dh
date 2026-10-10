/** Read-only schema and authority evidence for mailbox capture diagnostics. */
import {
  readCaptureCatalog,
  CAPTURE_FUNCTION_QUERY,
  CAPTURE_GRANTS_QUERY,
  CAPTURE_BASE_TABLES,
} from "./learn-capture-health-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const EMAIL_HEALTH_TABLES = [...CAPTURE_BASE_TABLES, "email_sync_runs"];
export const EMAIL_HEALTH_FUNCTION_QUERY = CAPTURE_FUNCTION_QUERY.replace(
  /p\.proname in \(([^)]*)\)/,
  (_, names) => `p.proname in (${names},'email_ingestion_run_guard_v2')`,
);
export const EMAIL_HEALTH_GRANTS_QUERY = CAPTURE_GRANTS_QUERY.replace(
  /c\.relname in \([^)]*\)/g,
  `c.relname in (${EMAIL_HEALTH_TABLES.map((n) => `'${n}'`).join(",")})`,
);
export async function readEmailHealthCatalog(args) {
  const c = await readCaptureCatalog(args);
  const results = await Promise.allSettled(
    [EMAIL_HEALTH_FUNCTION_QUERY, EMAIL_HEALTH_GRANTS_QUERY].map((q) =>
      communicationQuery(args.token, q, args),
    ),
  );
  if (results.some((r) => r.status === "rejected"))
    throw Error("Email health metadata unavailable");
  const [f, g] = results.map((r) => r.value);
  if (
    f?.length !== 1 ||
    !Array.isArray(f[0]?.functions) ||
    g?.length !== 1 ||
    !Array.isArray(g[0]?.grants)
  )
    throw Error("Email health metadata incomplete");
  return { ...c, emailHealthFunctions: f[0].functions, emailHealthGrants: g[0].grants };
}
