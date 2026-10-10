// ServiceOS — canonical Commusoft package preparation CORE (Phase 11J §1).
// PURE, deterministic transformation logic ONLY — no file IO, no network, no
// database, no clock. The CLI (prepare-canonical-package.mjs) wires real files;
// the synthetic suite (prepare-canonical.test.mjs) feeds tiny fixtures. The
// repository holds THIS code, the schemas and synthetic tests — never prepared
// CSVs, raw PII or customer samples.
//
// RECOVERY RECIPE (derived from the recorded truth of the deleted package —
// docs/product/commusoft-migration/IMPLEMENTATION_LEDGER.md §3 — and verified
// against the surviving sources before this tool was written):
//   customers = the full Commusoft "Customers" export (1 row per account);
//   sites     = the "Work addresses" export (1 row per work-address account);
//   jobs      = the FY2025-26 profit-by-job window MINUS job numbers present in
//               the all-time aborted export (aborted status wins), PLUS every
//               aborted job. The recorded splits (1,266/347 person/company,
//               1,607/6 + 957/5 active/inactive, 2,408/54/954
//               completed/open/aborted) all re-derive EXACTLY from this recipe.
//
// Deterministic output contract:
//   - column order = the governed import-profile schemas (migration
//     20260912120000), verbatim;
//   - rows sorted by numeric external_id ascending;
//   - RFC-4180 CSV, LF line endings, UTF-8, no BOM, quoting only when needed,
//     trailing newline;
//   - record_kind: person ⇔ Customer type ∈ PERSON_TYPES, else company_contact;
//   - names are NEVER parsed/split (title/first/last stay empty — no guessing);
//   - engineers are NEVER guessed (no engineer source exists → empty);
//   - marketing preferences (the source "Advertising" column) are NEVER carried;
//   - timestamps stay source-faithful: date+time sources → full ISO; date-only
//     sources → date-only ISO (midnight is never invented);
//   - a job's site_external_id is EITHER empty (address/postcode evidence only —
//     the v1/v2 invariant for FY-derived rows) OR, for 11K-reconstructed
//     current-window jobs, an EXACT work-address account on which every
//     corroborating source agrees and which resolves within the package;
//   - job_number always equals external_id (recorded invariant).

// ── Phase 11N: GOVERNED PROFILE TYPES + field-scoped value normalisation ────
//
// Phase 11M invalidated 1,349 of 1,613 customer rows and 860 of 962 site rows
// because Commusoft's literal export placeholder for "this customer has no
// telephone number" was carried into the package verbatim, and the governed
// profile types those columns `phone`. A non-empty cell with no digits is an
// invalid phone, and one invalid cell invalidates the WHOLE row.
//
// The correction is a narrow, field-scoped contract — never a broad text
// replacement over the package, which would silently rewrite real customer data.

/** The governed import-profile column contract: name, type and requiredness,
 *  mirroring migration 20260912120000. `governedProfilesMatch` in the HTTP suite
 *  binds this to the LIVE import_profiles rows so the two cannot drift. */
