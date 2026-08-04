# Marketing V1 — Production Launch Runbook (corrected)

**Status: MIGRATION CONTINUITY RESOLVED (2026-08-04)** — the §1 blocker is
CLEARED by the operator-approved **option 2** adoption recorded in
[PHONE_OPS_ADOPTION_DECISION.md](PHONE_OPS_ADOPTION_DECISION.md):
`20260830120000_phone_operations_control.sql` (SHA-256 `4b276b47…`) is
committed as canonical forward history on the parity dossier's evidence.
No production `migration repair` was required or performed. Production
`db push` may proceed per §4.
This runbook supersedes the five-command sequence and the
`MARKETING_PUBLIC_BASE_URL=https://app.openfolk.ai` proposal recorded earlier
(IMPLEMENTATION_LEDGER §24d) — that base URL was WRONG: unsubscribe and
tracking links are served by Edge Functions, so the base must be the
**functions origin**, not the app origin.

Production project: `tgbnakbxwcqjeimygroz` (eu-west). Frontend: Vercel
`serviceos-dh`, production branch `main`. Nothing in this document contains a
secret value, and no step below prints one — commands that would echo a
generated secret are forbidden.

---

## 1 · Migration continuity — the release blocker

Verified against the live production ledger (2026-08-03, read-only
`supabase migration list --linked`):

- Production **records `20260830120000_phone_operations_control.sql` as
  applied**. In this repository that file exists **only as untracked
  working-tree material** belonging to the concurrent Phone Operations
  workstream — it is in no commit on `serviceos-backend-foundation`.
- The Marketing chain pending for production is `20260827120100` and
  `20260828120000` … `20260908120500` plus `20260909120000`
  (atomic test-cancel), `20260910120000` (governed permission capture) and
  `20260911120000` (permission correctness: caller-request idempotency,
  complete versioned bulk contract, fail-closed actor gate, deterministic
  opt-out precedence) — the current migration HEAD is `20260911120000`.
  The applied phone-ops migration sits **between** `20260829120000` and
  `20260831120000` in that sequence.

Consequence: a `db push` from any clean release checkout (which is the only
acceptable deployment source) would find a remote-recorded migration with no
local file. Relying on the uncommitted working-tree copy — or absorbing the
phone-ops migration into a Marketing commit — is **not acceptable**; the
production ledger must always reconcile against committed history.

**Investigated 2026-08-04 (read-only dump of the production
`supabase_migrations` schema):** production's ledger row is
`('20260830120000', '{}', 'phone_operations_control')` — the stored
statements array is **EMPTY**, while every other applied migration row stores
its full statement content. Production therefore holds NO record of the bytes
applied under that version (the empty-statements signature matches a
`migration repair --status applied`-style recording, not a content-carrying
`db push`). The migration's OBJECTS verifiably exist on production
(phone_alert_policies / phone_alert_events / phone_on_call_assignments /
phone_operations_audit all respond over PostgREST), so the SQL genuinely ran —
but byte identity between the working-tree file (SHA-256
`4b276b47afa07936bd9e2285b1f83a573a90057be1349ea1148e7f37ecc0b4df`, zero
destructive operations) and what production executed **cannot be proven from
any evidence available in this repository or in production**. The phone-ops
session materials in the working tree (docs/run-checkpoints/,
docs/product-review/) contain no reference to this migration either.

Accordingly — per the launch rules at the time — the file stayed uncommitted
pending an operator decision, no `migration repair` was run, and **release
required ONE of** (HISTORICAL — resolved below):

1. The Phone Operations workstream produces its own checkpoint evidence — a
   deploy transcript or a recorded SHA-256 of the file at the moment the
   version was recorded on production, plus a statement of HOW it was
   recorded (push vs repair) — and commits the byte-exact file on that
   basis; **or**
2. An operator-approved migration-continuity decision is recorded: the
   operator audits the file against the live production objects, explicitly
   adopts the working-tree file as canonical for version `20260830120000`,
   and that decision (with the SHA-256 above) is committed as the permanent
   record.

~~Until then: do not run `db push` against production.~~ **SUPERSEDED —
the file is COMMITTED (adoption commit `6373306`) and the production
`db push` was executed on 2026-08-04 (see §4): the ledger is continuous
through `20260911120000`.**

**Parity evidence for option 2 (2026-08-04, read-only):** a complete
object-by-object parity dossier —
[PHONE_OPS_MIGRATION_PARITY.md](PHONE_OPS_MIGRATION_PARITY.md) — compares the
working-tree file (applied to an isolated predecessor-chain database) against
a same-day production schema extraction. Verdict: **SAFE TO ADOPT AS
CANONICAL FORWARD HISTORY** (every declared object exact; no unrepresented
production object; schema parity proves current-effect representation, never
historical byte identity).

**RESOLUTION (2026-08-04): option 2 TAKEN.** Chris Drummond explicitly
approved adopting the file as canonical forward history on the dossier's
evidence; the decision, hash and limitations are permanently recorded in
[PHONE_OPS_ADOPTION_DECISION.md](PHONE_OPS_ADOPTION_DECISION.md) and the file
is committed. This section's "do not run `db push`" restriction above is
superseded by that record.

