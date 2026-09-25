import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PracticeLifecycle,
  practiceVoiceError,
  practiceEndedMessage,
} from "./receptionist-practice-runtime.ts";
import {
  reconcilePracticeSessions,
  practiceReservationFailure,
} from "../../supabase/functions/_shared/receptionist-web-call.ts";

test("end before delayed join never resurrects a call", async () => {
  const lifecycle = new PracticeLifecycle();
  let joined!: () => void;
  const wait = new Promise<void>((resolve) => {
    joined = resolve;
  });
  const completion = wait.then(() => lifecycle.ready());
  assert.equal(lifecycle.end(), true);
  joined();
  assert.equal(await completion, false);
  assert.equal(lifecycle.end(), false);
});
test("only one readiness event starts the call timer; terminal state is final", () => {
  const lifecycle = new PracticeLifecycle();
  assert.equal(lifecycle.ready(), true);
  assert.equal(lifecycle.ready(), false);
  assert.equal(lifecycle.end(), true);
  assert.equal(lifecycle.ready(), false);
});
test("optional audio enhancement failure does not terminate a connected conversation", () => {
  for (const type of [
    "audio-processing-setup-error",
    "audio-processor-recovery-error",
    "audio-observer-setup-error",
  ])
    assert.equal(practiceVoiceError({ type }).fatal, false);
  for (const type of ["daily-error", "reconnect-error", "audio-start-failed"])
    assert.equal(practiceVoiceError({ type }).fatal, true);
  assert.match(practiceVoiceError({ error: { name: "NotAllowedError" } }).message, /Microphone/);
  assert.ok(
    !practiceVoiceError({
      type: "daily-error",
      error: { name: "SECRET PROVIDER TEXT" },
    }).message.includes("SECRET"),
  );
});
test("verified no-audio failure is explained without exposing provider messages", () => {
  assert.match(
    practiceEndedMessage("call.in-progress.error-assistant-did-not-receive-customer-audio")!,
    /microphone audio/,
  );
  assert.equal(practiceEndedMessage("customer-ended-call"), null);
  assert.ok(!practiceEndedMessage("error-PRIVATE")!.includes("PRIVATE"));
});
test("reservation responses distinguish overlap, quota, duplicate and infrastructure failure", () => {
  assert.equal(
    practiceReservationFailure("A practice conversation is already reserved", null).code,
    "practice_busy",
  );
  assert.equal(
    practiceReservationFailure("Practice daily limit reached", null).code,
    "practice_daily_limit",
  );
  assert.match(
    practiceReservationFailure("Practice daily limit reached", null).error,
    /will not reset/,
  );
  assert.equal(practiceReservationFailure(undefined, false).status, 409);
  assert.equal(practiceReservationFailure("unexpected private DB detail", null).status, 503);
  assert.ok(
    !practiceReservationFailure("unexpected private DB detail", null).error.includes("private"),
  );
});
test("only positive, tenant/session-bound ended evidence releases a reservation", async () => {
  const bound = (status: string, session = "ended", tenant = "tenant") => ({
    type: "webCall",
    status,
    assistant: { metadata: { openfolkPracticeSession: session, openfolkTenant: tenant } },
  });
  const calls: Record<string, unknown> = {
    ended: bound("ended"),
    active: bound("in-progress", "active"),
    wrongTenant: bound("ended", "wrongTenant", "other"),
    wrongSession: bound("ended", "other"),
    absent: null,
  };
  const released: string[] = [];
  await reconcilePracticeSessions(
    [...Object.keys(calls), "failedRead"]
      .map((id) => ({ id, call_id: id }))
      .concat([{ id: "starting", call_id: null as unknown as string }]),
    "tenant",
    async (id) => {
      if (id === "failedRead") throw Error("offline");
      return calls[id];
    },
    async (id) => {
      released.push(id);
    },
  );
  assert.deepEqual(released, ["ended"]);
});
test("failed reconciliation write is not silently treated as successful", async () => {
  await assert.rejects(() =>
    reconcilePracticeSessions(
      [{ id: "s", call_id: "c" }],
      "t",
      async () => ({
        type: "webCall",
        status: "ended",
        assistant: { metadata: { openfolkPracticeSession: "s", openfolkTenant: "t" } },
      }),
      async () => {
        throw Error("write failed");
      },
    ),
  );
});
test("actual UI checks microphone before reservation and guards late completion", () => {
  const ui = readFileSync(
    new URL("../components/receptionist/PracticeImprove.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ui, /getUserMedia\(\{ audio: true \}\)/);
  assert.match(
    ui,
    /const voice = new VapiClient\("", undefined, undefined, \{ audioSource: track \}\)/,
  );
  assert.match(ui, /if \(!connection.ended\) ready\(\)/);
  assert.match(ui, /if \(issue.fatal\)/);
  assert.match(ui, /setSession\(\{ id, callId: data\.callId, startedAt:/);
  assert.doesNotMatch(ui, /media\.current\?\.stop\(\);\s*media\.current = null;\s*const voice/);
  assert.match(ui, /media.current\?\.stop\(\)/);
});
