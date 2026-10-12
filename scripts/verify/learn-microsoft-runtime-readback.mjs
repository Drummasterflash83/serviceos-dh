/** Read back the updated TEST worker; no invocation or customer data reads. */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import ts from "typescript";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const manifest = JSON.parse(
  readFileSync("supabase/release/learn-test/078_microsoft_runtime.manifest.json"),
);
const CHANGES_ENDPOINTS = manifest.endpoints,
  CHANGES_SHA = manifest.bundleSha256;
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
function structure(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText;
  const tree = ts.createSourceFile(
    "runtime.js",
    js,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  function walk(n) {
    if (ts.isParenthesizedExpression(n)) return walk(n.expression);
    if (ts.isBlock(n) && n.statements.length === 1 && ts.isForOfStatement(n.statements[0]))
      return walk(n.statements[0]);
    if (
      ts.isBinaryExpression(n) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(
        n.operatorToken.kind,
      )
    ) {
      const terms = [];
      function collect(x) {
        if (ts.isParenthesizedExpression(x)) return collect(x.expression);
        if (ts.isBinaryExpression(x) && x.operatorToken.kind === n.operatorToken.kind) {
          collect(x.left);
          collect(x.right);
        } else terms.push(walk(x));
      }
      collect(n);
      return ["logical", n.operatorToken.kind, terms];
    }
    const kids = [];
    ts.forEachChild(n, (c) => {
      kids.push(walk(c));
    });
    return [
      n.kind,
      ts.isSourceFile(n) ? null : (n.text ?? n.escapedText ?? null),
      n.operator ?? null,
      ts.isVariableDeclarationList(n) ? n.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let) : null,
      kids,
    ];
  }
  return JSON.stringify(walk(tree));
}

const inspectExisting = process.argv.includes("--inspect-existing");
if (
  process.argv.slice(2).join(" ") !==
    "--existing-cli-login" + (inspectExisting ? " --inspect-existing" : "") ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST readback required");
const token = savedCliToken(),
  inventory = await edgeInventory(token),
  reports = [];
if (edgeRuntimeBundle(CHANGES_ENDPOINTS).sha256 !== CHANGES_SHA)
  throw Error("Reviewed source differs");
const root = ".verification-results/microsoft-runtime-readback";
if (existsSync(root) !== inspectExisting)
  throw Error("Use a fresh download or explicitly inspect the existing artifact");
if (!inspectExisting) mkdirSync(root, {mode: 0o700});
for (const endpoint of CHANGES_ENDPOINTS) {
  const expected = { "platform-worker": 20 }[endpoint.name];
  const live = inventory.find((x) => x.slug === endpoint.name);
  if (
    live?.version !== expected ||
    live.status !== "ACTIVE" ||
    live.verify_jwt !== endpoint.verifyJwt
  )
    throw Error("Installed endpoint version differs");
  if (!inspectExisting) {
    const download = spawnSync(
      "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase",
      ["functions", "download", endpoint.name, "--project-ref", TEST_PROJECT, "--workdir", root],
      {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 2097152,
      },
    );
    if (download.status !== 0) throw Error("Function source download unconfirmed");
  }
  const folder = root + "/supabase/functions/" + endpoint.name + "/",
    bundle = edgeRuntimeBundle([endpoint]);
  if (!existsSync(folder + "index.ts")) throw Error("Downloaded entry point missing");
  const missing = [],
    changed = [],
    same = [];
  let emittedImports = 0;
  const filePath = (f) =>
    folder + (f.path === endpoint.name + "/index.ts" ? "index.ts" : "functions/" + f.path);
  for (const f of bundle.files) {
    if (!existsSync(filePath(f))) {
      missing.push(f.path);
      continue;
    }
    if (structure(f.source) !== structure(readFileSync(filePath(f), "utf8"))) changed.push(f.path);
    else same.push(f.path);
  }
  const missingImporters = [];
  for (const f of bundle.files) {
    // Type-only modules omitted by the compiler cannot introduce runtime imports.
    if (!existsSync(filePath(f))) continue;
    const js = ts.transpileModule(f.source, {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    }).outputText;
    const tree = ts.createSourceFile(f.path, js, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    function walk(n) {
      let spec;
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier)
        spec = n.moduleSpecifier.text;
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword)
        spec = n.arguments[0]?.text;
      if (typeof spec === "string" && spec.startsWith(".")) {
        emittedImports++;
        const target = resolve(dirname(f.path), spec);
        if (missing.some((m) => resolve(m) === target))
          missingImporters.push({ from: f.path, to: spec });
      }
      ts.forEachChild(n, walk);
    }
    walk(tree);
  }
  if (changed.length || missingImporters.length) throw Error("Downloaded runtime differs");
  reports.push({
    endpoint: endpoint.name,
    version: expected,
    matchingRuntimeModules: same.length,
    omittedModules: missing,
    emittedImportsChecked: emittedImports,
    omittedModulesHaveNoEmittedImporters: true,
    differentRuntimeModules: changed,
    folder,
  });
}
for (const report of reports) delete report.folder;
const result = {
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  state: "downloaded_runtime_source_verified",
  sourceBundleSha256: CHANGES_SHA,
  reports,
  method:
    "Transpiled syntax-tree comparison normalizes comments, redundant parentheses, associative logical operators and a sole for-of block; emitted imports are checked separately. Review aid, not formal proof.",
  limitations: ["Syntax/import comparison; does not verify real provider or Storage transport."],
  providerRequests: 0,
  productionChanged: false,
};
writeFileSync(
  ".verification-results/microsoft-runtime-readback-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
