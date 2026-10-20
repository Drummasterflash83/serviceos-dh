import assert from "node:assert/strict";
import { test } from "node:test";
import { newerBuildAvailable, publishedBuildSha } from "./build-update.ts";

const current = "1".repeat(40);
const next = "2".repeat(40);

test("only a different published Git build prompts an open tab", () => {
  assert.equal(publishedBuildSha(`<meta name="openfolk-build" content="${next}">`), next);
  assert.equal(newerBuildAvailable(current, next), true);
  assert.equal(newerBuildAvailable(current, current), false);
});

test("unknown or malformed public responses cannot trigger an update", () => {
  assert.equal(publishedBuildSha('<meta name="openfolk-build" content="unknown">'), null);
  assert.equal(publishedBuildSha("<html></html>"), null);
  assert.equal(newerBuildAvailable(current, null), false);
  assert.equal(newerBuildAvailable("unknown", next), false);
});