export const GOVERNED_PROFILES = {
  customers: {
    profile: "Commusoft Prepared Customers",
    columns: [
      { canonical: "source_system", type: "text" },
      { canonical: "external_id", type: "text", required: true },
      { canonical: "record_kind", type: "text", required: true },
      { canonical: "display_name", type: "text" },
      { canonical: "title", type: "text" },
      { canonical: "first_name", type: "text" },
      { canonical: "last_name", type: "text" },
      { canonical: "company_name", type: "text" },
      { canonical: "primary_phone", type: "phone" },
      { canonical: "secondary_phone", type: "phone" },
      { canonical: "primary_email", type: "email" },
      { canonical: "address_text", type: "text" },
      { canonical: "postcode", type: "postcode" },
      { canonical: "active", type: "bool" },
      { canonical: "metadata_json", type: "text" },
    ],
  },
  sites: {
    profile: "Commusoft Prepared Sites",
    columns: [
      { canonical: "source_system", type: "text" },
      { canonical: "external_id", type: "text", required: true },
      { canonical: "customer_external_id", type: "text", required: true },
      { canonical: "label", type: "text" },
      { canonical: "address_text", type: "text" },
      { canonical: "postcode", type: "postcode" },
      { canonical: "primary_phone", type: "phone" },
      { canonical: "primary_email", type: "email" },
      { canonical: "active", type: "bool" },
      { canonical: "metadata_json", type: "text" },
    ],
  },
  jobs: {
    profile: "Commusoft Prepared Jobs",
    columns: [
      { canonical: "source_system", type: "text" },
      { canonical: "external_id", type: "text", required: true },
      { canonical: "job_number", type: "text" },
      { canonical: "customer_external_id", type: "text", required: true },
      { canonical: "site_external_id", type: "text" },
      { canonical: "site_address_text", type: "text" },
      { canonical: "site_postcode", type: "postcode" },
      { canonical: "title", type: "text" },
      { canonical: "description", type: "text" },
      { canonical: "status", type: "text", required: true },
      { canonical: "active", type: "bool" },
      { canonical: "created_date", type: "text" },
      { canonical: "completed_date", type: "text" },
      { canonical: "value_pennies", type: "number" },
      { canonical: "quoted_value_pennies", type: "number" },
      { canonical: "engineer", type: "text" },
      { canonical: "metadata_json", type: "text" },
    ],
  },
};

/** Column ORDER is the governed schema, derived so it can never diverge. */
const columnNames = (entity) => GOVERNED_PROFILES[entity].columns.map((c) => c.canonical);
export const CUSTOMER_COLUMNS = columnNames("customers");
export const SITE_COLUMNS = columnNames("sites");
export const JOB_COLUMNS = columnNames("jobs");

/**
 * PROVEN Commusoft "no value" sentinels, scoped to the EXACT entity and field
 * they were observed in. A sentinel is only ever blanked in an OPTIONAL field of
 * a type that cannot represent it — blanking a required field, or a field whose
 * type would happily accept the text, is refused by assertSentinelContract().
 *
 * Provenance: observed in the v3 package at 973 customer primary_phone, 596
 * customer secondary_phone and 860 site primary_phone cells. It is Commusoft's
 * rendering of "this record has no telephone numbers saved", not customer data.
 */
export const SOURCE_SENTINELS = {
  customers: {
    primary_phone: ["No numbers saved"],
    secondary_phone: ["No numbers saved"],
  },
  sites: {
    primary_phone: ["No numbers saved"],
  },
};

/** Every reason a prepared cell may be emptied. Recorded in the manifest as
 *  aggregate counts by entity, field and reason — never as values. */
export const EXCLUSION_REASONS = {
  SENTINEL: "source_no_value_sentinel",
  MALFORMED: "malformed_optional_endpoint",
};

/** Types whose value is an optional CONTACT ENDPOINT. A malformed endpoint may
 *  be dropped on its own; nothing else may be. */
const ENDPOINT_TYPES = new Set(["phone", "email"]);

const columnSpec = (entity, field) =>
  (GOVERNED_PROFILES[entity]?.columns ?? []).find((c) => c.canonical === field) ?? null;

/**
 * Fail-closed guard on the sentinel table itself: a sentinel may only be
 * declared for a field that EXISTS, is OPTIONAL, and whose governed type cannot
 * represent the sentinel text. Called by the builder and by the tests.
 */
export function assertSentinelContract() {
  const problems = [];
  for (const [entity, fields] of Object.entries(SOURCE_SENTINELS)) {
    for (const [field, values] of Object.entries(fields)) {
      const spec = columnSpec(entity, field);
      if (!spec) problems.push(`${entity}.${field}: not a governed column`);
      else if (spec.required)
        problems.push(`${entity}.${field}: is REQUIRED — a sentinel may not blank it`);
      else if (!ENDPOINT_TYPES.has(spec.type))
        problems.push(`${entity}.${field}: type "${spec.type}" is not an optional endpoint type`);
      for (const v of values)
        if (typeof v !== "string" || v.trim() === "")
          problems.push(`${entity}.${field}: an empty sentinel is not a sentinel`);
    }
  }
  if (problems.length) throw new Error(`sentinel contract violated:\n  ${problems.join("\n  ")}`);
  return true;
}

