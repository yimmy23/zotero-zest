const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

function fixture({ confirmed = true, outcomes } = {}) {
  const progress = [];
  const paints = [];
  const alerts = [];
  const calls = [];
  const requests = [];
  const cacheWrites = [];
  const main = { closed: false };
  let saves = 0;
  const items = Array.from({ length: 3 }, (_, n) => {
    const fields = {
      DOI: `10.5555/batch-${n}`,
      extra: `Private note ${n}\r\n\n  `,
    };
    return {
      libraryID: 1,
      key: `BATCH00${n}`,
      fields,
      getField: (field) => fields[field] ?? "",
      setField: (field, value) => {
        fields[field] = value;
      },
      saveTx: async () => {
        saves++;
      },
      isRegularItem: () => true,
      isEditable: () => true,
    };
  });
  const mocks = {};
  for (const name of [
    "reading/statusAuto",
    "reading/tracker",
    "reading/statusMenu",
    "reading/store",
    "reading/exportImport",
    "reading/migrate",
    "columns/rating",
    "graph/pane",
    "tags/nestedTree",
    "panes/statsDialog",
    "panes/annotMatrix",
    "panes/ratingImport",
    "utils/guard",
    "tabs/sidebar",
    "columns/authors",
    "rank/index",
  ])
    mocks[`src/${name}.ts`] = {};
  Object.assign(mocks, {
    "src/reading/status.ts": { READ_STATUSES: [] },
    "src/utils/locale.ts": {
      getString: (key, options) => ({ key, ...(options?.args ?? {}) }),
      getLocaleID: (key) => key,
    },
    "src/utils/prefs.ts": {
      getPref: (key) => key === "cite.useCrossref",
      getNumPref: () => 90,
    },
    "src/core/storage.ts": {
      cache: {
        ageOf: () => undefined,
        set: (...args) => cacheWrites.push(args),
        remove: (...args) => cacheWrites.push(args),
      },
    },
    "src/core/secrets.ts": { getSecret: async () => "" },
    "src/graph/authorIdentity.ts": { compactAuthorships: () => null },
    "src/core/http.ts": {
      politeParam: () => "",
      http: {
        requestResult: (method, url, options) =>
          new Promise((resolve) => {
            requests.push({ method, url, options, resolve });
          }),
      },
    },
  });
  if (outcomes)
    mocks["src/cite/index.ts"] = {
      citableItems: (items) => items,
      updateCitations: async (item, force, shouldContinue) => {
        calls.push({ item, force, shouldContinue });
        const status = outcomes[calls.length - 1];
        if (status instanceof Error) throw status;
        return { item, status };
      },
    };
  const h = createHarness({
    mocks,
    globals: {
      Zotero: { getMainWindow: () => main },
      Services: {
        prompt: {
          confirm: () => confirmed,
          alert: (...args) => alerts.push(args),
        },
      },
      ztoolkit: {
        log() {},
        ProgressWindow: class {
          constructor() {
            this.win = { close() {} };
            progress.push(this);
          }
          createLine() {
            return this;
          }
          show() {
            return this;
          }
          changeLine(line) {
            paints.push(line);
            return this;
          }
          startCloseTimer() {
            paints.push("timer");
          }
        },
      },
    },
  });
  return {
    ...h,
    progress,
    paints,
    alerts,
    calls,
    requests,
    cacheWrites,
    items,
    main,
    saves: () => saves,
    menus: h.load("src/modules/menus.ts"),
    runBatch: h.load("src/ui/batch.ts").runBatch,
    reply(
      index,
      result = {
        kind: "ok",
        value: { message: { "is-referenced-by-count": 42 } },
      },
    ) {
      requests[index].resolve(result);
    },
  };
}

