const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { windowFixture, PANEL_URL } = require("./dialog-fixture.cjs");

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function row(index, values = {}) {
  const value = {
    annotation: { id: index },
    attachment: { id: index + 10000 },
    key: `ANN${String(index).padStart(5, "0")}`,
    itemTitle: `Paper ${index}`,
    itemID: index,
    itemIdentity: `1/ITEM${index}`,
    attachmentTitle: `PDF ${index}`,
    text: `Unique annotation ${index}`,
    comment: index % 2 ? `Comment ${index}` : "",
    color: "#ffd400",
    page: String(index),
    type: "highlight",
    tags: [index % 2 ? "Methods" : "Results"],
    sourceURL: `zotero://open-pdf/library/items/ATT00001?annotation=ANN${String(index).padStart(5, "0")}`,
    ...values,
  };
  value.searchText = [
    value.itemTitle,
    value.text,
    value.comment,
    value.tags.join(" "),
    value.attachmentTitle,
  ]
    .join(" ")
    .toLowerCase();
  return value;
}

function setup({ rows = [row(1), row(2)], windows, manualLoads = false } = {}) {
  const allWindows = windows || [windowFixture()];
  const queue = [...allWindows];
  const loads = [];
  const logs = [];
  const openCalls = [];
  const copies = [];
  const navigations = [];
  const writes = [];
  const pickers = [];
  const observers = new Map();
  const items = new Map();
  let nextObserver = 0;
  let pickerResult = "/virtual/annotations-export";
  let navigateResult = true;
  const newHost = (viewRows = rows, selectedRows = viewRows.slice(0, 1)) => {
    const host = {
      closed: false,
      viewItems: [{ rows: viewRows }],
      selectedItems: [{ rows: selectedRows }],
      ZoteroPane: {
        itemsView: { getSortedItems: () => host.viewItems },
        getSelectedItems: () => host.selectedItems,
      },
      openDialog(...args) {
        openCalls.push({ host, args });
        const win = queue.shift() || windowFixture();
        if (!allWindows.includes(win)) allWindows.push(win);
        return win;
      },
    };
    return host;
  };
  const host = newHost();
  const harness = createHarness({
    mocks: {
      "src/utils/locale.ts": {
        getString: (id, options) =>
          id + (options?.args ? ` ${JSON.stringify(options.args)}` : ""),
      },
      "src/annots/matrixSource.ts": {
        collectMatrix: (items) => items.flatMap((item) => item.rows),
        collectMatrixAsync: (items, cancelled) => {
          const load = { items, cancelled };
          loads.push(load);
          if (manualLoads)
            return new Promise((resolve, reject) =>
              Object.assign(load, { resolve, reject }),
            );
          return Promise.resolve(items.flatMap((item) => item.rows));
        },
      },
      "src/utils/items.ts": {
        async openAttachmentAt(attachment, location) {
          navigations.push({ attachment, location });
          if (navigateResult instanceof Error) throw navigateResult;
          return navigateResult;
        },
      },
    },
    globals: {
      Zotero: {
        getMainWindow: () => host,
        Items: {
          registry: items,
          get(id) {
            return this.registry.get(Number(id));
          },
        },
        Notifier: {
          registerObserver(observer, types) {
            const id = `matrix-${++nextObserver}`;
            observers.set(id, { observer, types });
            return id;
          },
          unregisterObserver(id) {
            observers.delete(id);
          },
        },
        logError: (error) => logs.push(error),
        Utilities: {
          Internal: {
            copyTextToClipboard(text) {
              copies.push(text);
            },
          },
        },
        File: {
          async putContentsAsync(path, text) {
            writes.push({ path, text });
          },
        },
      },
      Services: { wm: { getEnumerator: () => allWindows } },
      ztoolkit: {
        log: (...args) => logs.push(args),
        FilePicker: class {
          constructor(...args) {
            pickers.push(args);
          }
          async open() {
            return pickerResult;
          }
        },
      },
    },
  });
  return {
    ...harness.load("src/panes/annotMatrix.ts"),
    host,
    newHost,
    allWindows,
    loads,
    logs,
    openCalls,
    copies,
    navigations,
    writes,
    pickers,
    observers,
    items,
    notify(event, type, ids = []) {
      for (const { observer, types } of observers.values()) {
        if (types.includes(type)) observer.notify(event, type, ids);
      }
    },
    zotero: harness.context.Zotero,
    win: allWindows[0],
    picker: (result) => {
      pickerResult = result;
    },
    navigate: (result) => {
      navigateResult = result;
    },
  };
}
const find = (win, selector) => {
  const result = win.document.querySelector(selector);
  assert.ok(result, `Missing ${selector}`);
  return result;
};
const rendered = (win) => win.document.querySelectorAll(".zest-matrix-row");
const change = (win, selector, value) => {
  const input = find(win, selector);
  input.value = value;
  input.dispatch("change");
  return input;
};

test("matrix waits past about:blank and renders exactly once after its real load", async () => {
  const win = windowFixture({ url: "about:blank" });
  const app = setup({ windows: [win] });
  app.openMatrix(app.host);
  assert.equal(app.openCalls[0].args[0], PANEL_URL);
  assert.equal(app.openCalls[0].args[1], "");
  assert.equal(app.loads.length, 0);
  win.dispatch("load");
  win.dispatch("unload");
  assert.equal(app.loads.length, 0);
  assert.equal(win.listeners.get("load").size, 1);
  win.finishLoad();
  await settle();
  assert.equal(app.loads.length, 1);
  assert.equal(rendered(win).length, 2);
  assert.equal(win.listeners.get("load").size, 0);
  win.dispatch("load");
  assert.equal(app.loads.length, 1);
  assert.equal(app.logs.length, 0);
});

test("closing a pending matrix removes its load listener and rejects captured late loads", async () => {
  const win = windowFixture({
    url: "about:blank",
    readyState: "loading",
    body: false,
  });
  const app = setup({ windows: [win] });
  app.openMatrix(app.host);
  const late = [...win.listeners.get("load").keys()][0];
  app.closeMatrix();
  assert.equal(win.closed, true);
  assert.equal(win.listeners.get("load").size, 0);
  win.finishLoad();
  late();
  await settle();
  assert.equal(app.loads.length, 0);
  assert.equal(rendered(win).length, 0);
});

