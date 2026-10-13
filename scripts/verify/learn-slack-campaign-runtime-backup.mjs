/** Read-only compiled TEST Slack campaign runtime backup. Never deploys or invokes functions. */
import https from "node:https";
import { brotliDecompressSync, brotliCompressSync, constants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { validateInventory } from "./learn-production-runtime-candidate.mjs";

const [out] = process.argv.slice(2),
  project = TEST_PROJECT;
if (
  process.argv.length !== 3 ||
  !out ||
  !resolve(out).startsWith(resolve(".verification-results") + "/") ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== project
)
  throw Error("Explicit TEST read-only project and fresh private output required");
const token = savedCliToken(),
  sha = (b) => createHash("sha256").update(b).digest("hex");
const candidateBytes = readFileSync(
  "supabase/release/learn-test/092_slack_campaign_runtime.manifest.json",
);
const manifest = JSON.parse(candidateBytes);
const candidate = {
  ...manifest,
  endpoints: manifest.beforeEndpoints.map((e) => ({ name: e.name, beforeProduction: e })),
};
if (candidate.projectRef !== project) throw Error("Candidate target mismatch");
async function get(path) {
  return new Promise((resolveResult, reject) => {
    const req = https.get(
      `https://api.supabase.com/v1/projects/${project}/functions${path}`,
      {
        headers: { Authorization: "Bearer " + token, Accept: "application/vnd.denoland.eszip" },
      },
      (r) => {
        let size = 0;
        const chunks = [];
        r.on("data", (b) => {
          size += b.length;
          if (size > 30000000) r.destroy(Error("Response exceeds bound"));
          else chunks.push(b);
        });
        r.on("error", reject);
        r.on("end", () => {
          if (r.statusCode !== 200)
            return reject(Error("Read-only function request HTTP " + r.statusCode));
          const raw = Buffer.concat(chunks);
          if (r.headers["content-encoding"] && r.headers["content-encoding"] !== "br")
            return reject(Error("Unexpected body encoding"));
          resolveResult(
            r.headers["content-encoding"] === "br"
              ? brotliDecompressSync(raw, { maxOutputLength: 30000000 })
              : raw,
          );
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(Error("Read-only request timeout")));
  });
}
function normalize(rows) {
  return validateInventory(
    rows.map((f) => ({
      name: f.slug,
      id: f.id,
      version: f.version,
      hash: f.ezbr_sha256,
      jwt: f.verify_jwt,
      status: f.status,
    })),
  );
}
function match(actual, expected) {
  return (
    actual &&
    expected &&
    ["name", "id", "version", "hash", "jwt", "status"].every((k) => actual[k] === expected[k])
  );
}
function validateCurrent(rows) {
  for (const e of candidate.endpoints) {
    const actual = rows.find((f) => f.name === e.name);
    if (e.beforeProduction ? !match(actual, e.beforeProduction) : actual)
      throw Error("TEST endpoint drift: " + e.name);
  }
}
validateCurrent(normalize(JSON.parse(await get(""))));
mkdirSync(out, { mode: 0o700 });
const report = {
  version: "learn-test-slack-compiled-backup/1",
  projectRef: project,
  candidateManifestSha256: sha(candidateBytes),
  startedAt: new Date().toISOString(),
  state: "downloading",
  endpoints: [],
  productionChanged: false,
  providerRequests: 0,
  limitations: [
    "Compiled bytes are returned by the provider while observed deployment metadata remains unchanged; re-encoded EZBR hashes may differ from the original compression.",
    "No rollback deployment or database compatibility claim. New checkpoint formats may require capture to remain paused and a forward repair.",
  ],
};
const save = () =>
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
save();
try {
  for (const e of candidate.endpoints.filter((e) => e.beforeProduction)) {
    const meta = JSON.parse(await get("/" + e.name));
    if (!match(normalize([meta])[0], e.beforeProduction))
      throw Error("Endpoint changed before body read: " + e.name);
    if (typeof meta.entrypoint_path !== "string" || !meta.entrypoint_path.startsWith("file:///"))
      throw Error("Missing rollback entrypoint");
    const body = await get("/" + e.name + "/body");
    if (!body.subarray(0, 5).equals(Buffer.from("ESZIP")))
      throw Error("Unexpected compiled format");
    const ezbr = Buffer.concat([
      Buffer.from("EZBR"),
      brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }),
    ]);
    if (!brotliDecompressSync(ezbr.subarray(4)).equals(body))
      throw Error("Compiled compression round trip differs");
    writeFileSync(join(out, e.name + ".eszip"), body, { flag: "wx", mode: 0o600 });
    writeFileSync(join(out, e.name + ".ezbr"), ezbr, { flag: "wx", mode: 0o600 });
    report.endpoints.push({
      ...e.beforeProduction,
      entrypointPath: meta.entrypoint_path,
      importMapPath: meta.import_map_path ?? null,
      eszipBytes: body.length,
      eszipSha256: sha(body),
      ezbrBytes: ezbr.length,
      ezbrSha256: sha(ezbr),
      originalCompressionMatched: sha(ezbr) === e.beforeProduction.hash,
      compressionRoundTrip: true,
    });
    save();
    console.log(JSON.stringify({ saved: e.name, completed: report.endpoints.length }));
  }
  validateCurrent(normalize(JSON.parse(await get(""))));
  report.state = "compiled_artifacts_retained_with_unchanged_deployment_metadata";
  report.completedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ state: report.state, endpoints: report.endpoints.length }));
} catch (error) {
  report.state = "incomplete";
  report.error = error.message;
  save();
  throw error;
}