/**
 * Normalise ONE prepared record against the governed profile, field by field.
 *
 * Rules, in order, and nothing else:
 *   1. a blank stays blank — normalisation never invents a value;
 *   2. a value equal to a PROVEN sentinel for THAT entity+field becomes blank;
 *   3. a valid value is passed through byte-for-byte, source-faithful;
 *   4. an OPTIONAL ENDPOINT that is still not coercible is dropped — that
 *      endpoint alone, never the record, and never replaced by a guess;
 *   5. anything else that fails coercion is LEFT ALONE, so the fail-closed
 *      package contract refuses the package rather than the builder quietly
 *      papering over a defect it does not understand.
 *
 * @param coerce the REAL importer coercion (supabase/functions/_shared/imports/profile.ts)
 * @param tally  mutable {"entity.field.reason": count} aggregate — counts only
 */
export function normalizeRecord(entity, record, coerce, tally) {
  const out = { ...record };
  const bump = (field, reason) => {
    const k = `${entity}.${field}.${reason}`;
    tally[k] = (tally[k] ?? 0) + 1;
  };
  for (const spec of GOVERNED_PROFILES[entity].columns) {
    const field = spec.canonical;
    const raw = String(out[field] ?? "");
    if (raw.trim() === "") continue; // rule 1

    const sentinels = SOURCE_SENTINELS[entity]?.[field] ?? [];
    if (sentinels.includes(raw.trim())) {
      out[field] = ""; // rule 2
      bump(field, EXCLUSION_REASONS.SENTINEL);
      continue;
    }
    const c = coerce(spec.type, raw);
    if (!c.error) continue; // rule 3
    if (ENDPOINT_TYPES.has(spec.type) && !spec.required) {
      out[field] = ""; // rule 4
      bump(field, EXCLUSION_REASONS.MALFORMED);
      continue;
    }
    // rule 5 — deliberately untouched; the contract will refuse the package
  }
  return out;
}

/** Apply normalizeRecord across a whole entity, returning records + aggregates. */
export function normalizeRecords(entity, records, coerce) {
  assertSentinelContract();
  const tally = {};
  const out = records.map((r) => normalizeRecord(entity, r, coerce, tally));
  return { records: out, exclusions: tally };
}

/** Customer types that are PEOPLE; everything else is a company_contact.
 *  Derived from the recorded 1,266/347 split (1,240 + 25 + 1 = 1,266). */
export const PERSON_TYPES = new Set(["Private customer", "Private Landlord", "Staff Member"]);

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};
function unescapeHtml(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;|&#\d+;/g, (m) => ENTITIES[m] ?? m);
}

/** Parse a Commusoft HTML-table ".xls" export: returns {header, rows} where the
 *  header is the first row containing `keyColumn` and rows are the cell arrays
 *  of matching width after it. Meta/banner rows never match. */
export function parseHtmlTable(text, keyColumn) {
  const rawRows = text.split("</tr>");
  const all = [];
  for (const chunk of rawRows) {
    const cells = [...chunk.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      unescapeHtml(m[1].replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length) all.push(cells);
  }
  const headerIdx = all.findIndex((r) => r.includes(keyColumn));
  if (headerIdx < 0) throw new Error(`source schema refused: no header row carries "${keyColumn}"`);
  const header = all[headerIdx];
  const rows = all.slice(headerIdx + 1).filter((r) => r.length === header.length);
  return { header, rows };
}

/** Strict header check — a source export with renamed/missing columns is REFUSED,
 *  never guessed around. `required` lists the columns the recipe reads. */
export function requireColumns(header, required, label) {
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length)
    throw new Error(`source schema refused: ${label} is missing column(s) ${missing.join(", ")}`);
  return (row, col) => row[header.indexOf(col)] ?? "";
}

/** dd/mm/yy [hh:mm am|pm] → source-faithful ISO. Date-only stays date-only —
 *  midnight is never invented. Two-digit years are 20yy (source system era). */
