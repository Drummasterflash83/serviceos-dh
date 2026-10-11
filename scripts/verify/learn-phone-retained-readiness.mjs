/** Full retained recording URL compatibility audit, fixed production tenant.
 * Read-only metadata; no audio, provider calls, raw URI output or credentials.
 */
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";
import {
  resolveSimwoodAccount,
  simwoodRecordingCustomer,
  boundSimwoodRecordingUrl,
} from "../../supabase/functions/_shared/simwood-account.ts";
const project = "tgbnakbxwcqjeimygroz",
  tenant = "00000000-0000-0000-0000-000000000001";
if (process.argv.slice(2).join(" ") !== "--read-only-production")
  throw Error("Explicit production read-only audit required");
const token = savedCliToken();
async function read(ref, path, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    method: query ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(query ? { body: JSON.stringify({ query }) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(`Metadata read unavailable (HTTP ${response.status}); response withheld`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 8 * 1024 * 1024) throw Error("Metadata bound exceeded");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
const sql = `select jsonb_build_object(
 'observedAt',clock_timestamp(),'tenantExists',exists(select 1 from public.tenants where id='${tenant}' and status='active'),
 'registry',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'tenant_id',a.tenant_id,'tenant_connector_id',a.tenant_connector_id,'account_key',a.account_key,'status',a.status,'customer',a.settings->>'provider_customer_id','connector',jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'connector_id',c.connector_id,'provider',c.provider,'status',c.status,'enabled',c.enabled)) order by a.id),'[]') from public.connector_accounts a join public.tenant_connectors c on c.id=a.tenant_connector_id where a.tenant_id='${tenant}' and c.tenant_id='${tenant}' and c.connector_id='simwood' and c.provider='simwood'),
 'recordingCount',(select count(*) from public.phone_recordings where tenant_id='${tenant}'),
 'recordings',(select coalesce(jsonb_agg(x order by x.id),'[]') from (select id,provider,provider_recording_id,recording_uri,storage_path is not null and storage_path<>'' as has_storage_pointer from public.phone_recordings where tenant_id='${tenant}' order by id limit 10001)x),
 'calls',(select jsonb_build_object('count',count(*),'latestStarted',max(started_at),'latestStored',max(created_at)) from public.phone_calls where tenant_id='${tenant}'),
 'transcripts',(select coalesce(jsonb_agg(x),'[]') from (select status,count(*) as records from public.phone_transcripts where tenant_id='${tenant}' group by status order by status)x),
 'recentRuns',(select coalesce(jsonb_agg(x),'[]') from (select sync_type,status,count(*) as runs,max(started_at) as latest_started,max(completed_at) as latest_completed from (select sync_type,status,started_at,completed_at from public.phone_sync_runs where tenant_id='${tenant}' order by started_at desc limit 200) r group by sync_type,status order by sync_type,status)x)
) as observation`;
const identity = await read(project, "");
if (
  identity.id !== project ||
  identity.organization_id !== "nmhqcjrjrtwsvlcvqqnh" ||
  identity.status !== "ACTIVE_HEALTHY"
)
  throw Error("Production identity differs");
const results = await Promise.allSettled([
  read(project, "/database/query/read-only", sql),
  read(project, "/secrets"),
  read("saatxzwxvdvqevbnskxy", "/secrets"),
]);
if (results.some((r) => r.status !== "fulfilled"))
  throw Error("Readiness audit incomplete; no conclusion");
const [rows, productionSecrets, testSecrets] = results.map((r) => r.value),
  o = rows?.[0]?.observation;
if (
  rows?.length !== 1 ||
  o?.tenantExists !== true ||
  !Array.isArray(o.registry) ||
  !Array.isArray(o.recordings) ||
  o.recordingCount !== o.recordings.length ||
  o.recordingCount > 10000 ||
  new Set(o.recordings.map((r) => r.id)).size !== o.recordingCount ||
  !Array.isArray(productionSecrets) ||
  !Array.isArray(testSecrets)
)
  throw Error("Incomplete retained inventory");
const port = {
  from(table) {
    if (table !== "connector_accounts") throw Error("Unexpected account read");
    const q = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      async limit() {
        return { data: o.registry, count: o.registry.length, error: null };
      },
    };
    return q;
  },
};
const unique = await resolveSimwoodAccount(port, tenant);
const counts = {
  recordings: o.recordingCount,
  withStoragePointer: 0,
  acceptedStoredUri: 0,
  acceptedMissingUriFallback: 0,
  accountUnverified: 0,
  rejectedUri: 0,
};
for (const r of o.recordings) {
  if (r.has_storage_pointer) counts.withStoragePointer++;
  const selected = simwoodRecordingCustomer(r.provider_recording_id, r.recording_uri);
  const account = await resolveSimwoodAccount(port, tenant, selected ?? undefined);
  if (!account.ok) {
    counts.accountUnverified++;
    continue;
  }
  const url = boundSimwoodRecordingUrl(
    account.customerId,
    r.provider_recording_id,
    r.recording_uri,
  );
  if (!url) {
    counts.rejectedUri++;
    continue;
  }
  if (r.recording_uri === null || r.recording_uri === undefined || r.recording_uri === "")
    counts.acceptedMissingUriFallback++;
  else counts.acceptedStoredUri++;
}
const hash = (o) =>
  createHash("sha256")
    .update(JSON.stringify({ registry: o.registry, recordings: o.recordings }))
    .digest("hex");
const first = hash(o),
  after = (await read(project, "/database/query/read-only", sql))?.[0]?.observation;
if (!after || hash(after) !== first || after.recordingCount !== o.recordingCount)
  throw Error("Retained recording or registry metadata changed during audit; no stable comparison");
const secrets = (rows) =>
  Object.fromEntries(
    ["SIMWOOD_USERNAME", "SIMWOOD_PASSWORD"].map((name) => [
      name,
      rows.some((r) => r.name === name),
    ]),
  );
console.log(
  JSON.stringify(
    {
      state: "retained_phone_metadata_audited",
      projectRef: project,
      observedAt: o.observedAt,
      completedAt: after.observedAt,
      uniqueActiveRegisteredAccount: unique.ok,
      registeredAccounts: o.registry.length,
      recordingUrlCompatibility: counts,
      metadataStableAcrossReads: true,
      metadataSha256: first,
      calls: o.calls,
      transcripts: o.transcripts,
      recentRuns: o.recentRuns,
      credentialNames: { production: secrets(productionSecrets), test: secrets(testSecrets) },
      providerRequests: 0,
      recordingsDownloaded: 0,
      productionWrites: 0,
      limitations: [
        "Full retained recording URI/registered-account compatibility only; storage pointers are not a byte, playback or provider-availability check.",
        "Secret names confirm configuration presence, not valid credentials or access to their values.",
        "Latest 200 sync runs are a bounded sample, not proof of provider history or voicemail coverage.",
      ],
    },
    null,
    2,
  ),
);
