/** Whole-roster, aggregate-only LIVE Commusoft source reconciliation. No apply. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken } from "./learn-test-readiness.mjs";

export const PROJECT = "tgbnakbxwcqjeimygroz";
export const TENANT = "00000000-0000-0000-0000-000000000001";
export const FIRST_HOLDS = [
  "job_source_hold",
  "property_source_hold",
  "customer_property_outside_dual_id",
  "customer_identity_unreviewed",
  "postcode_collision",
  "site_mapping_review",
  "site_source_other_hold",
  "provisional_site_review",
];
const path = new URL("./sql/new-dawn-m1-roster-first-hold.sql", import.meta.url);
export const QUERY = readFileSync(path, "utf8").replaceAll("__TENANT__", TENANT);

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assessRoster(row) {
  if (!row || !Number.isFinite(Date.parse(row.observed_at)) ||
      !["configured_connections", "observed_job_ids", "unlinked_job_ids",
        "distinct_referenced_property_ids", "ambiguous_latest_job_ids",
        "ambiguous_latest_property_ids"].every((key) => integer(row[key])) ||
      !row.job_first_holds || typeof row.job_first_holds !== "object" ||
      Array.isArray(row.job_first_holds) ||
      !row.distinct_property_ids_by_first_hold ||
      typeof row.distinct_property_ids_by_first_hold !== "object" ||
      Array.isArray(row.distinct_property_ids_by_first_hold)) {
    throw Error("Whole-roster aggregate contract changed; no clean set can be claimed");
  }
  if (row.configured_connections !== 1 || row.observed_job_ids < row.unlinked_job_ids)
    throw Error("Commusoft connection or source roster is ambiguous");
  const holds = Object.fromEntries(FIRST_HOLDS.map((key) => [key, 0]));
  const propertyCounts = { ...holds };
  for (const [key, value] of Object.entries(row.job_first_holds)) {
    if (!(key in holds) || !integer(value))
      throw Error("Unexpected first-hold class or count");
    holds[key] = value;
  }
  for (const [key, value] of Object.entries(row.distinct_property_ids_by_first_hold)) {
    if (!(key in propertyCounts) || !integer(value))
      throw Error("Unexpected source-property class or count");
    propertyCounts[key] = value;
  }
  if (Object.values(holds).reduce((sum, value) => sum + value, 0) !== row.unlinked_job_ids)
    throw Error("First-hold partition does not cover the whole unlinked roster");
  if (Object.entries(propertyCounts).some(([key, value]) => value > holds[key]))
    throw Error("A class has more distinct properties than jobs");
  return {
    observed_at: row.observed_at,
    project: PROJECT,
    tenant: TENANT,
    configured_connections: row.configured_connections,
    observed_job_ids: row.observed_job_ids,
    unlinked_job_ids: row.unlinked_job_ids,
    distinct_referenced_property_ids: row.distinct_referenced_property_ids,
    ambiguous_latest_job_ids: row.ambiguous_latest_job_ids,
    ambiguous_latest_property_ids: row.ambiguous_latest_property_ids,
    job_first_holds: holds,
    distinct_property_ids_by_first_hold: propertyCounts,
    clean_exact_batch_proven: false,
    links_applied_by_verifier: 0,
    limitation: "First-hold classes are source observations, not independent conflict totals or permission to create/link. Exact candidate, current-version, authority and rollback gates remain.",
  };
}

export async function readRoster({ token = savedCliToken(), fetcher = fetch } = {}) {
  const response = await fetcher(
    `https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY }),
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Error(`Whole-roster read-only query failed (HTTP ${response.status}): ${String(
      error?.message ?? error?.code ?? "unknown",
    ).slice(0, 300)}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1)
    throw Error("Whole-roster read-only response was incomplete");
  return assessRoster(rows[0]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await readRoster()));
}
