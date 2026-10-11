# Local voicemail signature diagnostic

This is a separate, pinned **Node diagnostic dependency** package, not a frontend
dependency. The shared implementation now lives in
`supabase/functions/_shared/voicemail/`; Node files here are thin adapters.
The server-only `edge.js` adapter uses pinned npm imports and passed an actual
offline Supabase Edge Runtime 1.74.3 user-worker check. It is not yet deployed.
Install without lifecycle scripts from the repository root:

```sh
npm ci --prefix scripts/verify/voicemail-auth --ignore-scripts --no-fund --no-audit
node --test scripts/verify/learn-voicemail-dkim-probe.test.mjs
node --test scripts/verify/voicemail-auth/signed-voicemail.test.mjs
node --test scripts/verify/voicemail-auth/decode-audio.test.mjs
```

`learn-voicemail-dkim-probe.mjs` reads one original email on stdin, bounded at 1 MiB.
It uses mailauth 7.3.0 in strict mode, requires RSA-SHA256 with at least 2048 bits,
the whole body, unique From/To/Subject/Date/Message-ID/MIME-Version/Content-Type
fields and signature coverage of those fields. Only TXT lookups for selectors
under the observed Birchills Google signing domain are allowed, at most three
distinct keys, with bounded DNS timeouts. Other signing domains are refused.
The report contains booleans, counts and algorithm details, never message text,
addresses, signature values or keys. No raw message is written to disk.

The wrapper `learn-voicemail-raw-auth-sample.mjs` rechecks the production tenant,
active Workspace credential and existing mailbox/source binding before one
read-only Gmail raw-message request. It uses the first retained private discovery
sample; it is not a general inbox scanner. It passes raw bytes to the diagnostic
child with an empty environment and no credentials. It writes exclusive, ignored
mode-0600 journals/results. The separate `--retry-after-local-fix` attempt preserves
the original journal rather than overwriting it. Do not rerun a completed journal.

```sh
node scripts/verify/learn-voicemail-raw-auth-sample.mjs --read-only-production-and-google
```

The 11 October live probe verified one signature and rejected locally modified
copies (subject change, body alteration with forged Authentication-Results, extra
From field). Two synthetic regression tests require no provider or DNS access.
The initial live attempt failed because the library's actual signed-header key
list is a string, despite its documented array; the adapter now handles both.

**This does not authorize import.** The configured provider-account/signer and
mailbox-recipient association, historical owner snapshot, private storage,
capture controls and runtime integration
remain required. A valid signature from the expected domain authenticates signed
content; it does not establish which Drummonds employee may receive the recording.
No deployable sender-verification worker or live capture is claimed.

## Extraction from verified original content

`signed-voicemail.mjs` now verifies and parses the same bounded original bytes.
The pinned postal-mime 4.0.5 parser limits total header bytes, nesting depth and
part count; nested messages become attachments, never silently become the main
notification. The signed To list must contain the expected mailbox; groups are
not inferred. Exactly one supported MP3 attachment is required. The return value
includes private candidate text and audio bytes for a future importer, and raw,
audio and stable content hashes. It still requires a verified provider-account /
private mailbox binding and audio validation; it is not a grant or an import.

Four synthetic signed-message tests cover successful extraction and repeat
receipts, wrong recipients, altered/unsigned and partial-body signatures,
ambiguous/unsupported/empty attachments and actual MIME complexity-limit errors.
The fixture audio is arbitrary bytes; these tests do not claim audio decoding.

`--extract-signed-content` selects a separate one-message wrapper journal and
in-memory child probe. It supplies the expected account mailbox and compares the
extracted audio hash/size to the earlier successful real decode evidence. The
11 October check matched the same 57,285-byte audio exactly, with the parser text
now obtained from the verified original MIME body. The child prints only
sanitized proof, never candidate text, headers, addresses or audio. No raw or
decoded content is persisted. The generic extractor's audio-format validation
requires the separate decoder below; matching the previous digest proved that sample.

```sh
node scripts/verify/learn-voicemail-raw-auth-sample.mjs --read-only-production-and-google --extract-signed-content
```

