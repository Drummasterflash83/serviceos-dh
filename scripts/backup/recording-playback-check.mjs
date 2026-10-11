/** Full local decode is evidence of decodability, not a human listening check. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, chmod, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { RecordingBackupError } from "./recording-backup-core.mjs";
const fail = (code) => {
  throw new RecordingBackupError(code);
};
const MAX = 64 * 1024 * 1024;
export async function checkRecordingPlayback(restored) {
  const output = join(restored.directory, "decoded-check.wav");
  let watch;
  try {
    if (process.platform !== "darwin")
      return {
        state: "not_checked",
        reason: "local_decoder_unavailable",
        listening: "not_verified",
      };
    if (restored.bytes === 0)
      return { state: "not_checked", reason: "empty_recording", listening: "not_verified" };
    if (restored.bytes > 8 * 1024 * 1024)
      return { state: "not_checked", reason: "decode_input_size_limit", listening: "not_verified" };
    const abort = new AbortController();
    let tooLarge = false;
    watch = setInterval(() => {
      stat(output)
        .then((s) => {
          if (s.size > MAX) {
            tooLarge = true;
            abort.abort();
          }
        })
        .catch(() => {});
    }, 100);
    try {
      await promisify(execFile)(
        "/usr/bin/afconvert",
        ["-f", "WAVE", "-d", "LEI16", restored.path, output],
        {
          timeout: 30000,
          maxBuffer: 4096,
          signal: abort.signal,
        },
      );
    } catch {
      fail(tooLarge ? "playback_output_limit" : "playback_decode_unconfirmed");
    }
    clearInterval(watch);
    watch = null;
    await chmod(output, 0o600);
    const file = await open(output, "r");
    try {
      const size = (await file.stat()).size;
      if (size > MAX || size < 44) fail("playback_output_unverified");
      const header = Buffer.alloc(12);
      await file.read(header, 0, 12, 0);
      if (
        header.toString("ascii", 0, 4) !== "RIFF" ||
        header.toString("ascii", 8, 12) !== "WAVE" ||
        header.readUInt32LE(4) + 8 !== size
      )
        fail("playback_output_unverified");
      let offset = 12,
        format,
        frames = 0;
      while (offset + 8 <= size) {
        const chunk = Buffer.alloc(8);
        await file.read(chunk, 0, 8, offset);
        const bytes = chunk.readUInt32LE(4),
          tag = chunk.toString("ascii", 0, 4);
        if (offset + 8 + bytes > size) fail("playback_output_unverified");
        if (tag === "fmt ") {
          if (bytes < 16) fail("playback_output_unverified");
          const fmt = Buffer.alloc(16);
          await file.read(fmt, 0, 16, offset + 8);
          format = {
            code: fmt.readUInt16LE(0),
            channels: fmt.readUInt16LE(2),
            rate: fmt.readUInt32LE(4),
            align: fmt.readUInt16LE(12),
            bits: fmt.readUInt16LE(14),
          };
        }
        if (tag === "data") {
          if (
            !format ||
            format.code !== 1 ||
            format.bits !== 16 ||
            !format.channels ||
            format.align !== format.channels * 2 ||
            !format.rate ||
            bytes % format.align
          )
            fail("playback_output_unverified");
          frames += bytes / format.align;
        }
        offset += 8 + bytes + (bytes % 2);
      }
      if (!frames || offset !== size) fail("playback_output_unverified");
      return {
        state: "decoded",
        decoder: "macOS afconvert",
        frames,
        sampleRate: format.rate,
        channels: format.channels,
        durationSeconds: frames / format.rate,
        listening: "not_verified",
      };
    } finally {
      await file.close();
    }
  } finally {
    clearInterval(watch);
    await rm(output, { force: true });
  }
}
