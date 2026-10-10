/** Validate complete bounded RPC replies before consuming any row result. */
export const IMPORT_BATCH_SIZE = 100;
export type ImportBatchRow = { row_number: number; record: Record<string, unknown>; invalid_fields?: string[] };
export type ImportBatchResult = { action?: string; error_code?: string; [key: string]: unknown };
export function checkedImportBatch(data: unknown, rows: ImportBatchRow[], mode: 'match' | 'apply'): Map<number, ImportBatchResult> {
  if (!Array.isArray(data) || data.length !== rows.length || rows.length < 1 || rows.length > IMPORT_BATCH_SIZE)
    throw Error('Incomplete import batch result');
  const expected = new Set(rows.map(r => r.row_number)), found = new Map<number, ImportBatchResult>();
  const actions = mode === 'match' ? ['new','matched','probable','invalid','held'] : ['created','linked','updated','conflict','held','invalid','already_applied'];
  for (const row of data) {
    const r = row?.result;
    if (!expected.has(row?.row_number) || found.has(row.row_number) || !r || typeof r !== 'object' || Array.isArray(r)) throw Error('Invalid import batch result');
    if (typeof r.error_code === 'string') {
      if (mode !== 'apply' || !/^[0-9A-Z]{5}$/.test(r.error_code) || r.action !== undefined) throw Error('Invalid import batch error');
    } else if (!actions.includes(r.action) || r.error_code !== undefined) throw Error('Invalid import batch action');
    found.set(row.row_number, r);
  }
  return found;
}
