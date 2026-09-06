const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

test("adding an owned Extra key preserves trailing user-authored whitespace", () => {
  const { upsertExtraText } = createHarness().load("src/utils/extra.ts");
  const before = "Personal note\r\n\r\n  \r\n";
  assert.equal(
    upsertExtraText(before, ["Remark"], "Read this"),
    `${before}\r\nRemark: Read this`,
  );
});
