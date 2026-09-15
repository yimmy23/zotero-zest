const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const plain = (value) => JSON.parse(JSON.stringify(value));

function item(id, key, kind, parentItem, libraryID = 1) {
  return {
    id,
    key,
    libraryID,
    parentItem,
    isAttachment: () => kind === "attachment",
    isNote: () => kind === "note",
    isRegularItem: () => kind === "paper",
  };
}

function fixture() {
  const paper = item(10, "PAPER001", "paper");
  const main = item(11, "MAINPDF1", "attachment", paper);
  const supplement = item(12, "SUPPPDF1", "attachment", paper);
  const epub = item(13, "EPUB0001", "attachment", paper);
  const standalone = item(14, "ALONE001", "attachment");
  const note = item(15, "NOTE0001", "note", paper);
  const items = new Map(
    [paper, main, supplement, epub, standalone, note].map((i) => [i.id, i]),
  );
  const opened = [],
    selected = [],
    fallbacks = [];
  const win = {
    closed: false,
    Zotero_Tabs: {
      _tabs: [],
      selectedID: "library",
      select: (id) => selected.push(id),
    },
  };
  const open = async (id, _location, options) => {
    opened.push({ id, options });
    win.Zotero_Tabs._tabs.push({ id: `restored-${id}`, data: { itemID: id } });
  };
  const h = createHarness({
    globals: {
      Zotero: {
        Items: {
          get: (id) => items.get(id),
          getIDFromLibraryAndKey: (libraryID, key) =>
            [...items.values()].find(
              (i) => i.libraryID === libraryID && i.key === key,
            )?.id,
        },
        Reader: { open, getByTabID() {} },
        Notes: { open },
        Promise: { delay: async () => {} },
      },
      Services: { prompt: { confirm: () => true } },
    },
    mocks: {
      "src/utils/locale.ts": { getString: (key) => key },
      "src/utils/prefs.ts": {},
      "src/utils/timers.ts": { setTimeout: () => 1, clearTimeout() {} },
      "src/utils/items.ts": {
        bestAttachment: (parent) => {
          fallbacks.push(parent.id);
          return main;
        },
      },
      "src/ui/icons.ts": {},
    },
  });
  const config = h.load("src/core/config.ts");
  const model = h.load("src/tabs/model.ts");
  const sidebar = h.load("src/tabs/sidebar.ts");
  const tab = (i, type = "reader") => ({
    id: `tab-${i.id}`,
    type,
    title: i.key,
    data: { itemID: i.id },
  });
  return {
    h,
    config,
    model,
    sidebar,
    win,
    items,
    paper,
    main,
    supplement,
    epub,
    standalone,
    note,
    tab,
    opened,
    selected,
    fallbacks,
  };
}

test("supplementary and same-parent attachments roundtrip independently in tab order", async () => {
  const f = fixture();
  f.win.Zotero_Tabs._tabs = [
    { id: "library", type: "library" },
    f.tab(f.supplement),
    f.tab(f.main, "reader-unloaded"),
    f.tab(f.epub),
    f.tab(f.standalone),
    f.tab(f.note, "note"),
  ];
  f.win.Zotero_Tabs.selectedID = `tab-${f.supplement.id}`;
  const session = f.sidebar.captureSession(f.win, "Reading");
  assert.deepEqual(
    plain(session.items),
    [f.supplement, f.main, f.epub, f.standalone, f.note].map((i) => ({
      kind: i.isNote() ? "note" : "attachment",
      libraryID: i.libraryID,
      key: i.key,
    })),
  );
  f.config.zestConfig.update((draft) => {
    draft.tagRules.push({ prefix: "#Keep" });
  });
  const persisted = f.config.sanitizeConfig(plain(f.config.zestConfig.get()));
  assert.deepEqual(plain(persisted.tabSessions[0]), plain(session));
  f.win.Zotero_Tabs._tabs = [];
  await f.sidebar.restoreSession(f.win, session.id);
  assert.deepEqual(
    f.opened.map((entry) => entry.id),
    [12, 11, 13, 14, 15],
  );
  assert.ok(f.opened.every((entry) => entry.options.openInBackground));
  assert.deepEqual(f.selected, ["restored-12"]);
  assert.deepEqual(f.fallbacks, []);
});

