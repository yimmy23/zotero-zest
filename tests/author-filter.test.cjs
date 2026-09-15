const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { events } = require("./dialog-fixture.cjs");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const ref = (id) => ({ label: `Author ${id}`, id });
const resolver = { memberItemIDs: (author) => new Set([author.id]) };

function fixture(options = {}) {
  const filters = new Map(),
    notifications = new Map(),
    writes = [],
    toasts = [],
    reads = [],
    builds = [];
  let nextObserver = 0;
  const h = createHarness({
    globals: {
      Zotero: {
        Libraries: { userLibraryID: 1 },
        Items: {
          getAll: async (libraryID) => {
            reads.push(libraryID);
            return options.getAll
              ? options.getAll(libraryID)
              : [{ libraryID, isRegularItem: () => true }];
          },
        },
        Promise: { delay: async () => options.delay?.() },
        Notifier: {
          registerObserver(observer) {
            const id = String(++nextObserver);
            notifications.set(id, observer);
            return id;
          },
          unregisterObserver(id) {
            notifications.delete(id);
          },
        },
      },
      ztoolkit: {
        log() {},
        ProgressWindow: class {
          createLine({ text }) {
            toasts.push(text);
          }
          show() {}
          startCloseTimer() {}
        },
      },
    },
    mocks: {
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/guard.ts": { guard: (_name, fn) => fn },
      "src/views/itemFilter.ts": {
        activeItemFilters: (win) => (filters.has(win) ? ["author"] : []),
        setItemFilter(win, _name, filter) {
          writes.push({ win, filter });
          if (filter) filters.set(win, filter);
          else filters.delete(win);
          return options.supported !== false;
        },
        refreshItemView: async (win) => {
          win.refreshes++;
          await options.refresh?.(win);
        },
      },
      "src/graph/authorIdentity.ts": {
        buildAuthorResolverAsync: async (items) => {
          builds.push(items);
          return options.build ? options.build(items) : resolver;
        },
      },
    },
  });
  const menu = h.load("src/authors/authorMenu.ts");
  function window(libraryID = 1) {
    const listeners = new Set();
    const win = {
      closed: false,
      scope: `C${libraryID}`,
      libraryID,
      collectionListeners: listeners,
      selections: [],
      refreshes: 0,
    };
    events(win);
    win.select = (scope, selectedLibraryID = win.libraryID, notify = true) => {
      win.scope = scope;
      win.libraryID = selectedLibraryID;
      if (notify) for (const fn of [...listeners]) fn();
    };
    win.ZoteroPane = {
      getSelectedLibraryIDs: () => [win.libraryID],
      getCollectionTreeRows: () => [{ id: win.scope }],
      collectionsView: {
        selectLibrary: async (id) => {
          win.selections.push(id);
          if (options.selectLibrary) return options.selectLibrary(win, id);
          win.select(`L${id}`, id);
        },
        onSelect: {
          addListener: (fn) => listeners.add(fn),
          removeListener: (fn) => listeners.delete(fn),
        },
      },
    };
    return win;
  }
  return {
    h,
    menu,
    window,
    filters,
    notifications,
    writes,
    toasts,
    reads,
    builds,
  };
}

