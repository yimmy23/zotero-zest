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

test("preferences focus rings use Zotero's native focus token", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../addon/content/preferences.css"),
    "utf8",
  );
  assert.doesNotMatch(css, /--accent-color\b/);
  const focusRules = css.match(/[^{}]*:focus-visible[^{}]*\{[^}]*\}/g);
  assert.ok(focusRules?.length);
  for (const rule of focusRules)
    assert.match(rule, /var\(--color-focus-border,\s*var\(--fill-primary\)\)/);
});

test("shared dialog surfaces are native-neutral without changing the chart palette", () => {
  const harness = createHarness();
  const { dialogThemeCSS } = harness.load("src/ui/dialogTheme.ts");
  const { READING_STATS_PALETTE } = harness.load("src/ui/palette.ts");
  const css = dialogThemeCSS();
  for (const color of ["#f2f2f2", "#ffffff", "#303030", "#1e1e1e"])
    assert.ok(css.includes(color));
  assert.doesNotMatch(css, /#181c24|#222731|#f5f4f1|#fffefa/);
  for (const palette of Object.values(READING_STATS_PALETTE)) {
    for (const family of ["blue", "violet", "bronze"])
      assert.ok(css.includes(`--zest-stats-${family}:${palette[family]}`));
  }
  assert.match(css, /--zest-accent:var\(--zest-stats-blue\)/);
  assert.match(css, /--zest-focus:AccentColor/);
});

function themeFixture() {
  const tokens = {
    "--material-sidepane": "#f2f2f2",
    "--material-background": "#ffffff",
    "--fill-primary": "rgba(0, 0, 0, 0.85)",
    "--fill-secondary": "rgba(0, 0, 0, 0.55)",
    "--color-border": "rgba(0, 0, 0, 0.15)",
    "--color-quinary-on-sidepane": "#e6e6e6",
    "--color-focus-border": "-moz-mac-focusring",
  };
  const declarations = new Map();
  let writes = 0;
  const style = {
    getPropertyValue: (name) => declarations.get(name)?.value || "",
    getPropertyPriority: (name) => declarations.get(name)?.priority || "",
    setProperty(name, value, priority = "") {
      writes++;
      declarations.set(name, { value, priority });
    },
    removeProperty(name) {
      writes++;
      declarations.delete(name);
    },
  };
  const listeners = new Set();
  const media = {
    matches: false,
    addEventListener(type, callback) {
      assert.equal(type, "change");
      listeners.add(callback);
    },
    removeEventListener(type, callback) {
      assert.equal(type, "change");
      listeners.delete(callback);
    },
  };
  const win = { closed: false, document: { documentElement: { style } } };
  let reads = 0;
  const host = {
    closed: false,
    getComputedStyle(element) {
      assert.equal(element, body);
      reads++;
      return { getPropertyValue: (name) => tokens[name] || "" };
    },
    matchMedia(query) {
      assert.equal(query, "(prefers-color-scheme: dark)");
      return media;
    },
  };
  const body = { ownerDocument: { defaultView: host } };
  return {
    ...createHarness().load("src/ui/dialogTheme.ts"),
    win,
    host,
    body,
    style,
    tokens,
    media,
    listeners,
    reads: () => reads,
    writes: () => writes,
    change() {
      for (const listener of [...listeners]) listener();
    },
  };
}

test("sidebar theme samples all native tokens and follows light/dark media changes", () => {
  const app = themeFixture();
  app.style.setProperty("--zest-stats-blue", "preserved-chart-blue");
  const binding = app.bindSidebarTheme(app.win, app.body);
  const mapping = {
    bg: "--material-sidepane",
    surface: "--material-background",
    fg: "--fill-primary",
    muted: "--fill-secondary",
    line: "--color-border",
    fill: "--color-quinary-on-sidepane",
    focus: "--color-focus-border",
  };
  const checkTokens = () => {
    for (const [name, native] of Object.entries(mapping))
      assert.equal(
        app.style.getPropertyValue(`--zest-${name}`),
        app.tokens[native],
      );
    assert.equal(app.style.getPropertyValue("--zest-shadow"), "none");
    assert.equal(
      app.style.getPropertyValue("--zest-stats-blue"),
      "preserved-chart-blue",
    );
  };
  checkTokens();
  assert.equal(app.style.getPropertyValue("color-scheme"), "light");
  Object.assign(app.tokens, {
    "--material-sidepane": "#303030",
    "--material-background": "#1e1e1e",
    "--fill-primary": "rgba(255, 255, 255, 0.9)",
    "--fill-secondary": "rgba(255, 255, 255, 0.55)",
    "--color-border": "rgba(255, 255, 255, 0.18)",
    "--color-quinary-on-sidepane": "#3c3c3c",
  });
  app.media.matches = true;
  app.change();
  checkTokens();
  assert.equal(app.style.getPropertyValue("color-scheme"), "dark");
  assert.equal(app.reads(), 2);
  binding.dispose();
});

test("hidden sidebar themes defer style reads and writes until reactivated", () => {
  const app = themeFixture();
  const binding = app.bindSidebarTheme(app.win, app.body);
  binding.setActive(false);
  const writes = app.writes();
  app.media.matches = true;
  app.tokens["--material-sidepane"] = "#303030";
  app.change();
  app.change();
  assert.equal(app.reads(), 1);
  assert.equal(app.writes(), writes);
  binding.setActive(true);
  assert.equal(app.reads(), 2);
  assert.equal(app.style.getPropertyValue("--zest-bg"), "#303030");
  const resumedWrites = app.writes();
  binding.setActive(true);
  assert.equal(app.reads(), 2);
  assert.equal(app.writes(), resumedWrites);
  binding.dispose();
});

test("missing native tokens use the fallback without empty inline declarations", () => {
  const app = themeFixture();
  delete app.tokens["--fill-secondary"];
  const binding = app.bindSidebarTheme(app.win, app.body);
  assert.equal(app.style.getPropertyValue("--zest-muted"), "");
  delete app.tokens["--material-sidepane"];
  app.media.matches = true;
  app.change();
  assert.equal(app.style.getPropertyValue("--zest-bg"), "");
  assert.equal(app.style.getPropertyValue("color-scheme"), "dark");
  binding.dispose();
});

test("theme disposal restores owned declarations and leaves newer overrides untouched", () => {
  const app = themeFixture();
  app.style.setProperty("--zest-bg", "old-background", "important");
  const first = app.bindSidebarTheme(app.win, app.body);
  const stale = [...app.listeners][0];
  const second = app.bindSidebarTheme(app.win, app.body);
  assert.equal(app.listeners.size, 1);
  const before = app.writes();
  first.dispose();
  stale();
  first.setActive(true);
  assert.equal(app.writes(), before);
  app.style.setProperty("--zest-muted", "external-text", "important");
  app.change();
  assert.equal(app.style.getPropertyValue("--zest-muted"), "external-text");
  second.dispose();
  assert.equal(app.listeners.size, 0);
  assert.equal(app.style.getPropertyValue("--zest-bg"), "old-background");
  assert.equal(app.style.getPropertyPriority("--zest-bg"), "important");
  assert.equal(app.style.getPropertyValue("--zest-surface"), "");
  assert.equal(app.style.getPropertyValue("--zest-muted"), "external-text");
  assert.equal(app.style.getPropertyPriority("--zest-muted"), "important");
  const disposedWrites = app.writes();
  app.change();
  second.setActive(true);
  second.dispose();
  assert.equal(app.writes(), disposedWrites);
});

test("missing browser theme APIs are safe and keep standalone fallback styles", () => {
  const app = themeFixture();
  app.host.matchMedia = undefined;
  const binding = app.bindSidebarTheme(app.win, app.body);
  assert.equal(app.style.getPropertyValue("--zest-bg"), "#f2f2f2");
  assert.equal(app.style.getPropertyValue("color-scheme"), "");
  binding.dispose();
  app.host.getComputedStyle = undefined;
  const fallback = app.bindSidebarTheme(app.win, app.body);
  const before = app.writes();
  assert.doesNotThrow(() => {
    fallback.setActive(false);
    fallback.setActive(true);
    fallback.dispose();
  });
  assert.equal(app.writes(), before);
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
