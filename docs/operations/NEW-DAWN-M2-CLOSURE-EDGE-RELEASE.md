# M2 closure Edge-only release handoff

This prepares the v5-compatible `learn-commusoft-job-detail` Edge route for
LIVE. It is a separate step before SQL migration
`20261107160000_new_dawn_commusoft_job_closure_source_facts.sql`. The Edge
route accepts both the installed v4 receipt and the proposed v5 receipt; it
does not change the Commusoft request scope, provider endpoint, source data,
flags, permits or SQL. Do not run a provider GET in this release.

The reviewed artifact was compiled locally with the pinned Supabase Edge
runtime. Source closure SHA-256:
`be16e43e707f180a11fa68cf73c71a5284aafb01698c405560683821cb755884`;
ESZIP SHA-256:
`248a4d308a6663e3107c66c49578a9355d7373ee5e4ac541fdd066da5de1d640`;
EZBR SHA-256:
`b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb`
(123,899 bytes). Its private path in this worktree is
`/private/tmp/serviceos-new-dawn-m2-closure/.verification-results/m2-closure-edge-v5-20261019-2350/artifacts/learn-commusoft-job-detail.ezbr`.
Regenerate into a fresh private directory using
`scripts/verify/new-dawn-m2-closure-edge-prepare.mjs` if moving checkouts;
the release helper rejects any artifact with different bytes. Keep the
compiled binary out of Git.

The release helper is `scripts/verify/new-dawn-m2-closure-edge-release.mjs`.
Its dry run checks local source and transport bytes without network access.
The LIVE read-only mode checks active project identity, the exact current
Edge v5 ID/hash/JWT/status, the optional-facts SQL ledger and function hash,
zero active permits and both broad M2 flags off. It downloads the deployed
v5 source, compares its pinned source closure and confirms the LIVE metadata
did not change during the check. These modes passed on 19 October; repeat the
read-only command immediately before release.

```sh
node --test scripts/verify/new-dawn-m2-closure-edge-release.test.mjs
node scripts/verify/new-dawn-m2-closure-edge-release.mjs --dry-run --artifact=.verification-results/m2-closure-edge-v5-20261019-2350/artifacts/learn-commusoft-job-detail.ezbr --out=.verification-results/m2-closure-edge-dry-run
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-closure-edge-release.mjs --live-read-only --artifact=.verification-results/m2-closure-edge-v5-20261019-2350/artifacts/learn-commusoft-job-detail.ezbr --out=.verification-results/m2-closure-edge-preflight-fresh
```

Use fresh output directory names if those paths already exist. The deployment
command below is **prepared, not executed**. It requires a separate exact
artifact environment value and performs one PATCH to the one existing
Supabase function. It then reads back Edge metadata, the unchanged SQL
ledger/function/default-off state, and downloaded deployed source. It rejects
an unexpected version (including a concurrent deployment), hash, source
closure or unrelated Edge change. An uncertain PATCH is never replayed.

```sh
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz NEW_DAWN_M2_EDGE_DEPLOY_ALLOW_SHA=b665e27c909b952840327210b592af46e2339e929ff4baecffd406df3dca35eb node scripts/verify/new-dawn-m2-closure-edge-release.mjs --live-deploy-exact --artifact=.verification-results/m2-closure-edge-v5-20261019-2350/artifacts/learn-commusoft-job-detail.ezbr --out=.verification-results/m2-closure-edge-deploy-fresh
```

If a PATCH is acknowledged but subsequent metadata or source readback fails,
the runtime may already be v6. Stop; inspect it read-only and do not repeat
the PATCH. The v6 route is backward compatible with installed SQL v4, so
closure SQL can remain uninstalled while investigating. The previous v5
deployed source was downloaded read-only with source closure SHA-256
`e913eb7ad77d6464ee36c74ae7868e5988d5e3ed2170982d581f84da8593b0dc`
and the compiled prior runtime should be preserved separately for an exact
rollback. Only after v6 source readback passes may the separate closure SQL
preflight and release proceed; neither is part of this Edge helper.

**Post-deploy readback correction:** the 19 October LIVE PATCH installed
version 6 with the exact EZBR hash above. Supabase CLI exports this compiled
version's shared files under
`work/supabase/functions/_shared/commusoft/` and strips TypeScript types.
The old byte-for-byte source check reported an unverified readback even though
the runtime metadata matched. The helper now compares the complete executable
TypeScript AST of each of the three reviewed files, ignoring only comments,
formatting, type erasure and parentheses. The original version 5 byte-for-byte
readback remains unchanged. Use this **read-only** mode to verify installed
v6 independently; it checks the exact Edge metadata, retained v4 optional SQL,
zero permits and flags off, downloads v6 source, compares all three executable
ASTs, and checks metadata again:

```sh
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-closure-edge-release.mjs --live-v6-readback --artifact=.verification-results/m2-closure-edge-v5-20261019-2350/artifacts/learn-commusoft-job-detail.ezbr --out=.verification-results/m2-closure-edge-v6-readback-fresh
```

Choose a fresh output directory. This command does not PATCH, install SQL,
change flags or call Commusoft. A future replay of the Edge deploy command
must not be used to resolve the readback issue.

This corrected read-only mode passed on 19 October: Edge v6
`b665e27c…`, reviewed executable source closure `be16e43e…`, optional
SQL `20261107150000`, zero active permits and both broad flags off. No
production state changed during that readback.

After the separately released closure SQL
`20261107160000_new_dawn_commusoft_job_closure_source_facts.sql` is
installed, the pre-closure `--live-v6-readback` mode intentionally stops
because its function and ledger pins are for v4. Use the separate
`--live-v6-closure-readback` mode. It checks the exact v6 Edge hash, optional
and closure migration receipts, v5 finish-function definition hash, zero
active permits and broad flags off, downloads the v6 Edge source and compares
all three executable ASTs, then rereads the state to detect change. It is
read-only and makes no provider request:

```sh
NEW_DAWN_M2_ALLOW_PROJECT=tgbnakbxwcqjeimygroz node scripts/verify/new-dawn-m2-closure-edge-release.mjs --live-v6-closure-readback --artifact=.verification-results/m2-closure-edge-v5-20261019-2350/artifacts/learn-commusoft-job-detail.ezbr --out=.verification-results/m2-closure-edge-v6-closure-readback-fresh
```

Choose a fresh output directory. The closure SQL install and independent
SQL readback are separate from this source check.
The post-closure read-only mode passed on 19 October with v6 Edge hash
`b665e27c…`, closure migration source hash `ab50173c…`, reviewed
deployed executable source closure `be16e43e…`, zero active permits and
both broad flags off. It made no production change or provider request.
