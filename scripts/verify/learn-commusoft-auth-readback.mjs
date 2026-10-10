/** Verify downloaded TEST code structurally and run existing behavioral tests on it.
 * CLI export changes formatting and strips types. Comparison preserves executable
 * AST structure, ignoring parentheses/comments only; no provider or hosted calls.
 */
import ts from "typescript";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
const mode = process.argv.slice(2).join(" ");
assert.ok(mode === "" || mode === "--contact-runtime", "Known readback release required");
const label = mode === "--contact-runtime" ? "commusoft-contact-runtime" : "commusoft-auth";
const base = resolve(`.verification-results/${label}-readback`);
function structure(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      verbatimModuleSyntax: false,
    },
  }).outputText;
  const f = ts.createSourceFile("module.js", js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function shape(n) {
    if (ts.isParenthesizedExpression(n)) return shape(n.expression);
    const children = [];
    ts.forEachChild(n, (c) => {
      children.push(shape(c));
    });
    return [
      n.kind,
      ts.isIdentifier(n) || ts.isLiteralExpression(n) || ts.isTemplateLiteralToken(n)
        ? n.text
        : null,
      n.operator ?? null,
      ts.isVariableDeclarationList(n) ? n.flags & ts.NodeFlags.BlockScoped : null,
      children,
    ];
  }
  return JSON.stringify(shape(f));
}
const report = {
  version: `${label}-readback/1`,
  observedAt: new Date().toISOString(),
  state: "started",
  endpoints: [],
  limits: [
    "Downloaded code with synthetic ports; not a signed-in hosted operator or real provider request from Edge.",
  ],
};
for (const name of ["learn-commusoft-worker", "learn-commusoft-verify"]) {
  const bundle = edgeRuntimeBundle([{ name, verifyJwt: true }]),
    exported = join(base, name, "supabase/functions", name),
    stageRoot = join(base, "normalized", name),
    stage = join(stageRoot, "supabase/functions"),
    files = [];
  for (const f of bundle.files) {
    const downloaded = readFileSync(
      join(exported, f.path === name + "/index.ts" ? "index.ts" : "functions/" + f.path),
      "utf8",
    );
    assert.ok(
      structure(downloaded) === structure(f.source),
      "Published executable AST differs: " + name + "/" + f.path,
    );
    const path = join(stage, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, downloaded);
    files.push({ path: f.path, sha256: createHash("sha256").update(downloaded).digest("hex") });
  }
  const tests =
    name === "learn-commusoft-worker"
      ? ["read_page", "page_store", "permit_server", "stored_scope", "worker"]
      : ["read_page", "verify_connection", "verification_http"];
  for (const n of tests)
    copyFileSync(
      "supabase/functions/_shared/commusoft/" + n + ".test.ts",
      join(stage, "_shared/commusoft", n + ".test.ts"),
    );
  if (name === "learn-commusoft-verify") {
    const client = join(stageRoot, "src/lib/learn-commusoft-verification.ts");
    mkdirSync(dirname(client), { recursive: true });
    copyFileSync("src/lib/learn-commusoft-verification.ts", client);
  }
  const run = spawnSync(
    process.execPath,
    ["--test", ...tests.map((n) => join(stage, "_shared/commusoft", n + ".test.ts"))],
    { encoding: "utf8", timeout: 30000, maxBuffer: 1048576 },
  );
  writeFileSync(join(base, name + "-tests.log"), run.stdout + run.stderr);
  assert.equal(run.status, 0, "Published behavior tests failed: " + name);
  const passed = Number(run.stdout.match(/ℹ pass (\d+)/)?.[1]);
  assert.ok(passed > 0);
  report.endpoints.push({
    name,
    executableStructureMatches: true,
    files,
    testsPassed: passed,
    repositoryTestSupport:
      name === "learn-commusoft-verify" ? ["src/lib/learn-commusoft-verification.ts"] : [],
  });
}
report.state = "passed";
writeFileSync(
  `.verification-results/${label}-readback.json`,
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report, null, 2));
