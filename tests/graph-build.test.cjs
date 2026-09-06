const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

function fixture() {
  const links = [
    [1, 3],
    [1, 4],
    [1, 5],
    [2, 6],
    [2, 7],
    [2, 8],
  ];
  const items = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    libraryID: 1,
    key: String(index + 1).padStart(8, "0"),
    firstCreator: `Author ${index + 1}`,
    isRegularItem: () => true,
    getField: (field) => (field === "date" ? "2026" : `Item ${index + 1}`),
    getCollections: () => [index < 2 ? 1 : 2],
    relatedItems: [],
  }));
  for (const [source, target] of links) {
    items[source - 1].relatedItems.push(items[target - 1].key);
    items[target - 1].relatedItems.push(items[source - 1].key);
  }
  const byKey = new Map(items.map((item) => [item.key, item]));
  const h = createHarness({
    mocks: { "src/core/storage.ts": { cache: { get: () => null } } },
    globals: {
      Zotero: {
        Items: { getByLibraryAndKey: (_libraryID, key) => byKey.get(key) },
        Collections: { get: (id) => ({ name: `Collection ${id}` }) },
      },
    },
  });
  return { items, buildGraph: h.load("src/graph/build.ts").buildGraph };
}

test("a graph budget removes newly isolated nodes and recomputes retained degree", async () => {
  const { items, buildGraph } = fixture();
  const data = await buildGraph(items, "related", { maxNodes: 3 });
  assert.equal(data.truncated, true);
  assert.equal(data.nodes.length, 2);
  assert.equal(data.edges.length, 1);
  assert.equal(data.isolated, 1);
  assert.deepEqual(
    Array.from(data.nodes, (node) => node.itemID),
    [1, 3],
  );
  assert.deepEqual(
    Array.from(data.nodes, (node) => node.weight),
    [1, 1],
  );
});

test("an isolated centre survives a graph budget even when its neighbours are removed", async () => {
  const { items, buildGraph } = fixture();
  const data = await buildGraph(items, "related", {
    maxNodes: 2,
    centerItemID: 2,
  });
  assert.equal(data.truncated, true);
  assert.equal(data.nodes.length, 1);
  assert.equal(data.nodes[0].itemID, 2);
  assert.equal(data.nodes[0].kind, "center");
  assert.equal(data.nodes[0].weight, 0);
  assert.equal(data.edges.length, 0);
  assert.equal(data.isolated, 1);
});

test("an untruncated graph preserves its edges and original degree weights", async () => {
  const { items, buildGraph } = fixture();
  const data = await buildGraph(items, "related", { maxNodes: 8 });
  assert.equal(data.truncated, false);
  assert.equal(data.nodes.length, 8);
  assert.equal(data.edges.length, 6);
  assert.equal(data.isolated, undefined);
  assert.deepEqual(
    Array.from(data.nodes, (node) => node.weight),
    [3, 3, 1, 1, 1, 1, 1, 1],
  );
});

test("a newly isolated category is removed without being counted as an omitted library item", async () => {
  const { items, buildGraph } = fixture();
  const data = await buildGraph(items.slice(0, 4), "collection", {
    maxNodes: 3,
  });
  assert.equal(data.truncated, true);
  assert.equal(data.nodes.length, 2);
  assert.equal(data.edges.length, 1);
  assert.equal(data.isolated, undefined);
  assert.deepEqual(
    Array.from(data.nodes, (node) => node.weight),
    [1, 1],
  );
});
