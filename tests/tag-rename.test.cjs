const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function fixture(tags, { failAt, cancelAt, confirmed = true } = {}) {
  const calls = [];
  const progress = [];
  let window;
  const harness = createHarness({
    globals: {
      Zotero: {
        getMainWindow: () => ({}),
        Tags: {
          getAll: async () => [...tags.keys()].map((tag) => ({ tag })),
          getID: (name) => tags.has(name),
          rename: async (_library, from, to) => {
            calls.push([from, to]);
            if (calls.length === failAt) throw new Error("write failed");
            tags.set(to, new Set([...(tags.get(to) ?? []), ...tags.get(from)]));
            tags.delete(from);
            if (calls.length === cancelAt) window.close();
          },
        },
      },
      Services: {
        prompt: {
          prompt: (_win, _title, _label, value) => {
            value.value = "A/B";
            return true;
          },
          confirm: () => confirmed,
        },
      },
      ztoolkit: {
        log() {},
        ProgressWindow: class {
          constructor() {
            this.win = window = { close() {} };
          }
          createLine() {
            return this;
          }
          show() {
            return this;
          }
          changeLine(line) {
            progress.push(line);
          }
          startCloseTimer() {}
        },
      },
    },
    mocks: {
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/prefs.ts": { getPref: () => "#" },
      "src/utils/guard.ts": { guard: (_name, fn) => fn },
      "src/tags/rules.ts": {},
    },
  });
  return { harness, calls, progress };
}

test("tag branch rename moves descendants before merging their former names", async () => {
  const tags = new Map([
    ["#A", new Set([1])],
    ["#A/B", new Set([2])],
  ]);
  const { harness, calls } = fixture(tags);
  await harness.load("src/tags/menu.ts").renameBranch(
    {},
    {
      node: { name: "A" },
      realNames: [...tags.keys()],
      libraryID: 1,
      linkSymbol: "/",
      onChanged() {},
    },
  );
  assert.deepEqual(calls, [
    ["#A/B", "#A/B/B"],
    ["#A", "#A/B"],
  ]);
  assert.deepEqual([...tags.get("#A/B")], [1]);
  assert.deepEqual([...tags.get("#A/B/B")], [2]);
});

test("tag rename plans contraction, external merges, native trimming and cycles", () => {
  const plan = createHarness().load("src/tags/rename.ts").planTagRenames;
  const result = plan(
    [
      [" A/B/B ", " A/B "],
      ["A/B", "A"],
    ],
    new Set(["A/B", "A/B/B", "A"]),
  );
  assert.deepEqual(
    Array.from(result.ordered, (row) => [...row]),
    [
      ["A/B", "A"],
      ["A/B/B", "A/B"],
    ],
  );
  assert.equal(result.merges, 1);
  assert.equal(
    plan(
      [
        ["A", "A/B"],
        ["A/B", "A/B/B"],
      ],
      new Set(["A", "A/B"]),
    ).merges,
    0,
  );
  assert.throws(
    () =>
      plan(
        [
          ["A", "B"],
          ["B", "A"],
        ],
        new Set(),
      ),
    /Cyclic/,
  );
  assert.throws(
    () =>
      plan(
        [
          ["A", "B"],
          [" A ", "C"],
        ],
        new Set(),
      ),
    /Conflicting/,
  );
});

for (const mode of ["failure", "cancel", "decline"]) {
  test(`tag rename ${mode} leaves dependent sources untouched`, async () => {
    const tags = new Map([
      ["#A", new Set([1])],
      ["#A/B", new Set([2])],
    ]);
    const { harness, calls } = fixture(tags, {
      failAt: mode === "failure" ? 1 : undefined,
      cancelAt: mode === "cancel" ? 1 : undefined,
      confirmed: mode !== "decline",
    });
    await harness.load("src/tags/menu.ts").renameBranch(
      {},
      {
        node: { name: "A" },
        realNames: [...tags.keys()],
        libraryID: 1,
        linkSymbol: "/",
        onChanged() {},
      },
    );
    assert.deepEqual([...tags.get("#A")], [1]);
    assert.equal(calls.length, mode === "decline" ? 0 : 1);
    assert.deepEqual([...tags.get(mode === "cancel" ? "#A/B/B" : "#A/B")], [2]);
  });
}

test("batch runner reports failed prerequisite and remaining work accurately", async () => {
  const { harness } = fixture(new Map());
  let writes = 0;
  const result = await harness.load("src/ui/batch.ts").runBatch(
    "test",
    [1, 2, 3],
    async () => {
      if (++writes === 2) throw new Error("failed");
    },
    { stopOnError: true },
  );
  assert.deepEqual({ ...result }, { ok: 1, fail: 1, stopped: 1 });
  assert.equal(writes, 2);
});
