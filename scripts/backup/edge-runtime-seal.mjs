/** One-time, server-side sealed export for the exact Build 01 runtime names.
 * No filesystem, provider call, database query, console output or fallback.
 * A staged deployment pins its project, expiry, nonce digest and public key.
 */
export const REQUIRED_NAMES = Object.freeze([
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_WORKSPACE_PRIVATE_KEY',
  'LEARN_QUICKBOOKS_WORKER_KEY',
  'LEARN_SLACK_EVENTS_SIGNING_SECRET',
  'OPENAI_API_KEY',
  'OPENFOLK_CONTROLPLANE_KEY',
  'PHONE_OPERATIONS_WEBHOOK_SECRET',
  'SIMWOOD_PASSWORD',
  'SIMWOOD_USERNAME',
]);
export const OPTIONAL_NAMES = Object.freeze(['GOOGLE_WORKSPACE_CLIENT_ID']);
const encoder = new TextEncoder();
const header = { 'content-type': 'application/json', 'cache-control': 'no-store',
  pragma: 'no-cache', 'x-content-type-options': 'nosniff' };
const reply = (status, code) => new Response(JSON.stringify({ error: code }),
  { status, headers: header });
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const b64 = bytes => {
  let result = '';
  for (let i = 0; i < bytes.length; i += 4096)
    result += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return btoa(result);
};
const unb64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const equal = (a, b) => {
  const left = encoder.encode(a), right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    difference |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return difference === 0;
};
async function sha256(subtle, bytes) {
  return hex(new Uint8Array(await subtle.digest('SHA-256', bytes)));
}

/** Inject env/clock/crypto for a synthetic no-provider test. */
export function createSealedRuntimeHandler(config, ports) {
  if (!config || !/^[a-z0-9]{20}$/.test(config.project) ||
      !/^[a-f0-9]{64}$/.test(config.nonceSha256) ||
      !/^[a-f0-9]{64}$/.test(config.spkiSha256) ||
      !/^[a-f0-9]{64}$/.test(config.serviceSha256) ||
      !Number.isSafeInteger(config.expiresAtMs) ||
      typeof ports?.env !== 'function' || typeof ports?.clock !== 'function' ||
      !ports?.crypto?.subtle || typeof ports.crypto.getRandomValues !== 'function')
    throw Error('Sealed runtime binding invalid');
  return async request => {
    if (request.method !== 'POST') return reply(405, 'method_not_allowed');
    if (ports.clock() >= config.expiresAtMs) return reply(404, 'recovery_closed');
    if (ports.env('SUPABASE_URL') !== `https://${config.project}.supabase.co`)
      return reply(503, 'runtime_unavailable');
    const auth = request.headers.get('authorization') ?? '';
    const apikey = request.headers.get('apikey') ?? '';
    if (!auth.startsWith('Bearer ') || apikey.length < 16 ||
        !equal(await sha256(ports.crypto.subtle, encoder.encode(auth.slice(7))), config.serviceSha256) ||
        !equal(await sha256(ports.crypto.subtle, encoder.encode(apikey)), config.serviceSha256))
      return reply(401, 'unauthorized');
    const nonce = request.headers.get('x-build01-recovery-nonce') ?? '';
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(nonce) ||
        !equal(await sha256(ports.crypto.subtle, encoder.encode(nonce)), config.nonceSha256))
      return reply(401, 'unauthorized');
    let input;
    try {
      if (Number(request.headers.get('content-length') ?? 0) > 4096) return reply(413, 'request_too_large');
      const raw = await request.text();
      if (raw.length > 4096) return reply(413, 'request_too_large');
      input = JSON.parse(raw);
    } catch { return reply(400, 'request_invalid'); }
    if (!input || Object.keys(input).length !== 1 || typeof input.spki !== 'string' ||
        !/^[A-Za-z0-9+/=]{500,1000}$/.test(input.spki)) return reply(400, 'request_invalid');
    let spki;
    try { spki = unb64(input.spki); }
    catch { return reply(400, 'request_invalid'); }
    if (!equal(await sha256(ports.crypto.subtle, spki), config.spkiSha256))
      return reply(401, 'unauthorized');
    const selected = {};
    for (const name of REQUIRED_NAMES) {
      const value = ports.env(name);
      if (typeof value !== 'string' || value.length < 1 || encoder.encode(value).length > 65536)
        return reply(503, 'required_binding_unavailable');
      selected[name] = value;
    }
    for (const name of OPTIONAL_NAMES) {
      const value = ports.env(name);
      if (typeof value === 'string' && value.length > 0 && encoder.encode(value).length <= 65536)
        selected[name] = value;
    }
    const plain = encoder.encode(JSON.stringify({
      format: 'serviceos-build01-edge-runtime-seal/1', project: config.project,
      sealedAtUtc: new Date(ports.clock()).toISOString(), selected,
    }));
    if (plain.length > 1024 * 1024) return reply(503, 'runtime_unavailable');
    let rawKey;
    try {
      const publicKey = await ports.crypto.subtle.importKey('spki', spki,
        { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
      rawKey = ports.crypto.getRandomValues(new Uint8Array(32));
      const iv = ports.crypto.getRandomValues(new Uint8Array(12));
      const aes = await ports.crypto.subtle.importKey('raw', rawKey,
        { name: 'AES-GCM' }, false, ['encrypt']);
      const [wrapped, encrypted] = await Promise.all([
        ports.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey),
        ports.crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, plain),
      ]);
      return new Response(JSON.stringify({
        format: 'serviceos-build01-edge-runtime-sealed-envelope/1',
        project: config.project, wrappedKey: b64(new Uint8Array(wrapped)),
        iv: b64(iv), ciphertext: b64(new Uint8Array(encrypted)),
      }), { status: 200, headers: header });
    } catch { return reply(503, 'runtime_unavailable'); }
    finally { plain.fill(0); rawKey?.fill(0); }
  };
}
