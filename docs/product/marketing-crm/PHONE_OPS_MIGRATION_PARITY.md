# Phone Operations migration `20260830120000` — production parity dossier

**Date:** 2026-08-04 · **Mode:** READ-ONLY (no commit of the migration, no
`migration repair`, no production write of any kind) · **Author:** correction
pass on `serviceos-backend-foundation` (see IMPLEMENTATION_LEDGER §27).

## Why this dossier exists

Production (`tgbnakbxwcqjeimygroz`) records migration version `20260830120000`
(`phone_operations_control`) with an **EMPTY statements array** — it holds no
record of the bytes executed under that version. The file exists in this
repository only as untracked working-tree material, SHA-256
`4b276b47afa07936bd9e2285b1f83a573a90057be1349ea1148e7f37ecc0b4df`
(re-verified this pass). **Byte identity between that file and what production
executed cannot be proven** — not from production, not from this repository.
This dossier answers the narrower, decidable question: *is the working-tree
file safe to adopt as the canonical forward-history representation of what
production currently contains?*

## Method

1. The entire untracked migration was read and every declared object
   enumerated (below).
2. An **isolated fresh local database** (disposable
   `supabase/postgres:17.6.1.141` container — production's own major/minor
   image line) was built from the committed migration chain, with the
   working-tree phone-ops file applied at its natural chain position
   (`20260829120000` → phone-ops → `20260831120000`). A repository-wide grep
   proves **no other migration touches any phone-ops object**, so the
   resulting definitions are exactly "committed predecessor chain + this
   file".
3. Production's `public` schema was extracted **read-only** the same day via
   `supabase db dump --linked` and loaded into a second scratch database in
   the same container (4 load errors, all in unrelated objects:
   `profiles_id_fkey`/two policies referencing the absent `auth` schema and
   the control-plane `gist` exclusion constraint needing `btree_gist` —
   none touches a phone-ops object).
4. Both databases were then interrogated with **one identical catalogue
   extraction script** (`information_schema.columns`,
   `pg_get_constraintdef`, `pg_get_indexdef`, `pg_class.relrowsecurity`,
   `pg_policies`, `role_table_grants`, `pg_get_triggerdef`,
   `pg_get_functiondef` + md5, `pg_proc.proacl`) and the outputs diffed.
   Seed rows were compared against **live** production over PostgREST
   (read-only, service role).
5. Normalisation applied: **owner/apply-role names only**
   (`supabase_admin` ⇄ `postgres`). Nothing else was normalised.

## What the migration declares (complete enumeration)

- **Seed/config rows (5):** upserts into `system_health_components` —
  `phone_ingress`(31), `ai_receptionist`(32), `phone_transfers`(33),
  `phone_destinations`(34), `phone_notifications`(35), category `telephony`.
- **Tables (4):** `phone_alert_policies` (13 cols, `unique(tenant_id)`,
  2 range checks), `phone_alert_events` (18 cols, severity/status checks),
  `phone_on_call_assignments` (16 cols, FK `team_members` on delete set
  null, 3 length checks), `phone_operations_audit` (10 cols). All four:
  uuid PKs with `gen_random_uuid()`, FK `tenants` on delete cascade.
- **Indexes (6):** partial-unique `phone_alert_events_open_key_uk`
  (`status in ('open','acknowledged')`), `phone_alert_events_tenant_seen_idx`,
  `phone_alert_events_tenant_status_idx`, partial-unique
  `phone_on_call_assignments_active_role_uk` (`active and effective_to is
  null`), `phone_on_call_assignments_tenant_idx`,
  `phone_operations_audit_tenant_idx`.
- **RLS:** enabled on all 4 tables; one select-only policy per table
  (`<table>_select_tenant`, to `authenticated`,
  `using (tenant_id = current_tenant_id() or is_openfolk())`).
- **Grants:** `service_role` select/insert/update/delete; `authenticated`
  select-only; nothing for `anon`.
- **Triggers (3):** `set_updated_at()` before-update on policies, events,
  assignments.
- **Function (1):** `phone_operations_set_on_call(uuid,uuid,text,text,text,
  uuid,text,text,text,jsonb) returns phone_on_call_assignments` — plpgsql,
  SECURITY DEFINER, `search_path=public`, per-role advisory lock, closes the
  previous active assignment, versions the new one, writes the audit row;
  EXECUTE revoked from public/anon/authenticated, granted to service_role.
