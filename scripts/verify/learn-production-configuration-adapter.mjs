/** Exact production configuration steps. Secret values are supplied just in time;
 * plans, observations and receipts contain only names/digests. No retry or delete.
 * Supabase secrets are project-wide, including the two dispatch callers.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const project = "tgbnakbxwcqjeimygroz";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const digest = (x) => sha(JSON.stringify(x));
const check = (v, m) => {
  if (!v) throw Error(m);
};
const hash = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const names = ["LEARN_COMMUSOFT_WORKER_KEY", "LEARN_SLACK_WORKER_KEY"];
export const configurationRuntimeMetadata = (f) => ({
  name: f.slug,
  id: f.id,
  version: f.version,
  hash: f.ezbr_sha256,
  jwt: f.verify_jwt,
  status: f.status,
});
const sort = (rows) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
export function configurationSecretMetadata(rows) {
  check(Array.isArray(rows), "Secret metadata unavailable");
  const out = rows.map((r) => ({ name: r.name, digest: r.digest ?? r.value }));
  check(
    out.every((r) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.name) && hash(r.digest)) &&
      new Set(out.map((r) => r.name)).size === out.length,
    "Secret metadata format differs",
  );
  return sort(out);
}
export function configurationRuntimeRefresh(before, after) {
  return (
    Array.isArray(before) &&
    Array.isArray(after) &&
    before.length === after.length &&
    new Set(before.map((r) => r.name)).size === before.length &&
    new Set(after.map((r) => r.name)).size === after.length &&
    before.every((b) => {
      const a = after.find((r) => r.name === b.name);
      return (
        a &&
        ["name", "id", "hash", "jwt", "status"].every((k) => a[k] === b[k]) &&
        Number.isSafeInteger(b.version) &&
        [b.version, b.version + 1].includes(a.version)
      );
    })
  );
}
export function createProductionConfigurationAdapter({
  candidate,
  operations,
  baseline,
  desiredSecretDigests,
  api,
  readSecret,
  allowWrite = false,
  assertApprovedRelease,
}) {
  candidate = structuredClone(candidate);
  operations = structuredClone(operations);
  baseline = structuredClone(baseline);
  desiredSecretDigests = structuredClone(desiredSecretDigests);
  check(
    candidate.projectRef === project &&
      candidate.database.length === 23 &&
      candidate.endpoints.length === 37 &&
      operations.projectRef === project &&
      typeof api === "function",
    "Reviewed production configuration required",
  );
  const selected = operations.operations.filter((o) => o.kind === "configuration");
  check(
    selected.length === 2 && selected.every((o) => o.pinSha256 === digest(o.contract)),
    "Configuration operation pins differ",
  );
  const setup = selected.find((o) => o.id === "matching-server-configuration"),
    activate = selected.find((o) => o.id === "activate-reviewed-input-dispatch");
  check(
    setup?.contract.captureActivation === false &&
      JSON.stringify(setup.contract.requiredNewSecretNames) === JSON.stringify(names) &&
      JSON.stringify(setup.contract.nonSecret) ===
        JSON.stringify({
          "learn-launch-status": { LEARN_STATUS_READ_MODE: "production_metadata_views" },
          "platform-worker": { LEARN_INPUT_DISPATCH_ENABLED: "false" },
        }) &&
      JSON.stringify(activate?.contract.nonSecret) ===
        JSON.stringify({ "platform-worker": { LEARN_INPUT_DISPATCH_ENABLED: "true" } }) &&
      activate.contract.createsImportApprovals === false &&
      activate.contract.createsRecurringChannelApprovals === false,
    "Configuration scope differs",
  );
  check(
    hash(candidate.manifestSha256) &&
      baseline.projectRef === project &&
      baseline.candidateSha256 === candidate.manifestSha256 &&
      selected.some((o) => o.id === baseline.stepId && o.pinSha256 === baseline.stepPinSha256),
    "Configuration baseline binding differs",
  );
  const op = selected.find((o) => o.id === baseline.stepId),
    activating = op.id === activate.id;
  const beforeSecrets = configurationSecretMetadata(baseline.secrets),
    beforeRuntime = sort(baseline.functions);
  check(
    beforeRuntime.length > 0 &&
      beforeRuntime.every((r) => r.status === "ACTIVE" && hash(r.hash)) &&
      new Set(beforeRuntime.map((r) => r.name)).size === beforeRuntime.length,
    "Complete runtime baseline required",
  );
  const original = sort([
    ...candidate.endpoints.flatMap((e) => (e.beforeProduction ? [e.beforeProduction] : [])),
    ...candidate.productionEndpointsOutsideCandidate,
  ]);
  if (!activating)
    check(
      digest(beforeRuntime) === digest(original),
      "Setup runtime baseline differs from candidate",
    );
  else {
    const targetNames = new Set(candidate.endpoints.map((e) => e.name));
    check(
      beforeRuntime.length ===
        candidate.endpoints.length + candidate.productionEndpointsOutsideCandidate.length &&
        candidate.endpoints.every((e) => {
          const r = beforeRuntime.find((r) => r.name === e.name),
            runtime = operations.operations.find((o) => o.id === "runtime-" + e.name);
          return (
            r &&
            r.hash === runtime?.contract.ezbrSha256 &&
            r.jwt === e.verifyJwt &&
            (e.beforeProduction
              ? r.id === e.beforeProduction.id &&
                [e.beforeProduction.version + 1, e.beforeProduction.version + 2].includes(r.version)
              : r.version === 1)
          );
        }) &&
        configurationRuntimeRefresh(
          candidate.productionEndpointsOutsideCandidate,
          beforeRuntime.filter((r) => !targetNames.has(r.name)),
        ),
      "Activation requires the matched runtime publication",
    );
  }
  check(
    Object.keys(desiredSecretDigests).length === 2 &&
      names.every((n) => hash(desiredSecretDigests[n])),
    "Exact secure trigger bindings required",
  );
  const desired = new Map(beforeSecrets.map((r) => [r.name, r.digest]));
  for (const n of names) {
    check(
      !desired.has(n) || desired.get(n) === desiredSecretDigests[n],
      "Existing trigger binding differs",
    );
    if (activating)
      check(
        desired.get(n) === desiredSecretDigests[n],
        "Activation requires prepared trigger bindings",
      );
    desired.set(n, desiredSecretDigests[n]);
  }
  const plain = activating
    ? { LEARN_INPUT_DISPATCH_ENABLED: "true" }
    : {
        LEARN_STATUS_READ_MODE: "production_metadata_views",
        LEARN_INPUT_DISPATCH_ENABLED: "false",
      };
  if (activating)
    check(
      desired.get("LEARN_INPUT_DISPATCH_ENABLED") === sha("false") &&
        desired.get("LEARN_STATUS_READ_MODE") === sha("production_metadata_views"),
      "Dispatch must be staged off",
    );
  for (const [name, value] of Object.entries(plain)) desired.set(name, sha(value));
  const afterSecrets = sort([...desired].map(([name, digest]) => ({ name, digest })));
  const writes = afterSecrets.filter(
    (r) => beforeSecrets.find((b) => b.name === r.name)?.digest !== r.digest,
  );
  function operation(step) {
    check(
      step.id === op.id && step.kind === "configuration" && step.pinSha256 === op.pinSha256,
      "Configuration step pin differs",
    );
  }
  async function readState(step) {
    operation(step);
    const secrets = configurationSecretMetadata(
      await api({ method: "GET", path: `/v1/projects/${project}/secrets` }),
    );
    const functions = sort(
      (await api({ method: "GET", path: `/v1/projects/${project}/functions` })).map(
        configurationRuntimeMetadata,
      ),
    );
    const original =
      digest(secrets) === digest(beforeSecrets) && digest(functions) === digest(beforeRuntime);
    const applied =
      digest(secrets) === digest(afterSecrets) &&
      configurationRuntimeRefresh(beforeRuntime, functions);
    return {
      state: applied ? "applied" : original ? "ready" : "drift",
      evidenceSha256: digest({ secrets, functions }),
      receipt: applied
        ? {
            projectRef: project,
            stepId: op.id,
            stepPinSha256: op.pinSha256,
            candidateSha256: candidate.manifestSha256,
            secretDigests: secrets,
            before: beforeRuntime,
            after: functions,
          }
        : null,
    };
  }
  async function observe(step) {
    const { state, evidenceSha256 } = await readState(step);
    return { state, evidenceSha256 };
  }
  return {
    observe,
    async receipt(step) {
      const r = await readState(step);
      check(r.state === "applied", "Configuration is not verified");
      return r.receipt;
    },
    async inspect() {
      const r = await observe({ id: op.id, kind: op.kind, pinSha256: op.pinSha256 });
      return {
        projectRef: project,
        state: r.state,
        changedNames: writes.map((r) => r.name),
        runtimeCount: beforeRuntime.length,
        productionChanges: 0,
        secretValuesIncluded: false,
        executionReady: false,
      };
    },
    async apply(step) {
      check(
        allowWrite && typeof assertApprovedRelease === "function",
        "Production configuration adapter is read-only",
      );
      operation(step);
      const authority = await assertApprovedRelease(step);
      check(
        authority?.projectRef === project &&
          authority.stepPinSha256 === step.pinSha256 &&
          hash(authority.approvalEvidenceSha256),
        "Current scoped release authorization required",
      );
      check((await observe(step)).state === "ready", "Configuration precondition changed");
      const values = [];
      for (const row of writes) {
        let value = plain[row.name];
        if (value === undefined) {
          check(typeof readSecret === "function", "Secure trigger source required");
          value = await readSecret(row.name);
        }
        check(
          typeof value === "string" &&
            value.length > 0 &&
            !/[\r\n]/.test(value) &&
            sha(value) === row.digest,
          "Secure binding differs",
        );
        values.push({ name: row.name, value });
      }
      // Exactly one POST. Lost response remains uncertain in the outer journal;
      // readback can reconcile full application but never retries partial changes.
      try {
        await api({ method: "POST", path: `/v1/projects/${project}/secrets`, json: values });
      } finally {
        for (const row of values) row.value = "";
      }
    },
  };
}
export function productionConfigurationTransport(
  token,
  { fetcher = fetch, allowWrite = false, allowedDigests = {} } = {},
) {
  check(typeof token === "string" && token.length > 20, "Existing management login required");
  const allowed = new Map(Object.entries(allowedDigests));
  return async (r) => {
    const base = `/v1/projects/${project}`,
      read = r.method === "GET" && [base + "/secrets", base + "/functions"].includes(r.path);
    const write =
      allowWrite &&
      r.method === "POST" &&
      r.path === base + "/secrets" &&
      Array.isArray(r.json) &&
      r.json.length > 0 &&
      r.json.length <= 4 &&
      new Set(r.json.map((x) => x.name)).size === r.json.length &&
      r.json.every(
        (x) =>
          [...names, "LEARN_STATUS_READ_MODE", "LEARN_INPUT_DISPATCH_ENABLED"].includes(x.name) &&
          Object.keys(x).sort().join(",") === "name,value" &&
          typeof x.value === "string" &&
          allowed.get(x.name) === sha(x.value),
      );
    check(read || write, "Configuration request outside reviewed scope");
    let response;
    try {
      response = await fetcher("https://api.supabase.com" + r.path, {
        method: r.method,
        redirect: "error",
        signal: AbortSignal.timeout(45000),
        headers: {
          Authorization: "Bearer " + token,
          ...(write ? { "Content-Type": "application/json" } : {}),
        },
        ...(write ? { body: JSON.stringify(r.json) } : {}),
      });
    } catch {
      throw Error("Configuration transport outcome unconfirmed");
    }
    check(
      response.status === (write ? 201 : 200),
      "Configuration response unconfirmed (" + response.status + ")",
    );
    // Secret creation returns an empty object. Do not retain or expose its body.
    if (write) return { submitted: true };
    return response.json();
  };
}
export function loadConfigurationAdapter(api, options) {
  const root = "supabase/release/learn-production/",
    bytes = readFileSync(root + "runtime-candidate.manifest.json");
  const plan = JSON.parse(readFileSync(root + "release-sequence.plan.json")),
    operations = JSON.parse(readFileSync(root + "release-operations.manifest.json"));
  check(
    plan.candidateSha256 === sha(bytes) &&
      operations.planSha256 === digest(plan) &&
      JSON.stringify(plan.steps) ===
        JSON.stringify(
          operations.operations.map(({ id, kind, pinSha256 }) => ({ id, kind, pinSha256 })),
        ),
    "Release plan binding differs",
  );
  return createProductionConfigurationAdapter({
    candidate: { ...JSON.parse(bytes), manifestSha256: sha(bytes) },
    operations,
    api,
    ...options,
  });
}
