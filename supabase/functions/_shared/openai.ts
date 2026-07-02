// ServiceOS — shared OpenAI helpers for Edge Functions (Deno).
//
// Provider-isolated speech-to-text. The rest of the pipeline depends only on
// `transcribeAudio` + the classified result shape, so a different provider
// (e.g. Deepgram for diarization/telephony) can be swapped in later without
// touching the calling function. URL imports only — no npm dependencies.

export const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";

// Default transcription model. Override with OPENAI_TRANSCRIPTION_MODEL.
// A safe documented fallback is "whisper-1".
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

/** OpenAI API key from Supabase secrets (server-side only). */
export function getOpenAiKey(): string | null {
  const key = Deno.env.get("OPENAI_API_KEY");
  return key && key.trim() !== "" ? key : null;
}

/** Configured transcription model, or the default. */
export function getTranscriptionModel(): string {
  const model = Deno.env.get("OPENAI_TRANSCRIPTION_MODEL");
  return model && model.trim() !== "" ? model.trim() : DEFAULT_TRANSCRIPTION_MODEL;
}

export type TranscribeResult =
  | { ok: true; text: string; language: string | null; model: string }
  | { ok: false; code: string; message: string; httpStatus: number };

/**
 * Transcribe an audio Blob via the OpenAI audio transcription API. Classifies
 * the common failure modes into stable codes: network_error,
 * openai_auth_failed, openai_rate_limited, openai_error, parse_error.
 */
export async function transcribeAudio(opts: {
  apiKey: string;
  model: string;
  audio: Blob;
  filename?: string;
}): Promise<TranscribeResult> {
  const form = new FormData();
  // FormData sets its own multipart boundary — do NOT set Content-Type manually.
  form.append("file", opts.audio, opts.filename ?? "recording.wav");
  form.append("model", opts.model);

  let resp: Response;
  try {
    resp = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "network failure";
    return {
      ok: false,
      code: "network_error",
      message: `Could not reach OpenAI: ${message}`,
      httpStatus: 502,
    };
  }

  if (resp.status === 401 || resp.status === 403) {
    return {
      ok: false,
      code: "openai_auth_failed",
      message: "OpenAI authentication failed — check OPENAI_API_KEY",
      httpStatus: 502,
    };
  }
  if (resp.status === 429) {
    return {
      ok: false,
      code: "openai_rate_limited",
      message: "OpenAI rate limit reached",
      httpStatus: 429,
    };
  }
  if (!resp.ok) {
    return {
      ok: false,
      code: "openai_error",
      message: `OpenAI transcription error (${resp.status})`,
      httpStatus: 502,
    };
  }

  let data: unknown;
  try {
    data = await resp.json();
  } catch {
    return {
      ok: false,
      code: "parse_error",
      message: "Could not parse OpenAI response",
      httpStatus: 502,
    };
  }

  const text = (data as { text?: unknown } | null)?.text;
  if (typeof text !== "string") {
    return {
      ok: false,
      code: "parse_error",
      message: "OpenAI response missing transcript text",
      httpStatus: 502,
    };
  }
  const rawLang = (data as { language?: unknown }).language;
  const language = typeof rawLang === "string" ? rawLang : null;

  return { ok: true, text, language, model: opts.model };
}
