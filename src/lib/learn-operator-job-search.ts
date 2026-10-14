import type { InformationClient } from "./openfolk-client-information.ts";
export type JobSearchRow = {
  id: string;
  fields: {
    job_number: string | null;
    title: string | null;
    status: string | null;
    customer: string | null;
    address: string | null;
    postcode: string | null;
  };
};
export type JobSearchPage = { query: string; rows: JobSearchRow[]; next_after: string | null };
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const fail = () => Error("Jobs could not be verified. Check your operator access and try again.");
export async function searchOperatorJobs(
  client: InformationClient,
  args: {
    tenant: string;
    actor: string;
    query: string;
    reason: string;
    after?: string | null;
  },
  signal: AbortSignal,
): Promise<JobSearchPage> {
  const after = args.after ?? null;
  if (
    !uuid(args.tenant) ||
    !uuid(args.actor) ||
    typeof args.query !== "string" ||
    args.query.length > 120 ||
    typeof args.reason !== "string" ||
    args.reason.trim().length < 3 ||
    args.reason.trim().length > 500 ||
    (after !== null && !uuid(after))
  )
    throw fail();
  const query = args.query.trim();
  const { data, error } = await client
    .rpc("learn_operator_job_search", {
      p_tenant: args.tenant,
      p_query: query,
      p_reason: args.reason.trim(),
      p_after: after,
    })
    .abortSignal(signal);
  const p = data as any;
  if (
    error ||
    !object(p) ||
    p.version !== "openfolk-job-search/1" ||
    p.tenant_id !== args.tenant ||
    p.actor_id !== args.actor ||
    p.query !== query ||
    p.after !== after ||
    !uuid(p.audit_id) ||
    typeof p.observed_at !== "string" ||
    !Number.isFinite(Date.parse(p.observed_at)) ||
    Date.parse(p.observed_at) < Date.now() - 300000 ||
    Date.parse(p.observed_at) > Date.now() + 60000 ||
    !Array.isArray(p.rows) ||
    p.rows.length > 25 ||
    (p.next_after !== null && !uuid(p.next_after))
  )
    throw fail();
  let prior = after;
  const fields = ["address", "customer", "job_number", "postcode", "status", "title"];
  for (const row of p.rows) {
    if (
      !object(row) ||
      !uuid(row.id) ||
      (prior && row.id <= prior) ||
      !object(row.fields) ||
      Object.keys(row.fields).sort().join() !== fields.join() ||
      !fields.every((k) => row.fields[k] === null || typeof row.fields[k] === "string")
    )
      throw fail();
    prior = row.id;
  }
  if (p.next_after !== null && (p.rows.length !== 25 || p.next_after !== prior)) throw fail();
  return { query, rows: p.rows, next_after: p.next_after };
}
