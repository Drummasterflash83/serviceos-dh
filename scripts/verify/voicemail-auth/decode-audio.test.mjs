import test from "node:test";
import assert from "node:assert/strict";
import { decodeVoicemailAudio } from "./decode-audio.mjs";
test("empty, oversized and non-MPEG payloads cannot become playable voicemail", async () => {
  await assert.rejects(decodeVoicemailAudio(new Uint8Array()), /input_invalid/);
  await assert.rejects(decodeVoicemailAudio(new Uint8Array(1048577)), /input_invalid/);
  await assert.rejects(
    decodeVoicemailAudio(new Uint8Array([1, 2, 3, 4])),
    /decode_empty|decode_unconfirmed/,
  );
});