test("real citation batch stops on first throttle without fetching remaining items", async () => {
  const h = fixture();
  const running = h.menus.updateCitationsFor(h.items, false);
  assert.equal(h.requests.length, 1);
  h.reply(0, { kind: "throttled", retryAfter: 60000 });
  const result = await running;
  assert.deepEqual(
    { ...result },
    {
      updated: 0,
      unchanged: 0,
      missing: 0,
      notFound: 0,
      failed: 1,
      stopped: 2,
      cancelled: false,
    },
  );
  assert.equal(h.requests.length, 1);
  assert.equal(h.saves(), 0);
  assert.equal(h.cacheWrites.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.alerts[0][2].stopped, 2);
});

for (const mode of ["progress close", "plugin shutdown", "main window close"]) {
  test(`real citation batch ${mode} discards its pending response and produces no late UI`, async () => {
    const h = fixture();
    const before = h.items.map((item) => item.fields.extra);
    const running = h.menus.updateCitationsFor(h.items, false);
    assert.equal(h.requests.length, 1);
    if (mode === "progress close") h.progress[0].win.close();
    else if (mode === "plugin shutdown") h.context.addon.data.alive = false;
    else h.main.closed = true;
    assert.equal(h.requests[0].options.shouldContinue(), false);
    h.reply(0);
    const result = await running;
    assert.deepEqual(
      { ...result },
      {
        updated: 0,
        unchanged: 0,
        missing: 0,
        notFound: 0,
        failed: 0,
        stopped: 3,
        cancelled: true,
      },
    );
    assert.equal(h.requests.length, 1);
    assert.equal(h.saves(), 0);
    assert.deepEqual(
      h.items.map((item) => item.fields.extra),
      before,
    );
    assert.equal(h.cacheWrites.length, 0);
    assert.equal(h.alerts.length, 0);
    assert.equal(h.paints.length, 0);
    assert.equal(h.progress.length, 1);
  });
}

test("declining a citation batch produces no result alert or request", async () => {
  const h = fixture({ confirmed: false });
  assert.equal(await h.menus.updateCitationsFor(h.items, false), undefined);
  assert.equal(h.requests.length, 0);
  assert.equal(h.alerts.length, 0);
  assert.equal(h.progress.length, 0);
});

test("citation tallies distinguish missing records and continue after ordinary failures", async () => {
  const h = fixture({ outcomes: ["failed", "not-found", "updated"] });
  const result = await h.menus.updateCitationsFor(h.items, true);
  assert.deepEqual(
    { ...result },
    {
      updated: 1,
      unchanged: 0,
      missing: 0,
      notFound: 1,
      failed: 1,
      stopped: 0,
      cancelled: false,
    },
  );
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every((call) => call.force === false));
  assert.ok(h.paints.some((line) => line?.text === "✓ 2  ✗ 1"));
});

test("citation tallies include thrown failures and preserve unchanged/no-identifier outcomes", async () => {
  const h = fixture({
    outcomes: [new Error("unexpected"), "unchanged", "no-id"],
  });
  const result = await h.menus.updateCitationsFor(h.items, false);
  assert.deepEqual(
    { ...result },
    {
      updated: 0,
      unchanged: 1,
      missing: 1,
      notFound: 0,
      failed: 1,
      stopped: 0,
      cancelled: false,
    },
  );
});

test("generic batches still continue after an ordinary error by default", async () => {
  const h = fixture();
  const visited = [];
  const result = await h.runBatch("test", [1, 2, 3], async (item) => {
    visited.push(item);
    if (item === 2) throw new Error("item failure");
  });
  assert.deepEqual(visited, [1, 2, 3]);
  assert.deepEqual({ ...result }, { ok: 2, fail: 1, stopped: 0 });
});

test("a completed generic write is still counted when its window closes during work", async () => {
  const h = fixture();
  let writes = 0;
  const result = await h.runBatch("test", [1, 2, 3], async () => {
    writes++;
    h.progress[0].win.close();
  });
  assert.equal(writes, 1);
  assert.deepEqual(
    { ...result },
    { ok: 1, fail: 0, stopped: 2, cancelled: true },
  );
  assert.equal(h.paints.length, 0);
  assert.equal(h.progress.length, 1);
});
