/** Strict local TypeScript check of the worker and manual processing endpoints.
 * Uses the installed SDK declarations and a minimal Deno env/serve shim; this
 * does not replace Edge runtime acceptance against the deployed SDK.
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = mkdtempSync(join(tmpdir(), "learn-worker-types-"));
try {
  const shim = join(dir, "deno.d.ts");
  writeFileSync(
    shim,
    "declare namespace Deno { const env: { get(name: string): string | undefined }; function serve(handler: (request: Request) => Response | Promise<Response>): void; }\n",
  );
  const config = join(dir, "tsconfig.json");
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        allowImportingTsExtensions: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        lib: ["ES2022", "DOM"],
        paths: {
          "https://esm.sh/@supabase/supabase-js@2.45.4": [
            join(root, "node_modules/@supabase/supabase-js/dist/index.d.mts"),
          ],
        },
      },
      files: [
        shim,
        ...["platform-worker", "identity-resolve", "interactions-sync"].map((name) =>
          join(root, "supabase/functions", name, "index.ts"),
        ),
      ],
    }),
  );
  const result = spawnSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", config],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (result.status === 0)
    console.log(
      "Strict worker/manual-endpoint TypeScript check passed (local SDK declarations and Deno shim).",
    );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