export function sourceIso(raw) {
  const m = String(raw ?? "")
    .trim()
    .match(/^(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm))?$/i);
  if (!m) return "";
  const [, dd, mm, yy, h, min, ap] = m;
  const year = yy.length === 2 ? `20${yy}` : yy;
  const date = `${year}-${mm}-${dd}`;
  if (!h) return date;
  let hour = Number(h) % 12;
  if ((ap ?? "").toLowerCase() === "pm") hour += 12;
  return `${date}T${String(hour).padStart(2, "0")}:${min}:00Z`;
}

/** "1,234.56" → integer pennies (never floats in output). Empty → "". */
export function pennies(raw) {
  const s = String(raw ?? "").replace(/[£,\s]/g, "");
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 100));
}

const joinAddress = (parts) =>
  parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
/** Deterministic compact metadata JSON: sorted keys, empty values dropped. */
export function metaJson(obj) {
  const clean = Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v !== "" && v !== null && v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return Object.keys(clean).length ? JSON.stringify(clean) : "";
}

const byNumericId = (col) => (a, b) => Number(a[col]) - Number(b[col]);

/** Customers export → prepared customer records (profile column order). */
export function buildCustomers(parsed) {
  const get = requireColumns(
    parsed.header,
    [
      "Name",
      "Customer Account Number",
      "Telephone",
      "Mobile",
      "Email",
      "Address line 1",
      "Town",
      "County",
      "Postcode",
      "Status",
      "Date Created",
      "Customer type",
    ],
    "customers export",
  );
  return parsed.rows
    .filter((r) => /^\d+$/.test(get(r, "Customer Account Number")))
    .map((r) => {
      const kind = PERSON_TYPES.has(get(r, "Customer type")) ? "person" : "company_contact";
      return {
        source_system: "commusoft",
        external_id: get(r, "Customer Account Number"),
        record_kind: kind,
        display_name: get(r, "Name"),
        title: "",
        first_name: "",
        last_name: "",
        company_name: kind === "company_contact" ? get(r, "Name") : "",
        primary_phone: get(r, "Telephone"),
        secondary_phone: get(r, "Mobile"),
        primary_email: get(r, "Email"),
        address_text: joinAddress([
          get(r, "Address line 1"),
          get(r, "Address line 2"),
          get(r, "Address line 3"),
          get(r, "Town"),
          get(r, "County"),
        ]),
        postcode: get(r, "Postcode"),
        active: get(r, "Status") === "Active" ? "true" : "false",
        // Marketing preferences (the "Advertising" column) are DELIBERATELY absent.
        metadata_json: metaJson({
          building_type: get(r, "Building type"),
          customer_type: get(r, "Customer type"),
          date_created: sourceIso(get(r, "Date Created")),
        }),
      };
    })
    .sort(byNumericId("external_id"));
}

/** Work-addresses export → prepared site records. */
export function buildSites(parsed) {
  const get = requireColumns(
    parsed.header,
    [
      "WorkAddress Account Number",
      "Customer Account Number",
      "Work Address Name",
      "Work Address Line1",
      "Work address town",
      "Work address postcode",
      "Work Address Telephone",
      "Work Address Mobile",
      "Work Address Email",
      "Status",
      "Date Created",
    ],
    "work-addresses export",
  );
  return parsed.rows
    .filter((r) => /^\d+$/.test(get(r, "WorkAddress Account Number")))
    .map((r) => ({
      source_system: "commusoft",
      external_id: get(r, "WorkAddress Account Number"),
      customer_external_id: get(r, "Customer Account Number"),
      label: get(r, "Work Address Name"),
      address_text: joinAddress([
        get(r, "Work Address Line1"),
        get(r, "Work Address Line2"),
        get(r, "Work Address Line3"),
        get(r, "Work address town"),
        get(r, "Work Address County"),
      ]),
      postcode: get(r, "Work address postcode"),
      primary_phone: get(r, "Work Address Telephone") || get(r, "Work Address Mobile"),
      primary_email: get(r, "Work Address Email"),
      active: get(r, "Status") === "Active" ? "true" : "false",
      metadata_json: metaJson({
        building_type: get(r, "Building type"),
        vacant: get(r, "Vacant"),
        date_created: sourceIso(get(r, "Date Created")),
      }),
    }))
    .sort(byNumericId("external_id"));
}

