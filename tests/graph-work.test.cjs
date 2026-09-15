const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

function fixture() {
  let reads = 0,
    waits = 0,
    live = true;
  let onWait = () => {};
  const h = createHarness({
    mocks: { "src/core/storage.ts": { cache: { get: () => null } } },
    globals: {
      Zotero: {
        Promise: {
          delay: async () => {
            waits++;
            onWait();
          },
        },
      },
    },
  });
  const items = Array.from({ length: 1000 }, (_, index) => ({
    id: index + 1,
    libraryID: 1,
    key: `P${index}`,
    isRegularItem: () => true,
    getField: () => "",
    getCreators() {
      reads++;
      return [{ lastName: "Wang", firstName: `Name${index}` }];
    },
  }));
  return {
    h,
    items,
    reads: () => reads,
    waits: () => waits,
    live: () => live,
    stop: () => {
      live = false;
    },
    onWait: (fn) => {
      onWait = fn;
    },
  };
}

test("author collection cancellation stops reading immediately at the next yield", async () => {
  const f = fixture();
  f.onWait(f.stop);
  const api = f.h.load("src/graph/authorIdentity.ts");
  await assert.rejects(
    api.buildAuthorResolverAsync(f.items, {
      maxSteps: 1,
      shouldContinue: f.live,
    }),
    { name: "WorkCancelled" },
  );
  assert.equal(f.reads(), 1);
  assert.equal(f.waits(), 1);
});

test("same-surname clustering and lookup wiring yield after collection and are cancellable", async () => {
  const f = fixture();
  let waitsAfterCollection = 0;
  f.onWait(() => {
    if (f.reads() === f.items.length && ++waitsAfterCollection === 8) f.stop();
  });
  const api = f.h.load("src/graph/authorIdentity.ts");
  await assert.rejects(
    api.buildAuthorResolverAsync(f.items, {
      maxSteps: 250,
      shouldContinue: f.live,
    }),
    { name: "WorkCancelled" },
  );
  assert.equal(f.reads(), f.items.length);
  assert.equal(waitsAfterCollection, 8);
});

test("a cancelled graph never continues creator collection or returns partial nodes", async () => {
  const f = fixture();
  f.onWait(f.stop);
  const api = f.h.load("src/graph/build.ts");
  const graph = await api.buildGraph(f.items, "author", {
    maxNodes: 250,
    maxSteps: 1,
    shouldContinue: f.live,
  });
  assert.equal(graph.nodes.length, 0);
  assert.equal(f.reads(), 0);
  assert.equal(f.waits(), 1);
});

test("sorting and graph edges keep yielding after all creator occurrences are collected", async () => {
  const f = fixture();
  let afterCollection = 0;
  f.onWait(() => {
    if (f.reads() >= f.items.length) afterCollection++;
  });
  const graph = await f.h
    .load("src/graph/build.ts")
    .buildGraph(f.items, "author", { maxNodes: 250, maxSteps: 500 });
  assert.equal(graph.nodes.length, 250);
  assert.equal(graph.edges.length, 125);
  assert.ok(afterCollection > 20);
});

for (const broken of [false, true]) {
  test(`creator-${broken ? "error" : "less"} items still yield and cancel before scanning the library`, async () => {
    const f = fixture();
    let reads = 0;
    const items = Array.from({ length: 10000 }, () => ({
      getCreators() {
        reads++;
        if (broken) throw new Error("unloaded creators");
        return [];
      },
    }));
    await assert.rejects(
      f.h.load("src/graph/authorIdentity.ts").buildAuthorResolverAsync(items, {
        maxSteps: 1,
        sliceMs: 1,
        shouldContinue: () => reads < 1,
      }),
      { name: "WorkCancelled" },
    );
    assert.equal(reads, 1);
    assert.equal(f.waits(), 1);
  });
}
