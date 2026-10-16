/** Keep Email inventory diagnosis out of the fenced queue result shape. */
import { createHash } from 'node:crypto';
export function patchDeployedEmailDiagnosticSettlement(source) {
  if (createHash('sha256').update(source).digest('hex') !==
    '48749186c599fdba05b4c478067c3fd34e0adb673c3b4023ffed4bf5614fdf81')
    throw Error('Email diagnostic settlement source baseline changed');
  const before = `  } catch  {
    return {
      success: false,
      recordsProcessed: counts.interactions_upserted,
      result: {
        ...counts,
        inventory_step: inventoryStep,
        database_error_code: databaseErrorCode
      },`;
  const after = `  } catch  {
    if (source === "email" && !currentEmail && (ctx.claim?.attemptCount ?? 1) > 1) {
      console.warn(\`learn_email_inventory_stage=\${inventoryStep} database_code=\${databaseErrorCode ?? "none"}\`);
    }
    return {
      success: false,
      recordsProcessed: counts.interactions_upserted,
      result: counts,`;
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0)
    throw Error('Email diagnostic settlement source anchor changed');
  return source.slice(0, at) + after + source.slice(at + before.length);
}