/** FY profit window + all-time aborted export → prepared job records.
 *  Aborted status WINS for numbers present in both (recorded invariant: the 338
 *  FY-complete jobs that were later aborted count as aborted). */
export function buildJobs(profitParsed, abortedParsed) {
  const getP = requireColumns(
    profitParsed.header,
    [
      "Job date",
      "Customer Account Number",
      "Job description",
      "Job number",
      "Final invoice raised",
      "Job Address Line 1",
      "Job Address Town",
      "Job Address Postcode",
      "Total revenue",
      "Job is complete",
    ],
    "profit-by-job export",
  );
  const getA = requireColumns(
    abortedParsed.header,
    [
      "Abort date/time",
      "Abort reason",
      "Customer Account Number",
      "Job Number",
      "Job Address Name",
    ],
    "aborted-jobs export",
  );
  const abortedRows = abortedParsed.rows.filter((r) => /^\d+$/.test(getA(r, "Job Number")));
  const abortedNums = new Set(abortedRows.map((r) => getA(r, "Job Number")));
  const windowJobs = profitParsed.rows
    .filter(
      (r) =>
        /^\d+$/.test(getP(r, "Job number")) &&
        ["Yes", "No"].includes(getP(r, "Job is complete")) &&
        !abortedNums.has(getP(r, "Job number")),
    )
    .map((r) => ({
      source_system: "commusoft",
      external_id: getP(r, "Job number"),
      job_number: getP(r, "Job number"),
      customer_external_id: getP(r, "Customer Account Number"),
      site_external_id: "", // recorded invariant: address/postcode evidence only
      site_address_text: joinAddress([
        getP(r, "Job Address Line 1"),
        getP(r, "Job Address Line 2"),
        getP(r, "Job Address Town"),
        getP(r, "Job Address County"),
      ]),
      site_postcode: getP(r, "Job Address Postcode"),
      title: "",
      description: getP(r, "Job description"),
      status: getP(r, "Job is complete") === "Yes" ? "completed" : "open",
      active: getP(r, "Job is complete") === "Yes" ? "false" : "true",
      created_date: sourceIso(getP(r, "Job date")),
      completed_date: "", // the source evidences no completion timestamp — never invented
      value_pennies: pennies(getP(r, "Total revenue")),
      quoted_value_pennies: "", // no quote evidence in the surviving sources
      engineer: "", // NO engineer source exists — never guessed
      metadata_json: metaJson({
        final_invoice_raised: getP(r, "Final invoice raised"),
        source_report: "profit_by_job_FY2025-26",
      }),
    }));
  const aborted = abortedRows.map((r) => ({
    source_system: "commusoft",
    external_id: getA(r, "Job Number"),
    job_number: getA(r, "Job Number"),
    customer_external_id: getA(r, "Customer Account Number"),
    site_external_id: "",
    site_address_text: "",
    site_postcode: "",
    title: "",
    description: "",
    status: "aborted",
    active: "false",
    created_date: "", // the aborted export evidences no creation timestamp
    completed_date: "",
    value_pennies: "",
    quoted_value_pennies: "",
    engineer: "",
    metadata_json: metaJson({
      abort_at: sourceIso(getA(r, "Abort date/time")),
      abort_reason: getA(r, "Abort reason"),
      job_address_name: getA(r, "Job Address Name"),
      source_report: "aborted_jobs_all_time",
    }),
  }));
  return [...windowJobs, ...aborted].sort(byNumericId("external_id"));
}

/** RFC-4180 CSV: LF, trailing newline, quote only when needed. */
export function toCsv(columns, records) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const rec of records) lines.push(columns.map((c) => esc(rec[c])).join(","));
  return lines.join("\n") + "\n";
}

