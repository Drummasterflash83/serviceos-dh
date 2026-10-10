// ServiceOS — canonical Commusoft package CONTRACT (Phase 11L).
//
// PURE verification logic: no file IO, no network, no database, no clock. The
// dry-run runner reads bytes and hands them here; the synthetic suite hands
// tiny fixtures here. Nothing in this module can touch the real package, so the
// whole contract is testable without starting Supabase.
//
// The contract is FAIL-CLOSED and VERSIONED: exactly one package version is an
// active import target (v4). Earlier versions are retained as HISTORICAL EVIDENCE and are explicitly refused
// as import targets — a package must never be imported just because it once
// carried a recorded fingerprint.
//
// Every failure is returned as a safe {code, detail} pair: versions, counts,
// hashes and file names only — never a row, a name, an address or any other
// customer content.

import {
  CUSTOMER_COLUMNS,
  SITE_COLUMNS,
  JOB_COLUMNS,
  GOVERNED_PROFILES,
  SOURCE_SENTINELS,
  EXCLUSION_REASONS,
} from "./prepare-canonical-core.mjs";
// The REAL importer coercion, imported from the edge function's shared module.
// The contract MUST validate cells with the same code the importer will run —
// a second implementation would drift, and drift is exactly how Phase 11M's
// 1,349 invalid rows survived a fully "verified" package.
import { coerce } from "../../../supabase/functions/_shared/imports/profile.ts";

/** The ONE version that may be imported. */
export const ACCEPTED_PACKAGE_VERSION = 4;

/** Retained as evidence; explicitly INACTIVE as import targets. */
export const HISTORICAL_PACKAGE_VERSIONS = {
  1: {
    status: "historical_evidence_only",
    note: "the original prepared package, deleted by an external folder sync (commusoft-migration ledger §8)",
    seals: {
      "prepared_customers.csv": "520a8f13a1036b5af22fae7777417ab8520f8706dedcf7f3da8ce1fedc7fa5cb",
      "prepared_sites.csv": "a2a76cdf7ed81f345bfb8fc3d8de3665c688674996093a9d18b3ce9ef68f4e92",
      "prepared_jobs.csv": "5a2276ce2b3cfd8d80613123b380e93c305b7ffc9bd66ed4f344114f8ade8d08",
    },
  },
  2: {
    status: "historical_evidence_only",
    note: "the Phase 11J deterministic regeneration (FY window + aborted only; superseded by v3's current-window closure)",
    seals: {
      "prepared_customers.csv": "dcf4e09ab15d862ecdfef610740c4d7b92be5ce31422d6a3fdd1baff4a790415",
      "prepared_sites.csv": "3fc35e95cdc4fe873c05a5011a31c308fe7968ea007dcf8be932a74435bd33b3",
      "prepared_jobs.csv": "72034dead92ff038495634b4b13ae159662761cbbfad62174ae754754d85d680",
    },
  },
  3: {
    status: "historical_evidence_only",
    note: "the Phase 11K current-window closure — the package Phase 11M attempted. It carries Commusoft's un-normalised 'no value' phone sentinel, which the governed profile types as a phone and which invalidated 1,349 of 1,613 customer rows and 860 of 962 site rows. Superseded by v4.",
    seals: {
      "prepared_customers.csv": "dcf4e09ab15d862ecdfef610740c4d7b92be5ce31422d6a3fdd1baff4a790415",
      "prepared_sites.csv": "3fc35e95cdc4fe873c05a5011a31c308fe7968ea007dcf8be932a74435bd33b3",
      "prepared_jobs.csv": "bdcffb031d2ace2bf997bfb2663a4ab3840a9f2da4b582759c5120975b92c3a7",
    },
  },
};

/** The EXACT file set: no missing file, no additional file, no rename. */
export const REQUIRED_FILES = {
  "prepared_customers.csv": {
    entity: "customers",
    profile: "Commusoft Prepared Customers",
    columns: CUSTOMER_COLUMNS,
    schemaKey: "customers",
  },
  "prepared_sites.csv": {
    entity: "sites",
    profile: "Commusoft Prepared Sites",
    columns: SITE_COLUMNS,
    schemaKey: "sites",
  },
  "prepared_jobs.csv": {
    entity: "jobs",
    profile: "Commusoft Prepared Jobs",
    columns: JOB_COLUMNS,
    schemaKey: "jobs",
  },
};

/** Dependencies are real: a site needs its customer, a job needs both. */
export const IMPORT_ORDER = ["customers", "sites", "jobs"];

/** Source-evidence records the package MUST depend on, by manifest key. */
export const REQUIRED_SOURCE_PROVENANCE = ["customers_export", "work_addresses_export"];

