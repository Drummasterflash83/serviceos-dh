// One-off recovery of two approved originals and one pinned local neutral edit.
// No arbitrary customer audio, provider URL, model, or key is accepted.
export const GREETING_TENANT = "00000000-0000-0000-0000-000000000001";
export const GREETING_MODEL = "gpt-4o-mini-transcribe";
export const ALAN_NEUTRAL_PCM_SHA256 = "fb10bc360eedd7dc9647c83f79f8cd1e91055dd2779d6caa9508149cbd9cdae6";
export async function greetingAudioEvidence(bytes: Uint8Array) {
  const hash = async (data: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)), b => b.toString(16).padStart(2, "0")).join("");
  const word = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  const sha256 = await hash(bytes);
  if (bytes.length < 44 || word(0, 4) !== "RIFF" || word(8, 12) !== "WAVE")
    return { sha256, bytes: bytes.length, pcmMatchesApproved: false, format: "unverified" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let validFormat = false, pcm: Uint8Array | null = null;
  for (let p = 12; p + 8 <= bytes.length;) {
    const kind = word(p, p + 4), size = view.getUint32(p + 4, true);
    if (p + 8 + size > bytes.length) throw new Error("Truncated provider WAV");
    if (kind === "fmt " && size >= 16) validFormat = view.getUint16(p + 8, true) === 1 &&
      view.getUint16(p + 10, true) === 1 && view.getUint32(p + 12, true) === 8000 && view.getUint16(p + 22, true) === 16;
    if (kind === "data") pcm = bytes.slice(p + 8, p + 8 + size);
    p += 8 + size + size % 2;
  }
  const pcmSha256 = validFormat && pcm ? await hash(pcm) : null;
  return { sha256, bytes: bytes.length, pcmSha256, pcmBytes: pcm?.length ?? 0,
    pcmMatchesApproved: pcmSha256 === ALAN_NEUTRAL_PCM_SHA256 && pcm?.length === 182576,
    format: validFormat ? "PCM16 mono 8000Hz" : "unverified" };
}
export const GREETING_ASSETS = {
  alan_unavailable: {
    filename: "Alan_unavailable.mp3", bytes: 238584,
    sha256: "39af89039edced814102a72639774cc73547fce57aaf6965952eb1459f453040",
    auditId: "4c542c21-b0d6-4662-b340-d0b681f2be5d",
  },
  alan_busy: {
    filename: "Alan_busy.mp3", bytes: 235658,
    sha256: "7ce6294868f86cf3b108125c90600d3896e76ad437251bd76d410e1c07578315",
    auditId: "b1cadc42-a580-4863-88c4-4de8e1f9b36f",
  },
  alan_neutral: {
    filename: "Alan_neutral.wav", bytes: 186672,
    sha256: "66a96d4edaec54fb32ead4b6f6700cf804c7e4c9164a1f98c2a1c99da3d7ad68",
    auditId: "62b7d5c5-4f40-40b8-a94b-ddcd1c2e367e",
  },
} as const;

export async function validateGreeting(body: Record<string, unknown>, now = new Date()) {
  if (now.getTime() < Date.parse("2026-10-02T00:00:00Z") ||
      now.getTime() >= Date.parse("2026-10-03T00:00:00Z") || !Number.isFinite(now.getTime()))
    throw new Error("Greeting verification window is closed");
  if (body.tenantId !== GREETING_TENANT || typeof body.asset !== "string" ||
      !Object.hasOwn(GREETING_ASSETS, body.asset)) throw new Error("Greeting asset not authorised");
  const asset = GREETING_ASSETS[body.asset as keyof typeof GREETING_ASSETS];
  if (typeof body.audioBase64 !== "string" || body.audioBase64.length !== Math.ceil(asset.bytes / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audioBase64)) throw new Error("Greeting bytes invalid");
  const binary = atob(body.audioBase64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const validHeader = asset.filename.endsWith(".mp3")
    ? bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51
    : new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE";
  if (bytes.length !== asset.bytes || !validHeader)
    throw new Error("Greeting format invalid");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== asset.sha256) throw new Error("Greeting hash mismatch");
  return { asset, bytes };
}
