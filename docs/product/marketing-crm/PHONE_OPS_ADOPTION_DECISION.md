# Migration-continuity decision — canonical adoption of `20260830120000`

**Decision:** ADOPT `supabase/migrations/20260830120000_phone_operations_control.sql`
as the canonical forward-history representation of production migration
version `20260830120000` (runbook §1, option 2).

| Field | Value |
| --- | --- |
| Operator | **Chris Drummond** (explicit written approval) |
| Approval date | **2026-08-04** |
| Migration version | `20260830120000` |
| Filename | `supabase/migrations/20260830120000_phone_operations_control.sql` |
| SHA-256 (authorised and committed) | `4b276b47afa07936bd9e2285b1f83a573a90057be1349ea1148e7f37ecc0b4df` |
| Evidence | [PHONE_OPS_MIGRATION_PARITY.md](PHONE_OPS_MIGRATION_PARITY.md) — complete read-only object-by-object parity dossier |
| Dossier verdict | **SAFE TO ADOPT AS CANONICAL FORWARD HISTORY** |
| Re-verified at adoption | Production ledger still records `('20260830120000','{}','phone_operations_control')`; a fresh same-day production schema dump is **byte-identical** to the dossier baseline (zero drift); the file hash is exact; the file contains **no destructive table or data operation** |

## What this decision is — and is not

This is an **audited canonical-adoption decision**: the committed file exactly
represents production's **current database effect** for every object the
version declares (columns, constraints, indexes, RLS, policies, grants,
triggers, function body, seed rows — see the dossier matrix). It does **not**
claim these exact bytes were historically executed on production: the
production ledger row stores an empty statements array, so **historical byte
identity remains unknowable**, permanently.

## Consequences

- The file is committed on `serviceos-backend-foundation`; committed history
  now reconciles against the production migration ledger, unblocking
  `db push` from a clean release checkout (runbook §4).
- **No production `migration repair` is required, performed or authorised** —
  production already records the version; only the repository side changed.
- The migration is inert by design (no provider writes, no notifications);
  environments that have not applied it (e.g. staging) may apply it as a
  normal historical migration — it is idempotent (`if not exists` /
  `create or replace` / upsert throughout).
