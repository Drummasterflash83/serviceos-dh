/** Read-only continuation metadata; source data and secrets are excluded. */
import { readContactCatalog, CONTACT_FUNCTION_QUERY } from "./learn-commusoft-contacts-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
export const RESUME_FUNCTIONS = ["learn_operator_resume_commusoft"];
export const RESUME_FUNCTION_QUERY = CONTACT_FUNCTION_QUERY.replace(
  /p\.proname in \(([^)]*)\)/,
  (_, names) => `p.proname in (${names},'learn_operator_resume_commusoft')`,
);
export async function readResumeCatalog(args) {
  const c = await readContactCatalog(args);
  const r = await communicationQuery(args.token, RESUME_FUNCTION_QUERY, args);
  if (r?.length !== 1 || !Array.isArray(r[0]?.functions))
    throw Error("Continuation metadata unavailable");
  return { ...c, resumeFunctions: r[0].functions };
}
