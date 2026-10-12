import test from "node:test";
import assert from "node:assert/strict";
import { canRecoverPhoneAuth } from "./learn-phone-real-test-guard.mjs";
const fixture = () => [
  {
    state: "capturing",
    pending: null,
    history: [
      {
        name: "simwood-sync-calls",
        status: 401,
        success: false,
        code: "internal_auth_mismatch",
        run: null,
        processed: null,
        windowComplete: null,
      },
    ],
  },
  {
    active: true,
    allowed: false,
    calls: 0,
    recordings: 0,
    audio: 0,
    running: 0,
    ai: 0,
    transcripts: 0,
  },
  [
    "phone_calls",
    "phone_recordings",
    "phone_sync_runs",
    "learn_phone_capture_pages",
    "learn_phone_import_completions",
    "learn_phone_processing_attempts",
  ].map((name) => ({ name, n: 0 })),
];
test("one acknowledged internal-auth rejection can resume only with paused, empty source and run state", () => {
  assert.equal(canRecoverPhoneAuth(...fixture()), true);
  for (const change of [
    (p) => (p.pending = { name: "simwood-sync-calls" }),
    (p) => (p.authRecovery = {}),
    (p) => (p.state = "prepared"),
    (p) => p.history.push({ ...p.history[0] }),
    (p) => (p.history[0].status = 503),
    (p) => (p.history[0].success = true),
    (p) => (p.history[0].code = "provider_error"),
    (p) => (p.history[0].run = "some-run"),
    (p) => (p.history[0].processed = 0),
    (p) => (p.history[0].windowComplete = false),
    (p) => (p.history[0].name = "simwood-sync-recordings"),
  ]) {
    const [p, s, r] = fixture();
    change(p);
    assert.equal(canRecoverPhoneAuth(p, s, r), false);
  }
  for (const key of ["calls", "recordings", "audio", "running", "ai", "transcripts"]) {
    const [p, s, r] = fixture();
    s[key] = 1;
    assert.equal(canRecoverPhoneAuth(p, s, r), false);
  }
  for (let i = 0; i < 6; i++) {
    const [p, s, r] = fixture();
    r[i].n = 1;
    assert.equal(canRecoverPhoneAuth(p, s, r), false);
  }
  for (const change of [(r) => r.pop(), (r) => (r[0] = { ...r[1] }), (r) => (r[0].n = "0")]) {
    const [p, s, r] = fixture();
    change(r);
    assert.equal(canRecoverPhoneAuth(p, s, r), false);
  }
  const [p, s, r] = fixture();
  s.allowed = true;
  assert.equal(canRecoverPhoneAuth(p, s, r), false);
});