test("each host has an independent matrix, source snapshot and search", async () => {
  const first = windowFixture();
  const second = windowFixture();
  const app = setup({ windows: [first, second] });
  const other = app.newHost([row(999)]);
  app.openMatrix(app.host);
  app.openMatrix(other);
  await settle();
  assert.equal(rendered(first).length, 2);
  assert.equal(rendered(second).length, 1);
  const search = find(first, ".zest-matrix-search");
  search.value = "missing";
  search.dispatch("input");
  first.flushTimers();
  assert.equal(rendered(first).length, 0);
  assert.equal(rendered(second).length, 1);
  assert.equal(find(second, ".zest-matrix-search").value, "");
  app.openMatrix(other);
  await settle();
  assert.equal(app.openCalls.length, 2);
  assert.equal(second.focusCount, 1);
  first.close();
  assert.equal(second.closed, false);
  assert.equal(
    app.loads[1].cancelled(),
    true,
    "the refreshed second snapshot supersedes its first load",
  );
  find(second, ".zest-matrix-refresh").click();
  await settle();
  assert.equal(rendered(second).length, 1);
});

test("scope changes cancel in-flight reloads and late results cannot replace the new scope", async () => {
  const app = setup({ manualLoads: true });
  app.openMatrix(app.host);
  const first = app.loads[0];
  assert.equal(
    find(app.win, ".zest-matrix-list").getAttribute("aria-busy"),
    "true",
  );
  change(app.win, ".zest-matrix-scope", "selected");
  assert.equal(app.loads.length, 2);
  assert.equal(first.cancelled(), true);
  assert.equal(app.loads[1].items, app.host.selectedItems);
  app.loads[1].resolve([row(55)]);
  await settle();
  assert.equal(rendered(app.win).length, 1);
  assert.ok(rendered(app.win)[0].textContent.includes("Unique annotation 55"));
  first.resolve([row(66), row(67)]);
  await settle();
  assert.equal(rendered(app.win).length, 1);
  assert.ok(rendered(app.win)[0].textContent.includes("Unique annotation 55"));
  assert.equal(
    find(app.win, ".zest-matrix-list").getAttribute("aria-busy"),
    "false",
  );
});

test("closing during reload cancels the source and prevents DOM writes after resolution", async () => {
  const app = setup({ manualLoads: true });
  app.openMatrix(app.host);
  const pending = app.loads[0];
  app.win.close();
  const writes = app.win.document.writes;
  assert.equal(pending.cancelled(), true);
  pending.resolve([row(5)]);
  await settle();
  assert.equal(app.win.document.writes, writes);
});

test("100-row pages expose all 2500 marks without recollecting or truncating", async () => {
  const app = setup({
    rows: Array.from({ length: 2500 }, (_, i) => row(i + 1)),
  });
  app.openMatrix(app.host);
  await settle();
  assert.equal(rendered(app.win).length, 100);
  assert.equal(find(app.win, ".zest-matrix-previous").disabled, true);
  for (let page = 1; page < 25; page++) {
    find(app.win, ".zest-matrix-next").click();
    assert.equal(rendered(app.win).length, 100);
  }
  assert.ok(
    rendered(app.win).at(-1).textContent.includes("Unique annotation 2500"),
  );
  assert.equal(find(app.win, ".zest-matrix-next").disabled, true);
  assert.equal(app.loads.length, 1);
  assert.equal(
    app.win.document.activeElement,
    find(app.win, ".zest-matrix-list"),
  );
  change(app.win, ".zest-matrix-tag", "Methods");
  assert.equal(rendered(app.win).length, 100);
  assert.ok(rendered(app.win)[0].textContent.includes("Unique annotation 1"));
  assert.equal(app.loads.length, 1);
});

test("debounced search preserves input identity, caret, focus and uses no new collection", async () => {
  const app = setup();
  app.openMatrix(app.host);
  await settle();
  const search = find(app.win, ".zest-matrix-search");
  search.focus();
  search.value = '"annotation 1"';
  search.selectionStart = search.selectionEnd = 7;
  search.dispatch("input");
  assert.equal(app.win.timers.size, 1);
  search.dispatch("input");
  assert.equal(app.win.timers.size, 1);
  assert.equal(rendered(app.win).length, 2);
  app.win.flushTimers();
  assert.equal(rendered(app.win).length, 1);
  assert.equal(find(app.win, ".zest-matrix-search"), search);
  assert.equal(app.win.document.activeElement, search);
  assert.equal(search.selectionStart, 7);
  assert.equal(app.loads.length, 1);
});

test("export uses the latest typed query before debounce and writes actual filtered CSV", async () => {
  const app = setup();
  app.openMatrix(app.host);
  await settle();
  const search = find(app.win, ".zest-matrix-search");
  search.value = '"annotation 2"';
  search.dispatch("input");
  find(app.win, ".zest-matrix-export-csv").click();
  await settle();
  assert.equal(app.pickers.length, 1);
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].path, "/virtual/annotations-export");
  assert.ok(app.writes[0].text.includes('"Unique annotation 2"'));
  assert.ok(!app.writes[0].text.includes('"Unique annotation 1"'));
  assert.equal(app.loads.length, 1);
  assert.ok(
    find(app.win, ".zest-matrix-status").textContent.includes('"count":1'),
  );
});

test("export captures a snapshot before the file picker; cancelling or closing prevents writes", async () => {
  const app = setup();
  app.openMatrix(app.host);
  await settle();
  let finishPicker;
  app.picker(
    new Promise((resolve) => {
      finishPicker = resolve;
    }),
  );
  find(app.win, ".zest-matrix-export-md").click();
  const search = find(app.win, ".zest-matrix-search");
  search.value = "missing";
  search.dispatch("input");
  app.win.flushTimers();
  finishPicker("/virtual/snapshot.md");
  await settle();
  assert.equal(app.writes.length, 1);
  assert.ok(app.writes[0].text.includes("Unique annotation 1"));
  assert.ok(app.writes[0].text.includes("Unique annotation 2"));
  find(app.win, ".zest-matrix-reset").click();
  app.picker(false);
  find(app.win, ".zest-matrix-export-md").click();
  await settle();
  assert.equal(app.writes.length, 1);
  app.picker(
    new Promise((resolve) => {
      finishPicker = resolve;
    }),
  );
  find(app.win, ".zest-matrix-export-md").click();
  app.win.close();
  finishPicker("/virtual/closed.md");
  await settle();
  assert.equal(app.writes.length, 1);
});

