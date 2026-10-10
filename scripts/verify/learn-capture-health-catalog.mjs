/** Read-only TEST schema metadata for operator capture evidence. */
import { readResumeCatalog, RESUME_FUNCTION_QUERY } from "./learn-commusoft-resume-catalog.mjs";
import { CONTACT_BASE_TABLES, CONTACT_GRANTS_QUERY } from "./learn-commusoft-contacts-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const CAPTURE_FUNCTIONS = ["learn_operator_capture_health"];
export const CAPTURE_BASE_TABLES = [...CONTACT_BASE_TABLES, "email_accounts"];
export const CAPTURE_FUNCTION_QUERY = RESUME_FUNCTION_QUERY.replace(
  /p\.proname in \(([^)]*)\)/,
  (_, names) =>
    `p.proname in (${names},'email_ingestion_account_guard_v2','learn_operator_capture_health')`,
);
export const CAPTURE_GRANTS_QUERY = CONTACT_GRANTS_QUERY.replace(
  /c\.relname in \([^)]*\)/g,
  `c.relname in (${CAPTURE_BASE_TABLES.map((n) => `'${n}'`).join(",")})`,
);
export async function readCaptureCatalog(args) {
  const c = await readResumeCatalog(args);
  const results = await Promise.allSettled(
    [CAPTURE_FUNCTION_QUERY, CAPTURE_GRANTS_QUERY].map((q) =>
      communicationQuery(args.token, q, args),
    ),
  );
  if (results.some((r) => r.status === "rejected")) throw Error("Capture metadata unavailable");
  const [f, g] = results.map((r) => r.value);
  if (
    f?.length !== 1 ||
    !Array.isArray(f[0]?.functions) ||
    g?.length !== 1 ||
    !Array.isArray(g[0]?.grants)
  )
    throw Error("Capture metadata incomplete");
  return { ...c, captureFunctions: f[0].functions, captureGrants: g[0].grants };
}
