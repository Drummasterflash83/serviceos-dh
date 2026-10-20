# Emma current provider readback — 20 October 2026

This is a read-only status record for the isolated New Dawn candidate. It does
not approve a call, provider change, publication or a main-number routing change.
The saved Supabase CLI login and the fixed `receptionist-testing` inspection
actions were used without 1Password. No caller messages, credentials or raw
provider payloads are retained here.

## Birchills, account 3950

`provider_inventory` returned HTTP 200 at the 20 October readback. The account
had 27 endpoints, including IVR 501 (Business Hours), IVR 502 (Out Of Hours),
virtual extension 205 (Emma), Tony's phone 105, Rob's phone 109 and shared
Emergency Call-Outs mailbox 603. The documented voicemail subresource probe
for the queried endpoints returned HTTP 405. This establishes endpoint
existence, not the current main-number route, busy/no-answer behavior,
mailbox-deposit behavior or notification delivery. Those need a separate
Birchills configuration readback and supervised phone receipts.

## Vapi configuration

`inspect_launch_graph` returned HTTP 200 at 02:25 UTC. Its fresh provider GETs
returned these release-configuration hashes:

| Resource | Provider ID | Hash prefix | Provider updated |
| --- | --- | --- | --- |
| LIVE Emma | `4eb2bee8-ac25-47c9-b962-409ed250ceb6` | `4d5a4078` | 13 Oct 13:29 UTC |
| Isolated candidate | `dcfc2e66-a438-43ab-b863-467f5a5089df` | `a7300200` | 2 Oct 10:30 UTC |
| Emergency helper | `41bd1fd0-3ebf-4f43-9ded-512cb9305455` | `a9292d69` | 1 Oct 19:15 UTC |
| Handoff tool | `94864962-b4c2-4364-ad82-6939cb9d4cb6` | `9c30e9d3` | 29 Sep 20:24 UTC |
| Ordinary tool | `89c45170-c66f-4688-a349-4a354892ba57` | `6dcd8375` | 1 Oct 11:30 UTC |
| Shared emergency tool | `ac550bea-6e64-4614-8dcf-a0a32856694e` | `3959d646` | 1 Oct 11:27 UTC |

The current LIVE assistant and both shared tools differ from the candidate's
saved source baseline. The candidate's ordinary destinations match the
approved transform, and the handoff passes full context, but candidate and
helper voice settings do **not** match current LIVE. The helper still uses the
shared emergency tool. It has no candidate-only inline three-destination
Rob/Tony/603 tool. The deployed inspection action predates the new inline-tool
projection, so its `helperOnlyUsesEmergencyTool: true` describes that old
shape, not a passing new candidate.

The separate metadata-only `inspect` returned HTTP 200. The candidate's
greeting template has three branches; each contains both “automated
receptionist” and “call is recorded”. This is configuration evidence, not
proof that Vapi renders and speaks each branch correctly. The candidate still
has one older model message, no installed intake-server policy, and no 603
fallback wording. It uses the existing handoff tool. Its voice object has no
explicit `speed` field, so published v14's 1.05 speed cannot be inferred for
this candidate. LIVE `receptionist-testing` is v55; the proposed
`receptionist-intake-check` function is not deployed.

## Local candidate and acceptance gates

The current branch source fixes the incomplete numbered-street case: “14
Road” cannot pass as a site, while ordinary “12 Example Rd/St” forms can.
The source candidate's 12 scenario definitions pass unchanged static
clock/mock/rubric preflight and all focused tests pass. Static checks do not
execute Vapi conversations, transfer a phone call, establish the saved
provider candidate hash or prove mailbox/email/Slack delivery.

Before any provider patch or test call: verify the current live/candidate
voice, transcriber and speed; reconcile the changed source baseline; deploy
and authenticate the candidate-only intake receiver; inspect and install a
candidate-only emergency tool with a reviewed 603 route; then run all 12
provider conversations on one unchanged candidate hash. A supervised test
number must demonstrate human-accepted primary and cross-cover transfers,
one 603 deposit after both failures, and correlated receipts to both engineer
addresses and the scoped Slack alert. The fail-closed experience for callers
who cannot provide a usable address, or when the intake receiver is down,
still needs an agreed operational fallback. Do not change the main number
without Chris's separate day-of go-ahead.
