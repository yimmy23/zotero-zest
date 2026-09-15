const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

const root = path.resolve(path.dirname(module.filename), "..");
const markup = fs.readFileSync(
  path.join(root, "addon/content/preferences.xhtml"),
  "utf8",
);
const css = fs.readFileSync(
  path.join(root, "addon/content/preferences.css"),
  "utf8",
);
const scriptPath = "src/modules/preferenceScript.ts";

function messages(locale) {
  return Object.fromEntries(
    Array.from(
      fs
        .readFileSync(
          path.join(root, "addon/locale", locale, "preferences.ftl"),
          "utf8",
        )
        .matchAll(/^([\w-]+) = (.+)$/gm),
      (match) => [match[1], match[2]],
    ),
  );
}

/** Load the authored XML fragment into the existing detached DOM fixture. */
function preferencesDocument(locale = "en-US") {
  const win = windowFixture();
  const doc = win.document;
  const strings = messages(locale);
  const ids = new Map();
  const stack = [doc.body];
  const tokens = /<\/?([\w:-]+)(?:\s+[\w:-]+\s*=\s*"[^"]*")*\s*\/?>/g;
  for (const match of markup.matchAll(tokens)) {
    const tag = match[1].split(":").at(-1);
    if (match[0].startsWith("</")) {
      assert.equal(stack.at(-1).tagName, tag, `unbalanced ${tag}`);
      stack.pop();
      continue;
    }
    const node = doc.createElement(tag);
    for (const [, name, value] of match[0].matchAll(/([\w:-]+)="([^"]*)"/g)) {
      node.setAttribute(name, value);
      if (name === "id") {
        assert.ok(!ids.has(value), `duplicate id ${value}`);
        ids.set(value, node);
      }
    }
    node.closest = (selector) => {
      let current = node;
      while (current && !current.matches(selector))
        current = current.parentElement;
      return current;
    };
    node.scrollIntoView = (options) => {
      node.lastScroll = options;
    };
    const stringID = node.getAttribute("data-l10n-id");
    if (strings[stringID]) node.textContent = strings[stringID];
    stack.at(-1).appendChild(node);
    if (!match[0].endsWith("/>")) stack.push(node);
  }
  assert.equal(stack.length, 1);
  doc.getElementById = (id) => ids.get(id) || null;
  return { doc, strings };
}

function navigationModule() {
  // Only the navigation builder runs here; host services must stay unused.
  const source = fs.readFileSync(path.join(root, scriptPath), "utf8");
  const mocks = {};
  for (const [, dependency] of source.matchAll(/\bfrom\s+"(\.[^"]+)"/g)) {
    const base = path.resolve(root, path.dirname(scriptPath), dependency);
    const target = [`${base}.ts`, path.join(base, "index.ts")].find(
      fs.existsSync,
    );
    if (target)
      mocks[path.relative(root, target).split(path.sep).join("/")] = {};
  }
  return createHarness({ mocks }).load(scriptPath);
}

test("all authored inputs and menus have unique IDs and associated bilingual labels", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const { doc, strings } = preferencesDocument(locale);
    const controls = [
      ...doc.querySelectorAll("input"),
      ...doc.querySelectorAll("menulist"),
      ...doc.querySelectorAll("select"),
      ...doc.querySelectorAll("textarea"),
    ];
    assert.equal(doc.querySelectorAll("input").length, 35);
    assert.equal(doc.querySelectorAll("menulist").length, 11);
    for (const control of controls) {
      const id = control.getAttribute("id");
      assert.ok(id, `${control.tagName} needs an id`);
      const label = doc.getElementById(control.getAttribute("aria-labelledby"));
      assert.equal(label?.tagName, "label", `${id} needs its label`);
      assert.ok(
        strings[label.getAttribute("data-l10n-id")],
        `${id} needs ${locale} text`,
      );
      if (control.tagName === "input")
        assert.equal(label.getAttribute("for"), id);
      for (const descriptionID of (
        control.getAttribute("aria-describedby") || ""
      )
        .split(/\s+/)
        .filter(Boolean)) {
        assert.ok(
          doc.getElementById(descriptionID),
          `${id} description must resolve`,
        );
      }
    }
    assert.equal(
      doc.getElementById("zest-pref-eskey").getAttribute("type"),
      "password",
    );
    assert.equal(
      doc.getElementById("zest-pref-s2key").getAttribute("type"),
      "password",
    );
    assert.equal(
      doc.getElementById("zest-pref-rating-display").getAttribute("preference"),
      "rating.display",
    );
  }
});

