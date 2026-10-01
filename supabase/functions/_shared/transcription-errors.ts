// Never persist provider prose: it may contain filenames, input text or secrets.
export function classifyTranscriptionError(status: number, body: unknown) {
  const error = (body as { error?: { code?: unknown; type?: unknown; message?: unknown } })?.error;
  const code = typeof error?.code === "string" ? error.code : "";
  const type = typeof error?.type === "string" ? error.type : "";
  const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
  let category = "openai_error";
  let detail = `Transcription provider failed (${status}); retry with backoff`;
  if (
    ["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"].includes(
      code,
    ) ||
    type === "insufficient_quota"
  ) {
    category = "openai_quota_exhausted";
    detail = "Transcription funding or spend limit needs OpenFolk review";
  } else if (status === 401 || status === 403) {
    category = "openai_auth_failed";
    detail = "Transcription credentials or project access need OpenFolk review";
  } else if (status === 429) {
    category = "openai_rate_limited";
    detail = "Transcription rate limit reached; retry with backoff";
  } else if (
    status === 413 ||
    (status === 400 && /maximum content size|file size|too large/.test(message))
  ) {
    category = "audio_too_large";
    detail = "Recording exceeds provider limits; split or convert before retrying";
  } else if (status === 400 && /too short|minimum.*duration/.test(message)) {
    category = "audio_too_short";
    detail = "Recording is too short for transcription; review source audio";
  } else if (status === 400 && /audio|file format|decode|corrupt/.test(message)) {
    category = "invalid_audio";
    detail = "Provider rejected the audio; review format, integrity and duration";
  } else if (status >= 400 && status < 500 && status !== 408) {
    category = "openai_invalid_request";
    detail = "Transcription request rejected; OpenFolk must review it before retrying";
  }
  return {
    ok: false as const,
    code: category,
    message: detail,
    httpStatus: status === 429 ? 429 : 502,
    providerStatus: status,
  };
}