/** Package QA — every invariant the approval rests on. REFUSES (throws) on any
 *  breach; returns the privacy-safe report (counts and invariants ONLY). */
export function qaPackage({ customers, sites, jobs }) {
  const fail = (m) => {
    throw new Error(`package QA refused: ${m}`);
  };
  const dupes = (list) => list.length - new Set(list).size;
  const custIds = customers.map((c) => c.external_id);
  const siteIds = sites.map((s) => s.external_id); // also validates job→site refs below
  const jobIds = jobs.map((j) => j.external_id);
  if (dupes(custIds)) fail(`${dupes(custIds)} duplicate customer external ids`);
  if (dupes(siteIds)) fail(`${dupes(siteIds)} duplicate site external ids`);
  if (dupes(jobIds)) fail(`${dupes(jobIds)} duplicate job external ids`);
  const custSet = new Set(custIds);
  const siteOrphans = sites.filter((s) => !custSet.has(s.customer_external_id)).length;
  const jobOrphans = jobs.filter((j) => !custSet.has(j.customer_external_id)).length;
  if (siteOrphans) fail(`${siteOrphans} site rows reference customers OUTSIDE the package`);
  if (jobOrphans) fail(`${jobOrphans} job rows reference customers OUTSIDE the package`);
  for (const c of customers) {
    if (!/^\d+$/.test(c.external_id)) fail("non-numeric customer external id");
    if (!["person", "company_contact"].includes(c.record_kind)) fail("unknown record_kind");
  }
  if (jobs.some((j) => j.job_number !== j.external_id))
    fail("job_number must equal the governed external id on every row");
  // 11K: a job's site link is EITHER empty (address evidence only) OR an exact
  // work-address account resolving WITHIN the package — never a guess.
  const siteSet = new Set(siteIds);
  const badSiteRefs = jobs.filter(
    (j) => j.site_external_id !== "" && !siteSet.has(j.site_external_id),
  ).length;
  if (badSiteRefs) fail(`${badSiteRefs} job rows reference sites OUTSIDE the package`);
  if (jobs.some((j) => j.engineer !== "")) fail("engineers must never be guessed");
  const marketingLeak = [customers, sites, jobs].some((list) =>
    list.some((r) => /advertising|marketing|opt[_-]?in/i.test(r.metadata_json ?? "")),
  );
  if (marketingLeak) fail("marketing preferences must remain absent");
  const kind = (k) => customers.filter((c) => c.record_kind === k).length;
  const act = (list) => list.filter((r) => r.active === "true").length;
  const st = (s) => jobs.filter((j) => j.status === s).length;
  if (st("completed") + st("open") + st("aborted") !== jobs.length) fail("unknown job status");
  return {
    customers: {
      rows: customers.length,
      person: kind("person"),
      company_contact: kind("company_contact"),
      active: act(customers),
      inactive: customers.length - act(customers),
    },
    sites: { rows: sites.length, active: act(sites), inactive: sites.length - act(sites) },
    jobs: {
      rows: jobs.length,
      completed: st("completed"),
      open: st("open"),
      aborted: st("aborted"),
    },
    relationships: {
      site_customer_refs_resolved: sites.length,
      job_customer_refs_resolved: jobs.length,
      jobs_with_exact_site_link: jobs.filter((j) => j.site_external_id !== "").length,
      orphans: 0,
      duplicates: 0,
    },
    invariants: {
      job_number_equals_external_id: true,
      job_site_links_exact_or_absent: true,
      engineers_never_guessed: true,
      marketing_preferences_absent: true,
      timestamps_source_faithful: true,
    },
  };
}

/** OFFLINE financial-dependency reconciliation (counts/ids only — the caller
 *  must never print row content). */
