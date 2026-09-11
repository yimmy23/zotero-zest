const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");

function unrelatedImports(file, keep = []) {
  const source = fs.readFileSync(
    path.join(path.dirname(module.filename), "..", file),
    "utf8",
  );
  return Object.fromEntries(
    [...source.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((name) => !keep.includes(name) && !name.endsWith("package.json"))
      .map((name) => [name, {}]),
  );
}

test("native rating menu opens a preview in the invoking window, never auto-imports", () => {
  const registered = [];
  const opened = [];
  class Item {
    constructor(regular = true) {
      this.regular = regular;
    }
    isRegularItem() {
      return this.regular;
    }
  }
  const host = {},
    paper = new Item(),
    attachment = new Item(false);
  const h = createHarness({
    mocks: {
      ...unrelatedImports("src/modules/menus.ts", ["../utils/guard"]),
      "../utils/locale": { getLocaleID: (id) => id, getString: (id) => id },
      "../reading/status": { READ_STATUSES: [] },
      "../panes/ratingImport": {
        openRatingImport: (...args) => opened.push(args),
      },
    },
    globals: {
      Zotero: {
        Item,
        MenuManager: { registerMenu: (entry) => registered.push(entry) },
      },
    },
  });
  h.load("src/modules/menus.ts").registerMenus();
  const find = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.l10nID === "menu-rating-import") return value;
    for (const child of Object.values(value)) {
      const found = find(child);
      if (found) return found;
    }
  };
  const command = find(registered);
  assert.equal(typeof command?.onCommand, "function");
  assert.equal(opened.length, 0);
  command.onCommand(
    {},
    {
      menuElem: { ownerDocument: { defaultView: host } },
      items: [paper, attachment],
    },
  );
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], host);
  assert.deepEqual([...opened[0][1]], [paper]);
});

test("settings import uses only currently selected items and remains a preview", async () => {
  const selected = [{}],
    opened = [],
    host = { ZoteroPane: { getSelectedItems: () => selected } };
  const h = createHarness({
    mocks: {
      ...unrelatedImports("src/modules/preferenceScript.ts"),
      "../panes/ratingImport": {
        openRatingImport: (...args) => opened.push(args),
      },
    },
    globals: { Zotero: { getMainWindow: () => host } },
  });
  await h
    .load("src/modules/preferenceScript.ts")
    .onPrefsCommand("rating-import");
  assert.deepEqual(opened, [[host, selected]]);
});
