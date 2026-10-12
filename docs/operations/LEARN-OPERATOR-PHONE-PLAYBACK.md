# Operator access to retained call audio

OpenFolk's selected-client Calls and Recording records views now include the
shared audio viewer. The recording list requires the existing active platform
admin grant, a real signed-in actor and a stated reason. It excludes View-As,
ordinary tenant roles without operator authority, and foreign source/cursor IDs.
No profile is moved between companies and no new grant is created.

The dedicated `learn-operator-phone-playback` endpoint validates the user session,
then calls its authorization RPC with that user's JWT. The server credential is
used only for signing an existing private storage object. Before releasing the
short-lived URL, it rechecks the same actor, selected client, recording pointer and
source digest. The playback receipt and operator reason are recorded atomically.
Failure to authorize or audit returns no URL. This never contacts Birchills.

Source/client/actor/reason changes unmount the player. Closing the detail or hiding
the page stops playback and clears the private URL. Refresh failure clears stale
recording rows. Stored transcript results still use their existing client reader;
operators can inspect transcripts through the separate audited collection.

## TEST evidence

Both additive SQL functions were installed at 12:34 UTC on 12 October, after a
full-schema rollback rehearsal. Tests cover 30+1 pagination, exact source binding,
foreign records, owner/view-only denial, operator access, actor spoofing, changed
source digest, idempotent audit, reason conflict, View-As, grant revocation and
audit-write failure. All 194 protected datasets were preserved.

The new endpoint is ACTIVE v1 with JWT verification. Its three downloaded
executable files match the reviewed source; four handler tests pass against the
download. Fifteen protocol/client/handler tests, strict frontend and endpoint
typechecks, and the frontend build pass. Other endpoints and schema are unchanged.
Protected frontend `e2d51fa` is READY at the stable TEST alias. On 12 October at
12:52 UTC, the existing operator session played the retained eight-second
synthetic recording to 0:08; closing its details removed the player. The earlier
view expiry also cleared records. Visual inspection found and corrected a shared
client-root layout conflict in both operator information/review panels.

Two browser reads produced six control-plane receipts and two matching playback
receipts. Exact actor, tenant, recording, reason and source-pointer digest match;
every original audit row is unchanged, and all other protected datasets match
across 194 collections. The stopped Commusoft supervisor's private baseline was
reconciled only for these exact additions, retaining original hashes and receipts.
No production data, identities or grants changed.

[Sanitized evidence](evidence/learn-operator-phone-playback-test-2026-10-12.json).

Real provider capture and playback remain separate from this retained-audio
feature. The Drummonds TEST tenant currently has no phone account, call or recording;
its Phone switch remains off. Its existing private recording bucket is WAV-only
and limited to 1 MiB per file. No cron schedules exist in TEST. Prepare bounded real
capture and storage scope before enabling that route; this deployment does not do so.
