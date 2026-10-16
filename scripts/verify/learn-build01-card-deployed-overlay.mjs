/** Exact-source overlay for a concurrent card revision in the deployed worker. */
import { createHash } from 'node:crypto';

export const CARD_WORKER_BASELINE_SHA = 'd1e69494f18179b534fdd959aafea25ea67b22d859b6c143392db39a8523adcd';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

function replaceOnce(source, oldPart, newPart) {
  if (source.indexOf(oldPart) < 0 || source.indexOf(oldPart) !== source.lastIndexOf(oldPart))
    throw Error('Reviewed deployed card-handler shape changed');
  return source.replace(oldPart, newPart);
}

export function patchDeployedCardHandler(source) {
  if (sha256(source) !== CARD_WORKER_BASELINE_SHA)
    throw Error('Deployed card-handler baseline changed');
  let next = replaceOnce(source,
    'let skipped = 0;\n    let failed = 0;\n    const healthCounts = {',
    'let skipped = 0;\n    let failed = 0;\n    let revisionConflicts = 0;\n    const healthCounts = {');
  next = replaceOnce(next,
    'if (updErr || updatedCard?.id !== cardId) {\n          failed += 1;\n          continue;\n        }\n        cardsProjected += 1;',
    `if (updErr) {
          failed += 1;
          continue;
        }
        if (updatedCard?.id !== cardId) {
          // Recheck only the revision. A concurrent writer's new card state
          // belongs to the next sweep, never to this stale projection.
          const { data: currentCard, error: currentErr } = await admin.from("customer_cards")
            .select("updated_at").eq("tenant_id", tenantId).eq("id", cardId).maybeSingle();
          if (!currentErr && typeof currentCard?.updated_at === "string" &&
            currentCard.updated_at !== card.updated_at) {
            revisionConflicts += 1;
            skipped += 1;
            continue;
          }
          failed += 1;
          continue;
        }
        cardsProjected += 1;`);
  next = replaceOnce(next,
    'cards_projected: cardsProjected,\n        skipped,\n        failed,',
    'cards_projected: cardsProjected,\n        skipped,\n        revision_conflicts: revisionConflicts,\n        failed,');
  return next;
}
