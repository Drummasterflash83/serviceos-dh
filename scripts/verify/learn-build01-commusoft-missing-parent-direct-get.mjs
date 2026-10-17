/** Bounded read-only direct GET for the 29 recorded open-job missing parents.
 * The target IDs and statuses stay in a private local journal, never stdout.
 * A 404 is provider absence at this instant, not proof of deletion. */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const keyPath = ".verification-results/commusoft-existing-private-key";
const journalPath = ".verification-results/learn-build01-commusoft-missing-parent-direct-get.private.json";
const sha = value => createHash("sha256").update(value).digest("hex");
const idValid = value => typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const sql = `begin read only;set local statement_timeout=45000;set local enable_nestloop=off;
with rows as materialized(select s.* from public.provider_connections c
 cross join lateral public.learn_commusoft_source_job_rows(c.tenant_id,c.id) s
 where c.tenant_id='${tenant}'::uuid and c.provider='commusoft'),
 gaps as (select relationship_state,
  case when relationship_state='property_source_missing' then property_reference
   else customer_reference end target_id
  from rows where source_status in ('Open','ongoing','pending','on_hold')
   and relationship_state in ('property_source_missing','customer_source_missing'))
select relationship_state,target_id,count(*)::int jobs from gaps
group by relationship_state,target_id order by target_id,relationship_state;commit;`;
const management = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
if (!management.ok) throw Error(`Missing-parent aggregate HTTP ${management.status}`);
const rows = await management.json();
if (!Array.isArray(rows) || rows.length < 1 || rows.length > 29 ||
    rows.some(row => !["property_source_missing", "customer_source_missing"].includes(row.relationship_state) ||
      !idValid(row.target_id) || !Number.isInteger(row.jobs) || row.jobs < 1) ||
    rows.reduce((sum, row) => sum + row.jobs, 0) !== 29)
  throw Error("Recorded open-job missing-parent scope changed");
const targets = [...new Set(rows.map(row => row.target_id))]
  .sort((a, b) => a.length - b.length || a.localeCompare(b));
const targetSetSha256 = sha(JSON.stringify(rows));
const keyStat = lstatSync(keyPath);
if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.uid !== process.getuid() ||
    (keyStat.mode & 0o077) !== 0 || keyStat.size < 16 || keyStat.size > 4096 ||
    realpathSync(keyPath) !== `${process.cwd()}/${keyPath}`)
  throw Error("Existing private Commusoft key unavailable");
const key = readFileSync(keyPath, "utf8").trim();
if (key.length < 16 || key.length > 4096 || /\s/.test(key))
  throw Error("Existing private Commusoft key shape changed");

let journal = existsSync(journalPath)
  ? JSON.parse(readFileSync(journalPath, "utf8"))
  : { contract: "learn-build01-commusoft-missing-parent-direct-get/1",
      project, tenant, targetSetSha256, targets, results: [],
      startedAt: new Date().toISOString() };
if (journal.contract !== "learn-build01-commusoft-missing-parent-direct-get/1" ||
    journal.project !== project || journal.tenant !== tenant ||
    journal.targetSetSha256 !== targetSetSha256 ||
    JSON.stringify(journal.targets) !== JSON.stringify(targets) ||
    !Array.isArray(journal.results) || journal.results.length > targets.length ||
    journal.results.some((row, index) => row.id !== targets[index] ||
      !["found_customer", "found_workaddress", "found_other_type", "not_found"].includes(row.state)))
  throw Error("Private missing-parent journal or target set changed");
function save() {
  const temporary = `${journalPath}.new`;
  writeFileSync(temporary, JSON.stringify(journal, null, 2) + "\n",
    { mode: 0o600, flag: "wx" });
  renameSync(temporary, journalPath);
}
if (!existsSync(journalPath)) save();

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("Commusoft property body unavailable");
  const parts = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 256 * 1024) {
      await reader.cancel();
      throw Error("Commusoft property body over bound");
    }
    parts.push(value);
  }
  const body = Buffer.concat(parts);
  try { return JSON.parse(body.toString("utf8")); }
  finally { body.fill(0); for (const part of parts) part.fill(0); }
}

for (let index = journal.results.length; index < targets.length; index++) {
  const id = targets[index];
  const response = await fetch(`https://app.commusoft.co.uk/api/v2/properties/${id}`, {
    method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key}`,
      "User-Agent": "OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)",
      Accept: "application/json" },
  });
  let state;
  if (response.status === 404) {
    await response.body?.cancel();
    state = "not_found";
  } else if (response.status === 200) {
    const record = await boundedJson(response);
    if (String(record?.id) !== id) throw Error("Commusoft property identity changed");
    state = record.type === "customer" ? "found_customer" :
      record.type === "workaddress" ? "found_workaddress" : "found_other_type";
  } else {
    await response.body?.cancel();
    throw Error(`Commusoft property read stopped at HTTP ${response.status}; private journal retained`);
  }
  journal.results.push({ id, state });
  journal.updatedAt = new Date().toISOString();
  save();
  await pause(1000);
}
const counts = Object.fromEntries(["found_customer", "found_workaddress", "found_other_type", "not_found"]
  .map(state => [state, journal.results.filter(row => row.state === state).length]));
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  recordedOpenJobsWithMissingParent: 29, distinctParentTargets: targets.length,
  completedDirectGets: journal.results.length, ...counts,
  targetIdsReturned: false, propertyBodiesReturned: false,
  providerWrites: false, databaseWrites: false,
  limitation: "GET status/type only. A 404 does not prove deletion; a 200 does not import the property or establish canonical identity." }));
