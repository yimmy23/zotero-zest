const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function setup() {
  const items = new Map();
  const reads = new Map();
  const annotationReads = new Map();
  const prefCalls = [];
  const libraryCalls = [];
  const prefs = {
    "nestedTags.matchChildTags": true,
    "textTags.match": "#",
  };
  const state = { automatic: true, yields: 0, libraryTags: [] };
  const make = (id, type = "regular", values = {}) => {
    const item = {
      id,
      libraryID: 1,
      parentItemID: false,
      tags: [],
      attachments: [],
      notes: [],
      annotations: [],
      isRegularItem: () => type === "regular",
      isAttachment: () => type === "attachment",
      getTags() {
        reads.set(id, (reads.get(id) || 0) + 1);
        return this.tags;
      },
      getAttachments() {
        if (type !== "regular") throw new Error("Not a regular item");
        return this.attachments;
      },
      getNotes() {
        if (type !== "regular") throw new Error("Not a regular item");
        return this.notes;
      },
      getAnnotations() {
        if (type !== "attachment") throw new Error("Not an attachment");
        annotationReads.set(id, (annotationReads.get(id) || 0) + 1);
        return this.annotations.map((id) => items.get(id)).filter(Boolean);
      },
      ...values,
    };
    items.set(id, item);
    return item;
  };
  const paper = make(1, "regular", {
    tags: [{ tag: "#Paper" }, { tag: "#Shared", type: 1 }],
    attachments: [2],
    notes: [4],
  });
  const pdf = make(2, "attachment", {
    parentItemID: 1,
    tags: [{ tag: "#PDF" }, { tag: "#Shared" }],
    annotations: [3],
  });
  const annotation = make(3, "annotation", {
    parentItemID: 2,
    tags: [{ tag: "#Evidence" }, { tag: "#Auto", type: 1 }],
  });
  const note = make(4, "note", {
    parentItemID: 1,
    tags: [{ tag: "#Note" }, { tag: "#Evidence" }],
  });
  const api = createHarness({
    mocks: {
      "src/utils/prefs.ts": { getPref: (key) => prefs[key] },
    },
    globals: {
      Zotero: {
        Items: { get: (id) => items.get(id) || false },
        Libraries: { userLibraryID: 1 },
        Prefs: {
          get(...args) {
            prefCalls.push(args);
            return state.automatic;
          },
        },
        Tags: {
          async getAll(libraryID, types) {
            libraryCalls.push([libraryID, types]);
            await state.onGetAll?.();
            return state.libraryTags.filter(
              (tag) => !types || types.includes(tag.type || 0),
            );
          },
          getColors: () => new Map(),
        },
        Promise: {
          async delay(ms) {
            assert.equal(ms, 0);
            state.yields++;
            await state.onYield?.();
          },
        },
        DB: {
          queryAsync() {
            throw new Error("No database access");
          },
        },
        HTTP: {
          request() {
            throw new Error("No network access");
          },
        },
      },
    },
  }).load("src/tags/scope.ts");
  return {
    ...api,
    make,
    items,
    reads,
    annotationReads,
    prefCalls,
    libraryCalls,
    prefs,
    state,
    paper,
    pdf,
    annotation,
    note,
  };
}

test("child tags are unique across paper, attachment, annotations and notes", () => {
  const s = setup();
  assert.deepEqual(Array.from(s.tagsOfItem(s.paper, true)), [
    "#Paper",
    "#Shared",
    "#PDF",
    "#Evidence",
    "#Auto",
    "#Note",
  ]);
  assert.deepEqual(Array.from(s.tagsOfItem(s.paper, false)), [
    "#Paper",
    "#Shared",
  ]);
  assert.deepEqual(Array.from(s.tagsOfItem(s.paper, true, false)), [
    "#Paper",
    "#PDF",
    "#Shared",
    "#Evidence",
    "#Note",
  ]);
});

test("standalone attachments include their annotations only with child matching", () => {
  const s = setup();
  s.pdf.parentItemID = false;
  assert.deepEqual(Array.from(s.tagsOfItem(s.pdf, true)), [
    "#PDF",
    "#Shared",
    "#Evidence",
    "#Auto",
  ]);
  assert.deepEqual(Array.from(s.tagsOfItem(s.pdf, false)), ["#PDF", "#Shared"]);
});

test("unreadable annotations do not suppress another attachment or child notes", () => {
  const s = setup();
  s.pdf.getAnnotations = () => {
    throw new Error("Linked URL attachment");
  };
  s.paper.attachments.push(5);
  s.make(5, "attachment", {
    parentItemID: 1,
    tags: [{ tag: "#Second" }],
    annotations: [6],
  });
  s.make(6, "annotation", {
    parentItemID: 5,
    tags: [{ tag: "#OtherEvidence" }],
  });
  const tags = s.tagsOfItem(s.paper, true);
  assert.ok(tags.includes("#Note"));
  assert.ok(tags.includes("#OtherEvidence"));
  assert.ok(tags.includes("#Second"));
});

