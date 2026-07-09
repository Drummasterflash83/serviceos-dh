# ServiceOS — Input Reliability (Phone + Email)

**Status:** Operational runbook. How to make phone + email **automatic, reliable,
observable and self-healing**, and how to prove one call and one email flow
end-to-end.

**Last updated:** 2026-07-09

> Related: [SCHEDULERS.md](SCHEDULERS.md) (per-scheduler reference + troubleshooting),
> [EVENT_ARCHITECTURE.md](EVENT_ARCHITECTURE.md), [CUSTOMER_CARD_ENGINE.md](CUSTOMER_CARD_ENGINE.md).

---

## 0. The honest reality (read this first)

The Operations Centre shows **stale / critical / "sync stale" / "Invalid or expired
session"** for two concrete, fixable reasons — **neither is application-logic
breakage:**

1. **No scheduler is configured to run.** There is **no cron definition anywhere
   in this repository** — no `pg_cron`, no Supabase scheduled-function config, no
   CI cron. The scheduled functions (`*-scheduled-sync`) are secret-gated HTTP
   endpoints that _something external must POST to on a timer_. Until that timer
   exists, **nothing runs automatically**, every scheduler reads "never/stale",
   and the manual buttons are the only thing moving data. **This is a deployment
   step, not code** — §2 + §3 below set it up.

2. **The phone pipeline child functions defaulted to `verify_jwt = true`.** They
   are invoked server-to-server with the **service-role** key as the bearer; with
   the gateway JWT check on, a non-JWT-format service key is rejected _before_ the
   function runs and surfaces inside as the misleading `invalid_auth` / "Invalid
   or expired session". This repo now sets `verify_jwt = false` on every
   internally-invoked worker ([config.toml](../supabase/config.toml)) so
   `_shared/authz.ts` is the sole gatekeeper. **This ships in the diff but only
   takes effect once the functions are re-deployed** (§4).

**So: this phase's fixes are (a) deploy `config.toml`, (b) set the secrets, (c)
configure the crons.** After that, inputs are automatic and the dashboard reflects
real freshness.

---

## 1. Required Supabase secrets

Set every secret before scheduling (values are never printed or committed):

```bash
# scheduler gate secrets
npx supabase secrets set PHONE_SCHEDULE_SECRET="…"
npx supabase secrets set PHONE_PROCESSING_SECRET="…"
npx supabase secrets set EMAIL_SCHEDULE_SECRET="…"
npx supabase secrets set EMAIL_WORKSPACE_SCHEDULE_SECRET="…"
npx supabase secrets set EMAIL_WORKSPACE_BACKFILL_SECRET="…"
npx supabase secrets set SIGNAL_SYNC_SECRET="…"
npx supabase secrets set IDENTITY_SYNC_SECRET="…"
npx supabase secrets set GRAPH_SYNC_SECRET="…"
npx supabase secrets set CARD_SYNC_SECRET="…"
npx supabase secrets set RECOMMENDATION_SYNC_SECRET="…"

# providers (must already be set for ingest + AI to work)
npx supabase secrets set OPENAI_API_KEY="…"
npx supabase secrets set SIMWOOD_USERNAME="…"  SIMWOOD_PASSWORD="…"
# Google Workspace DWD + Gmail OAuth secrets — see the ingest specs.

npx supabase secrets list   # verify names present (values never shown)
```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every function.

## 2. Deploy the functions (applies the `verify_jwt` fix)

The `verify_jwt = false` settings only take effect on deploy:

```bash
npx supabase functions deploy   # deploys all functions with config.toml applied
# or per function, e.g.:
npx supabase functions deploy phone-process-pipeline
```

Confirm the pipeline workers are `verify_jwt = false` (Supabase dashboard →
Edge Functions → each function → Details), or re-run the phone trace in §5.

## 3. Configure the schedulers (the missing piece)

Pick **one** mechanism. Recommended: **pg_cron + pg_net** (config-as-code, lives
in the database, easy to verify).

### Cadence & ordering

| Scheduler                                 | Cadence                   | Secret                            |
| ----------------------------------------- | ------------------------- | --------------------------------- |
| `phone-scheduled-sync`                    | every 5 min               | `PHONE_SCHEDULE_SECRET`           |
| `phone-processing-scheduled-sync`         | every 2 min               | `PHONE_PROCESSING_SECRET`         |
| `email-scheduled-sync`                    | every 5 min               | `EMAIL_SCHEDULE_SECRET`           |
| `email-workspace-scheduled-sync`          | every 5 min               | `EMAIL_WORKSPACE_SCHEDULE_SECRET` |
| `email-workspace-backfill-scheduled-sync` | every 15 min (until done) | `EMAIL_WORKSPACE_BACKFILL_SECRET` |
| `interactions-scheduled-sync`             | every 5 min               | `SIGNAL_SYNC_SECRET`              |
| `identity-scheduled-sync`                 | every 5 min               | `IDENTITY_SYNC_SECRET`            |
| `business-graph-scheduled-sync`           | every 5 min               | `GRAPH_SYNC_SECRET`               |
| `customer-card-scheduled-sync`            | every 5 min               | `CARD_SYNC_SECRET`                |
| `recommendation-scheduled-sync`           | every 5 min               | `RECOMMENDATION_SYNC_SECRET`      |

