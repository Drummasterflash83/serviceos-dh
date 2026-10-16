/** Exact, content-free failure-stage receipt for the deployed projection worker. */
import { createHash } from 'node:crypto';

const BASELINE='886f0d86e57e376130b7ca9e678932d718952d9ae70649a2a6142f780f2ace89';
const sha256=value=>createHash('sha256').update(value).digest('hex');
function once(source,before,after) {
  const at=source.indexOf(before);
  if(at<0 || source.indexOf(before,at+before.length)>=0)
    throw Error('Email diagnostic source anchor changed');
  return source.slice(0,at)+after+source.slice(at+before.length);
}
export function patchDeployedEmailDiagnostic(source) {
  if(sha256(source)!==BASELINE) throw Error('Email diagnostic deployed baseline changed');
  let output=once(source,
    '    failed: 0\n  };\n  try {',
    `    failed: 0
  };
  let inventoryStep = "selector_rpc";
  let databaseErrorCode = null;
  try {`);
  output=once(output,
    '    if (error || !Array.isArray(rows) || rows.length > limit || rows.some',
    `    if (error) {
      databaseErrorCode = typeof error.code === "string" && /^[A-Z0-9_]{3,12}$/.test(error.code) ? error.code : null;
      throw Error("inventory");
    }
    inventoryStep = "selector_shape";
    if (!Array.isArray(rows) || rows.length > limit || rows.some`);
  output=once(output,
    '    if (!currentEmail) {\n      const review = await admin.rpc("learn_projection_review_count", {',
    `    if (!currentEmail) {
      inventoryStep = "review_rpc";
      const review = await admin.rpc("learn_projection_review_count", {`);
  output=once(output,
    '      if (review.error || !Number.isSafeInteger(review.data) || review.data < 0) throw Error("review_inventory");',
    `      if (review.error) {
        databaseErrorCode = typeof review.error.code === "string" && /^[A-Z0-9_]{3,12}$/.test(review.error.code) ? review.error.code : null;
        throw Error("review_inventory");
      }
      inventoryStep = "review_shape";
      if (!Number.isSafeInteger(review.data) || review.data < 0) throw Error("review_inventory");`);
  output=once(output,
    '      result: counts,\n      error: {\n        code: "projection_inventory_unconfirmed",',
    `      result: { ...counts, inventory_step: inventoryStep, database_error_code: databaseErrorCode },
      error: {
        code: "projection_inventory_unconfirmed",`);
  return output;
}
