/** Exact, fail-closed patch of the serving v106 card handler only. */
import { createHash } from "node:crypto";
export const BASELINE_SHA256 = "3af16b56ac055277cd0b67677d0fa8858e6db02cbb654ecbaaada9c5f143e6c2";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function once(value, before, after) {
  const at = value.indexOf(before);
  if (at < 0 || value.indexOf(before, at + before.length) >= 0)
    throw Error("Serving card phase anchor changed");
  return value.slice(0, at) + after + value.slice(at + before.length);
}
export function patchDeployedCardPhase(source) {
  if (sha256(source) !== BASELINE_SHA256)
    throw Error("Serving card handler baseline changed");
  let patched = source;
  patched = once(patched, "    let revisionConflicts = 0;\n    const healthCounts = {",
    `    let revisionConflicts = 0;
    let inputRetries = 0;
    const failurePhases = { identity: 0, inputs: 0, projection: 0, update: 0 };
    const healthCounts = {`);
  patched = once(patched, "    for (const card of cards){\n      try {",
    `    for (const card of cards){
      let phase = "identity";
      try {`);
  patched = once(patched, `        const { data: inputData, error: inputError } = await admin.rpc("learn_card_projection_inputs", {
          p_tenant: tenantId,
          p_card: cardId
        });`,
    `        phase = "inputs";
        let { data: inputData, error: inputError } = await admin.rpc("learn_card_projection_inputs", {
          p_tenant: tenantId,
          p_card: cardId
        });
        // Retry only the read-only source input once; never retry an ambiguous update.
        if (inputError) {
          inputRetries += 1;
          ({ data: inputData, error: inputError } = await admin.rpc("learn_card_projection_inputs", {
            p_tenant: tenantId,
            p_card: cardId
          }));
        }`);
  patched = once(patched, `        ].reverse();
        // ── Communication`,
    `        ].reverse();
        phase = "projection";
        // ── Communication`);
  patched = once(patched, `        if (typeof card.updated_at !== "string") throw new Error("card_revision_unavailable");
        const { data: updatedCard`,
    `        phase = "update";
        if (typeof card.updated_at !== "string") throw new Error("card_revision_unavailable");
        const { data: updatedCard`);
  patched = once(patched, `        if (updErr) {
          failed += 1;
          continue;
        }`,
    `        if (updErr) {
          failed += 1;
          failurePhases.update += 1;
          continue;
        }`);
  patched = once(patched, `          failed += 1;
          continue;
        }
        cardsProjected += 1;`,
    `          failed += 1;
          failurePhases.update += 1;
          continue;
        }
        cardsProjected += 1;`);
  patched = once(patched, `      } catch (_e) {
        failed += 1; // failure-isolated: one bad card never aborts the batch
      }`,
    `      } catch (_e) {
        failed += 1; // failure-isolated: one bad card never aborts the batch
        failurePhases[phase] += 1;
      }`);
  patched = once(patched, `        revision_conflicts: revisionConflicts,
        failed,`,
    `        revision_conflicts: revisionConflicts,
        input_retries: inputRetries,
        failure_phases: failurePhases,
        failed,`);
  patched = once(patched, '          message: `${failed} card projection(s) failed`,',
    `          message: \`\${failed} card projection(s) failed; phases=\${Object.entries(failurePhases)
            .filter(([, count])=>count > 0).map(([name, count])=>\`\${name}:\${count}\`).join(",")}\`,`);
  if (sha256(patched) === BASELINE_SHA256) throw Error("Card phase patch had no effect");
  return patched;
}
