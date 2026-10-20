# M2 isolated Commusoft source-user page

The held legacy source-sync `users` import in [the earlier review](NEW-DAWN-M2-USERS-TRIAL-REVIEW.md) shares the ordinary account cursor. It is **not** the route for this trial. The isolated route installed by PRs #245 and #258 uses `learn-commusoft-users-page`, separate `new_dawn.m2_isolated_users_page` admission, and one saved request for at most 10 source-user IDs. It does not pause or move the recurring properties/jobs/contact cursor. The old `learn.inputs.commusoft.users.enabled` import flag stays Off.

Chris authorised one bounded, read-only Drummonds M2 source-user check in the signed-in LIVE OpenFolk operator area. These IDs are retained source evidence only. They do not establish a staff identity, engineer attendance, appointment or login. The Edge route requires the signed-in user, and the SQL start, service continuation and saved-read functions enforce current administrator authority independently of frontend hints.

At 03:37 UTC on 20 October, the dedicated gate was armed once, but the LIVE Modules page could not verify its advisory administrator hint. No page was requested. The fail-closed action set the gate Off and wrote an immutable abort entry. Independent readback found zero requests and zero retained versions. The ordinary Commusoft cycle continued. [PR #259](https://github.com/Drummasterflash83/serviceos-dh/pull/259) lets the independently guarded source-page control be shown when that hint is unavailable; an explicit `false` still hides it. All setup changes remain paused without verified admin access.

`scripts/verify/new-dawn-m2-isolated-users-one-page-trial.mjs` pins the LIVE project, tenant, installed start-function hash, exact flag, one configured connection, zero source-page requests and immutable audit history. It permitted at most one further arm after that exact zero-request abort. `--live-rollback-rehearsal` compiled and rolled back against the aborted state. The completed signed-in trial was:

1. The released UI appeared in LIVE. At 03:54:38 UTC, `--live-arm-once` read back only the dedicated gate On, legacy import Off, zero page requests and a second audit arm.
2. In the signed-in operator page, one request at 03:55:10 UTC read exactly 10 source-user IDs. `hasMore=true`; no further page was requested. The saved-read audit was `f35272d4-786d-41d7-88be-9de75a9eacc3`.
3. At 03:55:27 UTC, `--live-close-once` set the dedicated gate Off. Independent metadata readback found one complete request, 10 retained source versions, one saved-read audit, one completion audit, one gate-close audit, zero legacy users versions, and ordinary recurring capture still enabled in phase 4. The browser's completed outbox was cleared and the isolated control disappeared on refresh.

The [private signed-in screenshot](/Users/chrisdrummond/Documents/ChatGPT/ServiceOS/.verification-results/new-dawn-2026-10-20/m2-users-one-page-live.png) shows the result and explicit partial-page limit. Do not infer that these source IDs are Drummonds team members or job assignees. The held source-user reference flag remains Off.

The trial controller uses the existing saved noninteractive Supabase CLI login. It contains no provider credential and does not call Commusoft itself. Its audit actor identifies the system release controller, while the signed-in page request records the real OpenFolk operator UUID.
