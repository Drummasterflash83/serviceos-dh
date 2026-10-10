/** Reuse the existing TEST service credential for an explicit worker trigger.
 * Secret values travel only in process memory and CLI stdin. No files/logs/args.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { readCommusoftCatalog } from "./learn-commusoft-catalog.mjs";
import { installedCommusoft, commusoftFingerprint } from "./learn-test-commusoft-release.mjs";
import { catalogFingerprint } from "./learn-test-launch-rehearsal.mjs";
import { digest } from "./learn-test-foundation-release.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
export const COMMUSOFT_TRIGGER_NAME = "LEARN_COMMUSOFT_WORKER_KEY";
export function secretMetadata(output) {
  let rows;
  try {
    rows = JSON.parse(output);
  } catch {
    if (!/NAME\s*\|\s*DIGEST/.test(output)) throw Error("Secret inventory format differs");
    rows = output
      .split("\n")
      .filter(
        (line) =>
          line.includes("|") && !/NAME\s*\|\s*DIGEST/.test(line) && !/^[-+|\s]+$/.test(line),
      )
      .map((line) => {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\|\s*([a-f0-9]{64})\s*$/.exec(line);
        if (!match) throw Error("Secret inventory row differs");
        return { name: match[1], digest: match[2] };
      });
  }
  if (
    !Array.isArray(rows) ||
    rows.some(
      (s) =>
        typeof s.name !== "string" ||
        ![s.digest, s.value].some((v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v)),
    )
  )
    throw Error("Secret inventory incomplete");
  return rows;
}
export function exactRuntimeRefresh(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length)
    return false;
  const rest = ({ version, ...value }) => value;
  return before.every((b) => {
    const matches = after.filter((a) => a.id === b.id);
    return (
      matches.length === 1 &&
      matches[0].version === b.version + 1 &&
      digest(rest(matches[0])) === digest(rest(b))
    );
  });
}
export async function bindCommusoftTrigger({
  allowProjectRef,
  token,
  fetcher = fetch,
  runCli = spawnSync,
}) {
  const args = { allowProjectRef, token, fetcher },
    before = await readCommusoftCatalog(args);
  if (!installedCommusoft(before)) throw Error("Exact pre-trigger Commusoft TEST release required");
  const r = await fetcher(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok) throw Error("Existing TEST credential unavailable");
  const keys = (await r.json()).filter((k) => k.name === "service_role");
  if (keys.length !== 1) throw Error("Unique TEST credential required");
  const key = keys[0].api_key,
    claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
  if (claims.ref !== TEST_PROJECT || claims.role !== "service_role" || /[\r\n]/.test(key))
    throw Error("Credential scope differs");
  const env = { ...process.env, SUPABASE_ACCESS_TOKEN: token };
  function matches() {
    const r = runCli(cli, ["secrets", "list", "--project-ref", TEST_PROJECT, "--output", "json"], {
      env,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1048576,
    });
    if (r.status !== 0) throw Error("Secret metadata unavailable");
    const found = secretMetadata(r.stdout).filter((s) => s.name === COMMUSOFT_TRIGGER_NAME),
      hash = createHash("sha256").update(key).digest("hex");
    if (found.length && !(found.length === 1 && [found[0].digest, found[0].value].includes(hash)))
      throw Error("Existing trigger binding differs");
    return found.length === 1;
  }
  if (matches())
    return { state: "existing_binding_matches", writeAttempted: false, projectRef: TEST_PROJECT };
  let status = null;
  try {
    status = runCli(
      cli,
      ["secrets", "set", "--env-file", "/dev/stdin", "--project-ref", TEST_PROJECT],
      {
        env,
        input: `${COMMUSOFT_TRIGGER_NAME}=${key}\n`,
        encoding: "utf8",
        timeout: 45000,
        maxBuffer: 1048576,
      },
    ).status;
  } catch {
    /* Inspect, never resubmit an uncertain secret update. */
  }
  let bound = false,
    after = null;
  try {
    bound = matches();
    after = await readCommusoftCatalog(args);
  } catch {}
  const refreshed = !!after && exactRuntimeRefresh(before.base.functions, after.base.functions);
  let schemaPreserved = false;
  if (refreshed) {
    const restored = structuredClone(after);
    restored.base.functions = structuredClone(before.base.functions);
    restored.readinessCatalogSha256 = catalogFingerprint(restored.base);
    schemaPreserved =
      installedCommusoft(restored) &&
      commusoftFingerprint(restored) === commusoftFingerprint(before);
  }
  return {
    version: "learn-test-commusoft-trigger/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    name: COMMUSOFT_TRIGGER_NAME,
    state:
      status === 0 && bound && refreshed && schemaPreserved
        ? "binding_verified_needs_http_acceptance"
        : "requires_inspection",
    writeAttempted: true,
    cliExitStatus: status,
    bindingDigestMatched: bound,
    reusedExistingServiceCredential: true,
    exactRuntimeRefresh: refreshed,
    schemaPreserved,
    beforeEndpoints: before.base.functions,
    afterEndpoints: after?.base.functions ?? null,
    limitations: [
      "Supabase refreshes existing endpoint runtime versions when a project secret is bound. Only the exact +1 version change is accepted; source hashes, JWT policy, entrypoints and other fields must remain unchanged.",
      "No new service credential, Commusoft API key, worker endpoint, job, schedule or production change.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--bind-existing-test-key --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST trigger reuse required");
    const r = await bindCommusoftTrigger({ allowProjectRef: TEST_PROJECT, token: savedCliToken() });
    console.log(JSON.stringify(r, null, 2));
    if (r.state === "requires_inspection") process.exitCode = 1;
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