- **No** extensions, cron jobs, views, sequences or other operational
  objects.

## Parity matrix (expected local vs production)

| Object | Expected (predecessor chain + working-tree file) | Production | Verdict | Risk / action |
| --- | --- | --- | --- | --- |
| `phone_alert_policies` — all 13 columns, types, nullability, defaults | as declared | identical | **EXACT** | none |
| `phone_alert_policies` — PK, FK(tenants, cascade), `unique(tenant_id)`, checks (`consecutive_failures` 1–20, `reminder_minutes` 5–1440) | as declared | identical (`pg_get_constraintdef` equal) | **EXACT** | none |
| `phone_alert_events` — all 18 columns | as declared | identical | **EXACT** | none |
| `phone_alert_events` — PK, FK, severity + status checks | as declared | identical | **EXACT** | none |
| `phone_alert_events_open_key_uk` (partial UNIQUE where open/acknowledged) | as declared | identical (`pg_get_indexdef` equal) | **EXACT** | none |
| `phone_alert_events_tenant_seen_idx` / `_tenant_status_idx` | as declared | identical | **EXACT** | none |
| `phone_on_call_assignments` — all 16 columns | as declared | identical | **EXACT** | none |
| `phone_on_call_assignments` — PK, FK(tenants cascade), FK(team_members set null), 3 length checks | as declared | identical | **EXACT** | none |
| `phone_on_call_assignments_active_role_uk` (partial UNIQUE active+open-ended) / `_tenant_idx` | as declared | identical | **EXACT** | none |
| `phone_operations_audit` — all 10 columns + PK + FK + `_tenant_idx` | as declared | identical | **EXACT** | none |
| RLS enablement (4 tables) | enabled, not forced | enabled, not forced | **EXACT** | none |
| Policies `*_select_tenant` (4) — command, role, USING expression | as declared | identical | **EXACT** | none |
| Table grants — service_role RW, authenticated select, anon none (4 tables) | as declared | identical | **EXACT** | none |
| Triggers `*_set_updated_at` (3) — `pg_get_triggerdef` | as declared | identical | **EXACT** | none |
| `phone_operations_set_on_call` — signature, language, SECURITY DEFINER, `search_path=public` | as declared | identical | **EXACT** | none |
| `phone_operations_set_on_call` — **function body** | as declared | identical (`md5(pg_get_functiondef)` equal) | **EXACT** | none |
| `phone_operations_set_on_call` — ACL | owner self-grant + service_role EXECUTE; public/anon/authenticated revoked | same security semantics; entries differ only in owner/apply-role names (`supabase_admin` locally vs `postgres` on production) | **SEMANTIC MATCH** (environment noise only) | none — browser roles denied on both sides |
| Seed rows — 5 telephony `system_health_components` | as declared | identical on **live** production (component, label, category, sort_order all byte-equal) | **EXACT** | none |
| Reverse sweep — production phone-ops objects NOT in the file | n/a | none: full `phone%` table/function inventory identical both ways; only other `phone%` relation is the view `phone_recording_pipeline_state`, which belongs to a **committed** migration | **NO UNREPRESENTED OBJECTS** | none |

Nothing is missing on either side; there are no mismatches; the single
non-exact row is owner-name noise that no migration file controls.

## Adoption verdict

**SAFE TO ADOPT AS CANONICAL FORWARD HISTORY.**

Every object and security property the working-tree file declares exists on
production with an exactly matching definition, and production contains no
Phone Operations object the file does not represent. Adopting the file as the
canonical representation of version `20260830120000` would make committed
history faithfully describe production's current state.

**Explicit limitation:** schema parity proves the canonical file *represents
the current intended database effect*; it does **not** retroactively prove
that these exact bytes were executed on production under that version (the
production ledger row stores an empty statements array, so historical byte
identity remains unprovable). Adoption is therefore the runbook §1 **option
2** operator decision — an audited adopt-as-canonical, to be recorded with
the SHA-256 above — not a discovery of the original deploy artefact.

**This pass took no adoption action:** the file remains uncommitted, no
`migration repair` was run, and production was touched read-only throughout.
