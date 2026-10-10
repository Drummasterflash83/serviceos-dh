/** Additive operator controls in the explicitly named TEST project only. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  readOperatorInputsCatalog,
  OPERATOR_INPUT_FUNCTIONS,
  OPERATOR_INPUT_TABLES,
} from "./learn-operator-inputs-catalog.mjs";
import { installedCommusoftWorker } from "./learn-test-commusoft-runtime.mjs";
import { commusoftFingerprint } from "./learn-test-commusoft-release.mjs";
import { compactImportTable } from "./learn-test-import-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
export const OPERATOR_INPUT_RELEASE = "learn_operator_inputs_v1";
export const OPERATOR_INPUT_SHA =
  "f8954339b1c5e9d86391160882f6d30081bcf53b1247e6e05d3a79866e3ed6d2";
const HASHES = {
  manifest: "eeef30f0829d5abec95d96ac05aa37703a4d5fe3b5f7ab840589a846ee3954ae",
  prerequisites: "47d0e429789f45d8927896d4b33432e14900fd8f42ffc956194e95d5d620f8a0",
  expected: "73dc98dfcde22765dc51716863b11538c8b90e30a7222e718d72c3ed8b18155e",
};
const MARKER = "learn-test-operator-inputs/1";
function checked(name, hash) {
  const raw = readFileSync(
    new URL("../../supabase/release/learn-test/027_operator_inputs." + name, import.meta.url),
  );
  if (createHash("sha256").update(raw).digest("hex") !== hash)
    throw Error("Reviewed operator input package differs");
  return raw.toString();
}
export const operatorInputPrior = () =>
  JSON.parse(checked("prerequisites.json", HASHES.prerequisites));
export const expectedOperatorInputs = () => JSON.parse(checked("expected.json", HASHES.expected));
export const operatorInputFingerprint = (c) =>
  digest({
    prior: commusoftFingerprint(c),
    functions: c.operatorInputFunctions,
    grants: c.operatorInputGrants,
    authority: c.operatorInputAuthority,
  });
export function operatorInputPrerequisites(c) {
  const p = operatorInputPrior();
  return (
    installedCommusoftWorker(c) &&
    !c.tables.some((t) => OPERATOR_INPUT_TABLES.includes(t.name)) &&
    digest(c.operatorInputFunctions) === digest(p.functions) &&
    digest(c.operatorInputGrants) === digest(p.grants) &&
    digest(c.operatorInputAuthority) === digest(p.authority)
  );
}
export function withoutOperatorInputs(c) {
  const prior = structuredClone(c);
  prior.operatorInputFunctions = prior.operatorInputFunctions.filter(
    (f) => !OPERATOR_INPUT_FUNCTIONS.includes(f.name),
  );
  prior.operatorInputGrants = prior.operatorInputGrants.filter(
    (g) => !OPERATOR_INPUT_TABLES.includes(g.table),
  );
  prior.operatorInputAuthority.permissions = [];
  prior.actionRegistries.permissions = prior.actionRegistries.permissions.filter(
    (p) => !["platform.controlplane.view", "platform.controlplane.admin"].includes(p.permission),
  );
  prior.tables = prior.tables.filter((t) => !OPERATOR_INPUT_TABLES.includes(t.name));
  prior.base.inventory.tables = prior.base.inventory.tables.filter(
    (t) => t.schema !== "public" || !OPERATOR_INPUT_TABLES.includes(t.name),
  );
  prior.base.inventory.functions = prior.base.inventory.functions.filter(
    (f) => !OPERATOR_INPUT_FUNCTIONS.includes(f.name),
  );
  for (const report of [prior.readiness, prior.base.report])
    report.customMigrationEntries = report.customMigrationEntries.filter(
      (e) => e.migration_name !== OPERATOR_INPUT_RELEASE,
    );
  prior.readinessCatalogSha256 = catalogFingerprint(prior.base);
  return prior;
}
export function installedOperatorInputs(c) {
  const e = expectedOperatorInputs(),
    entries = c.readiness?.customMigrationEntries;
  if (
    !Array.isArray(entries) ||
    entries.length !== 28 ||
    entries.filter(
      (r) =>
        r.migration_name === OPERATOR_INPUT_RELEASE &&
        r.source_sha256 === OPERATOR_INPUT_SHA &&
        r.project_ref === TEST_PROJECT,
    ).length !== 1 ||
    digest(c.operatorInputFunctions.filter((f) => OPERATOR_INPUT_FUNCTIONS.includes(f.name))) !==
      digest(e.functions) ||
    digest(c.tables.filter((t) => OPERATOR_INPUT_TABLES.includes(t.name))) !== digest(e.tables) ||
    digest(c.operatorInputGrants.filter((g) => OPERATOR_INPUT_TABLES.includes(g.table))) !==
      digest(e.grants) ||
    digest(c.operatorInputAuthority.permissions) !== digest(e.permissions) ||
    digest(
      c.actionRegistries.permissions.filter((p) =>
        ["platform.controlplane.view", "platform.controlplane.admin"].includes(p.permission),
      ),
    ) !== digest(e.permissions)
  )
    return false;
  const compact = e.functions.map(
    ({ name, arguments: args, securityDefiner, authenticatedExecute, anonExecute }) => ({
      name,
      arguments: args,
      securityDefiner,
      authenticatedExecute,
      anonExecute,
    }),
  );
  if (
    digest(c.base.inventory.functions.filter((f) => OPERATOR_INPUT_FUNCTIONS.includes(f.name))) !==
      digest(compact) ||
    digest(
      c.base.inventory.tables.filter(
        (t) => t.schema === "public" && OPERATOR_INPUT_TABLES.includes(t.name),
      ),
    ) !== digest(e.tables.map(compactImportTable))
  )
    return false;
  return operatorInputPrerequisites(withoutOperatorInputs(c));
}
export function operatorInputSql(rehearse) {
  expectedOperatorInputs();
  const manifest = JSON.parse(checked("manifest.json", HASHES.manifest));
  for (const source of manifest.sources) {
    const raw = readFileSync(new URL("../../" + source.path, import.meta.url));
    if (createHash("sha256").update(raw).digest("hex") !== source.sha256)
      throw Error("Operator input source changed since packaging");
  }
  let sql = checked("sql", OPERATOR_INPUT_SHA);
  if (sql.split("\nbegin;\n").length !== 2 || sql.split("\ncommit;\n").length !== 2)
    throw Error("Operator input transaction framing differs");
  sql = sql.replace(
    "\nbegin;\n",
    `\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${OPERATOR_INPUT_SHA}';\n`,
  );
  if (rehearse) sql = sql.replace("\ncommit;\n", "\nrollback;\n");
  return (
    sql +
    `select '${MARKER}' as marker,${rehearse ? "not " : ""}exists(select 1 from of_test_deploy.migrations where migration_name='${OPERATOR_INPUT_RELEASE}' and source_sha256='${OPERATOR_INPUT_SHA}') as receipt_expected;`
  );
}
export async function releaseOperatorInputs({
  allowProjectRef,
  token,
  rehearse,
  rehearsal,
  fetcher = fetch,
  clock = Date.now,
}) {
  const args = { allowProjectRef, token, fetcher },
    before = await readOperatorInputsCatalog(args);
  if (installedOperatorInputs(before)) return { state: "already_installed", writeAttempted: false };
  if (!operatorInputPrerequisites(before))
    throw Error("Exact prior TEST worker/schema and absent operator objects required");
  if (!rehearse) {
    const at = Date.parse(rehearsal?.observedAt),
      now = clock();
    if (
      rehearsal?.version !== MARKER ||
      rehearsal.projectRef !== TEST_PROJECT ||
      rehearsal.sourceSha256 !== OPERATOR_INPUT_SHA ||
      rehearsal.state !== "rehearsed_and_rolled_back" ||
      rehearsal.acknowledged !== true ||
      rehearsal.beforeFingerprint !== rehearsal.afterFingerprint ||
      rehearsal.afterFingerprint !== operatorInputFingerprint(before) ||
      !Number.isFinite(at) ||
      !Number.isFinite(now) ||
      at > now ||
      now - at > 3600000
    )
      throw Error("Fresh matching operator input rollback rehearsal required");
  }
  let acknowledged = false;
  try {
    const r = await communicationQuery(token, operatorInputSql(rehearse), {
      fetcher,
      readOnly: false,
    });
    acknowledged = r?.length === 1 && r[0].marker === MARKER && r[0].receipt_expected === true;
  } catch {
    /* Inspect uncertain outcomes without resubmission. */
  }
  let after = null;
  try {
    after = await readOperatorInputsCatalog(args);
  } catch {}
  const verified =
    after &&
    (rehearse
      ? operatorInputPrerequisites(after) &&
        operatorInputFingerprint(after) === operatorInputFingerprint(before)
      : installedOperatorInputs(after) &&
        operatorInputFingerprint(withoutOperatorInputs(after)) ===
          operatorInputFingerprint(before));
  return {
    version: MARKER,
    projectRef: TEST_PROJECT,
    sourceSha256: OPERATOR_INPUT_SHA,
    observedAt: new Date(clock()).toISOString(),
    writeAttempted: true,
    acknowledged,
    state:
      acknowledged && verified
        ? rehearse
          ? "rehearsed_and_rolled_back"
          : "installed_needs_authenticated_acceptance"
        : "requires_inspection",
    beforeFingerprint: operatorInputFingerprint(before),
    afterFingerprint: after ? operatorInputFingerprint(after) : null,
    scope:
      "Operator grant schema, permission vocabulary and private input controls. No operator grants, module changes, credentials, connections, approvals, jobs, endpoints, schedules or production changes.",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const a = process.argv.slice(2),
      rehearse = a.join(" ") === "--rehearse --existing-cli-login";
    if (
      (!rehearse &&
        (a.length !== 4 ||
          a[0] !== "--apply" ||
          a[1] !== "--existing-cli-login" ||
          a[2] !== "--rehearsal-report")) ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST operator release required");
    const r = await releaseOperatorInputs({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
      rehearse,
      rehearsal: rehearse ? null : JSON.parse(readFileSync(a[3])),
    });
    console.log(JSON.stringify(r, null, 2));
    if (r.state === "requires_inspection") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