## 2 · Customer-readiness gate (before any real audience launch)

Marketing V1 is usable only when the permission journey is real. Before the
first genuine audience launch (not before deployment):

- [ ] At least ONE real contact has a genuine recorded marketing permission
      (governed `Record permission` path: controlled basis + method +
      reference/note + operator attestation), visible in the contact's
      append-only history.
- [ ] The operator has reviewed the audience check's exclusions for the first
      real campaign — every excluded person with the stated reason.
- [ ] Consent/preference capture is STAGING-PROVEN end-to-end (subscribe →
      audience inclusion → unsubscribe wins → evidenced resubscription →
      bulk with refused members reported exactly).
- [ ] Verified: NO imported contact was implicitly subscribed — imported
      contacts remain `No preference recorded` until a genuine decision is
      recorded (regression-locked in `marketing_admin.test.sql`).

## 3 · Pre-flight audit (read-only, do first)

- [ ] `supabase projects list` — CLI is linked to `tgbnakbxwcqjeimygroz`.
- [ ] `supabase migration list --linked` — remote ledger matches §1
      expectations and nothing new has appeared out-of-band.
- [ ] `supabase functions list` — record currently deployed function versions
      (rollback reference).
- [ ] `supabase secrets list` — **names only**; confirm which of §5's names
      already exist.
- [ ] Confirm the real tenant + operator profile exist and no non-terminal
      `send_marketing_test_email` intents are parked.
- [x] Operational mode blocks sending — **CORRECTED 2026-08-04:** the live
      tenant's mode is the pre-existing **`assisted`** (platform default
      `discovery`); `assisted` clamps the high-risk irreversible send action
      exactly like discovery, so nothing can send until an operator
      raises it — this is the launch-day safety floor).

## 4 · Database (after §1 clears)

- [ ] From the clean release checkout: `supabase db push --linked --dry-run`
      and confirm the plan is exactly the §1 pending list.
- [ ] `supabase db push --linked` (operator-authorised).
- [ ] `supabase migration list --linked` — remote now records the full chain
      through `20260911120000`.
- [ ] Post-checks (SQL editor, read-only):
      - `marketing_test_cancel` exists and EXECUTE is revoked from
        `anon`/`authenticated`.
      - The single permission-record RPC `marketing_permission_record`, the
        bulk RPC `marketing_permission_record_bulk` and the history RPC
        `marketing_permission_history` all exist
        (`to_regprocedure(...)` non-null for each signature).
      - Browser roles cannot execute ANY of them:
        `has_function_privilege('anon'|'authenticated', <sig>, 'execute')`
        is false for all three plus `marketing_permission_require_actor`.
      - Imports still produce NO subscribed preference: an imported contact
        has zero `communication_preferences` rows and
        `marketing_contact_eligibility(...)` = `unknown`
        (regression-locked in `marketing_admin.test.sql`).
      - Deterministic opt-out precedence is installed: the
        `marketing_endpoint_eligibility` definition (`pg_get_functiondef`)
        contains the tie-break
        `(pref.state = 'unsubscribed') desc` ordering term — same-instant
        subscribed/unsubscribed facts resolve to `unsubscribed` on every
        surface.
      - `serviceos_schedule_defs()` returns BOTH marketing scheduler jobs
        (`serviceos-marketing-broadcast`, `serviceos-marketing-sequence`).

## 5 · Edge Function secrets (names only — never echo values)

Set with `supabase secrets set NAME` (values entered interactively/from a
secret manager, never inline in a shared shell history, never printed):

| Name | Purpose | Also required in Postgres Vault? |
| --- | --- | --- |
| `MARKETING_PUBLIC_BASE_URL` | Public link base for unsubscribe/tracking. **Exact value: `https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1`** | No |
| `RESEND_API_KEY` | Resend transport (platform key) | No |
| `MARKETING_TRACKING_SECRET` | Signs open/click/unsubscribe tokens (≥32 chars) | No |
| `WORKER_SECRET` | platform-worker gate (already live in prod — verify by name) | No |
| `MARKETING_BROADCAST_SECRET` | Gates marketing-broadcast-scheduled-sync | **YES — same value** |
| `MARKETING_SEQUENCE_SECRET` | Gates marketing-sequence-scheduled-sync | **YES — same value** |

**The Edge/Vault pairing is not optional.** The cron job sends
`x-schedule-secret` read from **Vault** at run time; the Edge function
compares it against **its own env secret**. If the two stores disagree the
scheduler runs forever receiving 403s and no due work is ever discovered.
Load the Vault side with `select vault.create_secret('<value>', 'MARKETING_BROADCAST_SECRET');`
(and the sequence equivalent) **typed directly in the SQL editor, never in a
shell command that logs**.

## 6 · Functions deploy (exact release bytes)

Deploy from the clean release checkout, in one pass:

