const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function view(id, overrides = {}) {
  return {
    id,
    name: id,
    columns: [
      { dataKey: "title", width: 240, ordinal: 0, hidden: false },
      { dataKey: "year", width: 80, ordinal: 1, hidden: false },
      { dataKey: "dateAdded", width: 100, ordinal: 2, hidden: true },
    ],
    sortField: "title",
    sortDirection: 1,
    ...overrides,
  };
}

function fixture(saved) {
  let nextID = 0;
  const api = createHarness({
    globals: { Zotero: {} },
    mocks: {
      "src/utils/locale.ts": { getString: (key) => key },
      "src/columns/registry.ts": {},
      "src/utils/guard.ts": { guard: (_name, fn) => fn },
      "src/core/config.ts": {
        newId: () => `capture-${++nextID}`,
        zestConfig: { get: () => ({ viewGroups: saved }) },
      },
    },
  }).load("src/views/viewGroups.ts");
  function window(initial) {
    let columns, sortField, sortDirection, prefs;
    const win = {
      sorts: [],
      reset(layout) {
        columns = layout.columns.map((col) => ({ ...col }));
        sortField = layout.sortField;
        sortDirection = layout.sortDirection;
        prefs = {};
      },
      mutate(fn) {
        fn(columns);
      },
      ZoteroPane: {
        itemsView: {
          tree: { _columns: { getAsArray: () => columns }, invalidate() {} },
          _getColumnPrefs: () => prefs,
          _storeColumnPrefs: (next) => {
            prefs = next;
          },
          _resetColumns: async () => {
            columns = columns.map((col) => {
              const next = { ...col };
              delete next.sortDirection;
              return { ...next, ...prefs[col.dataKey] };
            });
            const sorted = columns.find((col) => col.sortDirection);
            sortField = sorted?.dataKey;
            sortDirection = sorted?.sortDirection;
          },
          getSortField: () => sortField,
          getSortDirection: () => sortDirection,
          sort: async () => {
            win.sorts.push([sortField, sortDirection]);
          },
        },
      },
    };
    win.reset(initial);
    return win;
  }
  return { api, window };
}

test("cycle advances among saved views with identical visible columns and different sorts", async () => {
  const a = view("A"),
    b = view("B", { sortField: "year", sortDirection: -1 }),
    c = view("C", { sortField: "dateAdded", sortDirection: -1 }),
    f = fixture([a, b, c]),
    win = f.window(a);
  await f.api.applyView(win, b);
  await f.api.cycleView(win, 1);
  assert.deepEqual(win.sorts.at(-1), ["dateAdded", -1]);
  await f.api.cycleView(win, 1);
  assert.deepEqual(win.sorts.at(-1), ["title", 1]);
  await f.api.cycleView(win, -1);
  assert.deepEqual(win.sorts.at(-1), ["dateAdded", -1]);
});

test("complete saved signatures distinguish widths and column order after module reload", async () => {
  const a = view("A"),
    b = view("B"),
    c = view("C");
  b.columns[0].width = 400;
  c.columns[0].ordinal = 1;
  c.columns[1].ordinal = 0;
  const f = fixture([a, b, c]),
    win = f.window(b);
  await f.api.cycleView(win, 1);
  assert.equal(f.api.captureView(win, "current").columns[0].ordinal, 1);
  const fresh = fixture([a, b, c]);
  await fresh.api.cycleView(win, -1);
  assert.equal(fresh.api.captureView(win, "current").columns[0].width, 400);
  assert.equal(fresh.api.captureView(win, "current").columns[0].ordinal, 0);
});

test("remembered identity disambiguates fully identical layouts independently per window", async () => {
  const a = view("A"),
    b = view("B"),
    c = view("C", { sortField: "year", sortDirection: -1 }),
    f = fixture([a, b, c]),
    one = f.window(a),
    two = f.window(a);
  await f.api.applyView(one, b);
  await f.api.applyView(two, a);
  await f.api.cycleView(one, 1);
  assert.deepEqual(one.sorts.at(-1), ["year", -1]);
  await f.api.cycleView(two, 1);
  assert.deepEqual(two.sorts.at(-1), ["title", 1]);
  await f.api.cycleView(two, 1);
  assert.deepEqual(two.sorts.at(-1), ["year", -1]);
});

for (const change of ["sort", "width", "order", "hidden"]) {
  test(`manual ${change} invalidates remembered view identity`, async () => {
    const a = view("A"),
      b = view("B", { sortField: "year", sortDirection: -1 }),
      c = view("C", { sortField: "dateAdded", sortDirection: -1 }),
      f = fixture([a, b, c]),
      win = f.window(a);
    await f.api.applyView(win, b);
    if (change === "sort") win.reset(view("manual", { sortDirection: -1 }));
    else
      win.mutate((columns) => {
        if (change === "width") columns[0].width = 333;
        if (change === "order") columns[0].ordinal = 5;
        if (change === "hidden") columns[0].hidden = true;
      });
    await f.api.cycleView(win, 1);
    assert.deepEqual(
      win.sorts.at(-1),
      ["title", 1],
      "start at first saved view",
    );
  });
}

test("manual changes matching another full view use it, while backward unknown starts at last", async () => {
  const a = view("A"),
    b = view("B", { sortField: "year", sortDirection: -1 }),
    c = view("C", { sortField: "dateAdded", sortDirection: -1 }),
    f = fixture([a, b, c]),
    win = f.window(a);
  await f.api.applyView(win, b);
  win.reset(a);
  await f.api.cycleView(win, 1);
  assert.deepEqual(win.sorts.at(-1), ["year", -1]);
  win.reset(view("manual", { sortDirection: -1 }));
  await f.api.cycleView(win, -1);
  assert.deepEqual(win.sorts.at(-1), ["dateAdded", -1]);
});

test("post-apply identity survives host-normalized widths and unavailable saved columns", async () => {
  const a = view("A"),
    b = view("B"),
    c = view("C", { sortField: "year", sortDirection: -1 });
  b.columns.push({ dataKey: "missing-plugin", ordinal: 3, width: 150 });
  b.columns[0].width = 400;
  const f = fixture([a, b, c]),
    win = f.window(a),
    iv = win.ZoteroPane.itemsView,
    reset = iv._resetColumns;
  iv._resetColumns = async () => {
    await reset();
    win.mutate((columns) => {
      columns[0].width = 399.6;
    });
  };
  await f.api.applyView(win, b);
  await f.api.cycleView(win, 1);
  assert.deepEqual(win.sorts.at(-1), ["year", -1]);
});
