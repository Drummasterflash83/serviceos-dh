/** Release 055 added transcript provenance, not new Auth-user triggers. Accept
 * precisely those additions, then retain every earlier fixture-contract check. */
import { actionAuthContractMatches } from "./learn-test-actions-acceptance.mjs";
const columns = { source_storage_path: "text", source_sha256: "text", processing_run_id: "uuid" };
const foreignKey = "FOREIGN KEY (processing_run_id) REFERENCES phone_sync_runs(id)";
export function phoneProcessingAuthContractMatches(contract) {
  try {
    const copy = structuredClone(contract),
      tables = copy?.tables;
    if (!Array.isArray(tables) || tables.filter((t) => t.name === "phone_transcripts").length !== 1)
      return false;
    const table = tables.find((t) => t.name === "phone_transcripts");
    if (!Array.isArray(table.columns) || !Array.isArray(table.constraints)) return false;
    for (const [name, type] of Object.entries(columns)) {
      const matches = table.columns.filter((c) => c.name === name);
      if (
        matches.length !== 1 ||
        matches[0].type !== type ||
        matches[0].default !== null ||
        matches[0].notNull !== false ||
        Object.keys(matches[0]).sort().join(",") !== "default,name,notNull,type"
      )
        return false;
    }
    if (table.constraints.filter((c) => c === foreignKey).length !== 1) return false;
    table.columns = table.columns.filter((c) => !Object.hasOwn(columns, c.name));
    table.constraints = table.constraints.filter((c) => c !== foreignKey);
    return actionAuthContractMatches(copy);
  } catch {
    return false;
  }
}
