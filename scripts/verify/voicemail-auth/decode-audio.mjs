/** Bounded MPEG decode without a native executable or persisted PCM.
 * Byte hashes establish identity; decoding establishes playable PCM, not speech quality.
 */
import { MPEGDecoder } from "mpg123-decoder";
export async function decodeVoicemailAudio(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 1048576)
    throw Error("voicemail_decode_input_invalid");
  const decoder = new MPEGDecoder({ enableGapless: false });
  let frames = 0,
    rate = 0,
    channels = 0,
    pcmBytes = 0;
  try {
    await decoder.ready;
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      const result = decoder.decode(bytes.subarray(offset, Math.min(bytes.length, offset + 16384)));
      if (
        !Array.isArray(result.errors) ||
        result.errors.length ||
        !Number.isSafeInteger(result.samplesDecoded) ||
        result.samplesDecoded < 0
      )
        throw Error("voicemail_decode_unconfirmed");
      if (!result.samplesDecoded) continue;
      if (
        !Number.isInteger(result.sampleRate) ||
        result.sampleRate < 8000 ||
        result.sampleRate > 48000 ||
        !Array.isArray(result.channelData) ||
        result.channelData.length < 1 ||
        result.channelData.length > 2 ||
        (rate && rate !== result.sampleRate) ||
        (channels && channels !== result.channelData.length)
      )
        throw Error("voicemail_decode_format_changed");
      rate = result.sampleRate;
      channels = result.channelData.length;
      frames += result.samplesDecoded;
      try {
        for (const pcm of result.channelData) {
          if (!(pcm instanceof Float32Array) || pcm.length !== result.samplesDecoded)
            throw Error("voicemail_decode_output_invalid");
          pcmBytes += pcm.byteLength;
          if (pcmBytes > 64 * 1024 * 1024 || frames / rate > 7202)
            throw Error("voicemail_decode_output_limit");
          if (pcm.some((sample) => !Number.isFinite(sample)))
            throw Error("voicemail_decode_output_invalid");
        }
      } finally {
        for (const pcm of result.channelData) if (pcm instanceof Float32Array) pcm.fill(0);
      }
    }
    if (!frames || !rate) throw Error("voicemail_decode_empty");
    return {
      state: "decoded",
      decoder: "mpg123-decoder@1.0.3",
      frames,
      sampleRate: rate,
      decodedChannels: channels,
      durationSeconds: frames / rate,
      listening: "not_verified",
    };
  } finally {
    decoder.free();
  }
}
