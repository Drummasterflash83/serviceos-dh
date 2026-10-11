/** Download both installed TEST card runtimes and verify their emitted closure. */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import ts from "typescript";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { DRAFT_ENDPOINTS, DRAFT_SHA } from "./learn-card-draft-runtime-deploy.mjs";
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

if (
  process.argv.slice(2).join(" ") !== "--existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST readback required");
const token = savedCliToken(),
  inventory = await edgeInventory(token),
  reports = [];
if (edgeRuntimeBundle(DRAFT_ENDPOINTS).sha256 !== DRAFT_SHA) throw Error("Reviewed source differs");
const root = ".verification-results/card-draft-runtime-readback";
if (existsSync(root)) throw Error("Readback directory already exists; inspect before repeating");
mkdirSync(root);
for (const endpoint of DRAFT_ENDPOINTS) {
  const expected = endpoint.name === "platform-worker" ? 16 : 2;
  const live = inventory.find((x) => x.slug === endpoint.name);
  if (
    live?.version !== expected ||
    live.status !== "ACTIVE" ||
    live.verify_jwt !== endpoint.verifyJwt
  )
    throw Error("Installed endpoint version differs");
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
  const folder = root + "/supabase/functions/" + endpoint.name + "/",
    bundle = edgeRuntimeBundle([endpoint]);
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
  const tests = readFileSync("scripts/customer-card-refresh.test.mjs", "utf8")
    .replaceAll(
      "../supabase/functions/_shared/customer_card.ts",
      resolve(folder + "functions/_shared/customer_card.ts"),
    )
    .replaceAll(
      "../supabase/functions/_shared/worker_handlers/customer_card_sync.ts",
      resolve(folder + "functions/_shared/worker_handlers/customer_card_sync.ts"),
    )
    .replaceAll(
      "../supabase/functions/customer-card-sync/index.ts",
      resolve(root + "/supabase/functions/customer-card-sync/index.ts"),
    );
  reports.push({
    endpoint: endpoint.name,
    version: expected,
    matchingRuntimeModules: same.length,
    omittedModules: missing,
    emittedImportsChecked: emittedImports,
    omittedModulesHaveNoEmittedImporters: true,
    differentRuntimeModules: changed,
    testSource: tests,
  });
}
for (const report of reports) {
  const file = join(root, report.endpoint + "-downloaded.test.mjs");
  writeFileSync(file, report.testSource);
  delete report.testSource;
  const run = spawnSync(process.execPath, ["--test", file], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2097152,
  });
  writeFileSync(join(root, report.endpoint + "-test.log"), run.stdout + "\n" + run.stderr);
  if (run.status !== 0) throw Error("Downloaded handler tests failed for " + report.endpoint);
  report.downloadedHandlerTestsPassed = 9;
}
const result = {
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  state: "downloaded_runtime_and_handler_tests_verified",
  sourceBundleSha256: DRAFT_SHA,
  reports,
  method:
    "Transpiled syntax-tree comparison normalizes comments, redundant parentheses, associative logical operators and a sole for-of block; emitted imports are checked separately. Review aid, not formal proof.",
  providerRequests: 0,
  productionChanged: false,
};
writeFileSync(
  ".verification-results/card-draft-runtime-readback-result.json",
  JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(JSON.stringify(result, null, 2));