**Ordering** (interactions → identity → graph → cards → recommendations) does NOT
need strict sequencing: every function is idempotent, so running them all on the
same 5-minute tick simply advances the chain one hop per tick and self-heals. If
you prefer, offset each by a minute.

### pg_cron + pg_net template

Store secrets in **Supabase Vault** so they aren't inlined in the cron body:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- one-time: put each secret in the vault (Supabase → Vault), then reference it.
-- Helper to POST a scheduled function with its gate secret from the vault:
--   replace <REF> with your project ref (…​.functions.supabase.co host).

select cron.schedule('phone-processing', '*/2 * * * *', $$
  select net.http_post(
    url    := 'https://<REF>.functions.supabase.co/phone-processing-scheduled-sync',
    headers:= jsonb_build_object(
      'content-type','application/json',
      'x-schedule-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'PHONE_PROCESSING_SECRET')
    ),
    body   := '{}'::jsonb
  );
$$);

-- repeat for each row in the table above, e.g.:
select cron.schedule('phone-sync',        '*/5 * * * *', $$ … phone-scheduled-sync        / PHONE_SCHEDULE_SECRET        $$);
select cron.schedule('email-sync',        '*/5 * * * *', $$ … email-scheduled-sync        / EMAIL_SCHEDULE_SECRET        $$);
select cron.schedule('email-workspace',   '*/5 * * * *', $$ … email-workspace-scheduled-sync / EMAIL_WORKSPACE_SCHEDULE_SECRET $$);
select cron.schedule('interactions',      '*/5 * * * *', $$ … interactions-scheduled-sync / SIGNAL_SYNC_SECRET           $$);
select cron.schedule('identity',          '*/5 * * * *', $$ … identity-scheduled-sync     / IDENTITY_SYNC_SECRET         $$);
select cron.schedule('business-graph',    '*/5 * * * *', $$ … business-graph-scheduled-sync / GRAPH_SYNC_SECRET          $$);
select cron.schedule('customer-cards',    '*/5 * * * *', $$ … customer-card-scheduled-sync / CARD_SYNC_SECRET            $$);
select cron.schedule('recommendations',   '*/5 * * * *', $$ … recommendation-scheduled-sync / RECOMMENDATION_SYNC_SECRET $$);

-- verify the jobs are registered + succeeding:
select jobid, jobname, schedule, active from cron.job order by jobname;
select jobname, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 30;
```

> **Do not commit real secrets.** They live in the Vault / `supabase secrets`, not
> the repo — which is exactly why cron config is not (and should not be) hard-coded
> here. Keep this template and your project ref in your deploy runbook.

### Alternative mechanisms

- **External cron** (GitHub Actions schedule, cron-job.org, etc.) that `curl`s each
  endpoint with its `x-schedule-secret` header — the test curls in
  [SCHEDULERS.md](SCHEDULERS.md) are exactly the requests to schedule.
- Whatever you pick, the endpoints and secrets are identical.

## 4. Prove the schedulers are running

```sql
-- are the cron jobs registered and succeeding? (pg_cron)
select jobname, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 30;

-- per-scheduler freshness from the app's own tables:
select sync_type, status, max(started_at) as last_run
from phone_sync_runs group by sync_type order by 1;

select provider, status, max(started_at) as last_run
from email_sync_runs group by provider, status order by 1;

select job_type, status, max(created_at) as last_run
from platform_jobs group by job_type, status order by 1;
```

The Operations Centre "Scheduler health" card reads these watermarks; "never"
means the cron isn't configured yet, not that code is broken.

---

## 5. Phone end-to-end proof (§ the product isn't stable until this passes)

Pick one pending recording and trace it through the whole chain.

```sql
-- 0) choose a recording that still needs work
select id, provider_call_id, started_at, storage_path
from phone_recordings where storage_path is null
order by started_at desc limit 1;

-- 1) audio downloaded  → storage_path set
select id, storage_path is not null as downloaded from phone_recordings where id = '<REC_ID>';

