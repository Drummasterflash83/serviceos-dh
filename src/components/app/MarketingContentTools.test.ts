import assert from "node:assert/strict";
import test from "node:test";

import { insertMarketingContent } from "./marketing-content-insert.ts";

test("inserts a personalisation field at the cursor", () => {
  assert.deepEqual(insertMarketingContent("Hello ", "{{first_name}}"), {
    value: "Hello {{first_name}}",
    caret: 20,
  });
});

test("adds readable spacing when inserting between words", () => {
  assert.deepEqual(insertMarketingContent("HelloSam", "{{first_name}}", 5), {
    value: "Hello {{first_name}} Sam",
    caret: 21,
  });
});

test("replaces a selection with a governed Markdown link", () => {
  assert.deepEqual(
    insertMarketingContent(
      "Please book now today.",
      "[book now](https://drummonds.co/book)",
      7,
      15,
    ),
    {
      value: "Please [book now](https://drummonds.co/book) today.",
      caret: 44,
    },
  );
});
