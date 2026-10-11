# Local voicemail signature diagnostic

This is a separate, pinned **Node diagnostic dependency**, not a frontend or
deployed Edge Function dependency. Edge compatibility has not been established.
Install without lifecycle scripts from the repository root:

```sh
npm ci --prefix scripts/verify/voicemail-auth --ignore-scripts --no-fund --no-audit
node --test scripts/verify/learn-voicemail-dkim-probe.test.mjs
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
mailbox-recipient association, historical owner snapshot, extraction of the
signed MIME body/audio, private storage, capture controls and runtime integration
remain required. A valid signature from the expected domain authenticates signed
content; it does not establish which Drummonds employee may receive the recording.
No deployable sender-verification worker or live capture is claimed.

Primary references:
- [mailauth verifier](https://github.com/postalsys/mailauth)
- [Verifier result fields](https://github.com/postalsys/mailauth/blob/master/docs/dkim.md)
- [Gmail original-message reads](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