-- 2) transcript created
select status, length(transcript_text) as chars from phone_transcripts where recording_id = '<REC_ID>';

-- 3) AI insight created (call_id back-filled)
select id, call_id, intent, urgency, sentiment from phone_ai_insights where recording_id = '<REC_ID>';

-- 4) the per-run trace (self-diagnosing; safe — no content/secrets)
select started_at, status, metadata->'trace' as trace
from phone_sync_runs where sync_type = 'pipeline'
  and metadata->>'recording_id' = '<REC_ID>'
order by started_at desc limit 5;

-- 5) interaction.ready published
select pe.status, pe.published_at
from platform_events pe
join interactions i on i.id = pe.subject_id
join phone_calls c on c.id = i.source_id
where c.provider_call_id = '<PROVIDER_CALL_ID>' and pe.event_type = 'interaction.ready';

-- 6) canonical interaction ready/enriched
select i.processing_status, i.related_person_id, i.related_company_id
from interactions i join phone_calls c on c.id = i.source_id
where c.provider_call_id = '<PROVIDER_CALL_ID>';

-- 7) identity → graph → customer card
select n.node_type, count(*) from graph_nodes n group by 1;      -- person/company/interaction present
select cc.id, cc.status, cc.context ? 'projection' as projected
from customer_cards cc where cc.person_id = '<PERSON_ID>';
```

**Pass = ** downloaded → transcript `completed` → insight row → `interaction.ready`
consumed → interaction `enriched` → a `customer_card` with a `projection`.

## 6. Email end-to-end proof

```sql
-- 1) message ingested
select id, provider_message_id, from_email, received_at from email_messages
order by received_at desc limit 1;

-- 2) projected to a canonical interaction (interactions-scheduled-sync)
select processing_status, related_person_id from interactions
where source_table = 'email_messages' and source_id = '<EMAIL_MSG_ID>';

-- 3) identity resolved → enriched
select processing_status, related_person_id, related_company_id from interactions
where source_table = 'email_messages' and source_id = '<EMAIL_MSG_ID>';

-- 4) graph + customer card
select cc.id, cc.status, cc.context ? 'projection' as projected
from customer_cards cc where cc.person_id = '<PERSON_ID>';
```

**Pass = ** message row → interaction `pending`→`enriched` → customer card with a
projection. **No "Build timeline" click required** once `interactions-scheduled-sync`
is on a cron.

---

## 7. Diagnosing the four failure modes

### `invalid_auth` / "Invalid or expired session" on the phone pipeline

The internal chain forwards **no** user JWT (verified: `getBearerToken` is only
read inside `authz.ts`). So this is one of:

- **Stale** — a failure from before the fix. `phone-pipeline-status` returns
  `last_failure_is_current` (false when a newer success exists); the UI shows
  non-current failures as resolved history. Confirm:
  ```sql
  select max(started_at) filter (where status='success') last_success,
         max(started_at) filter (where status='failed')  last_failure
  from phone_sync_runs where sync_type='pipeline';
  ```
- **Service-role / gateway** — fixed by `verify_jwt = false` (§2). If a NEW run's
  `metadata->'trace'->>'error_code'` is `internal_auth_mismatch`, the service-role
  key isn't matching at the gateway — realign the key or confirm the deploy.

### Stale sync (phone or email)

The scheduler for that input isn't running. Check `cron.job_run_details` (§4) and
the per-table watermarks. If "never", the cron isn't configured (§3).

### OAuth (Gmail) token expiry

```sql
select email_address, status, token_expires_at, last_error
from email_accounts where provider = 'gmail';
```

`status <> 'active'` or an expired token ⇒ genuine reconnect needed. A past
`last_error` with a **newer** successful `email_sync_runs` row ⇒ resolved, not
current (the connector health now treats it as such).

### Workspace (DWD) delegation failure

```sql
select email_address, enabled from google_workspace_mailboxes order by 1;
```

`google-workspace-test-connection` validates delegation; the workspace scheduler
re-tests on cadence. A historical delegation error with a later successful sync is
resolved, not current.

---

## 8. Operations Centre & Admin behaviour (what "good" looks like)

- **Operations Centre** = business health per input: Healthy / Warning / Critical,
  last successful sync, last successful processing, current backlog, oldest
  pending, **latest _active_ failure only**, scheduler status, "View diagnostics".
  It must NOT show resolved errors as current, setup buttons as normal actions, or
  "healthy" when a scheduler has never run.
- **Admin › Phone / Email** = diagnostics: queue depth, stage counts, latest
  traces, failed step, last cron invocation, last manual override, stale-secret
  warnings. Manual buttons here are **emergency overrides only**.

Deployment done → the manual buttons are never needed in normal operation.