test("expanded rows, duplicate tags and repeated papers count one root once", async () => {
  const s = setup();
  const scope = await s.collectTagScope(1, [
    s.annotation,
    s.pdf,
    s.paper,
    s.note,
    s.paper,
  ]);
  assert.equal(scope.inputs.length, 6);
  for (const input of scope.inputs) {
    assert.equal(input.count, 1, input.tag);
    assert.deepEqual(Array.from(input.itemIDs), [1]);
  }
  assert.equal(s.reads.get(1), 1);
  assert.equal(s.reads.get(2), 1);
  assert.equal(s.reads.get(3), 1);
  assert.equal(s.reads.get(4), 1);
});

test("scope child switch ignores expanded child tags but retains standalone tags", async () => {
  const s = setup();
  s.prefs["nestedTags.matchChildTags"] = false;
  const standalone = s.make(10, "attachment", {
    tags: [{ tag: "#Standalone" }],
    annotations: [11],
  });
  const standaloneMark = s.make(11, "annotation", {
    parentItemID: 10,
    tags: [{ tag: "#HiddenChild" }],
  });
  const scope = await s.collectTagScope(1, [
    s.pdf,
    s.paper,
    standaloneMark,
    standalone,
  ]);
  assert.deepEqual(Array.from(scope.inView), [
    "#Paper",
    "#Shared",
    "#Standalone",
  ]);
  assert.equal(s.reads.has(2), false);
  assert.equal(s.reads.has(11), false);
  assert.deepEqual(
    Array.from(scope.inputs.find((t) => t.tag === "#Standalone").itemIDs),
    [10],
  );
});

test("automatic tags stay hidden in both library and visible-row union", async () => {
  const s = setup();
  s.state.automatic = false;
  s.state.libraryTags = [
    { tag: "#Auto", type: 1 },
    { tag: "#Library", type: 0 },
    { tag: "Unmatched", type: 0 },
  ];
  const scope = await s.collectTagScope(1, [s.paper, s.pdf]);
  assert.equal(scope.inView.has("#Auto"), false);
  assert.equal(scope.inLibrary.has("#Auto"), false);
  assert.equal(
    scope.inputs.some((t) => t.tag === "#Auto"),
    false,
  );
  assert.equal(
    scope.inputs.some((t) => t.tag === "Unmatched"),
    false,
  );
  assert.equal(scope.inView.has("#Shared"), true);
  assert.deepEqual(s.prefCalls, [
    ["extensions.zotero.tagSelector.showAutomatic", true],
  ]);
  assert.equal(s.libraryCalls[0][0], 1);
  assert.deepEqual(Array.from(s.libraryCalls[0][1]), [0]);
  assert.equal(scope.inputs.find((t) => t.tag === "#Library").count, 0);

  s.state.automatic = true;
  const shown = await s.collectTagScope(1, [s.paper]);
  assert.equal(shown.inView.has("#Auto"), true);
  assert.equal(s.libraryCalls[1][1], undefined);
  assert.equal(
    s.reads.get(1),
    1,
    "visibility toggle reuses cached tag records",
  );
});

test("cache slots separate child mode and reuse automatic/manual answers", () => {
  const s = setup();
  const own = s.cachedTags(s.paper, false);
  const children = s.cachedTags(s.paper, true);
  assert.equal(s.cachedTags(s.paper, false), own);
  assert.equal(s.cachedTags(s.paper, true), children);
  assert.equal(s.cachedTags(s.paper, true, false).includes("#Auto"), false);
  assert.equal(s.cachedTags(s.paper, false, false).includes("#Shared"), false);
  assert.equal(s.reads.get(1), 2);
  assert.equal(s.reads.get(2), 1);
});

test("annotation changes invalidate attachment and paper aggregates, not unrelated/own caches", () => {
  const s = setup();
  const other = s.make(20, "regular", { tags: [{ tag: "#Other" }] });
  const own = s.cachedTags(s.paper, false);
  const untouched = s.cachedTags(other, true);
  s.cachedTags(s.pdf, true);
  s.cachedTags(s.paper, true);
  s.annotation.tags = [{ tag: "#Changed" }];
  s.invalidateTagCache(["3-44"]);
  assert.equal(s.cachedTags(s.pdf, true).includes("#Changed"), true);
  assert.equal(s.cachedTags(s.paper, true).includes("#Changed"), true);
  assert.equal(s.cachedTags(s.paper, false), own);
  assert.equal(s.cachedTags(other, true), untouched);
  assert.equal(s.reads.get(20), 1);
});

