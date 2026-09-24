import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import test from "node:test";

const html = readFileSync(new URL("../.vercel/output/static/index.html", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../.vercel/output/config.json", import.meta.url)));

test("public homepage is complete HTML with one working, non-scripted login link", () => {
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /Your business working better\./);
  assert.match(html, /open<span class="of-minimal-colon">folk<\/span>/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  assert.match(html, /href="https:\/\/app\.openfolk\.ai\/login\?redirect=%2Fclient"/);
  assert.match(html, /Client Login/);
});

test("no hydration, app assets, external fonts, provider calls or private data", () => {
  assert.doesNotMatch(
    html,
    /<script\b|modulepreload|\/assets\/|fonts\.google|supabase|access_token|refresh_token/i,
  );
  assert.ok(gzipSync(html).length < 2500, "homepage must remain under 2.5KB compressed");
});

test("shared design retains responsive sizing, keyboard focus and reduced motion", () => {
  const css = readFileSync(new URL("../src/styles/openfolk-home.css", import.meta.url), "utf8");
  assert.ok(html.includes(css), "use exact shared stylesheet, not a second design");
  for (const feature of [
    "clamp(",
    ":focus-visible",
    "prefers-reduced-motion",
    "forced-colors",
    "backdrop-filter",
  ]) {
    assert.ok(html.includes(feature), feature);
  }
  assert.match(html, /body\{margin:0\}/);
});

test("static filesystem takes precedence while all other paths keep their server fallback", () => {
  const filesystem = config.routes.findIndex((r) => r.handle === "filesystem");
  const fallback = config.routes.findIndex((r) => r.src === "/(.*)" && r.dest === "/__server");
  assert.ok(filesystem >= 0 && fallback > filesystem);
  assert.deepEqual(config.overrides, {});
  assert.ok(existsSync(new URL("../.vercel/output/functions/__server.func", import.meta.url)));
  const files = readdirSync(
    new URL("../.vercel/output/functions/__server.func/_ssr", import.meta.url),
  );
  for (const route of [
    "login-",
    "client-",
    "receptionist-",
    "app-",
    "openfolk-",
    "health-shadow-",
  ]) {
    assert.ok(
      files.some((f) => f.startsWith(route)),
      `private route still built: ${route}`,
    );
  }
  const publicFiles = readdirSync(new URL("../.vercel/output/static", import.meta.url));
  assert.deepEqual(
    publicFiles.filter((f) => f.endsWith(".html")),
    ["index.html"],
  );
});

test("generated page cannot accidentally enter source control as an alternate source", () => {
  const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^\/public\/index\.html$/m);
});
