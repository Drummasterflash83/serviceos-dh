// ServiceOS — Import profile mapping + validation + normalizers (PURE, source-neutral).
//
// A profile declares how a source system's columns map to canonical fields. Commusoft mapping is
// a PROFILE (data), never code here. This module: resolves file headers → canonical fields via
// aliases, coerces/normalizes values (phone/email/date/money/postcode), and validates rows. No
// I/O, no DB, no channel/source branching in the engine — the profile carries all specifics.

export type FieldType =
  "text" | "phone" | "email" | "date" | "number" | "money" | "postcode" | "bool";
export type EntityType = "customers" | "jobs" | "staff" | "sites" | "assets";

export interface ColumnSpec {
  canonical: string; // canonical field name, e.g. "primary_phone"
  aliases: string[]; // header names that map to it (case/space/punct-insensitive)
  required?: boolean;
  type?: FieldType;
}
export interface ImportProfileDef {
  columns: ColumnSpec[];
  dateFormats?: string[]; // informational; parser below is format-tolerant
}

export interface ColumnMapping {
  mapping: Record<string, number>; // canonical -> source column index
  unmapped: string[]; // source headers with no canonical target
  missingRequired: string[]; // required canonical fields absent from the file
}

const canon = (s: string) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[\s_\-.]+/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Map file headers to canonical fields using the profile's aliases. */
export function resolveColumnMapping(headers: string[], def: ImportProfileDef): ColumnMapping {
  const norm = headers.map(canon);
  const mapping: Record<string, number> = {};
  const usedIdx = new Set<number>();
  for (const col of def.columns) {
    const candidates = [col.canonical, ...col.aliases].map(canon);
    const idx = norm.findIndex((h, i) => !usedIdx.has(i) && candidates.includes(h));
    if (idx >= 0) {
      mapping[col.canonical] = idx;
      usedIdx.add(idx);
    }
  }
  const unmapped = headers.filter((_, i) => !usedIdx.has(i));
  const missingRequired = def.columns
    .filter((c) => c.required && !(c.canonical in mapping))
    .map((c) => c.canonical);
  return { mapping, unmapped, missingRequired };
}

// ── normalizers ─────────────────────────────────────────────────────────────
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith("+");
  const d = trimmed.replace(/\D+/g, "");
  if (!d) return null;
  // UK normalization: 07… → +447…, 0… → +44…; keep + prefix if present.
  if (hasPlus) return "+" + d;
  if (d.startsWith("0")) return "+44" + d.slice(1);
  if (d.startsWith("44")) return "+" + d;
  return d; // unknown format → digits only (still comparable)
}
export function normalizeEmail(raw: string): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
}
export function normalizePostcode(raw: string): string | null {
  if (!raw) return null;
  const p = String(raw).toUpperCase().replace(/\s+/g, "");
  return p || null;
}
/** Parse money to integer PENNIES (never float). Accepts "£1,234.56", "1234.5", "1234". */
export function parseMoneyPennies(raw: string): number | null {
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[£$€,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}
/** Format-tolerant date parse → ISO string, or null. Handles ISO, DD/MM/YYYY, MM/DD/YYYY-ish. */
export function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // ISO or yyyy-mm-dd
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})([ T].*)?$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).toISOString();
  // DD/MM/YYYY or DD-MM-YYYY (UK default) — prefer day-first
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const [, d, mo] = m;
    let y = m[3];
    if (y.length === 2) y = "20" + y;
    const dd = d.padStart(2, "0");
    const mm = mo.padStart(2, "0");
    const iso = `${y}-${mm}-${dd}T00:00:00Z`;
    const dt = new Date(iso);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** Coerce one raw cell to its canonical typed value. Returns { value, error? }. */
export function coerce(
  type: FieldType | undefined,
  raw: string,
): { value: unknown; error?: string } {
  const v = (raw ?? "").trim();
  if (v === "") return { value: null };
  switch (type) {
    case "phone": {
      const p = normalizePhone(v);
      return p ? { value: p } : { value: null, error: "invalid phone" };
    }
    case "email": {
      const e = normalizeEmail(v);
      return e ? { value: e } : { value: null, error: "invalid email" };
    }
    case "postcode":
      return { value: normalizePostcode(v) };
    case "money": {
      const p = parseMoneyPennies(v);
      return p == null ? { value: null, error: "invalid money" } : { value: p };
    }
    case "number": {
      const n = Number(v.replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? { value: n } : { value: null, error: "invalid number" };
    }
    case "date": {
      const d = parseDate(v);
      return d ? { value: d } : { value: null, error: "invalid date" };
    }
    case "bool":
      return { value: /^(1|true|yes|y|active)$/i.test(v) };
    default:
      return { value: v };
  }
}

export interface MappedRow {
  record: Record<string, unknown>;
  errors: Array<{ field: string; message: string }>;
  rowNumber: number;
}

/** Map + validate one source row (array of cells) into a canonical record. */
export function mapRow(
  cells: string[],
  def: ImportProfileDef,
  mapping: Record<string, number>,
  rowNumber: number,
): MappedRow {
  const record: Record<string, unknown> = {};
  const errors: MappedRow["errors"] = [];
  for (const col of def.columns) {
    const idx = mapping[col.canonical];
    const raw = idx == null ? "" : (cells[idx] ?? "");
    const { value, error } = coerce(col.type, raw);
    if (error) errors.push({ field: col.canonical, message: error });
    if (col.required && (value == null || value === "")) {
      errors.push({ field: col.canonical, message: `${col.canonical} is required` });
    }
    if (value != null && value !== "") record[col.canonical] = value;
  }
  return { record, errors, rowNumber };
}
