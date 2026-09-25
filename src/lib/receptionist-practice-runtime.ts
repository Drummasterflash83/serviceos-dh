import type Vapi from "@vapi-ai/web";

// Vapi 2.x ships CommonJS (`exports.default`). Production dynamic imports can
// wrap it as {default: {default: Vapi}}, unlike Vite's development interop.
// Resolve and validate before reserving a paid call, not after creating it.
export function resolveVapiConstructor(module: unknown): typeof Vapi {
  let candidate = module;
  for (let depth = 0; depth < 3; depth++) {
    if (typeof candidate === "function") {
      if (
        typeof candidate.prototype?.reconnect === "function" &&
        typeof candidate.prototype?.stop === "function"
      )
        return candidate as typeof Vapi;
      break;
    }
    if (!candidate || typeof candidate !== "object") break;
    candidate = (candidate as { default?: unknown }).default;
  }
  throw Error(
    "The voice client could not load. Refresh this page before trying again. No test call was placed.",
  );
}

// SDK errors include recoverable audio-enhancement failures. Never hang up merely
// because optional noise cancellation could not start.
export function practiceVoiceError(value: unknown) {
  const e = value as { type?: string; error?: { name?: string } } | null;
  if (
    [
      "audio-processing-setup-error",
      "audio-processor-recovery-error",
      "audio-observer-setup-error",
    ].includes(e?.type ?? "")
  )
    return {
      fatal: false,
      message: "Noise reduction is unavailable. You can continue the conversation.",
    };
  if (e?.type === "audio-start-failed")
    return {
      fatal: true,
      message:
        "Your browser blocked Emma’s audio playback. Allow sound for this site, then start again.",
    };
  if (e?.error?.name === "NotAllowedError")
    return {
      fatal: true,
      message:
        "Microphone access was blocked. Allow the microphone for this site, then start again.",
    };
  return {
    fatal: true,
    message:
      "The browser voice connection stopped before it was ready. Check microphone access and your connection. Your feedback is still here.",
  };
}

export function practiceEndedMessage(reason: string | null | undefined) {
  if (reason === "call.in-progress.error-assistant-did-not-receive-customer-audio")
    return "Emma did not receive microphone audio, so this conversation could not start. Check your microphone and browser permissions before another attempt.";
  if (reason === "customer-did-not-give-microphone-permission")
    return "Microphone permission was not granted. Allow it in your browser before another attempt.";
  if (reason === "exceeded-max-duration") return "This practice reached its time limit.";
  if (reason === "silence-timed-out") return "The conversation ended after a period of silence.";
  if (reason && /error|failed/.test(reason))
    return "The voice provider ended this conversation with a connection error. OpenFolk can check its call record.";
  return null;
}

// Check actual input before reserving a provider call. Permission alone proves
// only that a track exists; a muted device can still produce silent calls.
export async function microphoneHasSignal(track: MediaStreamTrack, timeoutMs = 8000) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  try {
    await context.resume();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && track.readyState === "live" && track.enabled) {
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      if (Math.sqrt(energy / samples.length) > 0.008) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  } finally {
    source.disconnect();
    await context.close();
  }
}

// One-way terminal latch: join() may finish after call-end/error/cancel.
// Its late completion must not resurrect a terminated call or start a timer.
export class PracticeLifecycle {
  private finished = false;
  private connected = false;
  private preparing = false;
  // The SDK can emit call-start from both the join completion and its
  // "listening" message. Claim readiness before any asynchronous device work.
  beginReadiness() {
    if (this.finished || this.connected || this.preparing) return false;
    this.preparing = true;
    return true;
  }
  ready() {
    if (this.finished || this.connected) return false;
    this.connected = true;
    return true;
  }
  end() {
    if (this.finished) return false;
    this.finished = true;
    return true;
  }
  get ended() {
    return this.finished;
  }
  get wasReady() {
    return this.connected;
  }
}
