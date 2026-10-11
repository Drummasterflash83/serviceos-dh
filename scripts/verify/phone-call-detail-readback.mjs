/** Compare downloaded Edge JavaScript with the reviewed TypeScript's emitted syntax. */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { CALL_DETAIL_BUNDLE_SHA } from "./phone-call-detail-runtime.mjs";
const bundle = edgeRuntimeBundle([{ name: "phone-call-detail", verifyJwt: true }]);
if (bundle.sha256 !== CALL_DETAIL_BUNDLE_SHA) throw Error("Pinned runtime differs");
function syntax(source) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText;
  const file = ts.createSourceFile("source.js", js, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  function visit(node) {
    if (ts.isParenthesizedExpression(node)) return visit(node.expression);
    const out = { kind: node.kind };
    if (
      ts.isIdentifier(node) ||
      ts.isStringLiteral(node) ||
      ts.isNumericLiteral(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isTemplateLiteralToken(node)
    )
      out.text = node.text;
    if (ts.isVariableDeclarationList(node)) out.declaration = node.flags & ts.NodeFlags.BlockScoped;
    if ("operator" in node) out.operator = node.operator;
    const children = [];
    ts.forEachChild(node, (n) => {
      children.push(visit(n));
    });
    out.children = children;
    return out;
  }
  return JSON.stringify(visit(file));
}
const root =
  ".verification-results/call-detail-runtime-readback/supabase/functions/phone-call-detail";
const checks = bundle.files.map((f) => {
  const source = readFileSync(
    f.path === "phone-call-detail/index.ts" ? root + "/index.ts" : root + "/functions/" + f.path,
    "utf8",
  );
  return {
    path: f.path,
    syntaxMatches: syntax(source) === syntax(f.source),
    downloadedSha256: createHash("sha256").update(source).digest("hex"),
  };
});
const result = {
  observedAt: new Date().toISOString(),
  bundleSha256: bundle.sha256,
  checks,
  allMatched: checks.every((c) => c.syntaxMatches),
  method:
    "Emitted syntax tree comparison retains literals, identifiers, operators, declaration kinds and child structure. Supplemented by downloaded-handler regression tests.",
};
writeFileSync(
  ".verification-results/call-detail-runtime-source-check.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
if (!result.allMatched) process.exitCode = 1;