- [ ] All `marketing-*` functions — including **`marketing-track`** and
      **`marketing-unsubscribe`** (both easy to forget: they serve the public
      links) and the two `*-scheduled-sync` functions.
- [ ] `platform-worker` (current shared implementation).
- [ ] `automation-execute`.
- [ ] `supabase functions list` — versions advanced for exactly this set.

## 7 · Scheduler registration & proof

1. Enable **pg_cron** and **pg_net** (Dashboard → Database → Extensions).
2. Set the scheduler base URL and register (SQL editor):
   `select serviceos_schedule_all('https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1');`
3. - [ ] Verify: `select jobname, schedule, active from cron.job order by jobname;`
      shows `serviceos-marketing-broadcast` and `serviceos-marketing-sequence`
      (`* * * * *`, active) alongside the existing ServiceOS jobs.
4. - [ ] **Secret-authenticated execution proof:** after ≥1 minute, check
      `cron.job_run_details` for both jobs (status `succeeded`) and the two
      functions' logs: the POST must return **200 with a JSON body** (e.g.
      `{"due": 0, ...}`), **not 401/403** — a 403 here means the Edge/Vault
      pair in §4 disagrees.
5. - [ ] **Due-work discovery evidence:** with a scheduled broadcast or an
      active sequence enrolment present (post-launch), the sync log shows the
      due item discovered and enqueued into `platform_jobs`. Record the ids.

## 8 · Link verification (before any production send)

- [ ] `curl -s -o /dev/null -w "%{http_code}" "https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/marketing-unsubscribe?t=test"`
      → an HTTP response from the function (2xx/4xx page, never 404-no-route).
- [ ] Same probe for `/marketing-track` → function responds (401/400 for an
      unsigned probe is CORRECT; 404 means the function is missing).
- [ ] After sender authority + a draft exists: generate a broadcast preview
      and confirm the rendered unsubscribe URL begins
      `https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/marketing-unsubscribe?t=`.
- [ ] Deployed HTTP suites for tracking/unsubscribe
      (`marketing-tracking` scope of `scripts/`) against production, read-only
      fixtures.

## 9 · Sender authority & controlled production test

- [x] Operator grants the platform sender authority for the real tenant's
      verified sending identity (`hello@drummonds.co` / Resend-verified
      domain), via the governed `marketing_sender_authority_grant` path.
      **DONE 2026-08-04** (authority `2d8b258a…` verified; verified-domain
      sender profile `72e40ace…` `production_verified`, enabled).
- [x] ONE governed test send (test-to-self) — **DONE 2026-08-04, PROVIDER
      SUBMISSION PROVEN** (operator-authorised temporary mode windows;
      ledger §28a has the full evidence):
      - Immutable request id `launch-verify-20260804T114113Z`, subject
        `ServiceOS production launch verification — 2026-08-04T11:41:13Z`,
        sender `hello@drummonds.co` → recipient `chris@openfolk.ai`.
      - Identifiers: delivery `19b9ae50-0697-402c-b4f9-f4d95ba192dd`,
        intent `d8434ccf-6502-4a25-b500-c16ffa2e1a4a`, correlation
        `2a62c72f-e1e8-427d-8390-4f9648fb4f2e`, provider (Resend) message id
        `230f8f98-4aec-42d2-a593-dead7843e06d`, submitted
        `2026-08-04T12:01:03Z`.
      - Exactly ONE provider request (single attempt #1; the delivery's
        unique `(tenant, request_id)` receipt and the frozen envelope rule
        out duplicates); intent terminal `succeeded`.
      - Mode windows (each raise + restore via published `config_versions`
        rows; restoration value `assisted`, never `discovery`):
        11:41:15–11:46:19Z (send parked behind a deep worker queue),
        11:50:18–11:54:21Z and 11:55:38–11:59:44Z (no execution — retry
        enqueue tooling error, nothing ran), 12:00:50–12:02:06Z (execution
        + provider submission). Effective mode re-verified `assisted` after
        every window.
      - Provider submission is NOT inbox proof — human inbox confirmation
        outstanding.
- [x] Zero non-terminal test intents afterwards — verified
      (`intent succeeded`, zero active `automation.execute` jobs).

## 10 · Frontend promotion

- [ ] Push the release branch; verify the Vercel **Preview** build is green.
- [ ] Fast-forward `main` to the release SHA (never a rewrite).
- [ ] Vercel Production deploy completes; production env vars point at
      `tgbnakbxwcqjeimygroz` (NEVER the staging project).

## 11 · Rollback

- Frontend: instant rollback to the previous Vercel production deployment.
- Sending: revoke the sender authority and/or unset `RESEND_API_KEY`
  (fails closed); `select serviceos_unschedule_all();` stops all cron work.
- Database: all Marketing migrations are additive; no destructive rollback is
  required or attempted. `git revert` on `main` if the frontend must retreat.
- Mode: the tenant's operational mode remains **`assisted`** (its
  pre-existing live state; platform default `discovery`) — the send action
  is clamped in both, so nothing sends by default even when fully deployed.
  Any temporary raise must restore `assisted`, never `discovery`.
