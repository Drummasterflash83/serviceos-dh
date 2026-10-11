# Isolated TEST playback acceptance — prepared, not activated

Run `73e083fe-4195-49fb-89a2-7679b6eab517` targets only Supabase TEST
`saatxzwxvdvqevbnskxy`. Automatic approval review rejected activation on
11 October 2026 because it creates new account access; explicit user approval
for this run has been requested. No account, membership or audio was created.
Previous approved and retired accounts do not authorise this run.

## Exact scope

- One new login: `learn-playback-73e083fe@example.invalid`, user
  `effb2fb2-0782-491b-9a49-5cf2a5ef9e4d`.
- Owner membership only in synthetic company
  `b6da43b2-0eec-4a70-9117-5a325b6b2e25`.
- Separate synthetic company `f671e7aa-07d7-44a2-8bfa-ebbe1f2607b9`
  has one metadata row for foreign-company denial checks, with no new login.
- One generated eight-second WAV, 128,044 bytes, in the existing private TEST
  phone-recordings bucket under the first company prefix. No real call content.
- Marked company/contact/customer-card/call/recording/interaction rows support
  the actual card reader and playback flow.
- No OpenFolk operator grant, existing-client access, production changes,
  real-provider request, email send or bulk import.

The runner checks the current schema and Auth fixture contract before activation.
It records pre-existing data fingerprints excluding only the new run's identities
and companies. A private mode-0600 session file holds the temporary password.
Never print its contents or commit it.

## Acceptance and retirement

Prepared runner: `scripts/verify/learn-phone-playback-session.mjs`.
All modes require `LEARN_TEST_ALLOW_PROJECT_REF=saatxzwxvdvqevbnskxy`.
Activation additionally requires `LEARN_PLAYBACK_APPROVED_RUN` equal to this exact
approved run UUID. Do not activate until the requested approval arrives.

1. `--activate`: establish only these synthetic fixtures and generated audio.
2. `--verify`: use a real Auth session and the actual card/list/link clients;
   check exact audio bytes, one immutable access receipt, foreign tenant denial,
   same-session role demotion and preservation. Restore only this synthetic
   profile's owner role for the browser check. Verification refuses to start
   more than 30 minutes after activation.
3. Sign in on the protected TEST frontend, open the synthetic customer card's
   call evidence, play the generated audio, close evidence and check it stops.
4. `--retire`: ban this exact marked Auth user, rotate its temporary password,
   remove tenant membership and set the profile to viewer. Verify the ban,
   membership removal and preservation before accepting the run as finished.
   Synthetic evidence and access receipts remain for review.

The owner membership does **not** expire automatically. Retirement must run after
acceptance, on failure, or immediately if the session is interrupted. The local
journal records partial activation; never blindly rerun activation. Inspect its
exact identifiers and use `--retire` if the account exists. No user password is
included in the console report or this document.

Passing this run would establish synthetic hosted playback, not real Birchill
capture, transcription quality, historical completeness or real call acceptance.
