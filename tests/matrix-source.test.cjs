const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function setup() {
  const items = new Map();
  const lookups = new Map();
  const reads = new Map();
  const titles = new Map();
  let yieldCount = 0;
  const make = (id, type, values = {}) => {
    const item = {
      id,
      key: `KEY${String(id).padStart(5, "0")}`,
      libraryID: 1,
      parentItemID: false,
      isRegularItem: () => type === "regular",
      isAttachment: () => type === "attachment",
      isAnnotation: () => type === "annotation",
      getField(field) {
        assert.equal(field, "title");
        titles.set(id, (titles.get(id) || 0) + 1);
        return item.title || `${type} ${id}`;
      },
      getAttachments: () => item.attachments || [],
      getAnnotations() {
        reads.set(id, (reads.get(id) || 0) + 1);
        return (item.annotations || []).map((id) => items.get(id));
      },
      getTags: () => [{ tag: "Methods" }],
      annotationText: `Annotation ${id}`,
      annotationComment: "",
      annotationPageLabel: "iv",
      annotationPosition: '{"pageIndex":3}',
      annotationColor: "#FFD400",
      annotationType: "highlight",
      ...values,
    };
    items.set(id, item);
    return item;
  };
  const parent = make(1, "regular", { attachments: [2, 3] });
  const pdf = make(2, "attachment", { parentItemID: 1, annotations: [4, 5] });
  const epub = make(3, "attachment", { parentItemID: 1, annotations: [6] });
  const a = make(4, "annotation", { parentItemID: 2 });
  const b = make(5, "annotation", {
    parentItemID: 2,
    annotationPageLabel: "ii",
  });
  const c = make(6, "annotation", {
    parentItemID: 3,
    annotationPosition:
      '{"type":"FragmentSelector","value":"epubcfi(/6/2!/4/2:0)"}',
  });
  const harness = createHarness({
    globals: {
      Zotero: {
        Items: {
          get(id) {
            lookups.set(id, (lookups.get(id) || 0) + 1);
            return items.get(id) || false;
          },
        },
        Libraries: { userLibraryID: 1 },
        Groups: {
          getGroupIDFromLibraryID(id) {
            return id === 8 ? 24680 : false;
          },
        },
        Promise: {
          async delay(ms) {
            assert.equal(ms, 0);
            yieldCount++;
          },
        },
        DB: {
          queryAsync() {
            throw new Error("No direct DB access");
          },
        },
        HTTP: {
          request() {
            throw new Error("No network");
          },
        },
      },
    },
  });
  return {
    ...harness.load("src/annots/matrixSource.ts"),
    toMarkdown: harness.load("src/annots/matrixModel.ts").toMarkdown,
    make,
    parent,
    pdf,
    epub,
    a,
    b,
    c,
    items,
    lookups,
    reads,
    titles,
    yieldCount: () => yieldCount,
  };
}

test("parent, expanded attachments, direct annotations and repeats collect only once", () => {
  const s = setup();
  const rows = s.collectMatrix([s.parent, s.pdf, s.a, s.parent, s.epub, s.pdf]);
  assert.deepEqual(
    Array.from(rows, (r) => r.key),
    [s.a.key, s.b.key, s.c.key],
  );
  assert.deepEqual(
    Array.from(rows, (r) => r.page),
    ["iv", "ii", "iv"],
  );
  assert.equal(s.reads.get(2), 1);
  assert.equal(s.reads.get(3), 1);
  assert.equal(s.titles.get(1), 1);
  assert.equal(s.titles.get(2), 1);
  assert.equal(s.titles.get(3), 1);
  assert.ok([...s.lookups.values()].every((count) => count === 1));
  assert.ok(
    rows.every((r) => r.itemID === 1 && r.itemIdentity === "1/KEY00001"),
  );
  assert.equal(rows[0].color, "#ffd400");
  assert.equal(rows[0].annotation, s.a);
  assert.equal(rows[0].attachment, s.pdf);
});

test("selecting an attachment does not collect its siblings; a selected mark stays one mark", () => {
  const s = setup();
  const rows = s.collectMatrix([s.pdf]);
  assert.equal(rows.length, 2);
  assert.equal(s.reads.has(3), false);
  s.reads.clear();
  const selected = s.collectMatrix([s.b]);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].key, s.b.key);
  assert.equal(selected[0].itemID, s.parent.id);
  assert.equal(s.reads.size, 0);
});

test("standalone attachments retain their own title and identity", () => {
  const s = setup();
  s.pdf.parentItemID = false;
  const rows = s.collectMatrix([s.pdf]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].itemID, 2);
  assert.equal(rows[0].itemTitle, "attachment 2");
  assert.equal(rows[0].itemIdentity, "1/KEY00002");
});

test("cross-library equal keys are distinct and group links use group IDs", () => {
  const s = setup();
  const att = s.make(20, "attachment", {
    key: s.pdf.key,
    libraryID: 8,
    annotations: [21],
  });
  s.make(21, "annotation", { key: s.a.key, libraryID: 8, parentItemID: 20 });
  const rows = s.collectMatrix([s.pdf, att]);
  assert.equal(rows.length, 3);
  assert.equal(
    rows[2].sourceURL,
    "zotero://open-pdf/groups/24680/items/KEY00002?page=4&annotation=KEY00004",
  );
  assert.notEqual(rows[0].itemIdentity, rows[2].itemIdentity);
});

