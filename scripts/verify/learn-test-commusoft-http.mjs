/** Exercise the installed TEST gateway/worker with an empty queue. No fixture,
 * provider credential, approval or schedule is created. Existing keys stay in memory. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readCommusoftCatalog } from "./learn-commusoft-catalog.mjs";
import { installedCommusoftWorker } from "./learn-test-commusoft-runtime.mjs";
import { commusoftFingerprint } from "./learn-test-commusoft-release.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

const tables = [
  "email_messages",
  "phone_calls",
  "phone_recordings",
  "phone_transcripts",
  "slack_messages",
  "slack_message_versions",
  "interactions",
  "people",
  "companies",
  "customer_cards",
  "sites",
  "jobs",
  "provider_connections",
  "tenant_connectors",
  "connector_accounts",
  "platform_jobs",
];
export const EMPTY_WORKER_SNAPSHOT = `select jsonb_build_object(
 'activeJobs',(select count(*) from public.platform_jobs where job_type='commusoft.source_sync' and status in ('queued','retrying','running')),
 'sources',(${tables
   .map(
     (t) =>
       `select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from public.${t} s`,
   )
   .map((s, i) => (i === 0 ? `select jsonb_agg(v order by name) from (${s}` : s))
   .join(" union all ")} ) v)
) as snapshot`;

export async function exerciseEmptyWorker({ snapshot, invoke, anon, service }) {
  const before = await snapshot();
  assert.equal(before.activeJobs, 0, "Empty Commusoft queue required before any worker request");
  const checks = [];
  async function expect(label, options, status, body) {
    const r = await invoke(options);
    assert.equal(r.status, status, `${label}: unexpected HTTP status`);
    if (body) assert.deepEqual(r.data, body, `${label}: unexpected response`);
    checks.push({ label, status: r.status });
  }
  const auth = (jwt) => ({ Authorization: `Bearer ${jwt}` }),
    trigger = { "x-serviceos-worker-key": service };
  await expect("Gateway rejects missing JWT", { headers: {} }, 401);
  await expect("Gateway requires JWT even with trigger key", { headers: trigger }, 401);
  await expect("Anonymous JWT cannot trigger worker", { headers: auth(anon) }, 403, {
    ok: false,
    code: "worker_forbidden",
  });
  await expect("Service JWT alone cannot trigger worker", { headers: auth(service) }, 403, {
    ok: false,
    code: "worker_forbidden",
  });
  await expect(
    "Incorrect trigger key refused",
    { headers: { ...auth(service), "x-serviceos-worker-key": "invalid-test-trigger-key" } },
    403,
    { ok: false, code: "worker_forbidden" },
  );
  await expect("GET refused", { method: "GET", headers: { ...auth(service), ...trigger } }, 405, {
    ok: false,
    code: "method_not_allowed",
  });
  await expect(
    "Caller job selectors refused",
    { headers: { ...auth(service), ...trigger }, body: '{"tenant_id":"synthetic-selector"}' },
    400,
    { ok: false, code: "worker_body_not_allowed" },
  );
  // Recheck immediately before the only request which can claim queued work.
  assert.deepEqual(await snapshot(), before, "Queue/source state changed before invocation");
  await expect("Authorised empty invocation", { headers: { ...auth(service), ...trigger } }, 200, {
    ok: true,
    result: { claimed: 0, outcomes: [] },
  });
  assert.deepEqual(
    await snapshot(),
    before,
    "Queue/source records changed during empty invocation",
  );
  return { checks, preExistingSourcesPreserved: true, activeJobs: 0 };
}

export async function acceptCommusoftHttp({ allowProjectRef, token, fetcher = fetch }) {
  assert.equal(allowProjectRef, TEST_PROJECT, "Explicit TEST project required");
  const args = { allowProjectRef, token, fetcher },
    before = await readCommusoftCatalog(args);
  assert.ok(installedCommusoftWorker(before), "Exact installed Commusoft worker/schema required");
  const management = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function request(url, options = {}) {
    return readAcceptanceResponse(
      await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(45000) }),
    );
  }
  const keys = await request(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    { headers: management },
  );
  assert.ok(keys.ok && Array.isArray(keys.data), "Existing TEST keys unavailable");
  function keyFor(role) {
    const rows = keys.data.filter((k) => k.name === role);
    assert.equal(rows.length, 1, "Unique existing TEST key required");
    const key = rows[0].api_key,
      claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    assert.ok(claims.ref === TEST_PROJECT && claims.role === role, "Existing key scope differs");
    return key;
  }
  const anon = keyFor("anon"),
    service = keyFor("service_role");
  const snapshot = async () => {
    const r = await request(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query/read-only`,
      {
        method: "POST",
        headers: management,
        body: JSON.stringify({ query: EMPTY_WORKER_SNAPSHOT }),
      },
    );
    assert.ok(r.ok && r.data?.length === 1 && r.data[0].snapshot, "TEST snapshot unavailable");
    return r.data[0].snapshot;
  };
  const result = await exerciseEmptyWorker({
    snapshot,
    anon,
    service,
    invoke: ({ method = "POST", headers, body }) =>
      request(`https://${TEST_PROJECT}.supabase.co/functions/v1/learn-commusoft-worker`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      }),
  });
  const after = await readCommusoftCatalog(args);
  assert.ok(
    installedCommusoftWorker(after) && commusoftFingerprint(after) === commusoftFingerprint(before),
    "Installed catalog changed during acceptance",
  );
  return {
    version: "learn-test-commusoft-http/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: "passed",
    ...result,
    catalogPreserved: true,
    limitations: [
      "Empty-queue runtime and gateway/trigger acceptance only; no queued page execution, provider request, real Commusoft access or signed-in owner JWT was tested.",
      "Source fingerprints cover the 16 named TEST tables; this is not production inventory or a database backup.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.slice(2).join(" "), "--accept --existing-cli-login");
    const r = await acceptCommusoftHttp({
      allowProjectRef: process.env.LEARN_TEST_ALLOW_PROJECT_REF,
      token: savedCliToken(),
    });
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    // Assertions may contain request objects or keys. Never print their values.
    console.error(
      JSON.stringify({
        state: "requires_inspection",
        error: "Commusoft HTTP acceptance did not complete",
        stage:
          e instanceof assert.AssertionError
            ? e.message.split("\n")[0]
            : "request_or_contract_failure",
      }),
    );
    process.exitCode = 1;
  }
}
