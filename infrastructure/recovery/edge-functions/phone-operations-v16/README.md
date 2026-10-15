# LIVE phone-operations v16 recovery source

This directory retains the source required to rebuild the LIVE `phone-operations`
Edge Function. On 15 October 2026 the LIVE Management API reported it ACTIVE at
version 16, `verify_jwt=false`, bundle SHA-256
`3253bb7078b9d4e7fa445b96b34e04a4f0c47a8dcd4512b4bf361c82def0d1bd`.
Its source was absent from the ServiceOS checkout even though 100 other active
functions had local entrypoints. The `data-import` directory is a shared handler,
not a deployed function entrypoint.

The four files in `functions/` come from tracked source commit
`b0d4b5f` in the separate `serviceos-dh` checkout. An authenticated, read-only
download of LIVE v16 was kept in ignored private recovery storage. TypeScript
transpilation and syntax-tree comparison found the archived entrypoint and all
three dependencies structurally identical to that downloaded runtime source
(1,714, 644, 515 and 927 nodes respectively). The later source at commit
`9e64ee0` contains additional Phone Operations behavior and did **not** match
LIVE v16; it must not be substituted as an exact restore claim. A high-entropy
credential-pattern scan of this archive found no embedded key. Secrets remain in
provider/runtime storage, never in these files.

For an isolated recovery rehearsal, copy the `functions/` tree into a fresh
project's `supabase/functions/` tree, then bundle and deploy `phone-operations`
with the reviewed `verify_jwt=false` setting. Its handler performs its own user
and webhook-secret checks; a restored service must reject unauthenticated and
foreign-tenant requests before any production route is resumed. Use synthetic
secrets and disable provider egress in the rehearsal. Restore Auth settings,
signing keys, runtime secrets, database, Storage bytes and the frontend from
their separate approved recovery sources; this source archive alone does not
establish a working application or Auth restore. Never point the rehearsal at
LIVE providers or expose archived customer data.

[Supabase's platform-to-self-hosted recovery guide](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
also distinguishes restored database/Auth users from separately required Auth
configuration, function code, Storage objects and SMTP settings.
