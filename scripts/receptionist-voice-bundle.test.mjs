// Run after VERCEL=1 npm run build. This tests the shipped SDK module, not a mock
// or Vite's dev-server interop. Constructing the client does not place a call.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolveVapiConstructor } from "../src/lib/receptionist-practice-runtime.ts";

test("production Vapi chunk resolves and constructs before any provider reservation", async () => {
  const assets = new URL("../.vercel/output/static/assets/", import.meta.url);
  const chunks = readdirSync(assets).filter((name) => /^vapi-.*\.js$/.test(name));
  assert.equal(chunks.length, 1, "Build the production frontend first");
  const module = await import(new URL(chunks[0], assets).href);
  const Voice = resolveVapiConstructor(module);
  const client = new Voice("");
  assert.equal(typeof client.reconnect, "function");
  assert.equal(typeof client.stop, "function");
});