test("five named task groups retain every section once and activate keyboard-focusable destinations", () => {
  const { buildPrefNavigation } = navigationModule();
  for (const locale of ["en-US", "zh-CN"]) {
    const { doc, strings } = preferencesDocument(locale);
    const headings = doc.querySelectorAll("groupbox h2");
    const controls = doc.querySelectorAll("[preference]");
    const originalBindings = controls.map((node) =>
      node.getAttribute("preference"),
    );
    const groups = doc.querySelectorAll(".zest-pref-nav-group");
    assert.equal(headings.length, 19);
    assert.equal(groups.length, 5);
    for (const group of groups) {
      const label = doc.getElementById(group.getAttribute("aria-labelledby"));
      assert.ok(strings[label.getAttribute("data-l10n-id")]);
    }
    buildPrefNavigation(doc);
    const buttons = doc.querySelectorAll(".zest-pref-jump");
    assert.equal(buttons.length, headings.length);
    assert.deepEqual(
      buttons.map((button) => button.getAttribute("data-l10n-id")).sort(),
      headings.map((heading) => heading.getAttribute("data-l10n-id")).sort(),
    );
    for (const button of buttons) {
      const heading = headings.find(
        (node) =>
          node.getAttribute("data-l10n-id") ===
          button.getAttribute("data-l10n-id"),
      );
      const task = heading
        .closest("groupbox")
        .getAttribute("data-zest-pref-task");
      assert.equal(
        button.parentElement.parentElement.getAttribute("id"),
        `zest-pref-nav-${task}-links`,
      );
      assert.equal(button.textContent, heading.textContent);
      assert.equal(button.type, "button");
      assert.equal(heading.tabIndex, -1);
      button.click();
      assert.equal(doc.activeElement, heading);
      assert.equal(heading.lastScroll.block, "start");
    }
    buildPrefNavigation(doc);
    assert.equal(
      doc.querySelectorAll(".zest-pref-jump").length,
      19,
      "reload does not duplicate navigation",
    );
    assert.deepEqual(doc.querySelectorAll("[preference]"), controls);
    assert.deepEqual(
      controls.map((node) => node.getAttribute("preference")),
      originalBindings,
    );
  }
});

test("complex examples remain discoverable through native details while their controls stay visible", () => {
  for (const locale of ["en-US", "zh-CN"]) {
    const { doc, strings } = preferencesDocument(locale);
    const details = doc.querySelectorAll("details");
    assert.equal(details.length, 2);
    for (const disclosure of details) {
      const summary = disclosure.querySelector("summary");
      const hint = disclosure.querySelector("description");
      assert.ok(strings[summary.getAttribute("data-l10n-id")]);
      assert.ok(strings[hint.getAttribute("data-l10n-id")]);
      assert.equal(disclosure.querySelectorAll("[preference]").length, 0);
      assert.equal(disclosure.getAttribute("hidden"), null);
    }
    for (const key of ["pref-texttags-match-hint", "pref-rank-map-hint"]) {
      assert.ok(
        strings[key].includes("="),
        `${locale} ${key} preserves syntax examples`,
      );
    }
  }
});

test("layout and focus rules stay scoped to authored rows rather than native XUL internals", () => {
  assert.doesNotMatch(css, /#zest-prefs\s+hbox\b/);
  assert.match(
    css,
    /#zest-prefs > groupbox > hbox\s*\{[^}]*flex-wrap:\s*wrap/s,
  );
  assert.match(css, /@media\s*\(max-width:\s*520px\)/);
  assert.match(
    css,
    /#zest-prefs > groupbox > hbox > label\s*\{\s*flex-basis:\s*100%/,
  );
  assert.ok(
    css
      .replace(/\s+/g, "")
      .includes(
        ":is(input,select,textarea,menulist,checkbox,button,summary):focus-visible",
      ),
  );
  assert.match(css, /\.zest-pref-jump\s*\{[^}]*white-space:\s*normal/s);
  assert.doesNotMatch(
    css,
    /\.zest-pref-row > span\s*\{[^}]*white-space:\s*nowrap/s,
  );
});
