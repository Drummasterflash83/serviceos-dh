import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, createDecipheriv, generateKeyPairSync, privateDecrypt,
  randomBytes, constants, webcrypto } from 'node:crypto';
import { createSealedRuntimeHandler, REQUIRED_NAMES, OPTIONAL_NAMES, ADDITIONAL_NAMES }
  from './edge-runtime-seal.mjs';

const project = 'saatxzwxvdvqevbnskxy';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicExponent: 65537 });
const spki = publicKey.export({ type: 'spki', format: 'der' });
const nonce = randomBytes(48).toString('base64url');
const sha = value => createHash('sha256').update(value).digest('hex');
const serviceKey = 'synthetic-service-key-never-live';
const env = Object.fromEntries(REQUIRED_NAMES.map(name => [name, `synthetic:${name}`]));
env.GOOGLE_WORKSPACE_PRIVATE_KEY = 'synthetic-multiline\nprivate-key\nnever-live';
env[OPTIONAL_NAMES[0]] = 'synthetic-optional-client-id';
env.SUPABASE_URL = `https://${project}.supabase.co`;
env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
const config = { project, serviceSha256: sha(serviceKey), nonceSha256: sha(nonce), spkiSha256: sha(spki),
  expiresAtMs: Date.now() + 60000 };
const handler = (overrides = {}, source = env) => createSealedRuntimeHandler(
  { ...config, ...overrides }, { env: name => source[name], clock: Date.now, crypto: webcrypto });
const request = (args = {}) => new Request(`https://${project}.supabase.co/functions/v1/build01-edge-recovery-once`, {
  method: 'POST', headers: {
    authorization: `Bearer ${args.key ?? serviceKey}`, apikey: args.key ?? serviceKey,
    'x-build01-recovery-nonce': args.nonce ?? nonce,
    'content-type': 'application/json',
  }, body: JSON.stringify({ spki: args.spki ?? spki.toString('base64') }),
});

test('exact synthetic runtime values are encrypted for the pinned public key', async () => {
  const response = await handler()(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const wire = await response.text();
  for (const value of Object.values(env)) assert.equal(wire.includes(value), false);
  const parsed = JSON.parse(wire);
  assert.equal(parsed.project, project);
  assert.equal(parsed.format, 'serviceos-build01-edge-runtime-sealed-envelope/1');
  const aesKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256' }, Buffer.from(parsed.wrappedKey, 'base64'));
  const iv = Buffer.from(parsed.iv, 'base64');
  const encrypted = Buffer.from(parsed.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(encrypted.subarray(-16));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  const recovered = JSON.parse(plain.toString('utf8'));
  assert.equal(recovered.project, project);
  assert.deepEqual(recovered.selected,
    Object.fromEntries([...REQUIRED_NAMES, ...OPTIONAL_NAMES].map(name => [name, env[name]])));
  plain.fill(0); aesKey.fill(0);
});

test('separate full-runtime scope seals only the five additional synthetic bindings', async () => {
  const additional = Object.fromEntries(ADDITIONAL_NAMES.map(name =>
    [name, `synthetic:${name}:never-live`]));
  const source = { ...env, ...additional };
  const response = await handler({ scope: 'full-runtime-additional/1' }, source)(request());
  assert.equal(response.status, 200);
  const wire = await response.text();
  for (const value of Object.values(additional)) assert.equal(wire.includes(value), false);
  const parsed = JSON.parse(wire);
  const aesKey = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256' }, Buffer.from(parsed.wrappedKey, 'base64'));
  const encrypted = Buffer.from(parsed.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', aesKey, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(encrypted.subarray(-16));
  const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
  const recovered = JSON.parse(plain.toString('utf8'));
  assert.deepEqual(recovered.selected, additional);
  plain.fill(0); aesKey.fill(0);
  const missing = { ...source }; delete missing.RESEND_API_KEY;
  assert.equal((await handler({ scope: 'full-runtime-additional/1' }, missing)(request())).status, 503);
  assert.throws(() => handler({ scope: 'unreviewed' }, source));
});

test('wrong key, nonce, recipient, project or expiry denies before reading a credential', async () => {
  const reads = [];
  const observed = createSealedRuntimeHandler(config, {
    env: name => { reads.push(name); return env[name]; }, clock: Date.now, crypto: webcrypto,
  });
  assert.equal((await observed(request({ key: 'wrong' }))).status, 401);
  assert.equal((await observed(request({ nonce: randomBytes(48).toString('base64url') }))).status, 401);
  const other = generateKeyPairSync('rsa', { modulusLength: 3072 });
  assert.equal((await observed(request({ spki: other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }))).status, 401);
  assert.equal(reads.filter(name => REQUIRED_NAMES.includes(name)).length, 0);
  assert.equal((await handler({ expiresAtMs: Date.now() - 1 })(request())).status, 404);
  const wrongProjectEnv = { ...env, SUPABASE_URL: 'https://elsewhere.supabase.co' };
  assert.equal((await handler({}, wrongProjectEnv)(request())).status, 503);
});

test('missing required binding fails closed without a partial envelope', async () => {
  const missing = { ...env };
  delete missing.GOOGLE_CLIENT_SECRET;
  const response = await handler({}, missing)(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'required_binding_unavailable' });
});

test('oversized request is rejected before reading a credential', async () => {
  const reads = [];
  const observed = createSealedRuntimeHandler(config, {
    env: name => { reads.push(name); return env[name]; }, clock: Date.now, crypto: webcrypto,
  });
  const oversized = new Request(`https://${project}.supabase.co/functions/v1/build01-edge-recovery-once`, {
    method: 'POST', headers: {
      authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
      'x-build01-recovery-nonce': nonce, 'content-type': 'application/json',
    }, body: JSON.stringify({ spki: spki.toString('base64'), extra: 'x'.repeat(5000) }),
  });
  assert.equal((await observed(oversized)).status, 413);
  assert.equal(reads.filter(name => REQUIRED_NAMES.includes(name)).length, 0);
});
