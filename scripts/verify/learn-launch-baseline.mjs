/** Fixed-scope read-only launch audit. No credential values, source bodies or
 * storage paths are returned. Counts are inventory, not preservation/coverage. */
import { readTestCatalog, savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const production = "tgbnakbxwcqjeimygroz";
// Production identity from the retained source-preservation baseline; local demo
// and the isolated real-data TEST tenant deliberately have different identities.
const tenant = "00000000-0000-0000-0000-000000000001";
const operation = process.argv.slice(2).join(" ");
if (!["--read-only-production-and-test", "--read-only-email-failure-sample"].includes(operation))
  throw Error("Explicit read-only production and TEST scope required");
const token = savedCliToken();
async function read(path, query) {
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${production}${path}`, {
      method: query ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(query ? { body: JSON.stringify({ query }) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw Error();
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 2 * 1024 * 1024) throw Error();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Error("Production metadata read unavailable; response withheld");
  }
}
const project = await read("");
if (
  project.id !== production ||
  project.organization_id !== "nmhqcjrjrtwsvlcvqqnh" ||
  project.status !== "ACTIVE_HEALTHY"
) {
  console.error(
    JSON.stringify({
      projectRef: project.id,
      organization: project.organization_id,
      status: project.status,
    }),
  );
  throw Error("Production identity or health differs");
}
if (operation === "--read-only-email-failure-sample") {
  const rows = await read(
    "/database/query/read-only",
    `select jsonb_build_object(
    'observedAt',clock_timestamp(),'tenantExists',exists(select 1 from public.tenants where id='${tenant}'),
    'sample',(select coalesce(jsonb_agg(x),'[]') from (
      select case when error_code ~ '^[a-z][a-z0-9_]{0,39}$' then error_code else 'unclassified' end as code,
      count(*) as jobs,min(updated_at) as earliest,max(updated_at) as latest
      from (select error_code,updated_at from public.platform_jobs where tenant_id='${tenant}'
        and job_type='email.workspace_sync' and status in ('dead_letter','retrying')
        order by updated_at desc limit 100) recent group by 1 order by 1
    ) x),
    'runCauses',(select coalesce(jsonb_agg(x),'[]') from (
      select case when error_message in (
       'Domain-wide delegation failed (invalid_grant)',
       'Domain-wide delegation failed (unauthorized_client)',
       'Domain-wide delegation failed (access_denied)',
       'Domain-wide delegation failed (invalid_scope)',
       'Domain-wide delegation failed (private_key_invalid)',
       'Domain-wide delegation failed (no_access_token)',
       'Domain-wide delegation failed (delegation_denied)'
      ) then split_part(split_part(error_message,'(',2),')',1) else 'unclassified' end as cause,
      count(*) as runs,count(distinct metadata->>'email_account_id') as accounts,
      min(started_at) as earliest,max(started_at) as latest
      from (select error_message,metadata,started_at from public.email_sync_runs
       where tenant_id='${tenant}' and sync_type='workspace_messages' and status='failed'
       order by started_at desc limit 200) recent group by 1 order by 1
    ) x)) as observation`,
  );
  if (rows?.length !== 1 || rows[0]?.observation?.tenantExists !== true)
    throw Error("Email failure sample unavailable");
  console.log(
    JSON.stringify(
      {
        contract: "learn-email-failure-sample/1",
        projectRef: production,
        ...rows[0].observation,
        limitations: [
          "At most 100 most recently updated failed/retrying Workspace jobs and 200 failed capture runs, not all failures or per-mailbox coverage.",
          "Machine-readable codes and allowlisted cause categories only; no raw errors, source data, provider calls or writes.",
        ],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const query = `select jsonb_build_object(
 'observedAt',clock_timestamp(),
 'tenantExists',exists(select 1 from public.tenants where id='${tenant}'),
 'emailAccounts',(select coalesce(jsonb_agg(x),'[]') from (select provider,status,auth_state,count(*) as accounts from public.email_accounts where tenant_id='${tenant}' group by provider,status,auth_state order by provider,status,auth_state)x),
 'workspaceConnections',(select coalesce(jsonb_agg(x),'[]') from (select status,count(*) as connections,max(last_verified_at) as latestVerification from public.google_workspace_connections where tenant_id='${tenant}' group by status order by status)x),
 'workspaceMailboxes',(select coalesce(jsonb_agg(x),'[]') from (select status,sync_enabled,mailbox_type,count(*) as mailboxes from public.google_workspace_mailboxes where tenant_id='${tenant}' group by status,sync_enabled,mailbox_type order by status,sync_enabled,mailbox_type)x),
 'recentEmailRuns',(select coalesce(jsonb_agg(x),'[]') from (select sync_type,status,count(*) as runs,max(started_at) as latestStarted,max(completed_at) as latestCompleted from public.email_sync_runs where tenant_id='${tenant}' and started_at>=now()-interval '7 days' group by sync_type,status order by sync_type,status)x),
 'emailJobs',(select coalesce(jsonb_agg(x),'[]') from (select job_type,status,count(*) as jobs from public.platform_jobs where tenant_id='${tenant}' and job_type like 'email.%' group by job_type,status order by job_type,status)x),
 'recentEmailFailureCodes',(select coalesce(jsonb_agg(x),'[]') from (
  select job_type,case when error_code ~ '^[a-z][a-z0-9_]{0,39}$' then error_code else 'unclassified' end as code,
   count(*) as jobs,max(updated_at) as latest_updated
  from public.platform_jobs where tenant_id='${tenant}' and job_type like 'email.%' and status in ('dead_letter','retrying') and updated_at>=now()-interval '24 hours'
  group by 1,2 order by 1,2)x),
 'workspaceAccountAuthority',(select coalesce(jsonb_agg(x),'[]') from (
  select matched_mailboxes,eligible_mailboxes,count(*) as accounts from (
   select a.id,count(m.id) as matched_mailboxes,
    count(m.id) filter(where m.sync_enabled and m.status in ('pending','active') and m.mailbox_type<>'suspended' and c.status='active' and c.last_verified_at is not null and lower(c.domain)=split_part(lower(a.email_address),'@',2)) as eligible_mailboxes
   from public.email_accounts a left join public.google_workspace_mailboxes m on m.tenant_id=a.tenant_id and lower(m.email_address)=lower(a.email_address)
   left join public.google_workspace_connections c on c.tenant_id=m.tenant_id and c.id=m.connection_id
   where a.tenant_id='${tenant}' and a.provider='gmail' and a.status in ('active_dwd','pending_tokenless_dwd') group by a.id
  ) account_matches group by matched_mailboxes,eligible_mailboxes order by matched_mailboxes,eligible_mailboxes)x),
 'captureAccountCoverage',(select coalesce(jsonb_agg(x),'[]') from (
  select sync_type,count(distinct coalesce(to_jsonb(r)->>'email_account_id',r.metadata->>'email_account_id')) as accounts_with_success,
   count(*) filter(where coalesce(to_jsonb(r)->>'email_account_id',r.metadata->>'email_account_id') is null) as runs_without_account_identity,
   sum(coalesce(r.records_processed,0)) as reported_processed_observations
  from public.email_sync_runs r where tenant_id='${tenant}' and sync_type in ('messages','workspace_messages','workspace_backfill') and status='success' and completed_at>=now()-interval '24 hours' group by sync_type order by sync_type)x),
 'sources',jsonb_build_object(
  'emails',(select count(*) from public.email_messages where tenant_id='${tenant}'),
  'calls',(select count(*) from public.phone_calls where tenant_id='${tenant}'),
  'recordings',(select count(*) from public.phone_recordings where tenant_id='${tenant}'),
  'customers',(select count(*) from public.customer_cards where tenant_id='${tenant}'),
  'jobs',(select count(*) from public.jobs where tenant_id='${tenant}')),
 'recordingStorage',(select jsonb_build_object(
  'objects',count(*),'knownSizeObjects',count(*) filter(where metadata->>'size' ~ '^[0-9]{1,18}$'),
  'knownBytes',coalesce(sum(case when metadata->>'size' ~ '^[0-9]{1,18}$' then (metadata->>'size')::numeric else null end),0),
  'objectsCreatedLast30Days',count(*) filter(where created_at>=now()-interval '30 days'),
  'knownBytesCreatedLast30Days',coalesce(sum(case when created_at>=now()-interval '30 days' and metadata->>'size' ~ '^[0-9]{1,18}$' then (metadata->>'size')::numeric else null end),0)
 ) from storage.objects where bucket_id='phone-recordings' and split_part(name,'/',1)='${tenant}')
) as observation`;
const results = await Promise.allSettled([
  read("/database/query/read-only", query),
  readTestCatalog({ allowProjectRef: TEST_PROJECT, token }),
]);
if (results.some((r) => r.status !== "fulfilled"))
  throw Error("Launch audit incomplete; no readiness conclusion");
const [rows, test] = results.map((r) => r.value);
const observation = rows?.[0]?.observation;
if (
  rows?.length !== 1 ||
  observation?.tenantExists !== true ||
  !Number.isFinite(Date.parse(observation.observedAt))
)
  throw Error("Production observation shape differs");
console.log(
  JSON.stringify(
    {
      contract: "learn-launch-baseline/1",
      production: { projectRef: production, ...observation },
      test: {
        projectRef: TEST_PROJECT,
        observedAt: test.inventory.observedAt,
        latestReleases: test.report.customMigrationEntries?.slice(-3) ?? null,
        microsoftTables: test.inventory.tables
          .filter((t) => t.name.startsWith("learn_microsoft_"))
          .map((t) => t.name),
        workers: test.functions
          .filter((f) => /learn|gmail|email|phone|simwood|platform-worker/.test(f.slug))
          .map((f) => ({ slug: f.slug, status: f.status, version: f.version })),
        requiredRpcs: test.report.rpcs,
      },
      limitations: [
        "Aggregate inventory only: not source preservation, provider completeness, capture health or signed-in acceptance.",
        "Storage metadata sizes are not byte checksums, playable audio or a backup.",
        "Recent object creation includes backfills and is not a prediction of ongoing growth.",
        "No writes, provider calls, audio downloads, new access grants or deployments.",
      ],
    },
    null,
    2,
  ),
);
