import test from "node:test";
import assert from "node:assert/strict";
import { GREETING_ASSETS, GREETING_TENANT, validateGreeting, greetingAudioEvidence } from "./receptionist-greeting-verification.ts";
const now = new Date("2026-10-02T06:00:00Z");
test("greeting recovery is limited to two fixed originals and one pinned neutral edit", () => {
  assert.equal(Object.keys(GREETING_ASSETS).length, 3);
  assert.equal(new Set(Object.values(GREETING_ASSETS).map(a => a.auditId)).size, 3);
});
test("arbitrary assets, tenant, empty/corrupted content and expired requests fail closed", async () => {
  for (const asset of ["__proto__", "constructor", "rob_busy", "https://example.test/audio.mp3"])
    await assert.rejects(validateGreeting({ tenantId: GREETING_TENANT, asset }, now), /not authorised/);
  await assert.rejects(validateGreeting({ tenantId: "other", asset: "alan_busy" }, now), /not authorised/);
  await assert.rejects(validateGreeting({ tenantId: GREETING_TENANT, asset: "alan_busy", audioBase64: "" }, now), /bytes invalid/);
  for (const timestamp of ["2026-10-01T23:59:59Z", "2026-10-03T00:00:00Z", "invalid"])
    await assert.rejects(validateGreeting({}, new Date(timestamp)), /window is closed/);
});
test("matching size and MP3 header cannot bypass SHA256 pinning", async () => {
  const bytes = Buffer.alloc(GREETING_ASSETS.alan_busy.bytes); bytes.write("ID3");
  await assert.rejects(validateGreeting({ tenantId: GREETING_TENANT, asset: "alan_busy", audioBase64: bytes.toString("base64") }, now), /hash mismatch/);
});
test("provider metadata or a different WAV cannot masquerade as verified greeting audio", async () => {
  const metadata = new TextEncoder().encode('{"size":186672}');
  assert.equal((await greetingAudioEvidence(metadata)).pcmMatchesApproved, false);
  const wav = Buffer.alloc(48); wav.write('RIFF'); wav.writeUInt32LE(40,4); wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt16LE(16,34);
  wav.write('data',36); wav.writeUInt32LE(4,40);
  assert.equal((await greetingAudioEvidence(wav)).pcmMatchesApproved,false);
  wav.writeUInt32LE(100,40);
  await assert.rejects(greetingAudioEvidence(wav), /Truncated/);
});
