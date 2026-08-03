# Marketing V1 — Production Launch Runbook (corrected)

**Status: PRODUCTION `db push` IS BLOCKED** by the migration-continuity condition
in §1. Every other step below is ready to execute once that blocker clears.
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
  (atomic test-cancel), and the applied phone-ops migration sits **between**
  `20260829120000` and `20260831120000` in that sequence.

Consequence: a `db push` from any clean release checkout (which is the only
acceptable deployment source) would find a remote-recorded migration with no
local file. Relying on the uncommitted working-tree copy — or absorbing the
phone-ops migration into a Marketing commit — is **not acceptable**; the
production ledger must always reconcile against committed history.

**Release requires ONE of:**

1. The Phone Operations workstream commits the **byte-exact**
   production-applied `20260830120000_phone_operations_control.sql` on the
   branch, and that checkpoint is integrated normally before the Marketing
   deployment; **or**
2. An authoritative migration-continuity decision (e.g. a recorded
   `supabase migration repair` policy for out-of-band operational migrations)
   is agreed with the operator and permanently documented in this repo.

Until then: **do not run `db push` against production.**

## 2 · Pre-flight audit (read-only, do first)

- [ ] `supabase projects list` — CLI is linked to `tgbnakbxwcqjeimygroz`.
- [ ] `supabase migration list --linked` — remote ledger matches §1
      expectations and nothing new has appeared out-of-band.
- [ ] `supabase functions list` — record currently deployed function versions
      (rollback reference).
- [ ] `supabase secrets list` — **names only**; confirm which of §4's names
      already exist.
- [ ] Confirm the real tenant + operator profile exist and no non-terminal
      `send_marketing_test_email` intents are parked.
- [ ] Operational mode is `discovery` (nothing can send until an operator
      raises it — this is the launch-day safety floor).

## 3 · Database (after §1 clears)

- [ ] From the clean release checkout: `supabase db push --linked --dry-run`
      and confirm the plan is exactly the §1 pending list.
- [ ] `supabase db push --linked` (operator-authorised).
- [ ] `supabase migration list --linked` — remote now records the full chain
      through `20260909120000`.
- [ ] Post-checks (SQL editor, read-only): `marketing_test_cancel` exists and
      EXECUTE is revoked from `anon`/`authenticated`;
      `serviceos_schedule_defs()` returns the two marketing jobs.

## 4 · Edge Function secrets (names only — never echo values)

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

## 5 · Functions deploy (exact release bytes)

Deploy from the clean release checkout, in one pass:

- [ ] All `marketing-*` functions — including **`marketing-track`** and
      **`marketing-unsubscribe`** (both easy to forget: they serve the public
      links) and the two `*-scheduled-sync` functions.
- [ ] `platform-worker` (current shared implementation).
- [ ] `automation-execute`.
- [ ] `supabase functions list` — versions advanced for exactly this set.

## 6 · Scheduler registration & proof

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

## 7 · Link verification (before any production send)

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

## 8 · Sender authority & controlled production test

- [ ] Operator grants the platform sender authority for the real tenant's
      verified sending identity (`hello@drummonds.co` / Resend-verified
      domain), via the governed `marketing_sender_authority_grant` path.
- [ ] ONE governed test send (test-to-self) through the deployed UI;
      confirm provider submission + inbox receipt; cancel path NOT exercised
      in production (already staging-proven).
- [ ] Zero non-terminal test intents afterwards.

## 9 · Frontend promotion

- [ ] Push the release branch; verify the Vercel **Preview** build is green.
- [ ] Fast-forward `main` to the release SHA (never a rewrite).
- [ ] Vercel Production deploy completes; production env vars point at
      `tgbnakbxwcqjeimygroz` (NEVER the staging project).

## 10 · Rollback

- Frontend: instant rollback to the previous Vercel production deployment.
- Sending: revoke the sender authority and/or unset `RESEND_API_KEY`
  (fails closed); `select serviceos_unschedule_all();` stops all cron work.
- Database: all Marketing migrations are additive; no destructive rollback is
  required or attempted. `git revert` on `main` if the frontend must retreat.
- Mode: operational mode remains `discovery` until an explicit operator
  decision — nothing sends by default even when fully deployed.
