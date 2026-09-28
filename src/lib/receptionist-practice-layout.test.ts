import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) =>
  readFileSync(new URL(`../components/receptionist/${file}`, import.meta.url), "utf8");
const css = read("receptionist.css");
const practice = read("PracticeImprove.tsx");
const recording = read("CallRecording.tsx");

test("practice recording keeps padding on every edge, independent of shared card styles", () => {
  const block = css.match(/\.ep-current-call \.rw-recording\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(block, /padding:\s*clamp\(16px, 3vw, 24px\)/);
  assert.doesNotMatch(block, /padding:\s*10px 0/);
  assert.match(css, /\.rw-recording-header\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.rw-recording audio\s*\{[^}]*max-width:\s*100%/s);
});

test("transcript separates speaker and words without changing the transcript", () => {
  assert.match(
    practice,
    /role="region"\s+tabIndex=\{0\}\s+aria-label="Live conversation transcript"/,
  );
  assert.match(practice, /<strong>\{line.role\}<\/strong>\s*<span>\{line.text\}<\/span>/);
  assert.match(css, /\.ep-transcript p\s*\{[^}]*minmax\(0, 1fr\)/s);
  assert.match(css, /\.ep-transcript span\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});

test("recording playback exposes paused and ended states, not a stale Playing label", () => {
  assert.match(recording, /onPause=/);
  assert.match(recording, /onEnded=\{\(\) => setState\("Recording finished"\)\}/);
  assert.match(recording, /audio\.paused/);
  assert.doesNotMatch(recording, /press play below/);
  assert.match(recording, /type="button"/);
});
