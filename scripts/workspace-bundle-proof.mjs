import ts from "typescript";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
const dir = ".vercel/output/static/assets/";
for (const prefix of ["openfolk._tenantId-", "ClientPortal-"]) {
  const entry = readdirSync(dir).find((file) => file.startsWith(prefix) && file.endsWith(".js"));
  assert.ok(entry, `Built entry exists: ${prefix}`);
  const seen = new Set();
  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(dir + file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const path = statement.moduleSpecifier.text;
      if (path.startsWith("./") && path.endsWith(".js")) visit(path.slice(2));
    }
  }
  visit(entry);
  assert.ok(
    ![...seen].some((file) => file.startsWith("OpenfolkWorkspace-")),
    "Future tools are not a static module dependency",
  );
  assert.ok(
    ![...seen].some((file) => file.startsWith("ClientInvestment-")),
    "Invoices are not loaded until opened",
  );
  console.log(
    JSON.stringify({
      entry,
      staticFiles: seen.size,
      rawBytes: [...seen].reduce((total, file) => total + readFileSync(dir + file).length, 0),
      gzipBytes: [...seen].reduce(
        (total, file) => total + gzipSync(readFileSync(dir + file)).length,
        0,
      ),
    }),
  );
}