export function reconcileFinancialsToJobs(financialExternalIds, jobExternalIds) {
  const jobSet = new Set(jobExternalIds);
  const perId = new Map();
  for (const id of financialExternalIds) perId.set(id, (perId.get(id) ?? 0) + 1);
  const matchedIds = [...perId.keys()].filter((id) => jobSet.has(id));
  const unmatchedIds = [...perId.keys()].filter((id) => !jobSet.has(id));
  const rowsFor = (ids) => ids.reduce((n, id) => n + perId.get(id), 0);
  return {
    financial_rows: financialExternalIds.length,
    distinct_financial_job_ids: perId.size,
    matched_job_ids: matchedIds.length,
    matched_rows: rowsFor(matchedIds),
    unmatched_job_ids: unmatchedIds.length,
    unmatched_rows: rowsFor(unmatchedIds),
    duplicate_financial_ids: [...perId.values()].filter((n) => n > 1).length,
    canonical_jobs_without_financials: [...jobSet].filter((id) => !perId.has(id)).length,
  };
}

// ═══ Phase 11K — current-window gap classification + v3 reconstruction ════════
//
// The v2 package covers FY2025-26 + aborted only: 584 financial rows in the
// 2026-05-01→2026-08-04 window reference Jobs with no canonical row. These
// functions EXHAUST the surviving local evidence to close that gap SAFELY:
// a Job is reconstructed ONLY from its exact source-system identity in the
// current-window profit export, attached ONLY to an exactly evidenced customer
// already in the package, with a site attached ONLY when every corroborating
// source agrees on exactly one work-address account that resolves in-package.
// Anything less becomes an HONEST category — never a fabricated Job, never a
// financial-only shell, never fuzzy matching as truth.

