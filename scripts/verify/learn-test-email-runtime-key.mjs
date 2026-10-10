/** Explicit TEST internal binding, reusing the existing service key in memory/stdin. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { edgeInventory, EMAIL_RUNTIME_DATABASE } from "./learn-test-email-runtime-deploy.mjs";
import { secretMetadata } from "./learn-test-commusoft-key.mjs";
export const INTERNAL_KEY_NAME = "SERVICEOS_INTERNAL_KEY";
export async function bindEmailInternalKey({
  allowProjectRef,
  token,
  persistJournal,
  fetcher = fetch,
  runCli = spawnSync,
}) {
  if (
    allowProjectRef !== TEST_PROJECT ||
    typeof persistJournal !== "function" ||
    typeof token !== "string" ||
    !/^sbp_(?:oauth_)?[a-f\d]{40}$/i.test(token)
  )
    throw Error("Explicit TEST binding and journal required");
  async function get(path) {
    const r = await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw Error("TEST binding metadata unavailable");
    return r.json();
  }
  const schema = await readRuntimeCatalog(token, { fetcher });
  if (schema.fingerprint !== EMAIL_RUNTIME_DATABASE) throw Error("Exact TEST database required");
  const before = await edgeInventory(token, fetcher),
    secrets = secretMetadata(JSON.stringify(await get("/secrets")));
  const keys = (await get("/api-keys?reveal=true")).filter((k) => k.name === "service_role");
  if (keys.length !== 1) throw Error("Unique existing TEST key required");
  const key = keys[0].api_key,
    claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
  if (claims.ref !== TEST_PROJECT || claims.role !== "service_role" || /[\r\n]/.test(key))
    throw Error("Wrong credential scope");
  const digest = createHash("sha256").update(key).digest("hex");
  const found = secrets.filter((s) => s.name === INTERNAL_KEY_NAME);
  if (found.length) {
    if (found.length === 1 && [found[0].digest, found[0].value].includes(digest))
      return { state: "existing_binding_matches", projectRef: TEST_PROJECT, writeAttempted: false };
    throw Error("Existing internal binding differs");
  }
  await persistJournal({
    version: "learn-email-internal-binding/1",
    projectRef: TEST_PROJECT,
    name: INTERNAL_KEY_NAME,
    digest,
    endpointsBefore: before,
    secretNamesBefore: secrets.map((s) => s.name),
    observedAt: new Date().toISOString(),
  });
  let status = null;
  try {
    status = runCli(
      "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase",
      ["secrets", "set", "--env-file", "/dev/stdin", "--project-ref", TEST_PROJECT],
      {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        input: `${INTERNAL_KEY_NAME}=${key}\n`,
        encoding: "utf8",
        timeout: 45000,
        maxBuffer: 1048576,
      },
    ).status;
  } catch {
    /* Inspect once; never resubmit. */
  }
  const [after, afterSchema, afterSecrets] = await Promise.all([
    edgeInventory(token, fetcher),
    readRuntimeCatalog(token, { fetcher }),
    get("/secrets").then((x) => secretMetadata(JSON.stringify(x))),
  ]);
  const bound =
    afterSecrets.filter((s) => s.name === INTERNAL_KEY_NAME).length === 1 &&
    afterSecrets.some((s) => s.name === INTERNAL_KEY_NAME && [s.digest, s.value].includes(digest));
  const normalized = (rows) =>
    JSON.stringify(
      rows
        .map((s) => ({ name: s.name, digest: s.digest ?? s.value }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  const otherSecretsUnchanged =
    normalized(secrets) === normalized(afterSecrets.filter((s) => s.name !== INTERNAL_KEY_NAME));
  const endpointsPreserved =
    after.length === before.length &&
    before.every((b) =>
      after.some(
        (a) =>
          a.id === b.id &&
          a.slug === b.slug &&
          a.status === b.status &&
          a.verify_jwt === b.verify_jwt &&
          a.ezbr_sha256 === b.ezbr_sha256 &&
          [b.version, b.version + 1].includes(a.version),
      ),
    );
  return {
    version: "learn-email-internal-binding/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    name: INTERNAL_KEY_NAME,
    state:
      bound &&
      otherSecretsUnchanged &&
      endpointsPreserved &&
      afterSchema.fingerprint === schema.fingerprint
        ? "binding_verified"
        : "requires_inspection",
    writeAttempted: true,
    cliExitStatus: status,
    existingCredentialReused: true,
    otherSecretsUnchanged,
    endpointsPreserved,
    endpoints: after.map(({ slug, version }) => ({ slug, version })),
    limitations: [
      "This establishes the explicit server binding only; authenticated HTTP still needs verification.",
      "No credential value enters files, logs, arguments or the report. No provider or scheduler activation.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (
      process.argv.slice(2).join(" ") !== "--bind --existing-cli-login" ||
      process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
    )
      throw Error("Explicit TEST binding required");
    const r = await bindEmailInternalKey({
      allowProjectRef: TEST_PROJECT,
      token: savedCliToken(),
      persistJournal: async (j) => {
        const fd = openSync(
          ".verification-results/email-runtime-internal-key-journal.json",
          "wx",
          0o600,
        );
        try {
          writeSync(fd, JSON.stringify(j, null, 2));
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      },
    });
    writeFileSync(
      ".verification-results/email-runtime-internal-key-result.json",
      JSON.stringify(r, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(r, null, 2));
    if (!["binding_verified", "existing_binding_matches"].includes(r.state)) process.exitCode = 1;
  } catch {
    console.error(
      "TEST internal binding did not confirm; inspect the retained journal before retrying.",
    );
    process.exitCode = 1;
  }
}
