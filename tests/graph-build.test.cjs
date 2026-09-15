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

test("a graph budget preserves a connected neighbourhood and recomputes retained degree", async () => {
  const { items, buildGraph } = fixture();
  const data = await buildGraph(items, "related", { maxNodes: 3 });
  assert.equal(data.truncated, true);
  assert.equal(data.nodes.length, 3);
  assert.equal(data.edges.length, 2);
  assert.equal(data.isolated, undefined);
  assert.deepEqual(
    Array.from(data.nodes, (node) => node.itemID),
    [1, 3, 4],
  );
  assert.deepEqual(
    Array.from(data.nodes, (node) => node.weight),
    [2, 1, 1],
  );
});

test("a centre keeps a neighbour before higher-degree nodes elsewhere spend the budget", async () => {
  const { items, buildGraph } = fixture();
  const data = await buildGraph(items, "related", {
    maxNodes: 2,
    centerItemID: 2,
  });
  assert.equal(data.truncated, true);
  assert.equal(data.nodes.length, 2);
  assert.equal(data.nodes[0].itemID, 2);
  assert.equal(data.nodes[0].kind, "center");
  assert.equal(data.nodes[0].weight, 1);
  assert.equal(data.edges.length, 1);
  assert.equal(data.isolated, undefined);
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

test("category budgets admit papers with their category instead of discarding every relationship", async () => {
  const { items, buildGraph } = fixture();
  const data = await buildGraph(items.slice(0, 4), "collection", {
    maxNodes: 3,
  });
  assert.equal(data.truncated, true);
  assert.equal(data.nodes.length, 3);
  assert.equal(data.edges.length, 2);
  assert.equal(data.isolated, undefined);
  assert.deepEqual(
    Array.from(data.nodes, (node) => node.weight),
    [1, 2, 1],
  );
});

test("502 papers in 251 components retain edges under sidebar and pane budgets in every bipartite mode", async () => {
  const { items, buildGraph } = fixture();
  const papers = Array.from({ length: 502 }, (_, index) => ({
    ...items[0],
    id: index + 1,
    key: `P${index}`,
    getTags: () => [{ tag: `Group${Math.floor(index / 2)}`, type: 0 }],
    getCollections: () => [Math.floor(index / 2)],
    getCreators: () => [
      { lastName: `Author${Math.floor(index / 2)}`, firstName: "Alice" },
    ],
  }));
  for (const mode of ["author", "tag", "collection"]) {
    const full = await buildGraph(papers, mode, { maxNodes: 1000 });
    assert.equal(full.edges.length, 502);
    for (const maxNodes of [0, 1, 2, 3, 120, 250]) {
      const graph = await buildGraph(papers, mode, { maxNodes });
      assert.ok(graph.nodes.length <= maxNodes);
      assert.equal(graph.truncated, true);
      if (maxNodes >= 2)
        assert.ok(graph.edges.length > 0, `${mode} budget ${maxNodes}`);
      const ids = new Set(graph.nodes.map((node) => node.id));
      const linked = new Set(
        graph.edges.flatMap((edge) => [edge.source, edge.target]),
      );
      assert.ok(
        graph.edges.every(
          (edge) => ids.has(edge.source) && ids.has(edge.target),
        ),
      );
      assert.ok(graph.nodes.every((node) => linked.has(node.id)));
    }
  }
});

test("zero and one-node budgets remain real caps even with a requested centre", async () => {
  const { items, buildGraph } = fixture();
  const none = await buildGraph(items, "related", {
    maxNodes: 0,
    centerItemID: 2,
  });
  assert.equal(none.nodes.length, 0);
  const one = await buildGraph(items, "related", {
    maxNodes: 1,
    centerItemID: 2,
  });
  assert.equal(one.nodes.length, 1);
  assert.equal(one.nodes[0].itemID, 2);
  assert.equal(one.edges.length, 0);
});
