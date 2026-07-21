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

// --- Analysis (chat completions) ----------------------------------------

export const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

// Default analysis model. Override with OPENAI_ANALYSIS_MODEL.
export const DEFAULT_ANALYSIS_MODEL = "gpt-4o-mini";

/** Configured analysis model, or the default. */
export function getAnalysisModel(): string {
  const model = Deno.env.get("OPENAI_ANALYSIS_MODEL");
  return model && model.trim() !== "" ? model.trim() : DEFAULT_ANALYSIS_MODEL;
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

export type AnalyseResult =
  | { ok: true; data: Record<string, unknown>; model: string }
  | { ok: false; code: string; message: string; httpStatus: number };

/**
 * Analyse a call transcript into structured operational intelligence via the
 * OpenAI chat completions API with JSON mode. Returns the raw parsed object;
 * the caller validates/normalises fields. Classifies the same failure modes as
 * `transcribeAudio`, plus `malformed_response` when the model returns non-JSON.
 */
export async function analyseTranscript(opts: {
  apiKey: string;
  model: string;
  transcript: string;
  /** Resolved Phone Intelligence context (direction, company, participants). Used for
   *  the summary ONLY as far as it is supported — never to invent an identity. */
  context?: string;
}): Promise<AnalyseResult> {
  const system =
    "You are an operations analyst for a UK heating & plumbing company. " +
    "Analyse the phone call transcript and return ONLY a JSON object with exactly these fields: " +
    "intent (string), urgency (one of: low, medium, high, emergency), " +
    "sentiment (one of: negative, neutral, positive, mixed), summary (short operational summary), " +
    "action_required (boolean), suggested_owner (one of: office, accounts, engineer, manager, unknown), " +
    "confidence (number between 0 and 1), customer_name (string or null), phone_number (string or null), " +
    "address_or_postcode (string or null), appliance_or_system (string or null), " +
    "fault_or_reason (string or null), promised_action (string or null), risk_flags (array of strings). " +
    "Base everything only on the transcript; do not invent details. Use null when unknown." +
    (opts.context
      ? " A RESOLVED CONTEXT block (verified call direction, the tenant company, and " +
        "resolved participants with confidence) precedes the transcript. Prefer it for the " +
        "summary's direction and participant names. When a participant is 'Unknown team " +
        "member' or unresolved, say so honestly — never guess a name. Never present an " +
        "unverified spoken name as certain."
      : "");

  const userContent = opts.context
    ? `[RESOLVED CONTEXT]\n${opts.context}\n\n[TRANSCRIPT]\n${opts.transcript}`
    : opts.transcript;

  const requestBody = {
    model: opts.model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  };

  let resp: Response;
  try {
    resp = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(requestBody),
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
      message: `OpenAI analysis error (${resp.status})`,
      httpStatus: 502,
    };
  }

  let outer: unknown;
  try {
    outer = await resp.json();
  } catch {
    return {
      ok: false,
      code: "parse_error",
      message: "Could not parse OpenAI response",
      httpStatus: 502,
    };
  }

  const content = (outer as { choices?: Array<{ message?: { content?: unknown } }> } | null)
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return {
      ok: false,
      code: "parse_error",
      message: "OpenAI response missing content",
      httpStatus: 502,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return {
      ok: false,
      code: "malformed_response",
      message: "OpenAI returned non-JSON analysis",
      httpStatus: 502,
    };
  }
  if (!data || typeof data !== "object") {
    return {
      ok: false,
      code: "malformed_response",
      message: "OpenAI analysis was not an object",
      httpStatus: 502,
    };
  }

  return { ok: true, data: data as Record<string, unknown>, model: opts.model };
}