/** Commusoft JSON window export ({header, rows:[ [cells…] ]}) → parse shape. */
export function fromJsonWindow(json) {
  if (!json || !Array.isArray(json.header) || !Array.isArray(json.rows))
    throw new Error("source schema refused: JSON window must carry header[] and rows[]");
  const header = json.header.map((h) => String(h).trim());
  const rows = json.rows
    .filter((r) => Array.isArray(r) && r.length === header.length)
    .map((r) =>
      r.map((c) =>
        String(c ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    );
  return { header, rows };
}

/** Exact (job, customer, work-address) pairs from a corroborating export.
 *  Only digit-form identifiers count — free-text references are NEVER used. */
export function corroborationPairs(
  parsed,
  { jobCol, customerCol, workAddressCol, typeCol, typeIs },
  sourceType,
) {
  const get = requireColumns(
    parsed.header,
    [jobCol, customerCol].concat(workAddressCol ? [workAddressCol] : []),
    `${sourceType} export`,
  );
  return parsed.rows
    .filter((r) => !typeCol || String(get(r, typeCol)).toLowerCase().includes(typeIs))
    .filter((r) => /^\d+$/.test(get(r, jobCol)))
    .map((r) => ({
      sourceType,
      job: get(r, jobCol),
      customer: /^\d+$/.test(get(r, customerCol)) ? get(r, customerCol) : "",
      workAddress:
        workAddressCol && /^\d+$/.test(get(r, workAddressCol)) ? get(r, workAddressCol) : "",
    }));
}

/** Fold pair lists into per-job corroboration evidence. */
export function buildCorroboration(pairLists) {
  const byJob = new Map();
  for (const pairs of pairLists)
    for (const p of pairs) {
      const e = byJob.get(p.job) ?? {
        customers: new Set(),
        workAddresses: new Set(),
        sources: new Set(),
      };
      if (p.customer) e.customers.add(p.customer);
      if (p.workAddress) e.workAddresses.add(p.workAddress);
      e.sources.add(p.sourceType);
      byJob.set(p.job, e);
    }
  return byJob;
}

export const GAP_CATEGORIES = [
  "fully_reconstructable",
  "job_evidenced_customer_unresolved",
  "financial_only_no_job_evidence",
  "conflict_or_duplicate",
];

/** Classify every unmatched financial Job id into EXACTLY ONE category and
 *  reconstruct category-1 Jobs. Returns aggregates + records — the CALLER must
 *  never print identifiers or row content. */
export function classifyCurrentWindowGap({
  unmatchedIds,
  profitWindow, // parse shape of the current-window profit export
  customerIds, // Set — package customers
  siteIds, // Set — package sites
  corroboration, // Map from buildCorroboration
  windowLabel,
}) {
  const get = requireColumns(
    profitWindow.header,
    ["Job date", "Customer Account Number", "Job description", "Job number", "Job is complete"],
    "current-window profit export",
  );
  const rowsByJob = new Map();
  for (const r of profitWindow.rows) {
    const num = get(r, "Job number");
    if (!/^\d+$/.test(num)) continue;
    (rowsByJob.get(num) ?? rowsByJob.set(num, []).get(num)).push(r);
  }
  const counts = Object.fromEntries(GAP_CATEGORIES.map((c) => [c, 0]));
  const provenance = {
    corroborated: 0,
    by_source_type: {},
    site_exact: 0,
    customer_conflicts: 0,
    duplicate_rows: 0,
  };
  const reconstructable = [];
  for (const id of unmatchedIds) {
    const rows = rowsByJob.get(id) ?? [];
    const cor = corroboration.get(id);
    if (cor) {
      provenance.corroborated++;
      for (const s of cor.sources)
        provenance.by_source_type[s] = (provenance.by_source_type[s] ?? 0) + 1;
    }
    if (rows.length === 0) {
      counts.financial_only_no_job_evidence++;
      continue;
    }
    const distinct = new Set(rows.map((r) => JSON.stringify(r)));
    if (distinct.size > 1) {
      counts.conflict_or_duplicate++;
      provenance.duplicate_rows++;
      continue;
    }
    const r = rows[0];
    const status = get(r, "Job is complete");
    const hasCore =
      ["Yes", "No"].includes(status) && (get(r, "Job date") || get(r, "Job description"));
    if (!hasCore) {
      counts.financial_only_no_job_evidence++;
      continue;
    }
    const customer = get(r, "Customer Account Number");
    const customerExact = /^\d+$/.test(customer) && customerIds.has(customer);
    // Cross-source conflict: any corroborating source naming a DIFFERENT customer.
    const conflicting = cor && customer && [...cor.customers].some((c) => c !== customer);
    if (conflicting) {
      counts.conflict_or_duplicate++;
      provenance.customer_conflicts++;
      continue;
    }
    if (!customerExact) {
      counts.job_evidenced_customer_unresolved++;
      continue;
    }
    // Exact site: every corroborating source agrees on ONE work-address account
    // that resolves within the package. Anything else stays address-evidence only.
    let siteId = "";
    if (cor && cor.workAddresses.size === 1) {
      const wa = [...cor.workAddresses][0];
      if (siteIds.has(wa)) {
        siteId = wa;
        provenance.site_exact++;
      }
    }
    counts.fully_reconstructable++;
    reconstructable.push({
      source_system: "commusoft",
      external_id: id,
      job_number: id,
      customer_external_id: customer,
      site_external_id: siteId,
      site_address_text: joinAddress([
        get(r, "Job Address Line 1"),
        get(r, "Job Address Line 2"),
        get(r, "Job Address Town"),
        get(r, "Job Address County"),
      ]),
      site_postcode: get(r, "Job Address Postcode"),
      title: "",
      description: get(r, "Job description"),
      status: status === "Yes" ? "completed" : "open",
      active: status === "Yes" ? "false" : "true",
      created_date: sourceIso(get(r, "Job date")),
      completed_date: "",
      value_pennies: pennies(get(r, "Total revenue")),
      quoted_value_pennies: "",
      engineer: "", // still never guessed
      metadata_json: metaJson({
        final_invoice_raised: get(r, "Final invoice raised"),
        source_report: windowLabel,
        corroborated_by: cor ? [...cor.sources].sort().join(",") : "",
      }),
    });
  }
  const total = GAP_CATEGORIES.reduce((n, c) => n + counts[c], 0);
  if (total !== unmatchedIds.length)
    throw new Error(
      `classification incomplete: categories total ${total} but ${unmatchedIds.length} ids were classified`,
    );
  reconstructable.sort((a, b) => Number(a.external_id) - Number(b.external_id));
  return { counts, provenance, reconstructable, classified: unmatchedIds.length };
}
