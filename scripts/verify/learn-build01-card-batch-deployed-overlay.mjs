/** Exact downloaded-source card sweep batch patch; no other module changes. */
import { createHash } from 'node:crypto';

export const CARD_BATCH_BASELINE_SHA = '0b3ca8167e0fbef67c850ff0f630cc96e243915378522abf705a9b459e07cd34';
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function patchDeployedCardBatch(source) {
  if (sha256(source) !== CARD_BATCH_BASELINE_SHA)
    throw Error('Deployed card handler baseline changed');
  const old = 'const DEFAULT_LIMIT = 200;';
  if (source.indexOf(old) < 0 || source.indexOf(old) !== source.lastIndexOf(old))
    throw Error('Reviewed card batch constant changed');
  return source.replace(old, `// A full sweep performs per-card source reads and graph-edge pagination. Keep its
// unattended batch below the five-minute platform-job lease under LIVE load.
const DEFAULT_LIMIT = 40;`);
}
