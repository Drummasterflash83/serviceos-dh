import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) =>
  readFileSync(new URL(`../components/receptionist/${file}`, import.meta.url), "utf8");
const css = read("receptionist.css");
const practice = read("PracticeImprove.tsx");
const recording = read("CallRecording.tsx");

function luminance(hex: string) {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((pair) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

test("feedback text and placeholder have explicit, readable colours on the purple console", () => {
  const field = css.match(/\.ep-inline-feedback textarea\s*\{([^}]+)\}/)![1];
  const placeholder = css.match(/\.ep-inline-feedback textarea::placeholder\s*\{([^}]+)\}/)![1];
  const colour = (block: string, property: string) =>
    block.match(new RegExp(`(?:^|[;\\s])${property}:\\s*(#[a-f0-9]{6})`))![1];
  const background = luminance(colour(field, "background"));
  for (const block of [field, placeholder]) {
    const foreground = luminance(colour(block, "color"));
    const contrast =
      (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
    assert.ok(contrast >= 4.5, `feedback contrast ${contrast.toFixed(2)} must be at least 4.5:1`);
  }
  assert.match(placeholder, /opacity:\s*1/);
  assert.match(field, /font-size:\s*16px/);
  assert.match(field, /color-scheme:\s*light/);
});

test("feedback keeps a visible caret, keyboard focus and legible saving state", () => {
  assert.match(css, /\.ep-inline-feedback textarea\s*\{[^}]*caret-color:\s*#34243e/s);
  assert.match(css, /\.ep-inline-feedback textarea:focus-visible\s*\{[^}]*outline:\s*3px solid/s);
  assert.match(
    css,
    /\.ep-inline-feedback textarea:disabled\s*\{[^}]*-webkit-text-fill-color:\s*#34243e;[^}]*opacity:\s*1/s,
  );
});

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
