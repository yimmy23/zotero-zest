const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

function setup({ venue = "", ranks = [], title = "" } = {}) {
  const prefs = new Map([["info.enable", true]]);
  const jobs = new Map();
  let jobID = 0;
  let section;
  const requests = [];
  const logs = [];
  const doc = {
    createElement(tag) {
      return {
        tag,
        ownerDocument: doc,
        children: [],
        listeners: {},
        isConnected: true,
        classList: { add() {} },
        style: { setProperty() {} },
        appendChild(el) {
          this.children.push(el);
          return el;
        },
        append(...els) {
          this.children.push(...els);
        },
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
        setAttribute() {},
        removeAttribute() {},
        getClientRects: () => [{}],
      };
    },
  };
  class Item {
    constructor(id) {
      this.id = id;
    }
    isRegularItem() {
      return true;
    }
    getField(key) {
      if (key === "title") return title;
      return key === "DOI" ? `10.1234/${this.id}` : "";
    }
  }
  const harness = createHarness({
    globals: {
      Zotero: {
        Item,
        ItemPaneManager: {
          registerSection(value) {
            section = value;
            return "info";
          },
          unregisterSection() {},
        },
      },
      ztoolkit: { log: (...args) => logs.push(args) },
    },
    mocks: {
      "src/utils/locale.ts": { getString: (key) => key, getLocaleID: (s) => s },
      "src/utils/prefs.ts": { getPref: (key) => prefs.get(key) },
      "src/utils/timers.ts": {
        setTimeout(fn) {
          jobs.set(++jobID, fn);
          return jobID;
        },
        clearTimeout: (id) => jobs.delete(id),
      },
      "src/reading/store.ts": { readingStore: { getForItem: () => undefined } },
      "src/reading/heat.ts": { hexToRgb: () => undefined },
      "src/columns/reading.ts": {},
      "src/reading/status.ts": { effectiveStatus: () => ({ source: "none" }) },
      "src/reading/statusMenu.ts": {},
      "src/columns/rating.ts": { getRating: () => 0 },
      "src/columns/remark.ts": { remarkOf: () => "" },
      "src/rank/index.ts": {
        requestJournalRecord() {},
        getJournalRecord: () => ({ values: ranks }),
        displayValuesForUI: () => ranks,
      },
      "src/rank/rank.ts": {
        displayFields: () => [],
        colorForRank: () => "",
        defaultRankColor: () => "",
      },
      "src/rank/display.ts": {
        rankFieldsForDisplay: (fields) => fields,
        rankValueDisplay: (value) => ({
          text: value.value,
          description: value.value,
        }),
      },
      "src/cite/index.ts": { citationOf: () => undefined },
      "src/rank/normalize.ts": { venueOf: () => venue },
      "src/utils/items.ts": { itemIsEditable: () => true },
      "src/authors/pipeline.ts": { formatAuthors: () => ({ parts: [] }) },
      "src/columns/authors.ts": { panelAuthorOptions: () => ({}) },
      "src/graph/authorIdentity.ts": { cachedAuthorships: () => undefined },
      "src/authors/authorMenu.ts": {},
      "src/graph/authorFetch.ts": {
        async ensureAuthorships(items, options) {
          requests.push({ items, options });
          return false;
        },
      },
      "src/utils/extra.ts": { getExtraBlock: () => undefined },
      "src/ui/icons.ts": { iconButton: () => doc.createElement("button") },
    },
  });
  const panel = harness.load("src/panes/infoSection.ts");
  panel.registerInfoSection();
  function show(id) {
    let enabled = true;
    const props = {
      body: doc.createElement("div"),
      item: new Item(id),
      refresh() {
        if (enabled) section.onRender(props);
      },
      setEnabled(value) {
        enabled = value;
        props.body.getClientRects = () => (enabled ? [{}] : []);
      },
    };
    section.onInit(props);
    section.onRender(props);
    assert.deepEqual(
      logs,
      [],
      "render should finish without hidden exceptions",
    );
    return props;
  }
  function drain() {
    for (const [id, fn] of jobs) {
      jobs.delete(id);
      fn();
    }
  }
  return { prefs, jobs, requests, panel, show, drain, section };
}

