/**
 * ActivityTable — a generic, column-driven table for recent activity, imports,
 * logs, etc. Columns and rows are supplied by the caller; no domain assumptions.
 */

import type { ReactNode } from "react";

export interface Column<Row> {
  key: string;
  header: string;
  /** Renders the cell for a row (defaults to the raw value at `key`). */
  render?: (row: Row) => ReactNode;
  className?: string;
}

export function ActivityTable<Row extends Record<string, unknown>>({
  title,
  columns,
  rows,
  rowKey,
  emptyLabel = "No activity yet.",
}: {
  title?: string;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  emptyLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-6">
      {title && <div className="text-sm font-semibold">{title}</div>}
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="pb-2 pr-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={rowKey(row, i)} className="border-b border-hairline last:border-0">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`py-2.5 pr-4 text-xs text-foreground ${c.className ?? ""}`}
                    >
                      {c.render ? c.render(row) : String(row[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
