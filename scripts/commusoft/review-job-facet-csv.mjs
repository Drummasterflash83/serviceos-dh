/** Private, default-held review of a bounded Commusoft facet CSV. No DB/provider call. */
import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareJobFacetCsv } from "./prepare-job-facet-csv.mjs";

const decimal = /^-?\d{1,12}(?:\.\d{1,4})?$/;
const currency = /^[A-Z]{3}$/;
const readyText = value => typeof value === "string" && value.trim().length > 0;
const zoned = (row, key) => row.time_states[key] === "zoned";

export function reviewJobFacetCsv(manifest, csv) {
  const staged = prepareJobFacetCsv(manifest, csv);
  const facet = staged.manifest.facet;
  const records = staged.records.map(row => {
    const reasons = [];
    const fields = row.fields;
    if (facet !== "engineers") reasons.push(row.link.state === "source_id_present"
      ? "parent_job_link_unreviewed" : "parent_job_id_missing");
    if (facet === "visits") {
      reasons.push("event_id_semantics_unverified", "visit_status_unreviewed");
      if (!readyText(fields.status)) reasons.push("visit_status_missing");
      if (!zoned(row, "starts_at") || !zoned(row, "ends_at") ||
        Date.parse(fields.ends_at) <= Date.parse(fields.starts_at))
        reasons.push("visit_start_end_unverified");
      reasons.push(readyText(fields.engineer_id)
        ? "source_engineer_unmapped" : "source_engineer_id_missing");
    } else if (facet === "engineers") {
      reasons.push("source_user_identity_unreviewed", "openfolk_staff_link_absent");
      if (!readyText(fields.display_name)) reasons.push("display_name_missing");
      if (!readyText(fields.status)) reasons.push("source_user_status_missing");
    } else if (facet === "estimates" || facet === "invoices") {
      reasons.push("source_document_status_unreviewed", "job_document_link_unverified");
      if (!readyText(fields.status)) reasons.push("source_document_status_missing");
      if (!zoned(row, "issued_at")) reasons.push("issued_time_unverified");
      if (!decimal.test(fields.amount) || !currency.test(fields.currency))
        reasons.push("amount_or_currency_shape_unverified");
    } else if (facet === "parts_costs") {
      reasons.push("line_item_and_cost_semantics_unreviewed");
      if (!readyText(fields.description) || !decimal.test(fields.quantity) ||
        !decimal.test(fields.amount) || !currency.test(fields.currency))
        reasons.push("part_cost_shape_unverified");
    }
    const sourceFieldsNeedReview = reasons.some(reason => [
      "parent_job_id_missing", "visit_start_end_unverified", "visit_status_missing",
      "display_name_missing", "source_user_status_missing", "issued_time_unverified",
      "source_document_status_missing", "amount_or_currency_shape_unverified",
      "part_cost_shape_unverified",
    ].includes(reason));
    return {
      source_record_id: row.identity.source_record_id,
      job_external_id: row.link.job_external_id,
      state: "held",
      shape: sourceFieldsNeedReview ? "needs_source_fields" : "ready_for_source_review",
      hold_reasons: reasons,
    };
  });
  return {
    version: "commusoft-job-facet-review/1",
    scope: staged.manifest,
    input_sha256: staged.sha256,
    freshness: { exported_at: staged.manifest.exported_at,
      record_updated_at: "not_supplied", current_provider_state: "unverified" },
    publication: "off",
    counts: { rows: records.length, held: records.length,
      ready_for_source_review: records.filter(row => row.shape === "ready_for_source_review").length,
      needs_source_fields: records.filter(row => row.shape === "needs_source_fields").length },
    records,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== "--manifest" || args[2] !== "--csv" || args[4] !== "--out")
    throw Error("Usage: node review-job-facet-csv.mjs --manifest scope.json --csv export.csv --out private-review.json");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const manifest = JSON.parse(decoder.decode(await readFile(args[1])));
  const csv = decoder.decode(await readFile(args[3]));
  const result = reviewJobFacetCsv(manifest, csv);
  const handle = await open(args[5], "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(result, null, 2) + "\n"); }
  finally { await handle.close(); }
  process.stdout.write(JSON.stringify({ version: result.version, input_sha256: result.input_sha256,
    publication: result.publication, counts: result.counts }) + "\n");
}