test("long text and comments expand independently of copying complete original content", async () => {
  const text = `Long text ${"x".repeat(900)}`;
  const comment = `Long comment ${"y".repeat(750)}`;
  const app = setup({ rows: [row(1, { text, comment })] });
  app.openMatrix(app.host);
  await settle();
  const preview = find(app.win, ".zest-matrix-text");
  const expand = find(app.win, ".zest-matrix-expand");
  assert.equal(preview.textContent.length, 651);
  assert.equal(expand.getAttribute("aria-expanded"), "false");
  find(app.win, ".zest-matrix-copy").click();
  assert.equal(app.copies[0], `${text}\n\n${comment}`);
  assert.equal(
    find(app.win, ".zest-matrix-status").textContent,
    "matrix-copied",
  );
  expand.click();
  assert.equal(preview.textContent, text);
  assert.equal(find(app.win, ".zest-matrix-comment p").textContent, comment);
  assert.equal(expand.getAttribute("aria-expanded"), "true");
  expand.click();
  assert.equal(preview.textContent.length, 651);
});

test("textless image marks copy their locator; open false gives user feedback and reenables action", async () => {
  const sample = row(1, { text: "", comment: "", type: "image" });
  const app = setup({ rows: [sample] });
  app.openMatrix(app.host);
  await settle();
  assert.ok(find(app.win, ".zest-matrix-no-text"));
  find(app.win, ".zest-matrix-copy").click();
  assert.equal(app.copies[0], sample.sourceURL);
  app.navigate(false);
  const open = find(app.win, ".zest-matrix-open");
  open.click();
  assert.equal(open.disabled, true);
  open.click();
  assert.equal(app.navigations.length, 1);
  await settle();
  assert.equal(open.disabled, false);
  assert.equal(app.navigations[0].attachment, sample.attachment);
  assert.equal(app.navigations[0].location.annotationID, sample.key);
  assert.equal(
    find(app.win, ".zest-matrix-status").textContent,
    "matrix-open-failed",
  );
});

test("annotation HTML and unsafe colour values are inert text, not injected DOM or style", async () => {
  const text = '<img src=x onerror="alert(1)"><script>evil()</script>';
  const app = setup({
    rows: [
      row(1, {
        text,
        itemTitle: text,
        comment: text,
        color: "red; background:url(evil)",
        tags: [text],
      }),
    ],
  });
  app.openMatrix(app.host);
  await settle();
  assert.equal(find(app.win, ".zest-matrix-text").textContent, text);
  assert.equal(find(app.win, ".zest-matrix-item-title").textContent, text);
  assert.equal(app.win.document.querySelectorAll("script").length, 0);
  assert.equal(app.win.document.querySelectorAll("img").length, 0);
  assert.equal(
    find(app.win, ".zest-matrix-type").style.getPropertyValue(
      "--annotation-color",
    ),
    "",
  );
  assert.equal(app.logs.length, 0);
});

