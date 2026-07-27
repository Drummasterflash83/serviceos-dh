// Evidence Layer V1 · GATE 0 — real Drummonds lossless/reversible conformance proof (READ-ONLY).
//
// Proves every existing signal can be represented by the canonical Evidence model WITHOUT LOSS and
// REVERSIBLY, and MEASURES conformance: per source table — rows, lossless %, reversible %, content-
// hash uniqueness (collisions), typed-field resolution, and parser-version capture (a Gate 1 gap).
// Reads existing data only; writes nothing; no store, no migration, no pipeline change. Output is
// aggregate — no message/call content, only counts, field names, booleans and truncated hashes.
//
// Run: node scripts/evidence-conformance-proof.ts   (needs .env.verify)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  toEvidence,
  canonicalize,
  verifyLossless,
  reconstructSource,
  SOURCE_ADAPTERS,
} from "../supabase/functions/_shared/evidence/model.ts";

function loadEnv(p: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const l of readFileSync(p, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
}
const env = loadEnv(new URL("../.env.verify", import.meta.url).pathname);
const ref = (env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
if (env.VERIFY_ALLOW_PROJECT_REF && ref !== env.VERIFY_ALLOW_PROJECT_REF) {
  console.error("REFUSING: project ref not in allowlist");
  process.exit(2);
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const T = env.VERIFY_TENANT ?? "00000000-0000-0000-0000-000000000001";
const SAMPLE = 500; // per table (read-only preview; conformance is structural, not volume-dependent)
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  console.log(
    `project ${ref} · tenant ${T.slice(0, 8)}… · Evidence Layer V1 · GATE 0 conformance\n`,
  );
  let allLossless = true;
  let anyCollision = false;
  const tables = Object.keys(SOURCE_ADAPTERS);
  for (const table of tables) {
    const head = await db
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", T);
    const total = head.count ?? 0;
    if (total === 0) {
      console.log(
        `${table}: 0 rows — kind '${SOURCE_ADAPTERS[table].kind}' modelled, no signal yet (honest empty)`,
      );
      continue;
    }
    const { data, error } = await db.from(table).select("*").eq("tenant_id", T).limit(SAMPLE);
    if (error) {
      console.log(`${table}: ERR ${error.message}`);
      continue;
    }
    const rows = data ?? [];
    let lossless = 0;
    let reversible = 0;
    let withOccurred = 0;
    let withExternal = 0;
    let withParserVersion = 0;
    const hashes = new Set<string>();
    let fieldCount = 0;
    for (const row of rows) {
      const e = toEvidence(table, row);
      e.contentHash = sha256(e.canonical);
      fieldCount = Math.max(fieldCount, Object.keys(row).length);
      if (verifyLossless(row, e).lossless) lossless++;
      if (canonicalize(reconstructSource(e)) === canonicalize(row)) reversible++;
      if (e.occurredAt) withOccurred++;
      if (e.sourceExternalId) withExternal++;
      if (e.parserVersion) withParserVersion++;
      hashes.add(e.contentHash);
    }
    const n = rows.length;
    const losslessPct = Math.round((lossless / n) * 100);
    const reversiblePct = Math.round((reversible / n) * 100);
    const collision = hashes.size !== n;
    if (losslessPct < 100 || reversiblePct < 100) allLossless = false;
    if (collision) anyCollision = true;
    console.log(
      `${table} (kind ${SOURCE_ADAPTERS[table].kind}): total=${total} sampled=${n} fields=${fieldCount} · ` +
        `lossless=${losslessPct}% reversible=${reversiblePct}% · hashes unique=${!collision} · ` +
        `occurredAt=${Math.round((withOccurred / n) * 100)}% externalId=${Math.round((withExternal / n) * 100)}% ` +
        `parserVersion=${Math.round((withParserVersion / n) * 100)}%`,
    );
  }
  console.log(
    `\n${allLossless && !anyCollision ? "✅" : "⚠️"} GATE 0: every sampled signal represented ${allLossless ? "100% lossless + reversible" : "with LOSS — see above"}; ` +
      `content-hash collisions: ${anyCollision ? "PRESENT" : "none"}.`,
  );
  console.log(
    "Note: parserVersion is largely absent in current data (only transcripts carry a model) — capturing it, " +
      "and richer raw (e.g. discarded email headers), is Gate 1. Gate 0 is lossless w.r.t. the current system-of-record.",
  );
}
main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
