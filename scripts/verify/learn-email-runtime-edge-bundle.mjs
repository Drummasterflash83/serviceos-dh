/** Resolve all static/transitive runtime dependencies; never copies env files. */
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
export const EMAIL_RUNTIME_ENDPOINTS = [
  { name: "platform-worker", verifyJwt: false },
  { name: "gmail-sync-messages", verifyJwt: true },
  { name: "gmail-workspace-sync-messages", verifyJwt: true },
  { name: "gmail-workspace-backfill-messages", verifyJwt: true },
];
export function emailRuntimeBundle() {
  return edgeRuntimeBundle(EMAIL_RUNTIME_ENDPOINTS);
}
export function edgeRuntimeBundle(endpoints) {
  if (!Array.isArray(endpoints) || !endpoints.length || endpoints.some(e => !/^[a-z][a-z0-9-]+$/.test(e.name)))
    throw Error("Explicit endpoint names required");
  const files = new Map(),
    external = new Set();
  function visit(path) {
    if (files.has(path)) return;
    if (path.startsWith("../") || path.startsWith("/") || !/\.(ts|js|json)$/.test(path))
      throw Error("Unreviewed runtime path: " + path);
    const source = readFileSync(
      new URL("../../supabase/functions/" + path, import.meta.url),
      "utf8",
    );
    files.set(path, source);
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    function dependency(node) {
      if (!ts.isStringLiteral(node)) throw Error("Dynamic dependency requires review: " + path);
      const spec = node.text;
      if (spec.startsWith(".")) visit(posix.normalize(posix.join(posix.dirname(path), spec)));
      else if (/^(https:\/\/|npm:|jsr:|node:)/.test(spec)) external.add(spec);
      else throw Error("Unresolved bare runtime import: " + spec);
    }
    function walk(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
        dependency(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        dependency(node.arguments[0]);
      ts.forEachChild(node, walk);
    }
    walk(file);
  }
  for (const e of endpoints) visit(e.name + "/index.ts");
  const entries = [...files]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, source]) => ({ path, source }));
  return {
    files: entries,
    external: [...external].sort(),
    sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
  };
}