Primary references:
- [mailauth verifier](https://github.com/postalsys/mailauth)
- [Verifier result fields](https://github.com/postalsys/mailauth/blob/master/docs/dkim.md)
- [Gmail original-message reads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)

## Private import coordinator

`private-import.mjs` accepts a service-role SDK-shaped client, a fixed tenant/route,
source message ID/account/receipt time, a bounded provider loader and the restricted
DNS resolver. It calls route admission before the loader, verifies that the loaded
source identity/receipt is unchanged, then verifies/extracts the signed message.
Its default decoder is `decode-audio.mjs`, using pinned mpg123 WebAssembly with
bounded input, chunks, PCM output and duration. Actual frame decoding was verified
against the same real 28.512-second sample. PCM output channel count is not an
assertion about the source's channel layout. Decode errors and empty output fail;
this does not assess intelligibility or prove every malformed MPEG tail is rejected.

After SQL preparation and a second admission check, both files are uploaded with
`upsert:false` and read back for size/SHA256 verification before publication.
Unknown upload replies are resolved by checking existing bytes. Conflicts never
cause overwrite or deletion. Failed/paused publication retains the private intake
and files for a retry. Published records retain the route's historical owner;
current extension reassignment does not change it.

`python3 scripts/verify/learn-voicemail-intake-local.py` now also runs the Node
coordinator against the actual PostgreSQL functions. Its synthetic loader and
in-memory storage adapter inject failures; successful publication uses a decoder
test double, while invalid audio is also rejected using the actual decoder. This
is orchestration proof, not hosted Storage transport or deployed runtime proof.

The diagnostic wrapper's `--decode-signed-content` mode uses a separate exclusive
journal for one real read-only signature/extraction/portable-decode check. Raw,
audio and PCM are not saved. No credentials are passed to the decoder child.

Still required: deployed runtime support and actual SDK/provider wiring, verified
routes/ownership, TEST installation and hosted storage acceptance, scheduling and
coverage, larger-message handling, recovery coverage and signed-in acceptance.

## Actual Edge user-worker check

```sh
python3 scripts/verify/learn-voicemail-edge-runtime.py
```

Requires the already-installed Docker image
`public.ecr.aws/supabase/edge-runtime:v1.74.3`; the harness never pulls it. Only
selected code/dependencies and synthetic fixtures are staged and mounted read-only.
The container has no external network and the user worker receives no host env.
A fresh synthetic RSA key signs generated notification mail; the private key
never leaves the generator process. A pinned development-only encoder,
`@breezystack/lamejs@1.2.7`, generates 28 seconds of tone. It is not a production
runtime dependency. The Edge worker imports the actual server adapter, verifies
and extracts the signed source, rejects body tampering and invalid MPEG bytes,
compares real decode output to Node, and runs the coordinator using controlled
SDK-shaped RPC/storage adapters. The worker is limited to 256 MiB, 2 seconds CPU
and 30 seconds wall time. The initial runtime failure (`Buffer is not defined`)
was fixed with explicit `node:buffer` imports in shared code.

Passing this check proves local runtime compatibility for this synthetic sample,
not hosted packaging, network DNS, provider access, real Storage, user playback or
full duration/format coverage. The existing actual PostgreSQL suite separately
checks SQL authority, preservation, concurrency and retry behaviour. No routes,
accounts, secrets or hosted capture are created by either test.

Primary references for this harness:
- [Supabase user-worker example](https://github.com/supabase/edge-runtime/blob/main/examples/main/index.ts)
- [Synthetic encoder](https://github.com/shijinyu/lamejs)

## Workspace bridge and internal HTTP entry

`supabase/functions/learn-voicemail-import/index.ts` is a prepared server-only
one-message endpoint, not a schedule or active deployment. It authenticates an
exact existing internal/service key before parsing the bounded body. The tenant
comes from the internal header. The shared Workspace bridge reuses the existing
credential-binding code, confirms Gmail profile identity, rechecks the route and
reads one bounded original message before invoking the shared importer. It does
not accept raw message bytes, provider tokens or caller-selected URLs over HTTP.

```sh
node --test scripts/verify/voicemail-auth/workspace-import.test.mjs supabase/functions/_shared/email_capture_ports.test.ts
```

The Edge harness now stages the static dependency graph of this endpoint and
executes its shared HTTP handler/provider bridge with controlled SDK/provider
transports. It does not call the actual SDK/network endpoint or mint a live token.
Live DNS resolution and hosted provider/storage compatibility remain unproven.
The public DNS resolver's restrictions are shared with the Node diagnostic.
The authenticated response explicitly keeps `coverageComplete:false`; scheduling,
source enumeration, queue fences and history coverage are still required.
