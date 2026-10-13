/** Connect the exact release journal to its scoped adapters. No network defaults,
 * approval creation, automatic rollback, retries or generic command execution.
 * Gate/frontend adapters must provide their own concrete acceptance evidence.
 */
import { createHash } from "node:crypto";
import { validateReleasePlan } from "./learn-production-release-journal.mjs";
const digest = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const check = (v, m) => {
  if (!v) throw Error(m);
};
const isHash = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
export function createProductionReleaseCoordinator({
  plan,
  operations,
  journal,
  sql,
  createConfiguration,
  createRuntime,
  configurationReceipts,
  checks,
  frontend,
  authorize,
}) {
  plan = validateReleasePlan(plan);
  operations = structuredClone(operations);
  check(
    operations.projectRef === plan.projectRef &&
      operations.planSha256 === digest(plan) &&
      JSON.stringify(plan.steps) ===
        JSON.stringify(
          operations.operations.map(({ id, kind, pinSha256 }) => ({ id, kind, pinSha256 })),
        ) &&
      operations.operations.every((o) => o.pinSha256 === digest(o.contract)),
    "Release operation contracts differ",
  );
  check(
    typeof journal?.next === "function" &&
      typeof journal?.status === "function" &&
      typeof authorize === "function" &&
      typeof configurationReceipts?.load === "function" &&
      typeof configurationReceipts?.save === "function",
    "Journal, authority and durable receipt store required",
  );
  let busy = false;
  const config = new Map();
  let runtime;
  const setupId = "matching-server-configuration";
  const exact = (step) => {
    const op = operations.operations.find((o) => o.id === step.id);
    check(
      op && op.kind === step.kind && op.pinSha256 === step.pinSha256,
      "Unreviewed coordinator operation",
    );
    return op;
  };
  const assertAdapter = (a) => {
    check(
      typeof a?.observe === "function" && typeof a?.apply === "function",
      "Release adapter unavailable",
    );
    return a;
  };
  async function configuration(step) {
    if (!config.has(step.id)) {
      check(typeof createConfiguration === "function", "Configuration adapter factory unavailable");
      config.set(step.id, assertAdapter(await createConfiguration(exact(step))));
    }
    return config.get(step.id);
  }
  async function persistedSetupReceipt() {
    const op = operations.operations.find((o) => o.id === setupId),
      r = await configurationReceipts.load(setupId);
    check(
      r &&
        r.projectRef === plan.projectRef &&
        r.candidateSha256 === plan.candidateSha256 &&
        r.stepId === setupId &&
        r.stepPinSha256 === op?.pinSha256,
      "Verified configuration receipt required before runtime",
    );
    return r;
  }
  async function adapter(step) {
    exact(step);
    if (step.kind === "check") return assertAdapter(checks?.[step.id]);
    if (step.kind === "frontend") return assertAdapter(frontend);
    if (["database", "schedule"].includes(step.kind)) return assertAdapter(sql);
    if (step.kind === "configuration") return configuration(step);
    if (step.kind === "runtime") {
      if (!runtime) {
        check(typeof createRuntime === "function", "Runtime adapter factory unavailable");
        runtime = assertAdapter(await createRuntime(await persistedSetupReceipt()));
      }
      return runtime;
    }
    throw Error("Unsupported release operation");
  }
  async function observe(step, phase) {
    const port = await adapter(step),
      result = await port.observe(step, phase);
    if (step.kind === "configuration" && result.state === "applied") {
      check(typeof port.receipt === "function", "Verified configuration readback unavailable");
      const receipt = await port.receipt(step);
      check(
        receipt?.projectRef === plan.projectRef &&
          receipt.candidateSha256 === plan.candidateSha256 &&
          receipt.stepId === step.id &&
          receipt.stepPinSha256 === step.pinSha256 &&
          digest({ secrets: receipt.secretDigests, functions: receipt.after }) ===
            result.evidenceSha256,
        "Configuration receipt scope differs",
      );
      // Commit the exact readback before the journal accepts this step. A failed
      // save leaves the journal uncertain; no upload can start without this proof.
      await configurationReceipts.save(step.id, receipt);
    }
    return result;
  }
  return {
    status() {
      const status = journal.status();
      check(status.planSha256 === digest(plan), "Journal plan changed");
      return {
        ...status,
        nextStep: plan.steps[status.completed]?.id ?? null,
        deployed: status.state === "sequence_verified",
        goalComplete: false,
      };
    },
    async next() {
      check(!busy, "Release coordinator is already advancing");
      busy = true;
      try {
        const status = journal.status();
        check(status.planSha256 === digest(plan), "Journal plan changed");
        const step = plan.steps[status.completed];
        if (!step) return status;
        // Resolve the selected adapter before journal intent. Missing external
        // gates cannot become an uncertain mutation or an implicit success.
        await adapter(step);
        return await journal.next({
          observe,
          authorize: async (s, planSha256) => {
            const approval = await authorize(exact(s), {
              planSha256,
              candidateSha256: plan.candidateSha256,
            });
            check(
              approval?.projectRef === plan.projectRef &&
                approval.stepPinSha256 === s.pinSha256 &&
                isHash(approval.approvalEvidenceSha256),
              "Current release authority and gates required",
            );
            return approval.approvalEvidenceSha256;
          },
          apply: async (s) => (await adapter(s)).apply(s),
        });
      } finally {
        busy = false;
      }
    },
  };
}
