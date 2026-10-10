/** Read-only TEST integration reference. No worker invocation, data rows or credentials.
 * This inventory is not a release approval or a restorable database backup.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { TEST_PROJECT, TEST_ORGANIZATION } from "./learn-test-readiness.mjs";
import { FOUNDATION_CATALOG_QUERY } from "./learn-foundation-catalog.mjs";

export const CAPTURE_RUNTIME_FUNCTIONS = [
  "email_ingestion_account_guard_v2",
  "email_ingestion_run_guard_v2",
  "email_ingestion_checkpoint_json_v2",
  "email_ingestion_count_v2",
  "email_ingestion_evidence_v2",
  "email_ingestion_keys_v2",
  "email_ingestion_payload_v2",
  "email_ingestion_recovery_v2",
  "email_ingestion_transition_result_v2",
  "email_ingestion_transition_v2",
  "platform_jobs_complete_email_v1",
  "platform_jobs_claim",
  "learn_slack_claim_jobs",
  "phone_retry_state",
  "phone_pending_readiness",
  "phone_select_pending",
];
export const CAPTURE_RUNTIME_WORKERS = [
  "gmail-sync-messages",
  "gmail-workspace-sync-messages",
  "gmail-workspace-backfill-messages",
  "google-workspace-discover-mailboxes",
  "email-scheduled-sync",
  "email-workspace-scheduled-sync",
  "email-workspace-backfill-scheduled-sync",
  "platform-worker",
  "phone-scheduled-sync",
  "phone-process-pipeline",
  "simwood-sync-calls",
  "simwood-sync-recordings",
  "simwood-download-recording",
  "learn-slack-worker",
];
const tables = [
  "email_accounts",
  "email_sync_runs",
  "email_ingestion_checkpoints",
  "email_ingestion_transitions",
];
const sha = (v) => createHash("sha256").update(v).digest("hex");
export const CAPTURE_RUNTIME_QUERY = `select jsonb_build_object(
 'observedAt',clock_timestamp(),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
  'arguments',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),
  'owner',r.rolname,'securityDefiner',p.prosecdef,'settings',p.proconfig,
  'grants',(select coalesce(jsonb_agg(jsonb_build_object('role',case when g.grantee=0 then 'public' else pg_get_userbyid(g.grantee) end,'privilege',g.privilege_type,'grantable',g.is_grantable) order by g.grantee,g.privilege_type),'[]') from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))g)) order by p.proname,p.oid),'[]')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
  where n.nspname='public' and p.proname in (${CAPTURE_RUNTIME_FUNCTIONS.map((n) => `'${n}'`).join(",")})),
 'phoneView',(select jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid,true),'owner',pg_get_userbyid(c.relowner),'options',c.reloptions)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state' and c.relkind='v'),
 'protocolRole',(select jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,'bypassRls',rolbypassrls,'createRole',rolcreaterole,'createDb',rolcreatedb) from pg_roles where rolname='email_ingestion_protocol_owner'),
 'protocolGrants',(select coalesce(jsonb_agg(x order by x::text),'[]') from (
  select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',null,'privilege',g.privilege_type,'grantable',g.is_grantable) x from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(c.relacl)g join pg_roles r on r.oid=g.grantee where r.rolname='email_ingestion_protocol_owner'
  union all select jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'privilege',g.privilege_type,'grantable',g.is_grantable) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid cross join lateral aclexplode(a.attacl)g join pg_roles r on r.oid=g.grantee where r.rolname='email_ingestion_protocol_owner'
 )g)
) as runtime`;

export async function readCaptureRuntimeAudit({ allowProjectRef, token, fetcher = fetch }) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    typeof token !== "string" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token)
  )
    throw Error("Explicit TEST allowlist and existing login required");
  async function read(path, query) {
    let response;
    try {
      response = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}${path}`, {
        method: query ? "POST" : "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(query ? { body: JSON.stringify({ query }) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw Error();
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 8388608) throw Error();
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw Error(
        `TEST runtime metadata unavailable${response ? ` (HTTP ${response.status})` : ""}; response withheld`,
      );
    }
  }
  const project = await read("");
  if (
    project.id !== TEST_PROJECT ||
    project.organization_id !== TEST_ORGANIZATION ||
    project.status !== "ACTIVE_HEALTHY"
  )
    throw Error("TEST identity or health differs");
  const results = await Promise.allSettled([
    read("/database/query/read-only", CAPTURE_RUNTIME_QUERY),
    read("/database/query/read-only", FOUNDATION_CATALOG_QUERY),
    read("/functions"),
  ]);
  if (results.some((r) => r.status !== "fulfilled"))
    throw Error("TEST runtime inventory incomplete; no release conclusion");
  const [rr, fr, workers] = results.map((r) => r.value),
    runtime = rr?.[0]?.runtime,
    foundation = fr?.[0]?.catalog;
  if (
    rr?.length !== 1 ||
    fr?.length !== 1 ||
    !Array.isArray(runtime?.functions) ||
    !Array.isArray(foundation?.tables) ||
    !Array.isArray(workers) ||
    !Number.isFinite(Date.parse(runtime.observedAt)) ||
    workers.some(
      (w) =>
        typeof w.slug !== "string" ||
        typeof w.status !== "string" ||
        !Number.isSafeInteger(w.version),
    )
  )
    throw Error("TEST runtime metadata shape differs");
  const snapshot = {
    version: "learn-capture-runtime-reference/1",
    projectRef: TEST_PROJECT,
    ...runtime,
    tables: foundation.tables.filter((t) => tables.includes(t.name)),
    workers: workers.map((w) => ({
      slug: w.slug,
      version: w.version,
      status: w.status,
      verifyJwt: w.verify_jwt ?? null,
    })),
  };
  if (snapshot.tables.length !== tables.length)
    throw Error("Email protocol table inventory incomplete");
  const functionNames = new Set(runtime.functions.map((f) => f.name));
  const missingWorkers = CAPTURE_RUNTIME_WORKERS.filter(
    (n) => !snapshot.workers.some((w) => w.slug === n && w.status === "ACTIVE"),
  );
  const missingFunctions = CAPTURE_RUNTIME_FUNCTIONS.filter((n) => !functionNames.has(n));
  const localEmailSources = [
    "gmail-sync-messages",
    "gmail-workspace-sync-messages",
    "gmail-workspace-backfill-messages",
  ].map((name) => {
    const source = readFileSync(
      new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url),
      "utf8",
    );
    return {
      name,
      sha256: sha(source),
      callsTransitionV2: source.includes("email_ingestion_transition_v2"),
    };
  });
  return {
    snapshot,
    report: {
      version: "learn-capture-runtime-audit/1",
      projectRef: TEST_PROJECT,
      observedAt: runtime.observedAt,
      state: "not_release_verified",
      missingWorkers,
      missingFunctions,
      phoneViewPresent: runtime.phoneView !== null,
      emailProtocolPresent: [
        "email_ingestion_transition_v2",
        "email_ingestion_transition_result_v2",
        "email_ingestion_account_guard_v2",
        "email_ingestion_run_guard_v2",
      ].every((n) => functionNames.has(n)),
      localEmailSources,
      functionReferences: runtime.functions.map((f) => ({
        name: f.name,
        arguments: f.arguments,
        sha256: sha(f.definition),
      })),
      limitations: [
        "Metadata inventory only; installed worker bodies and schedules are not validated.",
        "Local source markers do not establish protocol compatibility or absence of indirect calls.",
        "This reference contains no source records and is not a full database backup or deployment migration.",
        "No capture, provider requests, credentials, grants or hosted data were changed.",
      ],
    },
  };
}