test("default item browsing sends no request and offers a manual fetch", async () => {
  const s = setup();
  const props = s.show(1);
  assert.equal(s.jobs.size, 0);
  assert.equal(s.requests.length, 0);
  const row = props.body.children.find(
    (r) => r.children[0]?.textContent === "info-affiliations",
  );
  const button = row.children[1].children[0];
  await button.listeners.click();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].options.automatic, undefined);
  assert.equal(button.disabled, false);
});

test("automatic fetch timers belong to each panel and ignore hidden panels", () => {
  const s = setup();
  s.prefs.set("info.affiliations.autoFetch", true);
  s.show(1);
  const second = s.show(2);
  assert.equal(s.jobs.size, 2);
  second.body.getClientRects = () => [];
  s.drain();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].items[0].id, 1);
  assert.equal(s.requests[0].options.automatic, true);
});

test("changing items cancels the outgoing panel's delayed request", () => {
  const s = setup();
  s.prefs.set("info.affiliations.autoFetch", true);
  const props = s.show(1);
  props.item = { id: 2 };
  s.section.onItemChange(props);
  s.drain();
  assert.equal(s.requests.length, 0);
});

test("destroying the panel cancels pending automatic work", () => {
  const s = setup();
  s.prefs.set("info.affiliations.autoFetch", true);
  s.show(1);
  s.panel.unregisterInfoSection();
  assert.equal(s.jobs.size, 0);
});

test("enabling the panel restores a hidden section without changing items", () => {
  const s = setup();
  const props = s.show(1);
  s.prefs.set("info.enable", false);
  s.panel.refreshInfoSections();
  assert.equal(props.body.getClientRects().length, 0);
  s.prefs.set("info.enable", true);
  s.panel.refreshInfoSections();
  assert.equal(props.body.getClientRects().length, 1);
  assert.equal(s.requests.length, 0);
});

test("a long venue and all rank badges share one content column beside their label", () => {
  const venue = "The New England Journal of Medicine";
  const ranks = ["医学1区", "Q1", "96.2"].map((value) => ({
    value,
    field: value,
  }));
  const s = setup({ venue, ranks });
  const props = s.show(1);
  const row = props.body.children.find(
    (node) => node.children[0]?.textContent === "info-venue",
  );
  assert.equal(
    row.children.length,
    2,
    "badges must not become independent label-column siblings",
  );
  const [name, badges] = row.children[1].children;
  assert.equal(name.textContent, venue);
  assert.equal(badges.className, "zest-info-ranks");
  assert.deepEqual(
    badges.children.map((badge) => badge.textContent),
    ["医学1区", "Q1", "96.2"],
  );
});

test("status controls wrap together and outbound links use a separate full-width group", () => {
  const s = setup({ title: "A study" });
  const props = s.show(1);
  const stateRow = props.body.children.find(
    (node) => node.children[0]?.textContent === "info-status",
  );
  assert.equal(stateRow.children.length, 2);
  assert.equal(
    stateRow.children[1].children.length,
    2,
    "status and complete star group remain in the content cell",
  );
  assert.equal(stateRow.children[1].children[1].children.length, 5);
  const openRow = props.body.children.find(
    (node) => node.children[0]?.textContent === "info-open",
  );
  assert.equal(openRow.children.length, 2);
  const group = openRow.children[1];
  assert.equal(group.className, "zest-info-links");
  assert.ok(
    group.children.some((link) => link.textContent === "Semantic Scholar"),
  );
  assert.ok(
    group.children.every(
      (link) => link.tag === "button" && link.type === "button",
    ),
  );
});