test("keyboard shortcuts target only local search and export menu; advanced filters toggle", async () => {
  const app = setup();
  app.openMatrix(app.host);
  await settle();
  const root = find(app.win, ".zest-matrix");
  const search = find(app.win, ".zest-matrix-search");
  search.value = "lung";
  const event = root.dispatch("keydown", { metaKey: true, key: "f" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.win.document.activeElement, search);
  assert.equal(search.selectionEnd, 4);
  const menu = find(app.win, ".zest-matrix-export");
  menu.open = true;
  root.dispatch("keydown", { key: "Escape" });
  assert.equal(menu.open, false);
  assert.equal(app.win.document.activeElement.tagName, "summary");
  const toggle = find(app.win, ".zest-matrix-filter-toggle");
  const filters = find(app.win, ".zest-matrix-filters");
  assert.equal(filters.hidden, true);
  toggle.click();
  assert.equal(filters.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});

test("closing cancels debounce timers and captured callbacks cannot repaint", async () => {
  const app = setup();
  app.openMatrix(app.host);
  await settle();
  const search = find(app.win, ".zest-matrix-search");
  search.value = "test";
  search.dispatch("input");
  const late = [...app.win.timers.values()][0].fn;
  app.closeMatrix();
  assert.equal(app.win.timers.size, 0);
  const writes = app.win.document.writes;
  late();
  assert.equal(app.win.document.writes, writes);
});

test("item and tag shortcuts restore focus to results; reset returns focus to search", async () => {
  const app = setup({ rows: [row(1), row(2), row(3)] });
  app.openMatrix(app.host);
  await settle();
  const title = find(app.win, ".zest-matrix-item-title");
  title.focus();
  title.click();
  assert.equal(rendered(app.win).length, 1);
  assert.equal(find(app.win, ".zest-matrix-item").value, "1/ITEM1");
  assert.equal(
    app.win.document.activeElement,
    find(app.win, ".zest-matrix-list"),
  );
  find(app.win, ".zest-matrix-reset").click();
  assert.equal(rendered(app.win).length, 3);
  assert.equal(
    app.win.document.activeElement,
    find(app.win, ".zest-matrix-search"),
  );
  const tag = find(app.win, ".zest-matrix-tag-chip");
  tag.focus();
  tag.click();
  assert.equal(rendered(app.win).length, 2);
  assert.equal(find(app.win, ".zest-matrix-tag").tagName, "select");
  assert.equal(find(app.win, ".zest-matrix-tag").value, "Methods");
  assert.equal(
    app.win.document.activeElement,
    find(app.win, ".zest-matrix-list"),
  );
  assert.equal(app.loads.length, 1);
  assert.doesNotMatch(
    find(app.win, "style").textContent,
    /\.zest-matrix-tag\s*\{/,
  );
});

test("late navigation success or failure cannot overwrite a newer reload error", async () => {
  for (const result of [true, false]) {
    const app = setup();
    app.openMatrix(app.host);
    await settle();
    let finish;
    app.navigate(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    find(app.win, ".zest-matrix-open").click();
    app.host.closed = true;
    find(app.win, ".zest-matrix-refresh").click();
    await settle();
    assert.equal(
      find(app.win, ".zest-matrix-status").textContent,
      "matrix-load-failed",
    );
    assert.equal(
      rendered(app.win).length,
      0,
      "a failed source must not show the previous snapshot",
    );
    assert.equal(
      find(app.win, ".zest-matrix-empty h2").textContent,
      "matrix-unavailable",
    );
    assert.equal(find(app.win, ".zest-matrix-count").textContent, "");
    finish(result);
    await settle();
    assert.equal(
      find(app.win, ".zest-matrix-status").textContent,
      "matrix-load-failed",
    );
  }
});

test("late export feedback cannot replace a newer copy confirmation", async () => {
  const app = setup();
  app.openMatrix(app.host);
  await settle();
  let finish;
  app.picker(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  find(app.win, ".zest-matrix-export-md").click();
  find(app.win, ".zest-matrix-copy").click();
  finish("/virtual/late-export.md");
  await settle();
  assert.equal(app.writes.length, 1);
  assert.equal(
    find(app.win, ".zest-matrix-status").textContent,
    "matrix-copied",
  );
});

test("copy Markdown includes all 2501 results, not the current page, without I/O or recollection", async () => {
  const rows = Array.from({ length: 2501 }, (_, i) => row(i + 1));
  const original = JSON.stringify(rows);
  const app = setup({ rows });
  const mutations = [];
  const unexpectedWrite = (...args) => {
    mutations.push(args);
    throw new Error("Copy must not write the library");
  };
  app.zotero.DB = { executeTransaction: unexpectedWrite };
  app.zotero.Item = unexpectedWrite;
  for (const sample of rows) {
    sample.annotation.saveTx = unexpectedWrite;
    sample.attachment.saveTx = unexpectedWrite;
  }
  app.openMatrix(app.host);
  await settle();
  find(app.win, ".zest-matrix-next").click();
  assert.equal(rendered(app.win).length, 100);
  assert.ok(rendered(app.win)[0].textContent.includes("Unique annotation 101"));
  const menu = find(app.win, ".zest-matrix-export");
  const copy = find(app.win, ".zest-matrix-copy-md");
  assert.equal(find(app.win, ".zest-matrix-export-menu button"), copy);
  menu.open = true;
  copy.click();
  assert.equal(app.copies.length, 1);
  assert.equal((app.copies[0].match(/^## Paper /gm) || []).length, 2501);
  assert.ok(app.copies[0].includes("> Unique annotation 1  \n"));
  assert.ok(app.copies[0].includes("> Unique annotation 2501  \n"));
  assert.ok(app.copies[0].includes(rows.at(-1).sourceURL));
  assert.equal(
    find(app.win, ".zest-matrix-status").textContent,
    'matrix-copied-md {"count":2501}',
  );
  assert.equal(copy.disabled, false);
  assert.equal(menu.open, false);
  assert.equal(app.loads.length, 1);
  assert.equal(app.pickers.length, 0);
  assert.equal(app.writes.length, 0);
  assert.equal(app.navigations.length, 0);
  assert.equal(mutations.length, 0);
  assert.equal(JSON.stringify(rows), original);
  assert.equal(rendered(app.win).length, 100);
});

test("copy Markdown combines selected scope and all filters with the latest unpainted query", async () => {
  const common = {
    itemID: 1,
    itemIdentity: "1/ITEM1",
    itemTitle: "Selected paper",
    text: "Lung cancer evidence",
    comment: "Important",
    tags: ["Methods"],
  };
  const rows = [
    row(1, common),
    row(2, { ...common, text: "Lung cancer second result" }),
    row(3, { ...common, color: "#ff6666" }),
    row(4, { ...common, tags: ["Results"] }),
    row(5, { ...common, type: "underline" }),
    row(6, { ...common, comment: " " }),
    row(7, { ...common, itemIdentity: "2/ITEM1", itemID: 7 }),
    row(8, { ...common, text: "Lung cancer excluded" }),
    row(9, { ...common, text: "Lung cancer outside selection" }),
  ];
  const app = setup({ rows });
  app.host.selectedItems = [{ rows: rows.slice(0, -1) }];
  app.openMatrix(app.host);
  await settle();
  change(app.win, ".zest-matrix-scope", "selected");
  await settle();
  change(app.win, ".zest-matrix-item", "1/ITEM1");
  change(app.win, ".zest-matrix-color", "#ffd400");
  change(app.win, ".zest-matrix-tag", "Methods");
  change(app.win, ".zest-matrix-type", "highlight");
  const comments = find(app.win, ".zest-matrix-comments");
  comments.checked = true;
  comments.dispatch("change");
  assert.equal(rendered(app.win).length, 3);
  const search = find(app.win, ".zest-matrix-search");
  search.value = '"lung cancer" -excluded';
  search.dispatch("input");
  assert.equal(app.win.timers.size, 1);
  find(app.win, ".zest-matrix-copy-md").click();
  assert.equal(app.copies.length, 1);
  for (const sample of rows.slice(0, 2))
    assert.ok(app.copies[0].includes(sample.sourceURL));
  for (const sample of rows.slice(2))
    assert.ok(!app.copies[0].includes(sample.sourceURL));
  assert.equal(
    find(app.win, ".zest-matrix-status").textContent,
    'matrix-copied-md {"count":2}',
  );
  assert.equal(app.loads.length, 2);
  assert.equal(app.loads[1].items, app.host.selectedItems);
  assert.equal(app.pickers.length, 0);
  assert.equal(app.writes.length, 0);
});

test("copy Markdown and file export preserve identical full content, escaping, grouping and provenance", async () => {
  const text = `Long ${"x".repeat(1000)}\n[raw](javascript:evil)\n<img src=x>`;
  const comment = `**Comment** ${"y".repeat(800)}\nsecond & final`;
  const title = "# Same <title>";
  const first = row(1, { itemTitle: title, text, comment, page: "iv" });
  const second = row(2, {
    itemTitle: title,
    itemIdentity: "2/ITEM1",
    text: "",
    comment: "",
    type: "image",
    sourceURL:
      "zotero://open-pdf/groups/123/items/ATT00002?annotation=ANN00002",
  });
  const app = setup({ rows: [first, second] });
  app.openMatrix(app.host);
  await settle();
  assert.equal(find(app.win, ".zest-matrix-text").textContent.length, 651);
  find(app.win, ".zest-matrix-copy-md").click();
  assert.equal(app.copies.length, 1);
  assert.equal(app.pickers.length, 0);
  assert.equal(app.writes.length, 0);
  const markdown = app.copies[0];
  assert.equal((markdown.match(/^## /gm) || []).length, 2);
  assert.ok(markdown.includes("x".repeat(1000)));
  assert.ok(markdown.includes("y".repeat(800)));
  assert.ok(markdown.includes("\\[raw\\]\\(javascript:evil\\)"));
  assert.ok(markdown.includes("&lt;img src=x&gt;"));
  assert.ok(markdown.includes("\\*\\*Comment\\*\\*"));
  assert.ok(markdown.includes("> second &amp; final"));
  assert.ok(markdown.includes("matrix\\-col\\-page iv"));
  assert.ok(markdown.includes("matrix\\-comment:"));
  assert.ok(markdown.includes("matrix\\-col\\-tags:"));
  assert.ok(markdown.includes(first.sourceURL));
  assert.ok(markdown.includes(second.sourceURL));
  assert.ok(markdown.includes("PDF 2 · matrix\\-col\\-page 2 · image"));
  assert.ok(!markdown.includes("<img"));
  find(app.win, ".zest-matrix-export-md").click();
  await settle();
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].text, markdown);
  assert.equal(app.loads.length, 1);
});

test("copy Markdown is disabled while loading, empty or saving and recovers after cancellation", async () => {
  const app = setup({ manualLoads: true });
  app.openMatrix(app.host);
  const copy = find(app.win, ".zest-matrix-copy-md");
  assert.equal(copy.disabled, true);
  copy.click();
  app.loads[0].resolve([]);
  await settle();
  assert.equal(copy.disabled, true);
  copy.click();
  find(app.win, ".zest-matrix-refresh").click();
  assert.equal(copy.disabled, true);
  app.loads[1].resolve([row(1), row(2)]);
  await settle();
  assert.equal(copy.disabled, false);
  let finishPicker;
  app.picker(
    new Promise((resolve) => {
      finishPicker = resolve;
    }),
  );
  find(app.win, ".zest-matrix-export-md").click();
  assert.equal(copy.disabled, true);
  copy.click();
  assert.equal(app.copies.length, 0);
  finishPicker(false);
  await settle();
  assert.equal(copy.disabled, false);
  copy.click();
  assert.equal(app.copies.length, 1);
  assert.equal(app.pickers.length, 1);
  assert.equal(app.writes.length, 0);
});

test("an unpainted zero-match query never copies stale results", async () => {
  const app = setup();
  app.openMatrix(app.host);
  await settle();
  const search = find(app.win, ".zest-matrix-search");
  search.value = "definitely missing";
  search.dispatch("input");
  find(app.win, ".zest-matrix-copy-md").click();
  assert.equal(app.copies.length, 0);
  assert.doesNotMatch(
    find(app.win, ".zest-matrix-status").textContent,
    /copied/,
  );
  app.win.flushTimers();
  assert.equal(find(app.win, ".zest-matrix-copy-md").disabled, true);
  assert.equal(app.pickers.length, 0);
  assert.equal(app.loads.length, 1);
});

test("copy Markdown reports unavailable or throwing clipboard and allows a successful retry", async () => {
  for (const unavailable of [
    undefined,
    null,
    () => {
      throw new Error("clipboard busy");
    },
  ]) {
    const app = setup();
    app.openMatrix(app.host);
    await settle();
    const internal = app.zotero.Utilities.Internal;
    const workingCopy = internal.copyTextToClipboard;
    internal.copyTextToClipboard = unavailable;
    const copy = find(app.win, ".zest-matrix-copy-md");
    copy.click();
    assert.equal(
      find(app.win, ".zest-matrix-status").textContent,
      "matrix-copy-failed",
    );
    assert.equal(copy.disabled, false);
    assert.equal(app.copies.length, 0);
    internal.copyTextToClipboard = workingCopy;
    copy.click();
    assert.equal(app.copies.length, 1);
    assert.equal(
      find(app.win, ".zest-matrix-status").textContent,
      'matrix-copied-md {"count":2}',
    );
    assert.equal(app.pickers.length, 0);
    assert.equal(app.writes.length, 0);
    assert.equal(app.loads.length, 1);
  }
});

test("copy Markdown keeps each window's filters and feedback isolated", async () => {
  const first = windowFixture();
  const second = windowFixture();
  const app = setup({ windows: [first, second] });
  const other = app.newHost([row(900), row(901)]);
  app.openMatrix(app.host);
  app.openMatrix(other);
  await settle();
  const search = find(first, ".zest-matrix-search");
  search.value = '"annotation 1"';
  search.dispatch("input");
  find(first, ".zest-matrix-copy-md").click();
  assert.equal(find(second, ".zest-matrix-status").textContent, "");
  assert.equal(find(second, ".zest-matrix-search").value, "");
  const firstStatus = find(first, ".zest-matrix-status").textContent;
  find(second, ".zest-matrix-copy-md").click();
  assert.equal(app.copies.length, 2);
  assert.ok(app.copies[0].includes("Unique annotation 1"));
  assert.ok(!app.copies[0].includes("Unique annotation 2"));
  assert.ok(app.copies[1].includes("Unique annotation 900"));
  assert.ok(app.copies[1].includes("Unique annotation 901"));
  assert.equal(find(first, ".zest-matrix-status").textContent, firstStatus);
  assert.equal(
    find(second, ".zest-matrix-status").textContent,
    'matrix-copied-md {"count":2}',
  );
  first.close();
  find(second, ".zest-matrix-copy-md").click();
  assert.equal(app.copies[2], app.copies[1]);
  assert.equal(app.loads.length, 2);
  assert.equal(app.pickers.length, 0);
  assert.equal(app.writes.length, 0);
});

test("embedded matrices isolate the current reader source from the background library", async () => {
  const app = setup();
  const frame = windowFixture();
  const readerItems = [{ rows: [row(800), row(801)] }];
  const requested = [];
  const readerHost = {
    closed: false,
    get ZoteroPane() {
      throw new Error("Reader source must not inspect the hidden library");
    },
  };
  const mount = app.mountMatrix(frame, readerHost, {
    getItems(scope) {
      requested.push(scope);
      return readerItems;
    },
    selectedLabel: "matrix-scope-current",
  });
  await settle();
  assert.deepEqual(requested, ["selected"]);
  assert.equal(app.loads[0].items, readerItems);
  assert.equal(rendered(frame).length, 2);
  assert.equal(find(frame, ".zest-matrix-scope").disabled, true);
  assert.equal(
    find(frame, ".zest-matrix-scope option").textContent,
    "matrix-scope-current",
  );
  assert.ok(find(frame, ".zest-matrix-embedded"));
  assert.equal(app.logs.length, 0);
  mount.dispose();
  assert.equal(frame.closed, false);
  assert.equal(frame.listeners.get("unload").size, 0);
});

test("embedded matrices page 25 rows while export and totals stay full-snapshot", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => row(i + 1));
  const app = setup({ rows });
  const frame = windowFixture();
  app.mountMatrix(frame, app.host, {
    getItems: () => [{ rows }],
  });
  await settle();
  assert.equal(rendered(frame).length, 25);
  assert.ok(
    find(frame, ".zest-matrix-count").textContent.includes('"total":51'),
  );
  find(frame, ".zest-matrix-next").click();
  assert.equal(rendered(frame).length, 25);
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 26"));
  find(frame, ".zest-matrix-copy-md").click();
  assert.equal((app.copies[0].match(/^## Paper /gm) || []).length, 51);
});

test("mounting refuses the owner document or an unloaded or unrelated iframe", () => {
  const app = setup();
  const owner = windowFixture();
  const source = { getItems: () => [] };
  for (const [win, host] of [
    [owner, owner],
    [windowFixture({ url: "about:blank" }), owner],
    [windowFixture({ body: false }), owner],
    [windowFixture({ url: "chrome://zotero/content/zoteroPane.xhtml" }), owner],
  ]) {
    assert.throws(() => app.mountMatrix(win, host, source), /panel iframe/);
    assert.equal(win.document.querySelector(".zest-matrix"), null);
  }
  assert.equal(app.loads.length, 0);
});

test("embedded scope choices are explicit and never fall through to a library source", async () => {
  const app = setup();
  const frame = windowFixture();
  const selected = [{ rows: [row(1)] }];
  const view = [{ rows: [row(2), row(3)] }];
  app.mountMatrix(frame, app.host, {
    allowViewScope: true,
    getItems: (scope) => (scope === "view" ? view : selected),
  });
  await settle();
  assert.equal(find(frame, ".zest-matrix-scope").value, "selected");
  assert.equal(find(frame, ".zest-matrix-scope").children.length, 2);
  assert.equal(app.loads[0].items, selected);
  app.notify("modify", "item", [1]);
  change(frame, ".zest-matrix-scope", "view");
  await settle();
  assert.equal(
    app.loads.length,
    2,
    "scope change absorbs a queued notifier refresh",
  );
  assert.equal(app.loads[1].items, view);
  assert.equal(rendered(frame).length, 2);
});

test("hiding cancels an embedded scan; inactive refresh coalesces into one resume scan", async () => {
  const app = setup({ manualLoads: true });
  const frame = windowFixture();
  const source = { getItems: () => app.host.selectedItems };
  const mount = app.mountMatrix(frame, app.host, source);
  const original = app.loads[0];
  mount.setActive(false);
  const writes = frame.document.writes;
  assert.equal(original.cancelled(), true);
  mount.refresh();
  mount.refresh();
  original.resolve([row(700)]);
  await settle();
  assert.equal(app.loads.length, 1);
  assert.equal(frame.document.writes, writes);
  mount.setActive(true);
  assert.equal(app.loads.length, 2);
  app.loads[1].resolve([row(701)]);
  await settle();
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 701"));
  mount.setActive(false);
  mount.setActive(true);
  assert.equal(
    app.loads.length,
    2,
    "a settled, unchanged snapshot needs no scan",
  );
  mount.dispose();
  mount.refresh();
  mount.setActive(false);
  mount.setActive(true);
  assert.equal(app.loads.length, 2);
  assert.equal(frame.closed, false);
});

test("matrix notifier dirties active snapshots, coalesces hidden events, and unregisters", async () => {
  const app = setup();
  const frame = windowFixture();
  const mount = app.mountMatrix(frame, app.host, {
    getItems: () => app.host.selectedItems,
  });
  await settle();
  assert.equal(app.observers.size, 1);
  app.host.selectedItems = [{ rows: [row(99)] }];
  app.notify("add", "item", [1]);
  app.notify("modify", "item-tag", ["1-7"]);
  app.notify("delete", "item", [1]);
  assert.equal(app.loads.length, 1, "events wait for one merged refresh turn");
  frame.flushTimers();
  await settle();
  assert.equal(app.loads.length, 2);
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 99"));

  mount.setActive(false);
  app.notify("modify", "item", [999999]);
  app.notify("delete", "item-tag", ["1-7"]);
  app.notify("add", "item", [1]);
  frame.flushTimers();
  assert.equal(app.loads.length, 2, "hidden events only set dirty");
  mount.setActive(true);
  assert.equal(app.loads.length, 3);
  await settle();

  mount.dispose();
  assert.equal(app.observers.size, 0);
  app.notify("modify", "item", [1]);
  frame.flushTimers();
  assert.equal(
    app.loads.length,
    3,
    "late notifications cannot revive a disposed mount",
  );
});

test("unrelated item notifications do not reload or reset the embedded page", async () => {
  const rows = Array.from({ length: 75 }, (_, i) => row(i + 1));
  const app = setup({ rows });
  const frame = windowFixture();
  app.mountMatrix(frame, app.host, {
    getItems: () => [{ rows }],
  });
  await settle();
  find(frame, ".zest-matrix-next").click();
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 26"));
  app.items.set(999999, { id: 999999, parentItemID: 888888 });
  app.items.set(888888, { id: 888888, parentItemID: 777777 });
  app.items.set(777777, { id: 777777 });
  app.notify("modify", "item", [999999]);
  app.notify("modify", "item-tag", ["999999-7"]);
  frame.flushTimers();
  await settle();
  assert.equal(app.loads.length, 1);
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 26"));
});

test("unknown active modifies conservatively invalidate when lookup is unavailable", async () => {
  for (const mode of ["missing", "throw", "empty"]) {
    const app = setup();
    const frame = windowFixture();
    app.mountMatrix(frame, app.host, {
      getItems: () => app.host.selectedItems,
    });
    await settle();
    if (mode === "missing") delete app.zotero.Items.get;
    else if (mode === "throw")
      app.zotero.Items.get = function () {
        throw new Error("lookup failed");
      };
    else app.zotero.Items.get = function () {};
    app.notify("modify", "item", [999999]);
    frame.flushTimers();
    await settle();
    assert.equal(app.loads.length, 2, mode);
  }

  const app = setup();
  const frame = windowFixture();
  app.mountMatrix(frame, app.host, {
    getItems: () => app.host.selectedItems,
  });
  await settle();
  const throwingParent = { id: 999999 };
  Object.defineProperty(throwingParent, "parentItemID", {
    get() {
      throw new Error("stale item");
    },
  });
  app.items.set(999999, throwingParent);
  app.notify("modify", "item", [999999]);
  frame.flushTimers();
  await settle();
  assert.equal(app.loads.length, 2, "throwing parent getter");

  const hiddenApp = setup();
  const hiddenFrame = windowFixture();
  const hiddenMount = hiddenApp.mountMatrix(hiddenFrame, hiddenApp.host, {
    getItems: () => hiddenApp.host.selectedItems,
  });
  await settle();
  hiddenMount.setActive(false);
  let getCalls = 0;
  hiddenApp.zotero.Items.get = function () {
    getCalls++;
    return undefined;
  };
  hiddenApp.notify("modify", "item", [999999]);
  assert.equal(getCalls, 0, "hidden notifications do not inspect items");
});

test("attachment sources do not request regular-item child lists", async () => {
  let childReads = 0;
  const attachment = {
    id: 2,
    isRegularItem: () => false,
    getAttachments() {
      childReads++;
      throw new Error("getAttachments is only valid for regular items");
    },
    rows: [row(1)],
  };
  const app = setup();
  const frame = windowFixture();
  app.mountMatrix(frame, app.host, { getItems: () => [attachment] });
  await settle();
  assert.equal(childReads, 0);
  assert.equal(rendered(frame).length, 1);
});

test("empty scoped attachments invalidate when an annotation is reparented into them", async () => {
  const paper = {
    id: 1,
    isRegularItem: () => true,
    getAttachments: (includeTrashed) => (includeTrashed ? [2] : []),
    rows: [],
  };
  const app = setup();
  const frame = windowFixture();
  app.mountMatrix(frame, app.host, {
    getItems: () => [paper],
  });
  await settle();
  paper.rows = [
    row(100, {
      annotation: { id: 100, parentItemID: 2 },
      attachment: { id: 2, parentItemID: 1 },
      itemID: 1,
    }),
  ];
  app.notify("modify", "item", [100, 2, 9]);
  frame.flushTimers();
  await settle();
  assert.equal(app.loads.length, 2);
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 100"));
});

test("active unmatched annotation changes follow only two parent links", async () => {
  const paper = {
    id: 1,
    isRegularItem: () => true,
    getAttachments: () => [],
    rows: [],
  };
  const app = setup();
  const frame = windowFixture();
  app.mountMatrix(frame, app.host, {
    getItems: () => [paper],
  });
  await settle();
  app.items.set(100, { id: 100, parentItemID: 2 });
  app.items.set(2, { id: 2, parentItemID: 1 });
  paper.rows = [row(100)];
  app.notify("modify", "item", [100]);
  frame.flushTimers();
  await settle();
  assert.equal(app.loads.length, 2);
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 100"));
});

test("a notifier during a scan keeps the stale result loading until the replacement settles", async () => {
  const app = setup({ manualLoads: true });
  const frame = windowFixture();
  const mount = app.mountMatrix(frame, app.host, {
    getItems: () => app.host.selectedItems,
  });
  const initial = app.loads[0];
  initial.resolve([row(1)]);
  await settle();
  app.host.selectedItems = [{ rows: [row(2)] }];
  mount.refresh();
  const stale = app.loads[1];
  app.notify("modify", "item", [999999]);
  stale.resolve([row(1)]);
  await settle();
  assert.equal(app.loads.length, 3);
  assert.equal(rendered(frame).length, 0);
  assert.equal(find(frame, ".zest-matrix-copy-md").disabled, true);
  app.loads[2].resolve([row(2)]);
  await settle();
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 2"));
  assert.equal(find(frame, ".zest-matrix-copy-md").disabled, false);
});

test("hiding and resuming preserves matrix filters and page without recollection", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => row(i + 1));
  const app = setup({ rows });
  const frame = windowFixture();
  const mount = app.mountMatrix(frame, app.host, {
    getItems: () => [{ rows }],
  });
  await settle();
  const search = find(frame, ".zest-matrix-search");
  search.value = "annotation";
  search.dispatch("input");
  frame.flushTimers();
  find(frame, ".zest-matrix-next").click();
  const firstText = rendered(frame)[0].textContent;
  assert.ok(firstText.includes("Unique annotation 26"));
  mount.setActive(false);
  const writes = frame.document.writes;
  mount.setActive(true);
  assert.equal(frame.document.writes, writes);
  assert.equal(search.value, "annotation");
  assert.equal(rendered(frame)[0].textContent, firstText);
  assert.equal(app.loads.length, 1);
});

test("hidden search debounce is cancelled and its pending filter paints only on resume", async () => {
  const app = setup();
  const frame = windowFixture();
  const mount = app.mountMatrix(frame, app.host, {
    getItems: () => app.host.viewItems,
  });
  await settle();
  const search = find(frame, ".zest-matrix-search");
  search.value = '"annotation 2"';
  search.dispatch("input");
  const late = [...frame.timers.values()][0].fn;
  mount.setActive(false);
  const writes = frame.document.writes;
  assert.equal(frame.timers.size, 0);
  late();
  assert.equal(frame.document.writes, writes);
  assert.equal(rendered(frame).length, 2);
  mount.setActive(true);
  assert.equal(rendered(frame).length, 1);
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 2"));
  const resumedWrites = frame.document.writes;
  late();
  assert.equal(frame.document.writes, resumedWrites);
  assert.equal(app.loads.length, 1);
});

test("closing standalone matrices never closes embedded frames or the owner window", async () => {
  const standalone = windowFixture();
  const owner = windowFixture({
    url: "chrome://zotero/content/zoteroPane.xhtml",
  });
  const frame = windowFixture();
  frame.frameElement = {};
  const app = setup({ windows: [standalone, owner, frame] });
  owner.document.body.append(owner.document.createElement("div"));
  owner.document.body.children[0].className = "zest-matrix";
  const mount = app.mountMatrix(frame, app.host, {
    getItems: () => app.host.selectedItems,
  });
  app.openMatrix(app.host);
  await settle();
  app.closeMatrix();
  assert.equal(standalone.closed, true);
  assert.equal(owner.closed, false);
  assert.equal(frame.closed, false);
  mount.refresh();
  await settle();
  assert.equal(rendered(frame).length, 1);
  mount.dispose();
  assert.equal(owner.closed, false);
  assert.equal(frame.closed, false);
});

test("matrix sidebar instances and standalone filters remain independent with full Markdown export", async () => {
  const app = setup();
  const first = windowFixture();
  const second = windowFixture();
  const rows = Array.from({ length: 251 }, (_, i) => row(i + 1));
  const mount = app.mountMatrix(first, app.host, {
    getItems: () => [{ rows }],
  });
  app.mountMatrix(second, app.host, {
    getItems: () => [{ rows: [row(900)] }],
  });
  app.openMatrix(app.host);
  await settle();
  const search = find(first, ".zest-matrix-search");
  search.value = "annotation -251";
  search.dispatch("input");
  first.flushTimers();
  find(first, ".zest-matrix-next").click();
  find(first, ".zest-matrix-copy-md").click();
  const markdown = app.copies[0];
  assert.equal((markdown.match(/^## Paper /gm) || []).length, 250);
  assert.ok(markdown.includes(rows[0].sourceURL));
  assert.ok(markdown.includes(rows[249].sourceURL));
  assert.ok(!markdown.includes(rows[250].sourceURL));
  assert.equal(find(second, ".zest-matrix-search").value, "");
  assert.equal(find(app.win, ".zest-matrix-search").value, "");
  assert.equal(rendered(second).length, 1);
  assert.equal(rendered(app.win).length, 2);
  const writes = first.document.writes;
  mount.dispose();
  find(first, ".zest-matrix-next").click();
  assert.equal(first.document.writes, writes);
  assert.equal(second.closed, false);
  assert.equal(app.win.closed, false);
});

test("pop-out keeps an explicit frozen current-item source and can return to normal library scope", async () => {
  const app = setup();
  const frozen = [{ rows: [row(950)] }];
  const requested = [];
  const source = {
    getItems(scope) {
      requested.push(scope);
      return frozen;
    },
    selectedLabel: "matrix-scope-current",
  };
  app.openMatrix(app.host, source);
  await settle();
  app.host.selectedItems = [{ rows: [row(960)] }];
  find(app.win, ".zest-matrix-refresh").click();
  await settle();
  assert.equal(app.loads[1].items, frozen);
  assert.deepEqual(requested, ["selected", "selected"]);
  assert.ok(rendered(app.win)[0].textContent.includes("Unique annotation 950"));
  assert.equal(find(app.win, ".zest-matrix-scope").children.length, 1);
  app.openMatrix(app.host);
  await settle();
  assert.equal(app.openCalls.length, 1);
  assert.equal(find(app.win, ".zest-matrix-scope").value, "view");
  assert.equal(find(app.win, ".zest-matrix-scope").children.length, 2);
  assert.equal(app.loads[2].items, app.host.viewItems);
});

test("disposing an embedded matrix cancels late scans without closing or repainting the iframe", async () => {
  const app = setup({ manualLoads: true });
  const frame = windowFixture();
  const mount = app.mountMatrix(frame, app.host, {
    getItems: () => app.host.selectedItems,
  });
  const pending = app.loads[0];
  mount.dispose();
  const writes = frame.document.writes;
  assert.equal(pending.cancelled(), true);
  pending.resolve([row(4)]);
  await settle();
  assert.equal(frame.document.writes, writes);
  assert.equal(frame.closed, false);
  assert.equal(frame.listeners.get("unload").size, 0);
  mount.refresh();
  assert.equal(app.loads.length, 1);
});

test("a cancelled file picker while hidden does not repaint and restores actions on the same page", async () => {
  const rows = Array.from({ length: 201 }, (_, i) => row(i + 1));
  const app = setup({ rows });
  const frame = windowFixture();
  const mount = app.mountMatrix(frame, app.host, {
    getItems: () => [{ rows }],
  });
  await settle();
  find(frame, ".zest-matrix-next").click();
  let finish;
  app.picker(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  find(frame, ".zest-matrix-export-md").click();
  assert.equal(find(frame, ".zest-matrix-copy-md").disabled, true);
  mount.setActive(false);
  const writes = frame.document.writes;
  finish(false);
  await settle();
  assert.equal(frame.document.writes, writes);
  mount.setActive(true);
  assert.equal(find(frame, ".zest-matrix-copy-md").disabled, false);
  assert.ok(rendered(frame)[0].textContent.includes("Unique annotation 26"));
  assert.equal(app.loads.length, 1);
  assert.equal(app.writes.length, 0);
});