for (const stage of ["getAll", "build"]) {
  test(`clearing during ${stage} invalidates the pending request`, async () => {
    const gate = deferred();
    const f = fixture({ [stage]: () => gate.promise });
    const win = f.window();
    const pending = f.menu.applyAuthorFilter(win, ref(1));
    await tick();
    assert.equal(win.collectionListeners.size, 1);
    f.menu.clearAuthorFilter(win);
    gate.resolve(
      stage === "getAll" ? [{ isRegularItem: () => true }] : resolver,
    );
    assert.equal(await pending, 0);
    assert.equal(win.collectionListeners.size, 0);
    assert.equal(win.listeners.get?.("unload")?.size || 0, 0);
    assert.equal(f.filters.size, 0);
    assert.deepEqual(win.selections, []);
    assert.deepEqual(f.toasts, []);
  });

  test(`shutdown during ${stage} cannot repopulate filters, observers or cache`, async () => {
    const gate = deferred();
    const f = fixture({ [stage]: () => gate.promise });
    const win = f.window();
    const pending = f.menu.applyAuthorFilter(win, ref(1));
    await tick();
    f.menu.clearAllAuthorFilters();
    f.h.context.addon.data.alive = false;
    gate.resolve(
      stage === "getAll" ? [{ isRegularItem: () => true }] : resolver,
    );
    assert.equal(await pending, 0);
    assert.equal(f.filters.size, 0);
    assert.equal(f.notifications.size, 0);
    assert.equal(win.collectionListeners.size, 0);
    assert.deepEqual(win.selections, []);
    assert.deepEqual(f.toasts, []);
    assert.equal(await f.menu.applyAuthorFilter(win, ref(2)), 0);
    assert.equal(f.reads.length, 1);
  });
}

test("window unload cancels only its own pending request while sharing the same library build", async () => {
  const gate = deferred();
  const f = fixture({ build: () => gate.promise });
  const a = f.window(),
    b = f.window();
  const first = f.menu.applyAuthorFilter(a, ref(1));
  const second = f.menu.applyAuthorFilter(b, ref(2));
  await tick();
  a.closed = true;
  a.dispatch("unload");
  gate.resolve(resolver);
  assert.deepEqual(await Promise.all([first, second]), [0, 1]);
  assert.equal(f.reads.length, 1);
  assert.equal(f.builds.length, 1);
  assert.equal(a.collectionListeners.size, 0);
  assert.equal(b.collectionListeners.size, 1);
  assert.equal(f.filters.has(a), false);
  assert.equal(f.filters.has(b), true);
  assert.deepEqual(Array.from(f.filters.get(b)([{ id: 1 }, { id: 2 }])), [
    { id: 2 },
  ]);
});

test("a closed window without an unload notification cannot retain or publish author state", async () => {
  const gate = deferred();
  const f = fixture({ build: () => gate.promise });
  const win = f.window();
  const pending = f.menu.applyAuthorFilter(win, ref(1));
  await tick();
  win.closed = true;
  gate.resolve(resolver);
  assert.equal(await pending, 0);
  assert.equal(win.collectionListeners.size, 0);
  assert.equal(win.listeners.get("unload").size, 0);
  assert.equal(f.filters.size, 0);
});

test("A then B finishing in reverse order preserves B and never switches back to A's library", async () => {
  const aGate = deferred(),
    bGate = deferred();
  const f = fixture({
    build: (items) =>
      items[0].libraryID === 1 ? aGate.promise : bGate.promise,
  });
  const win = f.window(1);
  const a = f.menu.applyAuthorFilter(win, ref(1));
  await tick();
  win.select("C2", 2);
  const b = f.menu.applyAuthorFilter(win, ref(2));
  await tick();
  bGate.resolve(resolver);
  assert.equal(await b, 1);
  aGate.resolve(resolver);
  assert.equal(await a, 0);
  assert.deepEqual(win.selections, [2]);
  assert.deepEqual(Array.from(f.filters.get(win)([{ id: 1 }, { id: 2 }])), [
    { id: 2 },
  ]);
  assert.equal(win.collectionListeners.size, 1);
  assert.equal(f.toasts.length, 1);
});

test("new same-library request supersedes the old request and shares its in-flight resolver", async () => {
  const gate = deferred();
  const f = fixture({ build: () => gate.promise });
  const win = f.window();
  const first = f.menu.applyAuthorFilter(win, ref(1));
  const second = f.menu.applyAuthorFilter(win, ref(2));
  await tick();
  gate.resolve(resolver);
  assert.deepEqual(await Promise.all([first, second]), [0, 1]);
  assert.equal(f.builds.length, 1);
  assert.equal(f.writes.filter((entry) => entry.filter).length, 1);
  assert.deepEqual(Array.from(f.filters.get(win)([{ id: 1 }, { id: 2 }])), [
    { id: 2 },
  ]);
});

