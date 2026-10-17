import { createSealedRuntimeHandler } from './seal.mjs';

// The one-time deploy script replaces this whole binding with pinned, public
// hashes and a short expiry. No credential or recovery private key is embedded.
const binding = __BUILD01_RECOVERY_BINDING__;

Deno.serve(createSealedRuntimeHandler(binding, {
  env: (name: string) => Deno.env.get(name),
  clock: Date.now,
  crypto: globalThis.crypto,
}));