test("deleted annotations, notes and attachments invalidate retained reverse dependencies", () => {
  const s = setup();
  s.cachedTags(s.paper, true);
  s.cachedTags(s.pdf, true);
  s.items.delete(3);
  s.pdf.annotations = [];
  s.invalidateTagCache([3]);
  assert.equal(s.cachedTags(s.paper, true).includes("#Auto"), false);
  assert.equal(s.cachedTags(s.pdf, true).includes("#Evidence"), false);
  s.items.delete(4);
  s.paper.notes = [];
  s.invalidateTagCache(["4-7"]);
  assert.equal(s.cachedTags(s.paper, true).includes("#Note"), false);
  s.items.delete(2);
  s.paper.attachments = [];
  s.invalidateTagCache([2]);
  assert.equal(s.cachedTags(s.paper, true).includes("#PDF"), false);
});

test("new and reparented annotations invalidate current and former ancestor chains", () => {
  const s = setup();
  const second = s.make(10, "regular", { attachments: [11] });
  const secondPDF = s.make(11, "attachment", { parentItemID: 10 });
  s.cachedTags(s.paper, true);
  s.cachedTags(s.pdf, true);
  s.cachedTags(second, true);
  s.cachedTags(secondPDF, true);
  const fresh = s.make(12, "annotation", {
    parentItemID: 2,
    tags: [{ tag: "#New" }],
  });
  s.pdf.annotations.push(12);
  s.invalidateTagCache([12]);
  assert.equal(s.cachedTags(s.paper, true).includes("#New"), true);
  assert.equal(s.cachedTags(s.pdf, true).includes("#New"), true);
  s.pdf.annotations = s.pdf.annotations.filter((id) => id !== 12);
  secondPDF.annotations = [12];
  fresh.parentItemID = 11;
  s.invalidateTagCache([12]);
  assert.equal(s.cachedTags(s.paper, true).includes("#New"), false);
  assert.equal(s.cachedTags(s.pdf, true).includes("#New"), false);
  assert.equal(s.cachedTags(second, true).includes("#New"), true);
  assert.equal(s.cachedTags(secondPDF, true).includes("#New"), true);
});

test("removed dependency edges do not invalidate a former parent again", () => {
  const s = setup();
  s.cachedTags(s.paper, true);
  s.pdf.annotations = [];
  s.invalidateTagCache([3]);
  const refreshed = s.cachedTags(s.paper, true);
  s.items.delete(3);
  s.invalidateTagCache([3]);
  assert.equal(s.cachedTags(s.paper, true), refreshed);
});

test("explicit clear and empty invalidation rebuild while invalid IDs preserve caches", () => {
  const s = setup();
  const first = s.cachedTags(s.paper, true);
  s.invalidateTagCache(["not-an-id", 0, -1, "1.5"]);
  assert.equal(s.cachedTags(s.paper, true), first);
  s.clearTagCache();
  const second = s.cachedTags(s.paper, true);
  assert.notEqual(second, first);
  s.invalidateTagCache([]);
  assert.notEqual(s.cachedTags(s.paper, true), second);
});

test("a 21k same-order scan retains its hot 20k slots instead of thrashing", () => {
  const s = setup();
  const rows = Array.from({ length: 21000 }, (_, i) =>
    s.make(i + 100, "regular", { tags: [{ tag: "#Large" }] }),
  );
  const readAll = () => {
    for (const item of rows) s.cachedTags(item, false);
  };
  readAll();
  assert.equal(
    [...s.reads.values()].reduce((a, b) => a + b, 0),
    21000,
  );
  readAll();
  assert.equal(
    [...s.reads.values()].reduce((a, b) => a + b, 0),
    22000,
  );
  readAll();
  assert.equal(
    [...s.reads.values()].reduce((a, b) => a + b, 0),
    23000,
  );
  s.invalidateTagCache([100]);
  s.cachedTags(rows[0], false);
  assert.equal(s.reads.get(100), 2, "targeted invalidation makes room again");
});

test("cancelled scope stops before work, at its yield, and after getAll resolves", async () => {
  const s = setup();
  let cancelled = true;
  let result = await s.collectTagScope(1, [s.paper], () => cancelled);
  assert.equal(result.inputs.length, 0);
  assert.equal(s.reads.size, 0);
  assert.equal(s.libraryCalls.length, 0);

  cancelled = false;
  s.state.onYield = () => {
    cancelled = true;
  };
  const rows = Array.from({ length: 400 }, (_, i) => s.make(i + 100));
  result = await s.collectTagScope(1, rows, () => cancelled);
  assert.equal(result.inputs.length, 0);
  assert.equal(s.reads.size, 199);
  assert.equal(s.state.yields, 1);
  assert.equal(s.libraryCalls.length, 0);

  cancelled = false;
  s.state.onGetAll = () => {
    cancelled = true;
  };
  result = await s.collectTagScope(1, [s.paper], () => cancelled);
  assert.equal(result.inputs.length, 0);
  assert.equal(result.inView.size, 0);
  assert.equal(result.inLibrary.size, 0);
  assert.equal(s.libraryCalls.length, 1);
});