test("new note sessions restore the selected note and exact library identity", async () => {
  const f = fixture();
  const other = item(25, f.note.key, "note", undefined, 2);
  f.items.set(other.id, other);
  f.win.Zotero_Tabs._tabs = [
    f.tab(f.note, "note-unloaded"),
    f.tab(other, "note"),
  ];
  f.win.Zotero_Tabs.selectedID = `tab-${other.id}`;
  const session = f.sidebar.captureSession(f.win, "Notes");
  f.win.Zotero_Tabs._tabs = [];
  await f.sidebar.restoreSession(f.win, session.id);
  assert.deepEqual(
    f.opened.map((entry) => entry.id),
    [15, 25],
  );
  assert.deepEqual(f.selected, ["restored-25"]);
});

test("legacy parent, attachment and note session strings keep their restore behavior", async () => {
  const f = fixture();
  const session = f.model.saveSession("Legacy", [
    "1/PAPER001",
    "1/ALONE001",
    "note:1/NOTE0001",
    "1/NOTE0001",
  ]);
  assert.deepEqual(plain(f.model.sessions()[0].items), plain(session.items));
  await f.sidebar.restoreSession(f.win, session.id);
  assert.deepEqual(
    f.opened.map((entry) => entry.id),
    [11, 14, 15, 15],
  );
  assert.deepEqual(f.fallbacks, [10]);
  assert.deepEqual(f.selected, []);
});

test("missing or deleted exact targets are skipped without substituting another PDF", async () => {
  const f = fixture();
  f.win.Zotero_Tabs._tabs = [
    f.tab(f.supplement),
    f.tab(f.main),
    f.tab(f.note, "note"),
  ];
  f.win.Zotero_Tabs.selectedID = `tab-${f.supplement.id}`;
  const session = f.sidebar.captureSession(f.win, "Missing");
  f.items.delete(f.supplement.id);
  f.main.deleted = true;
  await f.sidebar.restoreSession(f.win, session.id);
  assert.deepEqual(
    f.opened.map((entry) => entry.id),
    [15],
  );
  assert.deepEqual(f.fallbacks, []);
  assert.deepEqual(f.selected, []);
});

test("session sanitizer validates targets and selection while retaining the legacy schema", () => {
  const f = fixture();
  const attachment = { kind: "attachment", libraryID: 1, key: "MAINPDF1" };
  const config = f.config.sanitizeConfig({
    tabSessions: [
      {
        id: "s",
        name: "Import",
        items: [
          "1/PAPER001",
          "note:1/NOTE0001",
          attachment,
          { ...attachment, kind: "paper" },
          { ...attachment, libraryID: -1 },
          { ...attachment, libraryID: 1.5 },
          { ...attachment, key: "" },
          { ...attachment, key: "1/KEY" },
          null,
        ],
        selected: attachment,
      },
    ],
  });
  assert.deepEqual(plain(config.tabSessions[0].items), [
    "1/PAPER001",
    "note:1/NOTE0001",
    attachment,
  ]);
  assert.deepEqual(plain(config.tabSessions[0].selected), attachment);
  config.tabSessions[0].selected = { ...attachment, key: "MISSING1" };
  assert.equal(
    f.config.sanitizeConfig(config).tabSessions[0].selected,
    undefined,
  );
});

test("a mismatched modern target kind cannot reopen an unrelated document", async () => {
  const f = fixture();
  const session = f.model.saveSession("Mismatch", [
    { kind: "attachment", libraryID: 1, key: f.paper.key },
    { kind: "note", libraryID: 1, key: f.main.key },
  ]);
  await f.sidebar.restoreSession(f.win, session.id);
  assert.deepEqual(f.opened, []);
  assert.deepEqual(f.fallbacks, []);
});
