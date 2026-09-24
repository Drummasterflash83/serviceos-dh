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

// One-way terminal latch: join() may finish after call-end/error/cancel.
// Its late completion must not resurrect a terminated call or start a timer.
export class PracticeLifecycle {
  private finished = false;
  private connected = false;
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
}
