const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

function selection(branches, linkSymbol = "/", matchRule = "#") {
  return {
    branches: Object.entries(branches).map(([path, names]) => ({
      path,
      names,
    })),
    linkSymbol,
    matchRule,
  };
}

const compile = (selected) =>
  createHarness().load("src/tags/branchFilter.ts").compileTagBranches(selected);

test("a single selected branch accepts any descendant but rejects similarly spelled neighbors", () => {
  const matches = compile(selection({ Method: ["#Method/A", "#Method/B"] }));
  assert.equal(matches(["#Method/A"]), true);
  assert.equal(matches(["#Method/B"]), true);
  assert.equal(
    matches(["#Method/New/Leaf"]),
    true,
    "virtual parent includes new descendants",
  );
  assert.equal(matches(["#Methodology"]), false);
  assert.equal(matches(["#Methodology/A"]), false);
  assert.equal(matches(["#Methodological"]), false);
  assert.equal(matches([]), false);
  assert.equal(compile(selection({}))([]), true);
});

test("separate branches compose with AND while each branch retains OR", () => {
  const matches = compile(
    selection({
      Method: ["#Method/A", "#Method/B"],
      Topic: ["#Topic/Lung", "#Topic/Breast"],
    }),
  );
  assert.equal(matches(["#Method/A", "#Topic/Breast"]), true);
  assert.equal(matches(["#Method/B", "#Topic/Lung"]), true);
  assert.equal(matches(["#Method/A", "#Method/B"]), false);
  assert.equal(matches(["#Topic/Lung"]), false);
});

test("every supported separator has a literal boundary rather than a regex or slash assumption", () => {
  for (const separator of ["/", "\\", ".", "-", "_", ":", ">", "+", "~", "<"]) {
    const matches = compile(selection({ Method: ["#Method"] }, separator));
    assert.equal(matches(["#Method"]), true, separator);
    assert.equal(matches([`#Method${separator}Leaf`]), true, separator);
    assert.equal(matches(["#Methodology"]), false, separator);
    const other = separator === "/" ? ":" : "/";
    assert.equal(matches([`#Method${other}Leaf`]), false, separator);
  }
});

test("regex display mappings group raw spellings and new descendants without guessing raw prefixes", () => {
  const matches = compile(
    selection(
      { Method: ["[Method/A] one", "[Method/B] two"] },
      "/",
      "/^\\[([^\\]]+)\\]/",
    ),
  );
  for (const tag of ["[Method/A] one", "[Method/B] two", "[Method/C] new"]) {
    assert.equal(matches([tag]), true, tag);
  }
  assert.equal(matches(["[Methodology/A] neighbor"]), false);
  assert.equal(matches(["[Topic] other/[Method/A] one"]), false);
});

test("path normalization matches the tree when raw tags contain empty segments", () => {
  const matches = compile(selection({ "Method/A": ["#Method//A"] }));
  assert.equal(matches(["#Method/A//Child/"]), true);
  assert.equal(matches(["#Method/AB"]), false);
});

function cardFixture() {
  const win = windowFixture(),
    other = windowFixture(),
    selected = new Map(),
    errors = [];
  class Item {
    isRegularItem() {
      return true;
    }
    getAttachments() {
      return [2];
    }
  }
  const item = new Item();
  let annotations = [],
    section;
  const harness = createHarness({
    globals: {
      ztoolkit: { log: (...args) => errors.push(args) },
      Zotero: {
        Item,
        Items: {
          get: () => ({
            id: 2,
            getAnnotations: () => annotations,
            getField: () => "PDF",
          }),
        },
        ItemPaneManager: {
          registerSection: (options) => {
            section = options;
            return "annots";
          },
        },
      },
    },
    mocks: {
      "src/utils/locale.ts": {
        getString: (key) => key,
        getLocaleID: (key) => key,
      },
      "src/utils/guard.ts": { guard: (_name, fn) => fn },
      "src/utils/items.ts": {},
      "src/ui/color.ts": { setReadableColorVariants() {} },
      "src/reading/heat.ts": { hexToRgb: () => null },
      "src/ui/icons.ts": {
        iconLabelButton: (doc, _icon, label, cls) => {
          const button = doc.createElement("button");
          button.className = cls;
          button.textContent = label;
          return button;
        },
      },
      "src/tags/nestedTree.ts": {
        selectedTagBranches: (win) => selected.get(win) || selection({}),
        onTagSelectionChange: () => () => {},
      },
    },
  });
  harness.load("src/panes/annotSection.ts").registerAnnotSection();
  return {
    win,
    other,
    selected,
    annotations(rows) {
      annotations = rows.map(([text, tags], i) => ({
        key: `ANNOT00${i}`,
        annotationText: text,
        annotationType: "highlight",
        getTags: () => tags.map((tag) => ({ tag })),
      }));
    },
    render(win) {
      section.onRender({
        body: win.document.body,
        doc: win.document,
        item,
        tabType: "library",
      });
      assert.deepEqual(errors, []);
      return Array.from(
        win.document.querySelectorAll(".zest-annot-text"),
        (el) => el.textContent,
      );
    },
  };
}

test("annotation cards preserve branch groups, show one chip per branch, and stay per window", () => {
  const f = cardFixture();
  f.annotations([
    ["A", ["#Method/A"]],
    ["B", ["#Method/B"]],
    ["neighbor", ["#Methodology"]],
    ["both", ["#Method/A", "#Topic/Lung"]],
  ]);
  f.selected.set(f.win, selection({ Method: ["#Method/A", "#Method/B"] }));
  assert.deepEqual(f.render(f.win), ["A", "B", "both"]);
  assert.deepEqual(f.render(f.other), ["A", "B", "neighbor", "both"]);
  f.selected.set(
    f.win,
    selection({ Method: ["#Method/A", "#Method/B"], Topic: ["#Topic/Lung"] }),
  );
  assert.deepEqual(f.render(f.win), ["both"]);
  assert.deepEqual(
    Array.from(
      f.win.document.querySelectorAll(".zest-annot-chip"),
      (el) => el.textContent,
    ),
    ["Method", "Topic"],
  );
});

test("annotation cards honor custom separators and regex display mapping", () => {
  const f = cardFixture();
  f.annotations([
    ["a", ["[Method:A] first"]],
    ["b", ["[Method:B] second"]],
    ["new", ["[Method:C] unseen"]],
    ["neighbor", ["[Methodology:A] adjacent"]],
  ]);
  f.selected.set(
    f.win,
    selection(
      { Method: ["[Method:A] first", "[Method:B] second"] },
      ":",
      "/^\\[([^\\]]+)\\]/",
    ),
  );
  assert.deepEqual(f.render(f.win), ["a", "b", "new"]);
});