test("user collection changes cancel while resolving, including a missed notification", async () => {
  for (const notify of [true, false]) {
    const gate = deferred();
    const f = fixture({ build: () => gate.promise });
    const win = f.window();
    const pending = f.menu.applyAuthorFilter(win, ref(1));
    await tick();
    win.select("C99", 1, notify);
    gate.resolve(resolver);
    assert.equal(await pending, 0);
    assert.equal(f.filters.size, 0);
    assert.equal(win.collectionListeners.size, 0);
    assert.deepEqual(win.selections, []);
  }
});

test("user collection changes during the native switch or its delay cannot reinstall the filter", async () => {
  for (const stage of ["selectLibrary", "delay"]) {
    const gate = deferred();
    const f = fixture({
      [stage]:
        stage === "selectLibrary"
          ? async (win, id) => {
              win.select(`L${id}`, id);
              await gate.promise;
            }
          : () => gate.promise,
    });
    const win = f.window();
    const pending = f.menu.applyAuthorFilter(win, ref(1));
    await tick();
    win.select("C99");
    gate.resolve();
    assert.equal(await pending, 0);
    assert.equal(win.scope, "C99");
    assert.equal(f.filters.size, 0);
    assert.equal(win.collectionListeners.size, 0);
    assert.deepEqual(f.toasts, []);
  }
});

test("the programmatic root switch is accepted but an immediate user switch clears an active filter", async () => {
  const f = fixture();
  const win = f.window();
  assert.equal(await f.menu.applyAuthorFilter(win, ref(1)), 1);
  win.select("L1"); // Duplicate host notification, no collection change.
  assert.equal(f.filters.has(win), true);
  win.select("C99"); // No one-second blind window.
  assert.equal(f.filters.has(win), false);
  assert.equal(win.collectionListeners.size, 0);
});

test("clear during the refresh suppresses the late success toast", async () => {
  const gate = deferred();
  const f = fixture({ refresh: () => gate.promise });
  const win = f.window();
  const pending = f.menu.applyAuthorFilter(win, ref(1));
  await tick();
  assert.equal(f.filters.has(win), true);
  f.menu.clearAuthorFilter(win);
  gate.resolve();
  assert.equal(await pending, 0);
  assert.deepEqual(f.toasts, []);
  assert.equal(f.filters.size, 0);
});

test("item changes during a shared build invalidate it without discarding the replacement cache", async () => {
  const old = deferred(),
    fresh = deferred();
  let count = 0;
  const f = fixture({
    build: () => (++count === 1 ? old.promise : fresh.promise),
  });
  const win = f.window();
  const first = f.menu.applyAuthorFilter(win, ref(1));
  await tick();
  for (const observer of f.notifications.values()) observer.notify();
  const second = f.menu.applyAuthorFilter(win, ref(2));
  await tick();
  fresh.resolve(resolver);
  assert.equal(await second, 1);
  old.resolve({ memberItemIDs: () => new Set([99]) });
  assert.equal(await first, 0);
  assert.equal(await f.menu.applyAuthorFilter(win, ref(3)), 1);
  assert.equal(f.builds.length, 2);
  assert.deepEqual(Array.from(f.filters.get(win)([{ id: 3 }, { id: 99 }])), [
    { id: 3 },
  ]);
});

test("cache entries are independent across libraries and resolver failure cleans pending state", async () => {
  const f = fixture();
  const a = f.window(1),
    b = f.window(2);
  await f.menu.applyAuthorFilter(a, ref(1));
  await f.menu.applyAuthorFilter(b, ref(2));
  f.menu.clearAuthorFilter(a);
  await f.menu.applyAuthorFilter(a, ref(3));
  assert.deepEqual(f.reads, [1, 2]);
  assert.equal(f.filters.has(b), true);
  const failed = fixture({
    build: async () => {
      throw new Error("broken");
    },
  });
  const win = failed.window();
  assert.equal(await failed.menu.applyAuthorFilter(win, ref(1)), 0);
  assert.equal(win.collectionListeners.size, 0);
  assert.equal(failed.filters.size, 0);
});
