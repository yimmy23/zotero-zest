const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

function setup() {
  const win = windowFixture();
  let section;
  const copies = [],
    opened = [];
  class Item {
    isRegularItem() {
      return true;
    }
    getAttachments() {
      return [2];
    }
  }
  const item = new Item();
  const annotation = {
    key: "ANNO0001",
    annotationText: "A <b>literal</b> highlight",
    annotationComment: "Full comment",
    annotationPageLabel: "iii",
    annotationColor: "#808080",
    annotationType: "highlight",
    getTags: () => [],
  };
  const attachment = {
    id: 2,
    getAnnotations: () => [annotation],
    getField: () => "PDF",
  };
  const h = createHarness({
    globals: {
      Zotero: {
        Item,
        Items: { get: () => attachment },
        ItemPaneManager: {
          registerSection: (s) => {
            section = s;
            return "annots";
          },
          unregisterSection() {},
        },
        Utilities: {
          Internal: { copyTextToClipboard: (text) => copies.push(text) },
        },
        Reader: { _readers: [] },
      },
    },
    mocks: {
      "src/utils/locale.ts": { getString: (id) => id, getLocaleID: (id) => id },
      "src/tags/nestedTree.ts": {
        selectedTagBranches: () => ({
          branches: [],
          linkSymbol: "/",
          matchRule: "#",
        }),
        onTagSelectionChange: () => () => {},
      },
      "src/utils/items.ts": {
        openAttachmentAt: async (att, location) => {
          opened.push({ att, location });
          return true;
        },
      },
    },
  });
  const api = h.load("src/panes/annotSection.ts");
  api.registerAnnotSection();
  const props = {
    body: win.document.body,
    doc: win.document,
    item,
    tabType: "library",
    refresh() {
      section.onRender(props);
    },
  };
  section.onInit(props);
  section.onRender(props);
  return { win, api, section, props, copies, opened };
}

test("cards have native copy/open buttons and keep complete plain text", async () => {
  const s = setup(),
    d = s.win.document;
  const copy = d.querySelector(".zest-annot-copy"),
    open = d.querySelector(".zest-annot-open");
  assert.equal(copy.type, "button");
  assert.equal(open.type, "button");
  assert.ok(copy.textContent);
  assert.ok(open.textContent);
  copy.click();
  assert.deepEqual(s.copies, ["A <b>literal</b> highlight\n\nFull comment"]);
  open.click();
  await Promise.resolve();
  assert.equal(s.opened[0].location.annotationID, "ANNO0001");
  const text = d.querySelector(".zest-annot-text");
  text.dispatch("dblclick");
  assert.equal(s.opened.length, 1, "selecting prose does not navigate");
});
test("repaint, item switch and teardown invalidate card actions", () => {
  const s = setup();
  const old = s.win.document.querySelector(".zest-annot-copy");
  s.props.refresh();
  old.click();
  assert.equal(s.copies.length, 0);
  const current = s.win.document.querySelector(".zest-annot-copy");
  s.section.onItemChange(s.props);
  current.click();
  assert.equal(s.copies.length, 0);
  s.props.refresh();
  const last = s.win.document.querySelector(".zest-annot-copy");
  s.api.unregisterAnnotSection();
  last.click();
  assert.equal(s.copies.length, 0);
});
test("matrix and cards share copy formatting and textless source fallback", () => {
  const { annotationCopyText } = createHarness({
    mocks: { "src/utils/locale.ts": {}, "src/ui/icons.ts": {} },
  }).load("src/annots/actions.ts");
  assert.equal(
    annotationCopyText({
      text: " ",
      comment: "",
      sourceURL: "zotero://open-pdf/library/items/ABC?annotation=DEF",
    }),
    "zotero://open-pdf/library/items/ABC?annotation=DEF",
  );
  assert.equal(
    annotationCopyText({ text: "text", comment: "comment" }),
    "text\n\ncomment",
  );
});
