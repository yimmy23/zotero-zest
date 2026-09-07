/* global __dirname */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");

test("shared chrome host loads native select popup styles outside the replaced body", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../addon/content/panel.xhtml"),
    "utf8",
  );
  const head = source.match(/<head>([\s\S]*?)<\/head>/)?.[1];
  assert.ok(head);
  assert.match(
    head,
    /<link\s+rel="stylesheet"\s+href="chrome:\/\/global\/skin\/global\.css"\s*\/>/,
  );
  // Both renderers replace body content. Native menus must keep their styles.
  for (const name of ["annotMatrix", "statsDialog"]) {
    const renderer = fs.readFileSync(
      path.join(__dirname, `../src/panes/${name}.ts`),
      "utf8",
    );
    assert.match(renderer, /content\/panel\.xhtml/);
  }
});

test("shared dialog theme preserves rem sizing after native chrome styles load", () => {
  const { dialogThemeCSS } = createHarness().load("src/ui/dialogTheme.ts");
  assert.match(dialogThemeCSS(), /:root\s*\{\s*font-size:16px;/);
});

test("matrix and statistics translations have matching keys and variables", () => {
  const messages = (locale) => {
    const source = fs.readFileSync(
      path.join(__dirname, `../addon/locale/${locale}/addon.ftl`),
      "utf8",
    );
    return Object.fromEntries(
      [
        ...source.matchAll(
          /^((?:matrix|stats)-[\w-]+)\s*=([^\n]*(?:\n[ \t]+[^\n]*)*)/gm,
        ),
      ].map(([, key, text]) => [
        key,
        [...new Set([...text.matchAll(/\$([\w-]+)/g)].map((m) => m[1]))].sort(),
      ]),
    );
  };
  const english = messages("en-US");
  assert.ok(Object.keys(english).length > 100);
  assert.deepEqual(messages("zh-CN"), english);
});
