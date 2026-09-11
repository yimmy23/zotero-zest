const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout } = require("node:timers");
const { createHarness } = require("./helpers.cjs");

function item({
  id = 1,
  libraryID = 1,
  key = `KEY${id}`,
  title = `Paper ${id}`,
  tags = [],
  extra = "",
  regular = true,
  editable = true,
  deleted = false,
} = {}) {
  return {
    id,
    libraryID,
    key,
    deleted,
    isDeleted: () => deleted,
    isRegularItem: () => regular,
    isEditable: () => editable,
    getTags: () => tags.map((tag) => ({ tag })),
    getField: (field) =>
      field === "title" ? title : field === "extra" ? extra : "",
  };
}

function setup({ save } = {}) {
  const writes = [];
  const h = createHarness({
    globals: { ztoolkit: { log() {} } },
    mocks: {
      "../utils/timers": { setTimeout },
      "../columns/rating": {
        RATING_KEYS: ["rate", "Rating"],
        getRating: (it) => {
          const match = /^\s*(?:rate|Rating)\s*:\s*(\d+)/im.exec(
            it.getField("extra"),
          );
          return match ? Number(match[1]) : 0;
        },
        setRating: async (it, value) => {
          writes.push([it, value]);
          if (save) await save(it, value);
        },
      },
      "../utils/extra": {
        getExtraLine: (it) => {
          const match = /^\s*(rate|Rating)\s*:\s*(.*?)\s*$/im.exec(
            it.getField("extra"),
          );
          return match ? { key: match[1], value: match[2] } : null;
        },
      },
    },
  });
  return { ...h.load("src/rating/tagImport.ts"), writes };
}

test("review snapshot accepts only one repeated rating and never writes during preview", () => {
  const app = setup();
  const source = item({ tags: ["★★★", "★★★"] });
  const preview = app.collectRatingImportPreview([source]);
  assert.equal(preview.eligible, 1);
  assert.equal(preview.rows[0].candidateRating, 3);
  assert.deepEqual(Array.from(preview.rows[0].tagCandidates), ["★★★", "★★★"]);
  assert.deepEqual(app.writes, []);
});

test("explicit yielding lets a scheduled cancellation stop a large immediate-save batch", async () => {
  const app = setup();
  const preview = app.collectRatingImportPreview(
    Array.from({ length: 100 }, (_, i) => item({ id: i + 1, tags: ["⭐"] })),
  );
  let cancelled = false;
  setTimeout(() => {
    cancelled = true;
  }, 0);
  const result = await app.commitRatingImport(preview, {
    yieldEvery: 1,
    isCancelled: () => cancelled,
  });
  assert.equal(result.cancelled, true);
  assert.equal(app.writes.length, 1);
});

test("conflicts, semantic/star substrings, existing malformed rates, inaccessible and duplicate rows all skip", () => {
  const app = setup();
  const rows = app.collectRatingImportPreview([
    item({ id: 1, tags: ["★", "★★"] }),
    item({ id: 2, tags: ["⭐精读", "a ★★★ b", "★★★★★★", "★☆"] }),
    item({ id: 3, tags: ["★★"], extra: "Rating: not-a-number\nrate: 2" }),
    item({ id: 4, tags: ["★★"], editable: false }),
    item({ id: 5, tags: ["★★"], regular: false }),
    item({ id: 6, tags: ["★★"], deleted: true }),
    item({ id: 7, tags: ["★★"] }),
    item({ id: 7, tags: ["★★"] }),
  ]).rows;
  assert.deepEqual(
    Array.from(rows, (row) => row.status),
    [
      "conflict",
      "no-tag",
      "existing",
      "readonly",
      "nonregular",
      "deleted",
      "ready",
      "duplicate",
    ],
  );
  assert.deepEqual(app.writes, []);
});

test("a tag/Extra read failure remains unavailable instead of becoming an empty field", () => {
  const app = setup();
  const inaccessible = item({ tags: ["★★"] });
  inaccessible.getTags = () => {
    throw new Error("unloaded");
  };
  const row = app.collectRatingImportPreview([inaccessible]).rows[0];
  assert.equal(row.status, "unavailable");
  assert.deepEqual(app.writes, []);
});

test("confirmation rechecks tags and Extra, saves sequentially, and preserves failures as row outcomes", async () => {
  let extra = "";
  const changed = item({ id: 1, tags: ["★★"] });
  changed.getField = (field) => (field === "extra" ? extra : "Changed");
  const failing = item({ id: 2, tags: ["★★★"] });
  const app = setup({
    save: async (it) => {
      if (it === failing) throw new Error("disk full");
    },
  });
  const preview = app.collectRatingImportPreview([changed, failing]);
  extra = "A concurrent note";
  const result = await app.commitRatingImport(preview, { yieldEvery: 1 });
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(
    Array.from(preview.rows, (row) => row.status),
    ["changed", "failed"],
  );
  assert.deepEqual(app.writes, [[failing, 3]]);
});

test("cancellation before the next item leaves remaining candidates untouched", async () => {
  let stop = false;
  const app = setup({
    save: async () => {
      stop = true;
    },
  });
  const preview = app.collectRatingImportPreview([
    item({ id: 1, tags: ["★"] }),
    item({ id: 2, tags: ["★★"] }),
  ]);
  const result = await app.commitRatingImport(preview, {
    isCancelled: () => stop,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.imported, 1);
  assert.equal(app.writes.length, 1);
  assert.equal(preview.rows[1].status, "ready");
});