/** Minimal RFC-4180 CSV reader (quotes + embedded commas). Pure. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

/** Canonical, order-independent serialisation of the sealed manifest fields —
 *  the basis of the manifest's own seal. Altering ANY covered field breaks it. */
export function canonicalContractPayload(manifest) {
  const stable = (v) => {
    if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
    if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(",")}}`;
  };
  return stable({
    package_name: manifest.package_name ?? null,
    package_version: manifest.package_version ?? null,
    prepared_at: manifest.prepared_at ?? null,
    output: manifest.output ?? null,
    schemas: manifest.schemas ?? null,
    sources: manifest.sources ?? null,
    qa: manifest.qa ?? null,
    gap_classification: manifest.gap_classification ?? null,
    // 11N: the governed profile binding and the data-quality exclusion counts
    // are SEALED. Altering a single exclusion count breaks the contract seal.
    profiles: manifest.profiles ?? null,
    data_quality: manifest.data_quality ?? null,
  });
}

/**
 * Fail-closed package verification.
 *
 * @param manifest    parsed manifest object
 * @param files       {filename: text} EXACTLY as found on disk
 * @param digest      (text) => {sha256, rows} — the caller supplies the hasher
 * @param provenance  parsed source-evidence record (or null)
 * @param manifestSeal recomputed seal over canonicalContractPayload (or null to skip)
 * @returns {ok, failures:[{code,detail}], summary} — SAFE data only.
 */
export function verifyPackage({ manifest, files, digest, provenance, manifestSeal }) {
  const failures = [];
  const fail = (code, detail) => failures.push({ code, detail });
  const summary = {
    package_version: null,
    files: {},
    relationships: null,
    provenance: null,
    cell_validation: null,
    data_quality: null,
  };

  if (!manifest || typeof manifest !== "object") {
    fail("manifest_unreadable", "no parseable package manifest was supplied");
    return { ok: false, failures, summary };
  }

  // ── 1. VERSION: exactly one active target; history is refused explicitly ──
  const version = manifest.package_version;
  summary.package_version = version ?? null;
  if (version !== ACCEPTED_PACKAGE_VERSION) {
    const hist = HISTORICAL_PACKAGE_VERSIONS[version];
    fail(
      hist ? "historical_version_not_an_import_target" : "unsupported_package_version",
      hist
        ? `package_version ${version} is retained as historical evidence only (${hist.status}); the accepted import target is v${ACCEPTED_PACKAGE_VERSION}`
        : `package_version ${JSON.stringify(version)} is not supported; the accepted import target is v${ACCEPTED_PACKAGE_VERSION}`,
    );
    return { ok: false, failures, summary }; // never proceed on an unaccepted version
  }

  // ── 2. MANIFEST SEAL: any altered sealed field breaks the contract ──
  if (manifestSeal !== null && manifestSeal !== undefined) {
    if (!manifest.contract_seal)
      fail("manifest_seal_missing", "the manifest carries no contract_seal");
    else if (manifest.contract_seal !== manifestSeal)
      fail(
        "manifest_seal_mismatch",
        "the manifest's sealed fields do not match its contract_seal — the manifest was altered after sealing",
      );
  }

  // ── 3. FILE SET: no missing, no additional, no renamed file ──
  const required = Object.keys(REQUIRED_FILES).sort();
  const sealed = Object.keys(manifest.output ?? {}).sort();
  const present = Object.keys(files ?? {}).sort();
  for (const name of required) {
    if (!sealed.includes(name))
      fail("manifest_file_missing", `the manifest seals no entry for ${name}`);
    if (!present.includes(name))
      fail("package_file_missing", `${name} is absent from the package directory`);
  }
  for (const name of sealed)
    if (!required.includes(name))
      fail("manifest_file_unexpected", `the manifest seals an unexpected entry: ${name}`);
  for (const name of present)
    if (!required.includes(name))
      fail("package_file_unexpected", `the package directory carries an unexpected file: ${name}`);
  if (failures.length) return { ok: false, failures, summary };

  // ── 4. PER FILE: recomputed hash + row count, and the declared schema ──
  const parsed = {};
  for (const name of required) {
    const spec = REQUIRED_FILES[name];
    const text = files[name];
    const d = digest(text);
    const seal = manifest.output[name] ?? {};
    summary.files[name] = { sha256: d.sha256, rows: d.rows, sealed_rows: seal.rows ?? null };
    if (seal.sha256 !== d.sha256)
      fail(
        "file_hash_mismatch",
        `${name} recomputes to ${d.sha256.slice(0, 12)}… but the manifest seals ${String(seal.sha256).slice(0, 12)}…`,
      );
    if (seal.rows !== d.rows)
      fail(
        "file_row_count_mismatch",
        `${name} carries ${d.rows} rows but the manifest seals ${seal.rows}`,
      );
    const rows = parseCsv(text);
    const header = rows[0] ?? [];
    parsed[spec.entity] = { header, body: rows.slice(1) };
    if (header.join(",") !== spec.columns.join(","))
      fail(
        "schema_mismatch",
        `${name} header does not match the governed ${spec.entity} profile schema (${spec.columns.length} columns expected, ${header.length} found)`,
      );
    const declared = (manifest.schemas ?? {})[spec.schemaKey];
    if (!Array.isArray(declared) || declared.join(",") !== spec.columns.join(","))
      fail(
        "declared_schema_mismatch",
        `the manifest's declared ${spec.schemaKey} schema does not match the governed profile "${spec.profile}"`,
      );
  }
  if (failures.length) return { ok: false, failures, summary };

  // ── 5. RELATIONSHIPS: verified BEFORE any database mutation ──
  const col = (entity, name) => {
    const idx = parsed[entity].header.indexOf(name);
    return (r) => (idx >= 0 ? (r[idx] ?? "") : "");
  };
  const custId = col("customers", "external_id");
  const siteId = col("sites", "external_id");
  const siteCust = col("sites", "customer_external_id");
  const jobId = col("jobs", "external_id");
  const jobCust = col("jobs", "customer_external_id");
  const jobSite = col("jobs", "site_external_id");
  const customers = parsed.customers.body.map(custId);
  const sites = parsed.sites.body.map(siteId);
  const jobs = parsed.jobs.body.map(jobId);
  const custSet = new Set(customers);
  const siteSet = new Set(sites);
  const dupes = (l) => l.length - new Set(l).size;
  const dupCust = dupes(customers);
  const dupSite = dupes(sites);
  const dupJob = dupes(jobs);
  const orphanSites = parsed.sites.body.filter((r) => !custSet.has(siteCust(r))).length;
  const orphanJobCust = parsed.jobs.body.filter((r) => !custSet.has(jobCust(r))).length;
  const orphanJobSite = parsed.jobs.body.filter(
    (r) => jobSite(r) !== "" && !siteSet.has(jobSite(r)),
  ).length;
  // ── 11P: EXACT SITE REFERENCES must belong to the JOB'S OWN CUSTOMER ────
  // Proving a referenced site merely EXISTS in-package is not enough. An exact
  // site_external_id is the strongest link the importer can act on, so a
  // reference that crosses customers would attach one customer's job to another
  // customer's address — the single worst outcome available to this importer.
  // Every non-empty reference must satisfy:
  //     job.customer_external_id == referenced_site.customer_external_id
  const siteCustomerOf = new Map();
  const siteIdSeen = new Set();
  const duplicateReferencedSites = new Set();
  for (const r of parsed.sites.body) {
    const id = siteId(r);
    if (siteIdSeen.has(id)) duplicateReferencedSites.add(id);
    siteIdSeen.add(id);
    siteCustomerOf.set(id, siteCust(r));
  }
  const exactRefs = parsed.jobs.body.filter((r) => jobSite(r) !== "");
  let exactAligned = 0;
  let exactCustomerMismatch = 0;
  let exactMissingSite = 0;
  let exactAmbiguousSite = 0;
  for (const r of exactRefs) {
    const ref = jobSite(r);
    if (!siteCustomerOf.has(ref)) {
      exactMissingSite++;
      continue;
    }
    if (duplicateReferencedSites.has(ref)) {
      exactAmbiguousSite++;
      continue;
    }
    if (siteCustomerOf.get(ref) === jobCust(r)) exactAligned++;
    else exactCustomerMismatch++;
  }

  summary.relationships = {
    customers: customers.length,
    sites: sites.length,
    jobs: jobs.length,
    duplicate_customer_ids: dupCust,
    duplicate_site_ids: dupSite,
    duplicate_job_ids: dupJob,
    orphan_sites: orphanSites,
    orphan_job_customers: orphanJobCust,
    orphan_job_sites: orphanJobSite,
    jobs_with_exact_site_link: exactRefs.length,
    exact_site_link_customer_aligned: exactAligned,
    exact_site_link_customer_mismatch: exactCustomerMismatch,
    exact_site_link_missing_site: exactMissingSite,
    exact_site_link_ambiguous_site: exactAmbiguousSite,
  };
  if (exactMissingSite)
    fail(
      "exact_site_reference_missing",
      `${exactMissingSite} job row(s) carry an exact site_external_id that names no site in the package`,
    );
  if (exactAmbiguousSite)
    fail(
      "exact_site_reference_ambiguous",
      `${exactAmbiguousSite} job row(s) carry an exact site_external_id that maps to more than one site row`,
    );
  if (exactCustomerMismatch)
    fail(
      "exact_site_customer_mismatch",
      `${exactCustomerMismatch} job row(s) reference a site belonging to a DIFFERENT customer — an exact link may never cross customers`,
    );
  if (dupCust) fail("duplicate_external_identity", `${dupCust} duplicate customer external ids`);
  if (dupSite) fail("duplicate_external_identity", `${dupSite} duplicate site external ids`);
  if (dupJob) fail("duplicate_external_identity", `${dupJob} duplicate job external ids`);
  if (orphanSites)
    fail(
      "orphan_relationship",
      `${orphanSites} site rows reference a customer outside the package`,
    );
  if (orphanJobCust)
    fail(
      "orphan_relationship",
      `${orphanJobCust} job rows reference a customer outside the package`,
    );
  if (orphanJobSite)
    fail("orphan_relationship", `${orphanJobSite} job rows reference a site outside the package`);

  // ── 5b. CELL VALUES: every prepared cell must satisfy the GOVERNED profile
  //     type, checked with the importer's OWN coercion, BEFORE any client
  //     exists. Phase 11M proved a header-and-relationship contract is not
  //     enough: a fully sealed, fully verified package still failed 84% of its
  //     customer rows at row 1 on a value the profile could not accept.
  const cellFailures = {};
  const blanks = {};
  const sentinelHits = {};
  for (const name of required) {
    const spec = REQUIRED_FILES[name];
    const entity = spec.entity;
    const governed = GOVERNED_PROFILES[entity];
    const header = parsed[entity].header;
    const sentinels = SOURCE_SENTINELS[entity] ?? {};
    for (const row of parsed[entity].body) {
      for (const column of governed.columns) {
        const idx = header.indexOf(column.canonical);
        const raw = idx >= 0 ? (row[idx] ?? "") : "";
        const key = (reason) => `${entity}.${column.canonical}.${reason}`;
        if (raw.trim() === "") {
          if (column.required) {
            const k = key("required_value_missing");
            cellFailures[k] = (cellFailures[k] ?? 0) + 1;
          } else {
            const k = `${entity}.${column.canonical}`;
            blanks[k] = (blanks[k] ?? 0) + 1;
          }
          continue;
        }
        // A known source sentinel surviving into the package is its own failure:
        // it means normalisation did not run, which IS the Phase 11M defect.
        if ((sentinels[column.canonical] ?? []).includes(raw.trim())) {
          const k = `${entity}.${column.canonical}`;
          sentinelHits[k] = (sentinelHits[k] ?? 0) + 1;
        }
        const c = coerce(column.type, raw);
        if (c.error) {
          const k = key(c.error.replace(/\s+/g, "_"));
          cellFailures[k] = (cellFailures[k] ?? 0) + 1;
        }
      }
    }
  }
  summary.cell_validation = {
    profile_binding: Object.fromEntries(
      Object.entries(GOVERNED_PROFILES).map(([k, v]) => [k, v.profile]),
    ),
    failures: cellFailures,
    total_failures: Object.values(cellFailures).reduce((a, b) => a + b, 0),
    surviving_source_sentinels: sentinelHits,
  };
  for (const [k, n] of Object.entries(cellFailures))
    fail(
      "cell_value_invalid",
      `${n} cell(s) fail the governed profile contract at ${k} — the importer would invalidate their whole row`,
    );
  for (const [k, n] of Object.entries(sentinelHits))
    fail(
      "source_sentinel_not_normalised",
      `${n} cell(s) at ${k} still carry a known source "no value" sentinel — the package was not normalised`,
    );

  // ── 5c. GOVERNED PROFILE BINDING: the manifest must declare the EXACT
  //     profile name, column set, types and requiredness the contract enforced.
  const declaredProfiles = manifest.profiles ?? null;
  if (!declaredProfiles) {
    fail("profile_binding_missing", "the manifest declares no governed profile binding");
  } else {
    for (const [entity, governed] of Object.entries(GOVERNED_PROFILES)) {
      const d = declaredProfiles[entity];
      if (!d) {
        fail("profile_binding_missing", `the manifest declares no profile binding for ${entity}`);
        continue;
      }
      if (d.profile !== governed.profile)
        fail(
          "profile_binding_mismatch",
          `${entity}: the manifest names profile "${d.profile}" but the contract enforces "${governed.profile}"`,
        );
      const norm = (cols) =>
        JSON.stringify((cols ?? []).map((c) => [c.canonical, c.type, c.required === true]));
      if (norm(d.columns) !== norm(governed.columns))
        fail(
          "profile_binding_mismatch",
          `${entity}: the manifest's declared column types/requiredness do not match the governed profile`,
        );
    }
  }

  // ── 5d. DATA-QUALITY EXCLUSIONS: recorded by field and reason, reconciled
  //     exactly, and sealed (an altered count breaks contract_seal at step 2).
  const dq = manifest.data_quality ?? null;
  if (!dq) {
    fail("data_quality_missing", "the manifest records no data-quality exclusion block");
  } else {
    const ex = dq.exclusions ?? {};
    const validReasons = new Set(Object.values(EXCLUSION_REASONS));
    let sum = 0;
    for (const [k, n] of Object.entries(ex)) {
      if (!Number.isInteger(n) || n < 0) {
        fail(
          "data_quality_count_invalid",
          `${k}: an exclusion count must be a non-negative integer`,
        );
        continue;
      }
      sum += n;
      const parts = k.split(".");
      const reason = parts.pop();
      const field = parts.pop();
      const entity = parts.join(".");
      if (!validReasons.has(reason)) {
        fail("data_quality_reason_unknown", `${k}: "${reason}" is not a declared exclusion reason`);
        continue;
      }
      const column = (GOVERNED_PROFILES[entity]?.columns ?? []).find((c) => c.canonical === field);
      if (!column) {
        fail("data_quality_field_unknown", `${k}: not a governed column of ${entity}`);
        continue;
      }
      if (column.required)
        fail(
          "data_quality_field_required",
          `${k}: a REQUIRED field may never be emptied by an exclusion`,
        );
      if (!["phone", "email"].includes(column.type))
        fail(
          "data_quality_field_not_endpoint",
          `${k}: only optional contact endpoints may be excluded, not a "${column.type}"`,
        );
      // Every excluded cell must now be BLANK in the package, so an exclusion
      // can never be larger than the blanks it claims to have produced.
      const blankCount = blanks[`${entity}.${field}`] ?? 0;
      if (n > blankCount)
        fail(
          "data_quality_not_reconciled",
          `${k}: claims ${n} exclusions but the package carries only ${blankCount} blank cells in that field`,
        );
    }
    if (dq.total_excluded_cells !== sum)
      fail(
        "data_quality_total_mismatch",
        `total_excluded_cells is ${dq.total_excluded_cells} but the per-field counts sum to ${sum}`,
      );
    summary.data_quality = { exclusions: ex, total_excluded_cells: sum };
  }

  // ── 6. SOURCE PROVENANCE: required records present and hash-aligned ──
  const provSources = provenance?.sources ?? null;
  if (!provSources) {
    fail(
      "source_provenance_record_missing",
      `no source-evidence registration record was supplied; ${REQUIRED_SOURCE_PROVENANCE.join(", ")} must be registered`,
    );
  } else {
    const provSummary = {};
    for (const key of REQUIRED_SOURCE_PROVENANCE) {
      const rec = provSources[key];
      const manifestSrc = (manifest.sources ?? {})[key];
      if (!rec) {
        fail(
          "source_provenance_record_missing",
          `the provenance record carries no entry for ${key}`,
        );
        continue;
      }
      if (!manifestSrc) {
        fail("manifest_source_missing", `the manifest declares no source entry for ${key}`);
        continue;
      }
      if (rec.sha256 !== manifestSrc.sha256)
        fail(
          "source_provenance_seal_mismatch",
          `${key}: the registered provenance seal ${String(rec.sha256).slice(0, 12)}… does not match the manifest's ${String(manifestSrc.sha256).slice(0, 12)}…`,
        );
      provSummary[key] = {
        provenance_class: rec.provenance_class ?? "unknown",
        register_verified: rec.register_verified === true,
      };
      if (rec.provenance_class !== "register_verified" && rec.register_verified === true)
        fail(
          "provenance_classification_inconsistent",
          `${key}: register_verified=true contradicts provenance_class "${rec.provenance_class}"`,
        );
    }
    summary.provenance = provSummary;
  }

  return { ok: failures.length === 0, failures, summary };
}

/** The dependency order is real — a wrong order is refused, not reordered. */
export function verifyImportOrder(order) {
  const ok = Array.isArray(order) && order.join(",") === IMPORT_ORDER.join(",");
  return {
    ok,
    failures: ok
      ? []
      : [
          {
            code: "import_order_invalid",
            detail: `import order must be ${IMPORT_ORDER.join(" → ")} (sites need their customer; jobs need both)`,
          },
        ],
  };
}
