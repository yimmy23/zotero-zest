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

function fixture() {
  // Use the service's real pure identity helper; no cache or transport runs.
  const identity = createHarness({
    mocks: unrelatedImports("src/rank/index.ts", ["./normalize"]),
  }).load("src/rank/index.ts");
  const registered = [],
    batches = [],
    refreshed = [];
  class Item {
    constructor(publicationTitle = "", ISSN = "") {
      this.fields = { publicationTitle, ISSN };
    }
    isRegularItem() {
      return true;
    }
    getField(name) {
      return this.fields[name] || "";
    }
  }
  const h = createHarness({
    mocks: {
      ...unrelatedImports("src/modules/menus.ts", ["../utils/guard"]),
      "../utils/locale": { getLocaleID: (id) => id, getString: (id) => id },
      "../reading/status": { READ_STATUSES: [] },
      "../rank": {
        journalRequestKeyOf: identity.journalRequestKeyOf,
        rankSourceThrottled: () => false,
        refreshJournal: async (item) => refreshed.push(item),
      },
      "../ui/batch": {
        runBatch(label, targets, task) {
          const finished = (async () => {
            for (const [index, item] of targets.entries())
              await task(item, index, () => true);
          })();
          batches.push({ label, targets: [...targets], finished });
          return finished;
        },
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
    if (value.l10nID === "rank-menu-refresh") return value;
    for (const child of Object.values(value)) {
      const found = find(child);
      if (found) return found;
    }
  };
  const command = find(registered);
  assert.equal(typeof command?.onCommand, "function");
  return {
    Item,
    batches,
    refreshed,
    async invoke(items) {
      command.onCommand({}, { items });
      await Promise.all(batches.map((batch) => batch.finished));
    },
  };
}

test("rank refresh menu deduplicates normalized titles and the full ISSN set, skipping empty identities", async () => {
  const f = fixture();
  const first = new f.Item(
    "Cancer Immunology, Immunotherapy",
    "0340-7004; 1432-0851",
  );
  const duplicate = new f.Item(
    "Ｃａｎｃｅｒ Immunology， Immunotherapy： CII",
    "1432-0851; 0340-7004; 1432-0851",
  );
  const empty = new f.Item();
  await f.invoke([first, duplicate, empty]);
  assert.equal(f.batches.length, 1);
  assert.equal(f.batches[0].label, "rank-menu-refresh");
  assert.deepEqual(f.batches[0].targets, [first]);
  assert.deepEqual(f.refreshed, [first]);
  await f.invoke([empty]);
  assert.equal(f.batches.length, 1, "empty selection identity opens no batch");
  assert.deepEqual(f.refreshed, [first]);
});

test("rank refresh menu executes both different journal names sharing the first ISSN", async () => {
  const f = fixture();
  const first = new f.Item("Journal Alpha", "1234-5678; 8765-4321");
  const second = new f.Item("Journal Beta", "1234-5678; 8765-4321");
  await f.invoke([first, second]);
  assert.equal(f.batches.length, 1);
  assert.deepEqual(f.batches[0].targets, [first, second]);
  assert.deepEqual(f.refreshed, [first, second]);
});
