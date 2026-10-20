/** Cursor over complete source identity groups, never an individual version. */
export function nextSourceCursor(rows, prior) {
  if (!Array.isArray(rows) || rows.length > 400) throw Error('source_page_size');
  let last = prior ? `${prior.collection}\u0000${prior.external_id}` : null;
  let groups = 0;
  for (const [index, row] of rows.entries()) {
    if (!['jobs', 'properties'].includes(row.collection) ||
      typeof row.external_id !== 'string' || !row.external_id)
      throw Error('source_page_shape');
    const key = `${row.collection}\u0000${row.external_id}`;
    if (index === 0 && last !== null && key <= last)
      throw Error('source_page_order');
    if (last !== key) {
      if (last !== null && key <= last) throw Error('source_page_order');
      groups++;
    }
    last = key;
  }
  if (groups > 200) throw Error('source_page_group_limit');
  return rows.length ? { collection: rows.at(-1).collection,
    external_id: rows.at(-1).external_id } : null;
}
