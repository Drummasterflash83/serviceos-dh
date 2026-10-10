// ServiceOS — canonical package VERIFIER (Phase 11L).
//
// READ-ONLY validation of a real prepared package against the versioned
// contract, plus its source provenance:
//   - register-verified Job sources: their manifest seals must equal the hashes
//     recorded in the DH Works evidence register;
//   - locally sealed recovered sources (customers / work addresses): their
//     manifest seals must equal the accepted source-evidence registration
//     record, and their honest classification is DISCLOSED, never upgraded;
//   - prepared-package output seals: recomputed from the bytes.
//
// Offline and non-mutating: no network, no database, no writes. Prints counts,
// hashes and classifications ONLY — never a row of customer data.
//
// Usage:
//   node scripts/commusoft/verify-canonical-package.mjs \
//     --package "<accepted package dir>" \
//     --source-evidence "<commusoft_source_evidence.json>" \
//     --register "<evidence_register.csv>"
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ACCEPTED_PACKAGE_VERSION,
  HISTORICAL_PACKAGE_VERSIONS,
  REQUIRED_FILES,
  REQUIRED_SOURCE_PROVENANCE,
  canonicalContractPayload,
  verifyPackage,
} from "./lib/package-contract.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) => {
    if (!a.startsWith("--")) return [];
    const v = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true;
    return [[a.slice(2), v]];
  }),
);
for (const k of Object.keys(process.env)) if (k.startsWith("SUPABASE_")) delete process.env[k];
const die = (m) => {
  console.error("REFUSED: " + m);
  process.exit(1);
};
for (const k of ["package", "source-evidence", "register"]) if (!args[k]) die(`--${k} is required`);

const pkgDir = resolve(String(args.package));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const manifestPath = join(pkgDir, "commusoft_canonical.manifest.json");
if (!existsSync(manifestPath)) die("the package carries no commusoft_canonical.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const files = {};
for (const name of Object.keys(REQUIRED_FILES))
  if (existsSync(join(pkgDir, name))) files[name] = readFileSync(join(pkgDir, name), "utf8");
for (const extra of Object.keys(manifest.output ?? {}))
  if (!(extra in REQUIRED_FILES) && existsSync(join(pkgDir, extra)))
    files[extra] = readFileSync(join(pkgDir, extra), "utf8");

const provenance = JSON.parse(readFileSync(resolve(String(args["source-evidence"])), "utf8"));
const verdict = verifyPackage({
  manifest,
  files,
  digest: (t) => ({ sha256: sha256(t), rows: t.split("\n").filter((l) => l.length).length - 1 }),
  provenance,
  manifestSeal: sha256(canonicalContractPayload(manifest)),
});

// ── source classification: register-verified vs locally sealed recovered ──
const registerText = readFileSync(resolve(String(args.register)), "utf8");
const registerShas = new Set(
  registerText
    .split("\n")
    .slice(1)
    .flatMap((l) => l.split(",").map((c) => c.trim().toLowerCase()))
    .filter((c) => /^[0-9a-f]{64}$/.test(c)),
);
const sourceClassification = {};
let classificationFailures = 0;
for (const [key, src] of Object.entries(manifest.sources ?? {})) {
  if (typeof src !== "object" || !src?.sha256) continue;
  const inRegister = registerShas.has(String(src.sha256).toLowerCase());
  const rec = provenance.sources?.[key] ?? null;
  const expected = REQUIRED_SOURCE_PROVENANCE.includes(key);
  const cls = inRegister
    ? "register_verified"
    : rec
      ? (rec.provenance_class ?? "unknown")
      : "unclassified";
  if (expected && !rec) classificationFailures++;
  if (expected && rec && rec.sha256 !== src.sha256) classificationFailures++;
  if (!inRegister && cls === "register_verified") classificationFailures++;
  sourceClassification[key] = {
    sha256_prefix: String(src.sha256).slice(0, 16),
    classification: cls,
    in_evidence_register: inRegister,
    provenance_record: rec ? "present" : expected ? "MISSING" : "not required",
  };
}

const report = {
  package_directory: pkgDir,
  accepted_version: ACCEPTED_PACKAGE_VERSION,
  historical_versions_inactive: Object.keys(HISTORICAL_PACKAGE_VERSIONS),
  package_version: verdict.summary.package_version,
  output_seals: verdict.summary.files,
  relationships: verdict.summary.relationships,
  source_classification: sourceClassification,
  provenance_disclosure: verdict.summary.provenance,
  unregistered_sources: provenance.unregistered_sources ?? [],
  required_to_upgrade_provenance: provenance.required_to_upgrade_provenance ?? [],
  contract_ok: verdict.ok,
  classification_failures: classificationFailures,
  failures: verdict.failures,
};
console.log(JSON.stringify(report, null, 2));
const pass = verdict.ok && classificationFailures === 0;
console.log(
  pass
    ? "\nCANONICAL PACKAGE VERIFIER: PASS (contract + source classification)"
    : "\nCANONICAL PACKAGE VERIFIER: REFUSED",
);
process.exit(pass ? 0 : 1);