test("native links carry PDF positions, EPUB CFI, snapshot selectors and exact keys", () => {
  const s = setup();
  const rows = s.collectMatrix([s.parent]);
  assert.equal(
    rows[0].sourceURL,
    "zotero://open-pdf/library/items/KEY00002?page=4&annotation=KEY00004",
  );
  assert.equal(
    rows[2].sourceURL,
    "zotero://open-pdf/library/items/KEY00003?cfi=epubcfi%28%2F6%2F2%21%2F4%2F2%3A0%29&annotation=KEY00006",
  );
  assert.ok(s.toMarkdown(rows).includes(`(${rows[2].sourceURL})`));
  s.a.annotationPosition = JSON.stringify({
    type: "CssSelector",
    value: "p:nth-child(2) > span",
  });
  assert.ok(
    s
      .collectMatrix([s.a])[0]
      .sourceURL.includes("?sel=p%3Anth-child%282%29%20%3E%20span&annotation="),
  );
  s.a.annotationPosition = "broken";
  assert.equal(
    s.collectMatrix([s.a])[0].sourceURL,
    "zotero://open-pdf/library/items/KEY00002?annotation=KEY00004",
  );
  s.a.annotationPosition = '{"pageIndex":0}';
  assert.ok(s.collectMatrix([s.a])[0].sourceURL.includes("?page=1&"));
});

test("unsupported libraries and invalid keys never invent source URLs", () => {
  const s = setup();
  s.pdf.libraryID = s.a.libraryID = s.b.libraryID = 10;
  assert.equal(s.collectMatrix([s.pdf])[0].sourceURL, "");
  s.pdf.libraryID = s.a.libraryID = s.b.libraryID = 1;
  s.a.key = 'bad";url(foo)';
  assert.equal(s.collectMatrix([s.a])[0].sourceURL, "");
});

test("images and ink without text survive, and only strict hex colours reach the UI", () => {
  const s = setup();
  s.a.annotationText = "";
  s.a.annotationType = "image";
  s.a.annotationColor = "red; background:url(https://example.invalid)";
  s.b.annotationText = "";
  s.b.annotationType = "ink";
  s.b.annotationColor = "#fff";
  const rows = s.collectMatrix([s.pdf]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    Array.from(rows, (r) => r.type),
    ["image", "ink"],
  );
  assert.ok(rows.every((r) => r.color === ""));
});

test("bad optional fields and broken sibling objects are isolated", () => {
  const s = setup();
  s.a.getTags = () => {
    throw new Error("unloaded tags");
  };
  Object.defineProperty(s.a, "annotationPageLabel", {
    get() {
      throw new Error("unloaded position");
    },
  });
  s.epub.getAnnotations = () => {
    throw new Error("linked URL");
  };
  s.parent.attachments.unshift(999);
  const rows = s.collectMatrix([null, {}, s.parent]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, "Annotation 4");
  assert.equal(rows[0].page, "");
  assert.equal(rows[0].tags.length, 0);
  s.pdf.getAnnotations = () => null;
  s.epub.getAnnotations = () => [s.c];
  assert.equal(s.collectMatrix([s.parent]).length, 1);
});

test("trashed ancestors, attachments, marks and mismatched parent references are excluded", () => {
  const s = setup();
  s.a.deleted = true;
  assert.equal(s.collectMatrix([s.parent]).length, 2);
  s.pdf.deleted = true;
  assert.equal(s.collectMatrix([s.parent, s.pdf, s.b]).length, 1);
  s.parent.deleted = true;
  assert.equal(s.collectMatrix([s.epub]).length, 0);
  s.parent.deleted = false;
  s.c.parentItemID = s.pdf.id;
  assert.equal(s.collectMatrix([s.epub]).length, 0);
});

test("async and sync snapshots agree and large attachments yield without database writes", async () => {
  const s = setup();
  for (let index = 100; index < 1200; index++) {
    s.make(index, "annotation", { parentItemID: 2 });
    s.pdf.annotations.push(index);
  }
  const initial = JSON.stringify(s.pdf.annotations);
  const sync = s.collectMatrix([s.pdf]);
  const asyncRows = await s.collectMatrixAsync([s.pdf], () => false);
  assert.deepEqual(
    Array.from(asyncRows, (r) => r.key),
    Array.from(sync, (r) => r.key),
  );
  assert.ok(s.yieldCount() >= 10);
  assert.equal(JSON.stringify(s.pdf.annotations), initial);
});

test("cancellation discards partial results and avoids later attachment reads", async () => {
  const s = setup();
  for (let index = 100; index < 1200; index++) {
    s.make(index, "annotation", { parentItemID: 2 });
    s.pdf.annotations.push(index);
  }
  const rows = await s.collectMatrixAsync([s.parent], () => s.yieldCount() > 0);
  assert.equal(rows.length, 0);
  assert.equal(s.yieldCount(), 1);
  assert.equal(s.reads.has(3), false);
  s.reads.clear();
  assert.equal((await s.collectMatrixAsync([s.pdf], () => true)).length, 0);
  assert.equal(s.reads.size, 0);
});

test("search index includes title, attachment, text, comments and own annotation tags", () => {
  const s = setup();
  s.a.annotationComment = "Research NOTE";
  const rows = s.collectMatrix([s.a]);
  assert.equal(
    rows[0].searchText,
    "annotation 4 research note regular 1 attachment 2 methods",
  );
});
