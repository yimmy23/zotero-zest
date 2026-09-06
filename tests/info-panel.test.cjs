const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");
const { nameTokens } = createHarness({
  mocks: { "src/core/storage.ts": { cache: {} } },
}).load("src/graph/authorIdentity.ts");

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const hit = find(child, predicate);
    if (hit) return hit;
  }
}

function findClass(root, name) {
  return find(root, (node) => node.classList?.contains(name));
}

function findAll(root, predicate) {
  return [
    ...(predicate(root) ? [root] : []),
    ...(root.children || []).flatMap((child) => findAll(child, predicate)),
  ];
}

function findRow(root, label) {
  return find(
    root,
    (node) =>
      node.classList?.contains("zest-info-row") &&
      node.children[0]?.textContent === label,
  );
}

function institutionName(entry) {
  return findClass(entry, "zest-info-institution-name")?.textContent;
}

function institutionRoles(entry) {
  return findAll(entry, (node) =>
    node.classList?.contains("zest-info-institution-role"),
  ).map((node) => node.textContent);
}

function setup({
  venue = "",
  ranks = [],
  title = "",
  fields = {},
  abstract = false,
  authorParts = [],
  rating = 0,
  readingRecord,
} = {}) {
  const prefs = new Map([
    ["info.enable", true],
    ["info.abstract", abstract],
  ]);
  const jobs = new Map();
  let jobID = 0;
  let section;
  const requests = [];
  const authorshipCache = new Map();
  const abstractRequests = [];
  const abstractCache = new Map();
  const translationRequests = [];
  const writes = [];
  const logs = [];
  const authorMenus = [];
  const ratingWrites = [];
  const ratings = new Map();
  let fetchImplementation = async () => ({ kind: "missing" });
  let translationImplementation = async () => ({ kind: "error" });
  let authorshipImplementation = async () => false;
  let ratingImplementation = async () => {};
  const doc = {
    activeElement: null,
    defaultView: { mozInnerScreenX: 100, mozInnerScreenY: 200 },
    createElement(tag) {
      let content = "";
      const attrs = new Map();
      const values = new Map();
      const node = {
        tag,
        ownerDocument: doc,
        parentNode: null,
        childNodes: [],
        className: "",
        attachedRoot: false,
        disabled: false,
        hidden: false,
        selectionStart: 0,
        selectionEnd: 0,
        selectionDirection: "none",
        listeners: {},
        get children() {
          return this.childNodes.filter((child) => child.tag !== "#text");
        },
        get isConnected() {
          return this.attachedRoot || !!this.parentNode?.isConnected;
        },
        get textContent() {
          return (
            content + this.childNodes.map((child) => child.textContent).join("")
          );
        },
        set textContent(value) {
          for (const child of this.childNodes) child.parentNode = null;
          this.childNodes = [];
          content = String(value ?? "");
        },
        style: {
          setProperty: (key, value) => values.set(key, value),
          getPropertyValue: (key) => values.get(key) || "",
        },
        appendChild(el) {
          el.parentNode?.removeChild(el);
          el.parentNode = this;
          this.childNodes.push(el);
          return el;
        },
        append(...els) {
          for (const el of els)
            this.appendChild(
              typeof el === "string" ? doc.createTextNode(el) : el,
            );
        },
        removeChild(el) {
          const index = this.childNodes.indexOf(el);
          if (index >= 0) this.childNodes.splice(index, 1);
          el.parentNode = null;
          return el;
        },
        remove() {
          this.parentNode?.removeChild(this);
          this.attachedRoot = false;
        },
        addEventListener(type, fn) {
          this.listeners[type] = fn;
        },
        setAttribute(key, value) {
          attrs.set(key, String(value));
          if (key === "class") this.className = String(value);
        },
        getAttribute: (key) => attrs.get(key) ?? null,
        removeAttribute: (key) => attrs.delete(key),
        getClientRects() {
          return this.isConnected ? [{}] : [];
        },
        getBoundingClientRect() {
          return {
            left: 12,
            top: 18,
            right: 112,
            bottom: 38,
            width: 100,
            height: 20,
          };
        },
        focus() {
          doc.activeElement = this;
        },
        setSelectionRange(start, end, direction) {
          this.selectionStart = start;
          this.selectionEnd = end;
          this.selectionDirection = direction;
        },
      };
      node.classList = {
        contains: (name) => node.className.split(/\s+/).includes(name),
        add(...names) {
          node.className = [
            ...new Set([
              ...node.className.split(/\s+/).filter(Boolean),
              ...names,
            ]),
          ].join(" ");
        },
        remove(...names) {
          node.className = node.className
            .split(/\s+/)
            .filter((name) => !names.includes(name))
            .join(" ");
        },
        toggle(name, force) {
          const enabled = force ?? !this.contains(name);
          if (enabled) this.add(name);
          else this.remove(name);
          return enabled;
        },
      };
      return node;
    },
    createTextNode(text) {
      const node = this.createElement("#text");
      node.textContent = text;
      return node;
    },
  };
  class Item {
    constructor(id, overrides = {}) {
      this.id = id;
      this.libraryID = 1;
      this.key = `ITEM${id}`;
      this.fields = { title, DOI: `10.1234/${id}`, ...fields, ...overrides };
    }
    isRegularItem() {
      return true;
    }
    getField(key) {
      return this.fields[key] || "";
    }
    setField(key, value) {
      writes.push({ itemID: this.id, key, value });
      this.fields[key] = value;
    }
    async saveTx() {
      writes.push({ itemID: this.id, save: true });
    }
  }
  function abstractIdentity(item) {
    const doi = String(item.getField("DOI") || "").toLowerCase();
    const pmid = String(item.getField("PMID") || "");
    return doi || pmid ? { key: `${doi}/${pmid}`, doi, pmid } : null;
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
      "src/utils/locale.ts": {
        getString: (key, options) =>
          options?.args
            ? `${key} ${Object.values(options.args).join(" ")}`
            : key,
        getLocaleID: (s) => s,
      },
      "src/utils/prefs.ts": { getPref: (key) => prefs.get(key) },
      "src/utils/timers.ts": {
        setTimeout(fn) {
          jobs.set(++jobID, fn);
          return jobID;
        },
        clearTimeout: (id) => jobs.delete(id),
      },
      "src/reading/store.ts": {
        readingStore: { getForItem: () => readingRecord },
        formatDuration: (seconds) => `${seconds}s`,
        pagesSeen: () => 3,
      },
      "src/reading/heat.ts": {
        hexToRgb: () => undefined,
        heatAlphas: () => [0.2, 0.6, 0.8],
        heatLevel: () => 1,
      },
      "src/columns/reading.ts": {
        heatColor: () => "#66ADFF",
        heatOpacity: () => 1,
      },
      "src/reading/status.ts": { effectiveStatus: () => ({ source: "none" }) },
      "src/reading/statusMenu.ts": {},
      "src/columns/rating.ts": {
        getRating: (item) => ratings.get(item.id) ?? rating,
        async setRating(item, value) {
          ratingWrites.push({ itemID: item.id, value });
          await ratingImplementation(item, value);
          ratings.set(item.id, value);
        },
      },
      "src/columns/registry.ts": {},
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
      "src/authors/pipeline.ts": {
        formatAuthors: () => ({
          parts: authorParts,
          total: authorParts.filter((part) => part.creator).length,
        }),
      },
      "src/columns/authors.ts": { panelAuthorOptions: () => ({}) },
      "src/graph/authorIdentity.ts": {
        cachedAuthorships: (item) => authorshipCache.get(item.id),
        findCachedAuthor: () => undefined,
        nameTokens,
      },
      "src/authors/authorMenu.ts": {
        openAuthorMenu: (...args) => authorMenus.push(args),
      },
      "src/graph/authorFetch.ts": {
        async ensureAuthorships(items, options) {
          requests.push({ items, options });
          return authorshipImplementation(items, options);
        },
      },
      "src/panes/abstractSource.ts": {
        abstractIdentity,
        cachedAbstract: (item) =>
          abstractCache.get(abstractIdentity(item)?.key),
        async fetchAbstract(item, options) {
          abstractRequests.push({ item, options });
          return fetchImplementation(item, options);
        },
        stopAbstractFetches() {},
      },
      "src/panes/abstractTranslation.ts": {
        translationProvider: () => ({ id: "test", label: "Test Translator" }),
        async translateAbstract(text, options) {
          translationRequests.push({ text, options });
          return translationImplementation(text, options);
        },
        stopAbstractTranslations() {},
      },
      "src/ui/icons.ts": { iconButton: () => doc.createElement("button") },
    },
  });
  const panel = harness.load("src/panes/infoSection.ts");
  panel.registerInfoSection();
  function show(id, overrides = {}) {
    let enabled = true;
    const props = {
      body: doc.createElement("div"),
      item: new Item(id, overrides),
      refreshes: 0,
      refresh() {
        props.refreshes++;
        if (enabled) section.onRender(props);
      },
      setEnabled(value) {
        enabled = value;
        props.body.getClientRects = () =>
          enabled && props.body.isConnected ? [{}] : [];
      },
    };
    props.body.attachedRoot = true;
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
  return {
    doc,
    authorMenus,
    ratingWrites,
    prefs,
    jobs,
    requests,
    authorshipCache,
    panel,
    show,
    drain,
    section,
    Item,
    logs,
    writes,
    abstractRequests,
    abstractCache,
    abstractIdentity,
    translationRequests,
    setFetchImplementation(fn) {
      fetchImplementation = fn;
    },
    setTranslationImplementation(fn) {
      translationImplementation = fn;
    },
    setAuthorshipImplementation(fn) {
      authorshipImplementation = fn;
    },
    setRatingImplementation(fn) {
      ratingImplementation = fn;
    },
  };
}

test("default item browsing sends no request and offers a manual fetch", async () => {
  const s = setup();
  const props = s.show(1);
  assert.equal(s.jobs.size, 0);
  assert.equal(s.requests.length, 0);
  const row = findRow(props.body, "info-affiliations");
  const button = row.children[1].children[0];
  await button.listeners.click();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].options.automatic, undefined);
  assert.equal(
    findClass(props.body, "zest-affiliations-fetch").disabled,
    false,
  );
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
  const row = findRow(props.body, "info-venue");
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
  const stateRow = findRow(props.body, "info-status");
  assert.equal(stateRow.children.length, 2);
  assert.equal(
    stateRow.children[1].children.length,
    2,
    "status and complete star group remain in the content cell",
  );
  assert.equal(stateRow.children[1].children[1].children.length, 5);
  const openRow = findRow(props.body, "info-open");
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

test("an empty abstract with an identifier exposes only compact manual retrieval without explanatory copy or networking", () => {
  const s = setup({ abstract: true, title: "A paper" });
  const props = s.show(1);
  const abstract = findClass(props.body, "zest-info-abstract");
  assert.ok(abstract, "missing abstracts must not remove the entire section");
  assert.ok(findClass(abstract, "zest-abstract-fetch"));
  assert.equal(findClass(abstract, "zest-info-abstract-text"), undefined);
  assert.equal(findClass(abstract, "zest-info-abstract-empty"), undefined);
  assert.equal(findClass(abstract, "zest-info-abstract-note"), undefined);
  assert.equal(findClass(abstract, "zest-abstract-translate"), undefined);
  assert.equal(abstract.textContent.includes("info-abstract-no-id"), false);
  assert.equal(s.translationRequests.length, 0);
  assert.equal(s.abstractRequests.length, 0);
  assert.equal(s.requests.length, 0);
  assert.equal(s.jobs.size, 0);
  assert.deepEqual(s.writes, []);
});

test("manual abstract retrieval replaces the single primary body without exposing stored translations or modifying item fields", async () => {
  const original = "A short local abstract.";
  const extra =
    "abstractTranslation: 背景：已有译文\n结果：保留结果\nRemark: My note";
  const s = setup({
    abstract: true,
    fields: { abstractNote: original, extra },
  });
  const record = {
    text: "Background: Retrieved full abstract.\nMethods: The complete methods.\nResults: The complete results.",
    source: "Europe PMC",
    url: "https://europepmc.org/article/MED/123456",
    fetchedAt: 1_783_900_000_000,
    doi: "10.1234/1",
  };
  s.setFetchImplementation(async (item, options) => {
    assert.equal(options.shouldContinue(), true);
    s.abstractCache.set(s.abstractIdentity(item).key, record);
    return { kind: "ok", record };
  });
  const props = s.show(1);
  const oldButton = findClass(props.body, "zest-abstract-fetch");
  await oldButton.listeners.click();
  assert.equal(s.abstractRequests.length, 1);
  assert.equal(
    oldButton.isConnected,
    false,
    "refresh discards the prior DOM tree",
  );
  const source = findClass(props.body, "zest-info-abstract-source");
  assert.ok(source?.textContent.includes("Europe PMC"));
  assert.ok(props.body.textContent.includes("The complete results."));
  assert.equal(props.body.textContent.includes("已有译文"), false);
  assert.equal(props.body.textContent.includes("保留结果"), false);
  assert.equal(props.body.textContent.includes(original), false);
  assert.equal(
    findAll(props.body, (node) =>
      node.classList?.contains("zest-info-abstract-text"),
    ).length,
    1,
  );
  assert.equal(findClass(props.body, "zest-info-abstract-original"), undefined);
  assert.equal(findClass(props.body, "zest-info-abstract-note"), undefined);
  assert.equal(s.translationRequests.length, 0);
  assert.equal(props.item.getField("abstractNote"), original);
  assert.equal(props.item.getField("extra"), extra);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("an item without abstract or usable identifier hides the abstract section, even when Extra has a translation", () => {
  const s = setup({
    abstract: true,
    fields: { DOI: "", extra: "abstractTranslation: 旧译文不应默认展示" },
  });
  const props = s.show(1);
  assert.equal(findClass(props.body, "zest-info-abstract"), undefined);
  assert.equal(props.body.textContent.includes("旧译文"), false);
  assert.equal(s.abstractRequests.length, 0);
  assert.equal(s.translationRequests.length, 0);
  assert.deepEqual(s.writes, []);
});

test("the primary abstract prefers cached online text and exposes an idle translate button without extra prose", () => {
  const s = setup({
    abstract: true,
    fields: {
      abstractNote: "Short stored abstract.",
      extra: "abstractTranslation: 已存在的中文译文",
    },
  });
  s.abstractCache.set(s.abstractIdentity(new s.Item(1)).key, {
    text: "The complete cached online abstract.",
    source: "PubMed",
    url: "https://pubmed.ncbi.nlm.nih.gov/123456/",
    fetchedAt: 1_783_900_000_000,
  });
  const props = s.show(1);
  const body = findClass(props.body, "zest-info-abstract-text");
  const button = findClass(props.body, "zest-abstract-translate");
  assert.equal(body.textContent, "The complete cached online abstract.");
  assert.equal(body.getAttribute("data-language"), "original");
  assert.equal(button.tag, "button");
  assert.equal(button.type, "button");
  assert.equal(button.textContent, "info-abstract-translate");
  assert.equal(button.disabled, false);
  assert.ok(button.title.includes("Test Translator"));
  assert.equal(
    props.body.textContent.includes("Short stored abstract."),
    false,
  );
  assert.equal(props.body.textContent.includes("已存在的中文译文"), false);
  assert.equal(findClass(props.body, "zest-info-abstract-note"), undefined);
  assert.equal(findClass(props.body, "zest-info-abstract-original"), undefined);
  assert.equal(s.translationRequests.length, 0);
  assert.equal(s.abstractRequests.length, 0);
  assert.deepEqual(s.writes, []);
});

test("translation is click-only, replaces the same abstract view, survives repaint and toggles without refetching", async () => {
  const original = "A<B and C>D remain literal; a complete original abstract.";
  const translated = "中文译文 A<B 和 C>D；保留 <b> 与 &lt; 字面文本。";
  const extra = "abstractTranslation: 其他插件的译文\nRemark: saved note";
  const s = setup({
    abstract: true,
    fields: { abstractNote: original, extra },
  });
  s.setTranslationImplementation(async (text, options) => {
    assert.equal(text, original);
    assert.equal(options.shouldContinue(), true);
    return { kind: "ok", text: translated, provider: "Test Translator" };
  });
  const props = s.show(1);
  assert.equal(s.translationRequests.length, 0);
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(s.translationRequests.length, 1);
  let body = findClass(props.body, "zest-info-abstract-text");
  assert.equal(body.getAttribute("data-language"), "translation");
  assert.equal(body.textContent, translated);
  assert.equal(
    find(body, (node) => node.tag === "b"),
    undefined,
  );
  assert.equal(
    findClass(props.body, "zest-abstract-translate").textContent,
    "info-abstract-original",
  );
  s.panel.refreshInfoSections(1);
  body = findClass(props.body, "zest-info-abstract-text");
  assert.equal(body.textContent, translated);
  assert.equal(body.getAttribute("data-language"), "translation");
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    original,
  );
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").getAttribute(
      "data-language",
    ),
    "original",
  );
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    translated,
  );
  assert.equal(s.translationRequests.length, 1);
  assert.equal(
    findAll(props.body, (node) =>
      node.classList?.contains("zest-info-abstract-text"),
    ).length,
    1,
  );
  assert.equal(props.item.getField("abstractNote"), original);
  assert.equal(props.item.getField("extra"), extra);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("a pending translation survives same-item repaint, retains the remark draft and suppresses duplicate clicks", async () => {
  const s = setup({
    abstract: true,
    fields: { abstractNote: "Original text" },
  });
  let finish;
  s.setTranslationImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = s.show(1);
  const editor = findClass(props.body, "zest-info-input");
  editor.value = "Unsaved draft survives translation";
  editor.listeners.input();
  const oldButton = findClass(props.body, "zest-abstract-translate");
  const pending = oldButton.listeners.click();
  assert.equal(s.translationRequests.length, 1);
  s.panel.refreshInfoSections(1);
  const button = findClass(props.body, "zest-abstract-translate");
  assert.equal(oldButton.isConnected, false);
  assert.equal(button.disabled, true);
  assert.equal(s.translationRequests[0].options.shouldContinue(), true);
  await button.listeners.click();
  assert.equal(s.translationRequests.length, 1);
  assert.equal(findClass(props.body, "zest-info-input").value, editor.value);
  finish({ kind: "ok", text: "译文", provider: "Test Translator" });
  await pending;
  assert.equal(
    findClass(props.body, "zest-abstract-translate").disabled,
    false,
  );
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "译文",
  );
  assert.equal(findClass(props.body, "zest-info-input").value, editor.value);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("failed translation keeps the original, gives compact feedback and permits an explicit retry", async () => {
  const s = setup({
    abstract: true,
    fields: { abstractNote: "Original text" },
  });
  const props = s.show(1);
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  const body = findClass(props.body, "zest-info-abstract-text");
  assert.equal(body.textContent, "Original text");
  assert.equal(body.getAttribute("data-language"), "original");
  assert.equal(
    findClass(props.body, "zest-abstract-translate").disabled,
    false,
  );
  assert.ok(
    findClass(findClass(props.body, "zest-info-abstract"), "zest-info-feedback")
      .textContent,
  );
  s.setTranslationImplementation(async () => ({
    kind: "ok",
    text: "重试后的译文",
    provider: "Test Translator",
  }));
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(s.translationRequests.length, 2);
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "重试后的译文",
  );
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("stored abstracts without identifiers still support user-initiated translation without offering retrieval", async () => {
  const s = setup({
    abstract: true,
    fields: { DOI: "", abstractNote: "Locally stored abstract." },
  });
  s.setTranslationImplementation(async () => ({
    kind: "ok",
    text: "本地摘要的译文。",
    provider: "Test Translator",
  }));
  const props = s.show(1);
  assert.equal(findClass(props.body, "zest-abstract-fetch"), undefined);
  assert.equal(s.translationRequests.length, 0);
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(s.translationRequests.length, 1);
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "本地摘要的译文。",
  );
  assert.deepEqual(s.writes, []);
});

test("a long translated abstract retains complete text and the expansion choice across repaint and language toggles", async () => {
  const original = "A complete original abstract sentence. ".repeat(40);
  const translated = "完整译文保留所有内容，包括研究方法和结果。".repeat(60);
  assert.ok(original.length > 900 && translated.length > 900);
  const s = setup({ abstract: true, fields: { abstractNote: original } });
  s.setTranslationImplementation(async () => ({
    kind: "ok",
    text: translated,
    provider: "Test Translator",
  }));
  const props = s.show(1);
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.ok(findClass(props.body, "zest-info-abstract-preview"));
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    translated,
  );
  findClass(props.body, "zest-info-abstract-expand").listeners.click();
  s.panel.refreshInfoSections(1);
  assert.equal(findClass(props.body, "zest-info-abstract-preview"), undefined);
  assert.equal(
    findClass(props.body, "zest-info-abstract-expand").getAttribute(
      "aria-expanded",
    ),
    "true",
  );
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    original.trim(),
  );
  assert.equal(findClass(props.body, "zest-info-abstract-preview"), undefined);
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    translated,
  );
  assert.equal(findClass(props.body, "zest-info-abstract-preview"), undefined);
  assert.equal(s.translationRequests.length, 1);
  assert.deepEqual(s.writes, []);
});

test("an unexpected provider exception never exposes raw text or credentials and leaves translation retryable", async () => {
  const s = setup({
    abstract: true,
    fields: { abstractNote: "Original text" },
  });
  s.setTranslationImplementation(async () => {
    throw new Error("private-provider-key and raw payload");
  });
  const props = s.show(1);
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "Original text",
  );
  assert.equal(
    findClass(props.body, "zest-abstract-translate").disabled,
    false,
  );
  assert.equal(props.body.textContent.includes("private-provider-key"), false);
  assert.equal(props.body.textContent.includes("raw payload"), false);
  assert.deepEqual(s.logs, []);
  assert.deepEqual(s.writes, []);
});

test("a cancelled hidden translation clears its busy state before the panel is shown again", async () => {
  const s = setup({
    abstract: true,
    fields: { abstractNote: "Original text" },
  });
  let finish;
  s.setTranslationImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = s.show(1);
  const pending = findClass(
    props.body,
    "zest-abstract-translate",
  ).listeners.click();
  props.body.getClientRects = () => [];
  const refreshes = props.refreshes;
  finish({ kind: "cancelled" });
  await pending;
  assert.equal(props.refreshes, refreshes);
  props.body.getClientRects = () => [{}];
  s.panel.refreshInfoSections(1);
  assert.equal(
    findClass(props.body, "zest-abstract-translate").disabled,
    false,
  );
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "Original text",
  );
  assert.deepEqual(s.logs, []);
});

test("a newly retrieved primary abstract invalidates a translation made from the shorter stored text", async () => {
  const s = setup({
    abstract: true,
    fields: { abstractNote: "Short local text" },
  });
  s.setTranslationImplementation(async () => ({
    kind: "ok",
    text: "旧短文译文",
    provider: "Test Translator",
  }));
  const props = s.show(1);
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "旧短文译文",
  );
  s.abstractCache.set(s.abstractIdentity(props.item).key, {
    text: "Complete online abstract",
    source: "PubMed",
    url: "https://pubmed.ncbi.nlm.nih.gov/123456/",
    fetchedAt: 1_783_900_000_000,
  });
  s.panel.refreshInfoSections(1);
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "Complete online abstract",
  );
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").getAttribute(
      "data-language",
    ),
    "original",
  );
  assert.equal(props.body.textContent.includes("旧短文译文"), false);
  s.setTranslationImplementation(async (text) => ({
    kind: "ok",
    text: `新译文 ${text}`,
    provider: "Test Translator",
  }));
  await findClass(props.body, "zest-abstract-translate").listeners.click();
  assert.equal(s.translationRequests.length, 2);
  assert.equal(s.translationRequests[1].text, "Complete online abstract");
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "新译文 Complete online abstract",
  );
  assert.deepEqual(s.writes, []);
});

for (const reason of [
  "item change",
  "DOI change",
  "primary text change",
  "panel hidden",
  "panel destruction",
  "preference disabled",
]) {
  test(`late translation results are ignored after ${reason}`, async () => {
    const s = setup({
      abstract: true,
      fields: { abstractNote: "Original text" },
    });
    let finish;
    s.setTranslationImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props = s.show(1);
    const pending = findClass(
      props.body,
      "zest-abstract-translate",
    ).listeners.click();
    const valid = s.translationRequests[0].options.shouldContinue;
    assert.equal(valid(), true);
    if (reason === "item change") {
      props.item = new s.Item(2);
      s.section.onItemChange(props);
      s.section.onRender(props);
    } else if (reason === "DOI change") {
      props.item.fields.DOI = "10.1234/replaced";
      s.panel.refreshInfoSections(1);
    } else if (reason === "primary text change") {
      props.item.fields.abstractNote = "Replacement original text";
      s.panel.refreshInfoSections(1);
    } else if (reason === "panel hidden") {
      props.body.getClientRects = () => [];
    } else if (reason === "panel destruction") {
      s.section.onDestroy(props);
    } else {
      s.prefs.set("info.abstract", false);
      s.panel.refreshInfoSections(1);
    }
    assert.equal(valid(), false);
    const refreshes = props.refreshes;
    finish({
      kind: "ok",
      text: "Stale translation",
      provider: "Test Translator",
    });
    await pending;
    assert.equal(props.refreshes, refreshes);
    assert.equal(props.body.textContent.includes("Stale translation"), false);
    assert.deepEqual(s.writes, []);
    assert.deepEqual(s.logs, []);
  });
}

test("rapidly disabling and reenabling abstracts invalidates the old translation without clearing a new request", async () => {
  const s = setup({
    abstract: true,
    fields: { abstractNote: "Original text" },
  });
  const completions = [];
  s.setTranslationImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  const props = s.show(1);
  const first = findClass(
    props.body,
    "zest-abstract-translate",
  ).listeners.click();
  s.prefs.set("info.abstract", false);
  s.panel.refreshInfoSections(1);
  s.prefs.set("info.abstract", true);
  s.panel.refreshInfoSections(1);
  assert.equal(s.translationRequests[0].options.shouldContinue(), false);
  const second = findClass(
    props.body,
    "zest-abstract-translate",
  ).listeners.click();
  assert.equal(s.translationRequests[1].options.shouldContinue(), true);
  completions[0]({
    kind: "ok",
    text: "Old stale translation",
    provider: "Test Translator",
  });
  await first;
  assert.equal(findClass(props.body, "zest-abstract-translate").disabled, true);
  assert.equal(props.body.textContent.includes("Old stale translation"), false);
  completions[1]({
    kind: "ok",
    text: "Current translation",
    provider: "Test Translator",
  });
  await second;
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    "Current translation",
  );
  assert.equal(
    findClass(props.body, "zest-abstract-translate").disabled,
    false,
  );
  assert.deepEqual(s.logs, []);
});

for (const reason of [
  "item change",
  "panel destruction",
  "DOI change",
  "panel hidden",
]) {
  test(`late abstract responses do not refresh after ${reason}`, async () => {
    const s = setup({ abstract: true });
    let finish;
    s.setFetchImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props = s.show(1);
    const pending = findClass(
      props.body,
      "zest-abstract-fetch",
    ).listeners.click();
    assert.equal(s.abstractRequests.length, 1);
    const valid = s.abstractRequests[0].options.shouldContinue;
    assert.equal(valid(), true);
    if (reason === "item change") {
      props.item = new s.Item(2);
      s.section.onItemChange(props);
      s.section.onRender(props);
    } else if (reason === "panel destruction") {
      s.section.onDestroy(props);
    } else if (reason === "panel hidden") {
      props.body.getClientRects = () => [];
    } else {
      props.item.fields.DOI = "10.1234/replaced";
      s.section.onItemChange(props);
      s.section.onRender(props);
    }
    assert.equal(valid(), false);
    const refreshes = props.refreshes;
    finish({ kind: "ok", record: { text: "Stale result", source: "PubMed" } });
    await pending;
    assert.equal(props.refreshes, refreshes);
    assert.equal(props.body.textContent.includes("Stale result"), false);
    assert.deepEqual(s.writes, []);
    assert.deepEqual(s.logs, []);
  });
}

test("an unrelated same-item repaint keeps a pending abstract request and blocks duplicate clicks", async () => {
  const s = setup({ abstract: true });
  let finish;
  const record = {
    text: "The requested abstract survives an unrelated reading-state repaint.",
    source: "PubMed",
    url: "https://pubmed.ncbi.nlm.nih.gov/123456/",
    fetchedAt: 1_783_900_000_000,
  };
  s.setFetchImplementation(
    (item) =>
      new Promise((resolve) => {
        finish = () => {
          s.abstractCache.set(s.abstractIdentity(item).key, record);
          resolve({ kind: "ok", record });
        };
      }),
  );
  const props = s.show(1);
  const oldButton = findClass(props.body, "zest-abstract-fetch");
  const pending = oldButton.listeners.click();
  s.panel.refreshInfoSections(1);
  assert.equal(oldButton.isConnected, false);
  assert.equal(s.abstractRequests[0].options.shouldContinue(), true);
  const newButton = findClass(props.body, "zest-abstract-fetch");
  assert.equal(newButton.disabled, true);
  await newButton.listeners.click();
  assert.equal(s.abstractRequests.length, 1);
  finish();
  await pending;
  assert.ok(props.body.textContent.includes(record.text));
  assert.ok(
    findClass(props.body, "zest-info-abstract-source")?.textContent.includes(
      "PubMed",
    ),
  );
  assert.deepEqual(s.logs, []);
});

test("cancelling a hidden panel request leaves the fetch button usable when shown again", async () => {
  const s = setup({ abstract: true });
  let finish;
  s.setFetchImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = s.show(1);
  const pending = findClass(
    props.body,
    "zest-abstract-fetch",
  ).listeners.click();
  props.body.getClientRects = () => [];
  const refreshes = props.refreshes;
  finish({ kind: "cancelled" });
  await pending;
  assert.equal(
    props.refreshes,
    refreshes,
    "hidden sections should not repaint",
  );
  props.body.getClientRects = () => [{}];
  s.panel.refreshInfoSections(1);
  assert.equal(findClass(props.body, "zest-abstract-fetch").disabled, false);
  assert.deepEqual(s.logs, []);
});

test("leaving and returning to an item does not revive its previous request or clear the new request", async () => {
  const s = setup({ abstract: true });
  const completions = [];
  s.setFetchImplementation(
    () =>
      new Promise((resolve) => {
        completions.push(resolve);
      }),
  );
  const props = s.show(1);
  const old = findClass(props.body, "zest-abstract-fetch").listeners.click();
  props.item = new s.Item(2);
  s.section.onItemChange(props);
  s.section.onRender(props);
  props.item = new s.Item(1);
  s.section.onItemChange(props);
  s.section.onRender(props);
  const current = findClass(
    props.body,
    "zest-abstract-fetch",
  ).listeners.click();
  assert.equal(s.abstractRequests.length, 2);
  assert.equal(s.abstractRequests[0].options.shouldContinue(), false);
  assert.equal(s.abstractRequests[1].options.shouldContinue(), true);
  const refreshes = props.refreshes;
  completions[0]({ kind: "cancelled" });
  await old;
  assert.equal(props.refreshes, refreshes);
  assert.equal(findClass(props.body, "zest-abstract-fetch").disabled, true);
  completions[1]({ kind: "missing" });
  await current;
  assert.equal(findClass(props.body, "zest-abstract-fetch").disabled, false);
  assert.deepEqual(s.logs, []);
});

test("same-item refresh preserves the only abstract disclosure without adding an Extra translation view", () => {
  const s = setup({
    abstract: true,
    fields: {
      abstractNote: "Original abstract",
      extra: "abstractTranslation: 已有译文",
    },
  });
  const props = s.show(1);
  const abstract = findClass(props.body, "zest-info-abstract");
  assert.ok(abstract?.listeners.toggle);
  abstract.open = false;
  abstract.listeners.toggle();
  s.panel.refreshInfoSections(1);
  assert.equal(findClass(props.body, "zest-info-abstract").open, false);
  assert.equal(findClass(props.body, "zest-info-abstract-original"), undefined);
  assert.equal(props.body.textContent.includes("已有译文"), false);
  assert.equal(abstract.isConnected, false);
  assert.deepEqual(s.logs, []);
});

test("bibliography, abstract, reading workspace and outbound links remain in reading order", () => {
  const s = setup({ abstract: true, title: "A study", venue: "A Journal" });
  const props = s.show(1);
  const bibliography = findClass(props.body, "zest-info-bibliography");
  const abstract = findClass(props.body, "zest-info-abstract");
  const workspace = findClass(props.body, "zest-info-workspace");
  const links = findClass(props.body, "zest-info-open");
  assert.ok(bibliography && abstract && workspace && links);
  assert.ok(findRow(bibliography, "info-title"));
  assert.ok(findRow(bibliography, "info-venue"));
  assert.ok(findRow(bibliography, "info-citations"));
  assert.ok(findRow(workspace, "info-reading"));
  assert.ok(findRow(workspace, "info-status"));
  assert.equal(findClass(workspace, "zest-info-input").tag, "textarea");
  const indexes = [bibliography, abstract, workspace, links].map((node) =>
    props.body.children.indexOf(node),
  );
  assert.ok(
    indexes.every((index, i) => index >= 0 && (!i || index > indexes[i - 1])),
  );
});

for (const primarySource of ["stored", "online"]) {
  test(`long ${primarySource} abstracts preview without removing full text and can expand or collapse`, () => {
    const fullText =
      "A complete abstract sentence remains in the document. ".repeat(24) +
      "完整结尾 P<0.001.";
    assert.ok(fullText.length > 900);
    const s = setup({
      abstract: true,
      fields: primarySource === "stored" ? { abstractNote: fullText } : {},
    });
    if (primarySource === "online") {
      s.abstractCache.set(s.abstractIdentity(new s.Item(1)).key, {
        text: fullText,
        source: "Europe PMC",
        url: "https://europepmc.org/article/MED/123456",
        fetchedAt: 1_783_900_000_000,
      });
    }
    const props = s.show(1);
    const content = findClass(props.body, "zest-info-abstract-text");
    const expand = findClass(props.body, "zest-info-abstract-expand");
    assert.equal(findClass(props.body, "zest-info-abstract-preview"), content);
    assert.equal(
      content.textContent,
      fullText,
      "preview must retain the full abstract in the DOM",
    );
    assert.equal(expand.type, "button");
    assert.equal(expand.textContent, "info-abstract-read-all");
    assert.equal(expand.getAttribute("aria-expanded"), "false");
    expand.listeners.click();
    assert.equal(
      findClass(props.body, "zest-info-abstract-preview"),
      undefined,
    );
    assert.equal(content.textContent, fullText);
    assert.equal(expand.textContent, "info-collapse");
    assert.equal(expand.getAttribute("aria-expanded"), "true");
    expand.listeners.click();
    assert.equal(findClass(props.body, "zest-info-abstract-preview"), content);
    assert.equal(content.textContent, fullText);
    assert.equal(expand.textContent, "info-abstract-read-all");
    assert.equal(expand.getAttribute("aria-expanded"), "false");
    assert.deepEqual(s.writes, []);
    assert.equal(s.abstractRequests.length, 0);
    assert.deepEqual(s.logs, []);
  });
}

test("the abstract preview threshold is strictly greater than 900 characters", () => {
  const s = setup({ abstract: true });
  const short = s.show(1, { abstractNote: "x".repeat(900) });
  assert.equal(findClass(short.body, "zest-info-abstract-preview"), undefined);
  assert.equal(findClass(short.body, "zest-info-abstract-expand"), undefined);
  assert.equal(
    findClass(short.body, "zest-info-abstract-text").textContent.length,
    900,
  );
  const long = s.show(2, { abstractNote: "x".repeat(901) });
  assert.ok(findClass(long.body, "zest-info-abstract-preview"));
  assert.ok(findClass(long.body, "zest-info-abstract-expand"));
  assert.equal(
    findClass(long.body, "zest-info-abstract-text").textContent.length,
    901,
  );
});

test("expanded abstract previews survive same-item refresh and reset after changing items", () => {
  const fullText =
    "The full abstract remains available after a reading-state update. "
      .repeat(20)
      .trim();
  const s = setup({ abstract: true, fields: { abstractNote: fullText } });
  const props = s.show(1);
  const expand = findClass(props.body, "zest-info-abstract-expand");
  expand.listeners.click();
  s.section.onItemChange(props);
  s.panel.refreshInfoSections(1);
  assert.equal(expand.isConnected, false);
  assert.equal(findClass(props.body, "zest-info-abstract-preview"), undefined);
  assert.equal(
    findClass(props.body, "zest-info-abstract-expand").textContent,
    "info-collapse",
  );
  assert.equal(
    findClass(props.body, "zest-info-abstract-expand").getAttribute(
      "aria-expanded",
    ),
    "true",
  );
  assert.equal(
    findClass(props.body, "zest-info-abstract-text").textContent,
    fullText,
  );
  for (const itemID of [2, 1]) {
    props.item = new s.Item(itemID);
    s.section.onItemChange(props);
    s.section.onRender(props);
    assert.ok(findClass(props.body, "zest-info-abstract-preview"));
    assert.equal(
      findClass(props.body, "zest-info-abstract-expand").getAttribute(
        "aria-expanded",
      ),
      "false",
    );
    assert.equal(
      findClass(props.body, "zest-info-abstract-text").textContent,
      fullText,
    );
  }
  assert.deepEqual(s.logs, []);
});

test("multiline textarea remarks stay on one Extra line and cannot inject another field", async () => {
  const extra =
    "Rating: 2\r\nRemark: old note\r\nCustom_Field: leave unchanged\r\n";
  const s = setup({ fields: { extra } });
  const props = s.show(1);
  const input = findClass(props.body, "zest-info-input");
  assert.equal(input.value, "old note");
  input.value =
    "Methods: first line\r\nRating: 5\rPMID: 999999\nRead_Status: read";
  await input.listeners.change();
  const expected =
    "Methods: first line Rating: 5 PMID: 999999 Read_Status: read";
  assert.equal(input.value, expected);
  assert.equal(
    props.item.getField("extra"),
    `Rating: 2\r\nRemark: ${expected}\r\nCustom_Field: leave unchanged\r\n`,
  );
  assert.equal(s.writes.filter((write) => write.key === "extra").length, 1);
  assert.equal(s.writes.filter((write) => write.save).length, 1);
  assert.deepEqual(s.logs, []);
});

test("naturally wrapped textarea remarks preserve their single-line text and punctuation", async () => {
  const extra = "UserNote: preserve this\nRemark: original\nRating: 3";
  const note =
    "KEYNOTE-671: This is a long reading note with punctuation, a hazard ratio of 0.58, and a comparison: treatment versus control. "
      .repeat(4)
      .trim();
  const s = setup({ fields: { extra } });
  const props = s.show(1);
  const input = findClass(props.body, "zest-info-input");
  input.value = note;
  await input.listeners.change();
  assert.equal(input.value, note);
  assert.equal(
    props.item.getField("extra"),
    `UserNote: preserve this\nRemark: ${note}\nRating: 3`,
  );
  const writes = s.writes.length;
  await input.listeners.change();
  assert.equal(
    s.writes.length,
    writes,
    "an unchanged note must not write or save again",
  );
  assert.deepEqual(s.logs, []);
});

test("cached plain-text abstracts preserve literal tags, entities and comparison symbols without parsing them again", () => {
  const s = setup({ abstract: true });
  const text =
    "A<B and C>D are literal comparison symbols; literal <b> and &lt; must remain exactly as provided in the cached plain text.";
  s.abstractCache.set(s.abstractIdentity(new s.Item(1)).key, {
    text,
    source: "Europe PMC",
    url: "https://europepmc.org/article/MED/123456",
    fetchedAt: 1_783_900_000_000,
  });
  const props = s.show(1);
  const content = findClass(props.body, "zest-info-abstract-text");
  assert.equal(content.textContent, text);
  assert.equal(
    find(content, (node) => node.tag === "b"),
    undefined,
  );
  assert.ok(content.textContent.includes("A<B and C>D"));
  assert.ok(content.textContent.includes("literal <b> and &lt;"));
  assert.equal(s.abstractRequests.length, 0);
  assert.equal(s.requests.length, 0);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("unsaved remark input survives same-item refresh without being written or leaking to another item", () => {
  const s = setup({ fields: { extra: "Remark: saved note" } });
  const props = s.show(1);
  const input = findClass(props.body, "zest-info-input");
  assert.equal(typeof input.listeners.input, "function");
  input.value = "A draft still being edited: do not lose this.";
  input.listeners.input();
  s.panel.refreshInfoSections(1);
  assert.equal(findClass(props.body, "zest-info-input").value, input.value);
  assert.equal(props.item.getField("extra"), "Remark: saved note");
  assert.deepEqual(s.writes, []);
  props.item = new s.Item(2, { extra: "Remark: another item's note" });
  s.section.onItemChange(props);
  s.section.onRender(props);
  assert.equal(
    findClass(props.body, "zest-info-input").value,
    "another item's note",
  );
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("pending affiliation retrieval survives a same-item repaint and keeps replacement buttons busy", async () => {
  const s = setup();
  let finish;
  s.setAuthorshipImplementation(
    (items) =>
      new Promise((resolve) => {
        finish = () => {
          s.authorshipCache.set(items[0].id, [
            { i: "A123", n: "A Researcher", a: "A Newly Retrieved Institute" },
          ]);
          resolve(true);
        };
      }),
  );
  const props = s.show(1);
  const old = findClass(props.body, "zest-affiliations-fetch");
  const pending = old.listeners.click();
  assert.equal(s.requests.length, 1);
  s.panel.refreshInfoSections(1);
  assert.equal(old.isConnected, false);
  assert.equal(s.requests[0].options.shouldContinue(), true);
  const button = findClass(props.body, "zest-affiliations-fetch");
  assert.equal(button.disabled, true);
  await button.listeners.click();
  assert.equal(s.requests.length, 1);
  finish();
  await pending;
  assert.ok(props.body.textContent.includes("A Newly Retrieved Institute"));
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

for (const reason of ["item change", "DOI change", "panel destruction"]) {
  test(`affiliation requests reject stale results after ${reason}`, async () => {
    const s = setup();
    let finish;
    s.setAuthorshipImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const props = s.show(1);
    const pending = findClass(
      props.body,
      "zest-affiliations-fetch",
    ).listeners.click();
    assert.equal(s.requests[0].options.shouldContinue(), true);
    if (reason === "panel destruction") {
      s.section.onDestroy(props);
    } else if (reason === "DOI change") {
      // Identity checks must reject a late body even before Zotero repaints.
      props.item.fields.DOI = "10.1234/replaced";
    } else {
      props.item = new s.Item(2);
      s.section.onItemChange(props);
      s.section.onRender(props);
    }
    assert.equal(s.requests[0].options.shouldContinue(), false);
    const refreshes = props.refreshes;
    finish(true);
    await pending;
    assert.equal(props.refreshes, refreshes);
    assert.deepEqual(s.logs, []);
  });
}

test("a cancelled hidden affiliation lookup becomes usable when its panel is shown again", async () => {
  const s = setup();
  let finish;
  s.setAuthorshipImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = s.show(1);
  const pending = findClass(
    props.body,
    "zest-affiliations-fetch",
  ).listeners.click();
  props.body.getClientRects = () => [];
  assert.equal(s.requests[0].options.shouldContinue(), false);
  const refreshes = props.refreshes;
  finish(false);
  await pending;
  assert.equal(props.refreshes, refreshes);
  props.body.getClientRects = () => [{}];
  s.panel.refreshInfoSections(1);
  assert.equal(
    findClass(props.body, "zest-affiliations-fetch").disabled,
    false,
  );
  assert.deepEqual(s.logs, []);
});

test("turning off the abstract preference cancels pending source work and restores the control when reenabled", async () => {
  const s = setup({ abstract: true });
  let finish;
  s.setFetchImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const props = s.show(1);
  const pending = findClass(
    props.body,
    "zest-abstract-fetch",
  ).listeners.click();
  s.prefs.set("info.abstract", false);
  s.panel.refreshInfoSections();
  assert.equal(findClass(props.body, "zest-info-abstract"), undefined);
  assert.equal(s.abstractRequests[0].options.shouldContinue(), false);
  const refreshes = props.refreshes;
  finish({ kind: "cancelled" });
  await pending;
  assert.equal(props.refreshes, refreshes);
  s.prefs.set("info.abstract", true);
  s.panel.refreshInfoSections();
  assert.equal(findClass(props.body, "zest-abstract-fetch").disabled, false);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("an old affiliation response cannot revive after leaving and returning or clear a newer request", async () => {
  const s = setup();
  const completions = [];
  s.setAuthorshipImplementation(
    () =>
      new Promise((resolve) => {
        completions.push(resolve);
      }),
  );
  const props = s.show(1);
  const first = findClass(
    props.body,
    "zest-affiliations-fetch",
  ).listeners.click();
  props.item = new s.Item(2);
  s.section.onItemChange(props);
  s.section.onRender(props);
  props.item = new s.Item(1);
  s.section.onItemChange(props);
  s.section.onRender(props);
  const second = findClass(
    props.body,
    "zest-affiliations-fetch",
  ).listeners.click();
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[0].options.shouldContinue(), false);
  assert.equal(s.requests[1].options.shouldContinue(), true);
  const refreshes = props.refreshes;
  completions[0](true);
  await first;
  assert.equal(props.refreshes, refreshes);
  assert.equal(findClass(props.body, "zest-affiliations-fetch").disabled, true);
  completions[1](false);
  await second;
  assert.equal(
    findClass(props.body, "zest-affiliations-fetch").disabled,
    false,
  );
  assert.deepEqual(s.logs, []);
});

test("an automatic affiliation miss does not schedule a repeating fetch and repaint loop", async () => {
  const s = setup();
  s.prefs.set("info.affiliations.autoFetch", true);
  s.show(1);
  assert.equal(s.jobs.size, 1);
  s.drain();
  await new Promise((resolve) => require("node:timers").setImmediate(resolve));
  assert.equal(s.requests.length, 1);
  assert.equal(s.jobs.size, 0);
  s.panel.refreshInfoSections(1);
  assert.equal(s.jobs.size, 0);
  assert.equal(s.requests.length, 1);
  assert.deepEqual(s.logs, []);
});

test("disabling and immediately reenabling abstracts cannot revive an old request or clear a new one", async () => {
  const s = setup({ abstract: true });
  const completions = [];
  s.setFetchImplementation(
    () => new Promise((resolve) => completions.push(resolve)),
  );
  const props = s.show(1);
  const first = findClass(props.body, "zest-abstract-fetch").listeners.click();
  s.prefs.set("info.abstract", false);
  s.panel.refreshInfoSections();
  s.prefs.set("info.abstract", true);
  s.panel.refreshInfoSections();
  assert.equal(s.abstractRequests[0].options.shouldContinue(), false);
  assert.equal(findClass(props.body, "zest-abstract-fetch").disabled, false);
  const second = findClass(props.body, "zest-abstract-fetch").listeners.click();
  assert.equal(s.abstractRequests.length, 2);
  assert.equal(s.abstractRequests[1].options.shouldContinue(), true);
  const refreshes = props.refreshes;
  completions[0]({ kind: "missing" });
  await first;
  assert.equal(props.refreshes, refreshes);
  assert.equal(findClass(props.body, "zest-abstract-fetch").disabled, true);
  const abstract = findClass(props.body, "zest-info-abstract");
  assert.equal(findClass(abstract, "zest-info-feedback").textContent, "");
  completions[1]({ kind: "missing" });
  await second;
  assert.equal(findClass(props.body, "zest-abstract-fetch").disabled, false);
  assert.equal(
    findClass(findClass(props.body, "zest-info-abstract"), "zest-info-feedback")
      .textContent,
    "info-abstract-missing",
  );
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("remark focus and selection survive a same-item repaint without stealing focus on other updates", () => {
  const s = setup({ fields: { extra: "Remark: saved note" } });
  const props = s.show(1);
  const input = findClass(props.body, "zest-info-input");
  assert.equal(input.getAttribute("aria-label"), "column-remark");
  input.value = "The draft is still being edited.";
  input.listeners.input();
  input.focus();
  input.setSelectionRange(4, 9, "backward");
  s.panel.refreshInfoSections(1);
  const replacement = findClass(props.body, "zest-info-input");
  assert.notEqual(replacement, input);
  assert.equal(s.doc.activeElement, replacement);
  assert.equal(replacement.value, input.value);
  assert.deepEqual(
    [
      replacement.selectionStart,
      replacement.selectionEnd,
      replacement.selectionDirection,
    ],
    [4, 9, "backward"],
  );
  const otherControl = findClass(props.body, "zest-info-status");
  otherControl.focus();
  s.panel.refreshInfoSections(1);
  assert.notEqual(
    s.doc.activeElement,
    findClass(props.body, "zest-info-input"),
  );
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("a failed remark save retains its draft and error, then retries the same value successfully", async () => {
  const original = "Rating: 2\nRemark: saved note\nCustom_Field: unchanged";
  const s = setup({ fields: { extra: original } });
  const props = s.show(1);
  let attempts = 0;
  let persisted = original;
  props.item.saveTx = async () => {
    attempts++;
    if (attempts === 1) throw new Error("intentional test persistence failure");
    persisted = props.item.getField("extra");
  };
  const input = findClass(props.body, "zest-info-input");
  input.value = "Revised reading note: preserve this draft.";
  input.listeners.input();
  await input.listeners.change();
  assert.equal(attempts, 1);
  assert.equal(persisted, original);
  assert.equal(props.item.getField("extra"), original);
  let feedback = findClass(props.body, "zest-info-remark-feedback");
  assert.equal(feedback.getAttribute("role"), "status");
  assert.equal(feedback.textContent, "info-remark-save-failed");
  s.panel.refreshInfoSections(1);
  const retry = findClass(props.body, "zest-info-input");
  assert.equal(retry.value, input.value);
  feedback = findClass(props.body, "zest-info-remark-feedback");
  assert.equal(feedback.textContent, "info-remark-save-failed");
  await retry.listeners.change();
  assert.equal(
    attempts,
    2,
    "an unchanged draft still needs a second persistence attempt",
  );
  assert.equal(
    persisted,
    `Rating: 2\nRemark: ${input.value}\nCustom_Field: unchanged`,
  );
  assert.equal(feedback.textContent, "");
  s.panel.refreshInfoSections(1);
  assert.equal(findClass(props.body, "zest-info-input").value, input.value);
  assert.equal(
    findClass(props.body, "zest-info-remark-feedback").textContent,
    "",
  );
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0][0], "[info] remark save failed");
});

function authorPartsFor(count) {
  return Array.from({ length: count }, (_, i) => [
    ...(i ? [{ text: "; " }] : []),
    {
      text: `Researcher ${i + 1}`,
      creator: { family: `Researcher${i + 1}`, given: "A" },
    },
  ]).flat();
}

test("native author buttons anchor keyboard clicks to the author and preserve pointer coordinates", () => {
  const s = setup({ authorParts: authorPartsFor(1) });
  const props = s.show(1);
  const author = findClass(props.body, "zest-info-author");
  assert.equal(author.tag, "button");
  assert.equal(author.type, "button");
  assert.equal(author.textContent, "Researcher 1");
  let stopped = 0;
  author.listeners.click({
    detail: 0,
    screenX: 0,
    screenY: 0,
    stopPropagation: () => stopped++,
  });
  assert.equal(stopped, 1);
  assert.equal(s.authorMenus.length, 1);
  const [win, ref, point] = s.authorMenus[0];
  assert.equal(win, s.doc.defaultView);
  assert.equal(ref.family, "Researcher1");
  assert.equal(ref.given, "A");
  assert.equal(ref.label, "Researcher 1");
  assert.equal(point.screenX, 112);
  assert.equal(point.screenY, 238);
  author.listeners.click({
    detail: 1,
    screenX: 503,
    screenY: 607,
    stopPropagation: () => stopped++,
  });
  assert.equal(stopped, 2);
  assert.equal(s.authorMenus[1][2].screenX, 503);
  assert.equal(s.authorMenus[1][2].screenY, 607);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("only the first and verified corresponding authors and their distinct institutions are initially visible, with expansion remembered per item", () => {
  const s = setup({
    title: "Article title",
    venue: "A Journal",
    authorParts: authorPartsFor(6),
  });
  const institutions = [
    "University One, Department of Thoracic Oncology",
    "University Two, Research Center",
    "University Three, Clinical Trials Unit",
    "University Four, Medical School",
  ];
  const rows = Array.from({ length: 6 }, (_, i) => {
    const institution = [0, 1, 3, 1, 2, 0][i];
    return {
      i: `A${i + 1}`,
      n: `A Researcher${i + 1}`,
      v: 2,
      c: i === 4,
      p: i === 0 ? "first" : i === 5 ? "last" : "middle",
      af: [{ i: `I${institution}`, n: institutions[institution] }],
      a: institutions[institution],
    };
  });
  s.authorshipCache.set(1, rows);
  s.authorshipCache.set(2, rows);
  const props = s.show(1);
  const bibliography = findClass(props.body, "zest-info-bibliography");
  assert.equal(bibliography.children[0], findRow(props.body, "info-title"));
  assert.equal(
    bibliography.children[1],
    findClass(props.body, "zest-info-source"),
  );
  assert.equal(
    findRow(props.body, "info-venue").parentNode,
    bibliography.children[1],
  );
  const authorRow = findRow(props.body, "info-authors");
  const authors = authorRow.children[1].children;
  assert.equal(authors.length, 6);
  assert.deepEqual(
    authors.map((entry) => entry.hidden),
    [false, true, true, true, false, true],
  );
  assert.deepEqual(
    authors.map((entry) => findClass(entry, "zest-info-author").textContent),
    Array.from({ length: 6 }, (_, i) => `Researcher ${i + 1}`),
  );
  assert.equal(
    findClass(authors[0], "zest-info-author-role").textContent,
    "info-author-first",
  );
  assert.equal(
    findClass(authors[4], "zest-info-author-role").textContent,
    "info-author-corresponding",
  );
  assert.equal(
    findClass(authors[5], "zest-info-author-role"),
    undefined,
    "the last author is not presumed to be corresponding",
  );
  let authorToggle = findClass(authorRow, "zest-info-metadata-toggle");
  assert.equal(authorToggle.tag, "button");
  assert.equal(authorToggle.textContent, "info-authors-all 6");
  assert.equal(authorToggle.getAttribute("aria-expanded"), "false");
  const institutionRow = findRow(props.body, "info-affiliations");
  const list = findClass(institutionRow, "zest-info-institutions");
  assert.equal(list.tag, "ul");
  assert.equal(
    list.children.length,
    4,
    "duplicate affiliations share one complete list entry",
  );
  assert.deepEqual(
    list.children.map((entry) => entry.tag),
    ["li", "li", "li", "li"],
  );
  assert.deepEqual(
    list.children.map(institutionName).sort(),
    [...institutions].sort(),
  );
  assert.deepEqual(
    list.children
      .filter((entry) => !entry.hidden)
      .map(institutionName)
      .sort(),
    [institutions[0], institutions[2]].sort(),
  );
  const firstInstitution = list.children.find(
    (entry) => institutionName(entry) === institutions[0],
  );
  const correspondingInstitution = list.children.find(
    (entry) => institutionName(entry) === institutions[2],
  );
  const otherInstitution = list.children.find(
    (entry) => institutionName(entry) === institutions[1],
  );
  assert.deepEqual(institutionRoles(firstInstitution), [
    "info-affiliation-first",
  ]);
  assert.deepEqual(institutionRoles(correspondingInstitution), [
    "info-affiliation-corresponding",
  ]);
  assert.deepEqual(institutionRoles(otherInstitution), []);
  assert.ok(firstInstitution.title.includes("A Researcher1"));
  assert.ok(correspondingInstitution.title.includes("A Researcher5"));
  let institutionToggle = findClass(
    institutionRow,
    "zest-info-metadata-toggle",
  );
  assert.equal(institutionToggle.textContent, "info-affiliations-all 4");
  authorToggle.listeners.click();
  institutionToggle.listeners.click();
  assert.ok(authors.every((entry) => !entry.hidden));
  assert.ok(list.children.every((entry) => !entry.hidden));
  assert.deepEqual(institutionRoles(firstInstitution), [
    "info-affiliation-first",
  ]);
  assert.deepEqual(institutionRoles(correspondingInstitution), [
    "info-affiliation-corresponding",
  ]);
  assert.deepEqual(
    institutionRoles(otherInstitution),
    [],
    "expansion must not invent role attribution for other institutions",
  );
  s.panel.refreshInfoSections(1);
  authorToggle = findClass(
    findRow(props.body, "info-authors"),
    "zest-info-metadata-toggle",
  );
  institutionToggle = findClass(
    findRow(props.body, "info-affiliations"),
    "zest-info-metadata-toggle",
  );
  assert.equal(authorToggle.getAttribute("aria-expanded"), "true");
  assert.equal(institutionToggle.getAttribute("aria-expanded"), "true");
  assert.equal(authorToggle.textContent, "info-collapse");
  props.item = new s.Item(2);
  s.section.onItemChange(props);
  s.section.onRender(props);
  assert.equal(
    findClass(
      findRow(props.body, "info-authors"),
      "zest-info-metadata-toggle",
    ).getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(
    findClass(
      findRow(props.body, "info-affiliations"),
      "zest-info-metadata-toggle",
    ).getAttribute("aria-expanded"),
    "false",
  );
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});

test("short lists still fold non-core authors and institutions instead of using a fixed count threshold", () => {
  const s = setup({ authorParts: authorPartsFor(3) });
  s.authorshipCache.set(1, [
    {
      i: "A1",
      n: "A Researcher1",
      v: 2,
      c: false,
      p: "first",
      af: [{ n: "First Complete University Name" }],
    },
    {
      i: "A2",
      n: "A Researcher2",
      v: 2,
      c: false,
      p: "middle",
      af: [{ n: "Second Complete University Name" }],
    },
    {
      i: "A3",
      n: "A Researcher3",
      v: 2,
      c: true,
      p: "last",
      af: [{ n: "Third Complete University Name" }],
    },
  ]);
  const props = s.show(1);
  assert.equal(findClass(props.body, "zest-info-authors").children.length, 3);
  assert.deepEqual(
    findClass(props.body, "zest-info-authors").children.map(
      (entry) => entry.hidden,
    ),
    [false, true, false],
  );
  assert.equal(
    findClass(findRow(props.body, "info-authors"), "zest-info-metadata-toggle")
      .textContent,
    "info-authors-all 3",
  );
  assert.equal(
    findClass(
      findRow(props.body, "info-affiliations"),
      "zest-info-metadata-toggle",
    ).textContent,
    "info-affiliations-all 3",
  );
  assert.deepEqual(
    findClass(props.body, "zest-info-institutions")
      .children.filter((entry) => !entry.hidden)
      .map(institutionName)
      .sort(),
    ["First Complete University Name", "Third Complete University Name"],
  );
  assert.deepEqual(s.logs, []);
});

test("a first author who is also verified corresponding appears once with both roles and all their institutions", () => {
  const s = setup({ authorParts: authorPartsFor(1) });
  s.authorshipCache.set(1, [
    {
      i: "A1",
      n: "A Researcher1",
      v: 2,
      p: "first",
      c: true,
      af: [
        { i: "I1", n: "Core University One" },
        { i: "I2", n: "Core University Two" },
      ],
    },
  ]);
  const props = s.show(1);
  const authors = findClass(props.body, "zest-info-authors").children;
  assert.equal(authors.length, 1);
  assert.equal(authors[0].hidden, false);
  const role = findClass(authors[0], "zest-info-author-role").textContent;
  assert.ok(role.includes("info-author-first"));
  assert.ok(role.includes("info-author-corresponding"));
  const institutions = findClass(props.body, "zest-info-institutions").children;
  assert.equal(institutions.length, 2);
  assert.ok(institutions.every((entry) => !entry.hidden));
  for (const institution of institutions) {
    assert.deepEqual(institutionRoles(institution), [
      "info-affiliation-first",
      "info-affiliation-corresponding",
    ]);
    assert.ok(institution.title.includes("A Researcher1"));
  }
  assert.equal(findClass(props.body, "zest-info-metadata-toggle"), undefined);
  assert.equal(s.requests.length, 0);
  assert.deepEqual(s.logs, []);
});

test("without verified correspondence first and last authors are visible, while detail retrieval remains explicitly available", async () => {
  const s = setup({ authorParts: authorPartsFor(3) });
  s.authorshipCache.set(1, [
    { i: "A1", n: "A Researcher1", a: "First Core University" },
    { i: "A2", n: "A Researcher2", a: "Another University" },
    { i: "A3", n: "A Researcher3", a: "Last University" },
  ]);
  const props = s.show(1);
  const authors = findClass(props.body, "zest-info-authors").children;
  assert.deepEqual(
    authors.map((entry) => entry.hidden),
    [false, true, false],
  );
  const lastRole = findClass(authors[2], "zest-info-author-role");
  assert.equal(lastRole.textContent, "info-author-last");
  assert.equal(lastRole.title, "info-author-last-tip");
  const institutions = findClass(props.body, "zest-info-institutions").children;
  assert.deepEqual(
    institutionRoles(
      institutions.find(
        (entry) => institutionName(entry) === "First Core University",
      ),
    ),
    ["info-affiliation-first"],
  );
  assert.deepEqual(
    institutionRoles(
      institutions.find(
        (entry) => institutionName(entry) === "Last University",
      ),
    ),
    ["info-affiliation-last"],
  );
  assert.deepEqual(
    institutionRoles(
      institutions.find(
        (entry) => institutionName(entry) === "Another University",
      ),
    ),
    [],
  );
  assert.equal(
    props.body.textContent.includes("info-affiliation-corresponding"),
    false,
  );
  assert.equal(s.requests.length, 0);
  assert.equal(s.jobs.size, 0);
  await findClass(props.body, "zest-affiliations-fetch").listeners.click();
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].options.details, true);
  assert.equal(s.requests[0].options.automatic, undefined);
  assert.deepEqual(s.logs, []);
});

test("without any authorship metadata first and last fallback stay visible without claiming corresponding authorship or institutions", () => {
  const s = setup({ authorParts: authorPartsFor(4) });
  const props = s.show(1);
  const authors = findClass(props.body, "zest-info-authors").children;
  assert.deepEqual(
    authors.map((entry) => entry.hidden),
    [false, true, true, false],
  );
  assert.equal(
    findClass(authors[0], "zest-info-author-role").textContent,
    "info-author-first",
  );
  assert.equal(
    findClass(authors[3], "zest-info-author-role").textContent,
    "info-author-last",
  );
  assert.equal(
    findClass(authors[3], "zest-info-author-role").title,
    "info-author-last-tip",
  );
  assert.equal(
    props.body.textContent.includes("info-author-corresponding"),
    false,
  );
  assert.equal(findClass(props.body, "zest-info-institutions"), undefined);
  assert.equal(s.requests.length, 0);
  assert.equal(s.jobs.size, 0);
  assert.deepEqual(s.writes, []);
});

test("a single author without metadata remains first only and needs neither a duplicate last role nor a disclosure", () => {
  const s = setup({ authorParts: authorPartsFor(1) });
  const props = s.show(1);
  const authors = findClass(props.body, "zest-info-authors").children;
  assert.equal(authors.length, 1);
  assert.equal(authors[0].hidden, false);
  assert.equal(
    findClass(authors[0], "zest-info-author-role").textContent,
    "info-author-first",
  );
  assert.equal(props.body.textContent.includes("info-author-last"), false);
  assert.equal(
    findClass(findRow(props.body, "info-authors"), "zest-info-metadata-toggle"),
    undefined,
  );
});

test("a shared first and corresponding institution renders once with separate role tags and both author names", () => {
  const s = setup({ authorParts: authorPartsFor(3) });
  s.authorshipCache.set(1, [
    {
      i: "A1",
      n: "A Researcher1",
      v: 2,
      p: "first",
      c: false,
      af: [{ i: "I1", n: "Shared Core Institution" }],
    },
    {
      i: "A2",
      n: "A Researcher2",
      v: 2,
      p: "middle",
      c: true,
      af: [{ i: "I1", n: "Shared Core Institution" }],
    },
    {
      i: "A3",
      n: "A Researcher3",
      v: 2,
      p: "last",
      c: false,
      af: [{ i: "I2", n: "Other Institution" }],
    },
  ]);
  const props = s.show(1);
  const authors = findClass(props.body, "zest-info-authors").children;
  assert.deepEqual(
    authors.map((entry) => entry.hidden),
    [false, false, true],
  );
  assert.equal(findClass(authors[2], "zest-info-author-role"), undefined);
  const list = findClass(props.body, "zest-info-institutions");
  const shared = list.children.filter(
    (entry) => institutionName(entry) === "Shared Core Institution",
  );
  assert.equal(shared.length, 1);
  assert.deepEqual(institutionRoles(shared[0]), [
    "info-affiliation-first",
    "info-affiliation-corresponding",
  ]);
  assert.ok(findClass(shared[0], "zest-info-institution-roles"));
  assert.ok(shared[0].title.includes("A Researcher1"));
  assert.ok(shared[0].title.includes("A Researcher2"));
  const others = list.children.find(
    (entry) => institutionName(entry) === "Other Institution",
  );
  assert.equal(others.hidden, true);
  assert.deepEqual(institutionRoles(others), []);
  findClass(
    findRow(props.body, "info-affiliations"),
    "zest-info-metadata-toggle",
  ).listeners.click();
  assert.equal(others.hidden, false);
  assert.deepEqual(institutionRoles(others), []);
  s.panel.refreshInfoSections(1);
  const refreshedShared = findClass(
    props.body,
    "zest-info-institutions",
  ).children.find(
    (entry) => institutionName(entry) === "Shared Core Institution",
  );
  assert.deepEqual(institutionRoles(refreshedShared), [
    "info-affiliation-first",
    "info-affiliation-corresponding",
  ]);
  assert.deepEqual(s.logs, []);
});

test("a unique matched first-author position overrides local order without changing correspondence evidence", () => {
  const s = setup({ authorParts: authorPartsFor(4) });
  s.authorshipCache.set(
    1,
    Array.from({ length: 4 }, (_, index) => ({
      i: `A${index + 1}`,
      n: `A Researcher${index + 1}`,
      v: 2,
      p: index === 2 ? "first" : index === 3 ? "last" : "middle",
      c: index === 1,
      af: [{ i: `I${index + 1}`, n: `Institute ${index + 1}` }],
    })),
  );
  const props = s.show(1);
  const authors = findClass(props.body, "zest-info-authors").children;
  assert.deepEqual(
    authors.map((entry) => entry.hidden),
    [true, false, false, true],
  );
  assert.equal(findClass(authors[0], "zest-info-author-role"), undefined);
  assert.equal(
    findClass(authors[2], "zest-info-author-role").textContent,
    "info-author-first",
  );
  assert.equal(
    findClass(authors[1], "zest-info-author-role").textContent,
    "info-author-corresponding",
  );
  assert.equal(findClass(authors[3], "zest-info-author-role"), undefined);
  const list = findClass(props.body, "zest-info-institutions").children;
  assert.deepEqual(
    institutionRoles(
      list.find((entry) => institutionName(entry) === "Institute 3"),
    ),
    ["info-affiliation-first"],
  );
  assert.deepEqual(
    institutionRoles(
      list.find((entry) => institutionName(entry) === "Institute 2"),
    ),
    ["info-affiliation-corresponding"],
  );
});

test("unmatched provider institutions remain unattributed even when the preview uses them as a fallback", () => {
  const s = setup({ authorParts: authorPartsFor(3) });
  s.authorshipCache.set(1, [
    {
      i: "A90",
      n: "Unmatched Scientist",
      v: 2,
      p: "first",
      c: true,
      af: [{ i: "I1", n: "Unverified Institution One" }],
    },
    {
      i: "A91",
      n: "Another Scientist",
      v: 2,
      p: "last",
      c: false,
      af: [{ i: "I2", n: "Unverified Institution Two" }],
    },
  ]);
  const props = s.show(1);
  const authors = findClass(props.body, "zest-info-authors").children;
  assert.deepEqual(
    authors.map((entry) => entry.hidden),
    [false, true, false],
  );
  assert.equal(
    props.body.textContent.includes("info-author-corresponding"),
    false,
  );
  const institutions = findClass(props.body, "zest-info-institutions").children;
  assert.equal(institutions.length, 2);
  assert.ok(institutions.every((entry) => !entry.hidden));
  assert.ok(
    institutions.every((entry) => institutionRoles(entry).length === 0),
  );
  assert.deepEqual(s.logs, []);
});

test("a three-institution preview represents both first and corresponding roles and keeps role tags on folded entries", () => {
  const s = setup({ authorParts: authorPartsFor(3) });
  s.authorshipCache.set(1, [
    {
      i: "A1",
      n: "A Researcher1",
      v: 2,
      p: "first",
      c: false,
      af: Array.from({ length: 4 }, (_, index) => ({
        i: `I${index}`,
        n: `First Institution ${index}`,
      })),
    },
    {
      i: "A2",
      n: "A Researcher2",
      v: 2,
      p: "middle",
      c: true,
      af: [{ i: "I4", n: "Corresponding Institution" }],
    },
    { i: "A3", n: "A Researcher3", v: 2, p: "last", c: false, af: [] },
  ]);
  const props = s.show(1);
  const entries = findClass(props.body, "zest-info-institutions").children;
  const visible = entries.filter((entry) => !entry.hidden);
  assert.equal(visible.length, 3);
  assert.ok(
    visible.some((entry) =>
      institutionRoles(entry).includes("info-affiliation-first"),
    ),
  );
  assert.ok(
    visible.some((entry) =>
      institutionRoles(entry).includes("info-affiliation-corresponding"),
    ),
  );
  const folded = entries.filter((entry) => entry.hidden);
  assert.equal(folded.length, 2);
  assert.ok(
    folded.every((entry) =>
      institutionRoles(entry).includes("info-affiliation-first"),
    ),
  );
  findClass(
    findRow(props.body, "info-affiliations"),
    "zest-info-metadata-toggle",
  ).listeners.click();
  assert.ok(entries.every((entry) => !entry.hidden));
  assert.ok(
    folded.every((entry) =>
      institutionRoles(entry).includes("info-affiliation-first"),
    ),
  );
});

test("rating buttons expose current selection and action labels and keep read-only items inert", async () => {
  const s = setup({ rating: 3 });
  const props = s.show(1);
  let stars = findClass(props.body, "zest-info-stars").children;
  assert.equal(stars.length, 5);
  assert.ok(
    stars.every((star) => star.tag === "button" && star.type === "button"),
  );
  assert.deepEqual(
    stars.map((star) => star.getAttribute("aria-pressed")),
    ["false", "false", "true", "false", "false"],
  );
  assert.deepEqual(
    stars.map((star) => star.getAttribute("aria-label")),
    [
      "info-rating-set 1",
      "info-rating-set 2",
      "info-rating-set 2",
      "info-rating-set 4",
      "info-rating-set 5",
    ],
  );
  stars[2].listeners.click();
  await new Promise((resolve) => require("node:timers").setImmediate(resolve));
  assert.deepEqual(s.ratingWrites, [{ itemID: 1, value: 2 }]);
  stars = findClass(props.body, "zest-info-stars").children;
  assert.equal(stars[1].getAttribute("aria-pressed"), "true");
  props.editable = false;
  s.panel.refreshInfoSections(1);
  stars = findClass(props.body, "zest-info-stars").children;
  assert.ok(stars.every((star) => star.disabled));
  stars[4].listeners.click();
  assert.equal(s.ratingWrites.length, 1);
  assert.equal(findClass(props.body, "zest-info-input").disabled, true);
  assert.deepEqual(s.logs, []);
});

test("a failed rating save displays an accessible error and allows the same rating to be retried without an unhandled rejection", async () => {
  const s = setup({ rating: 2 });
  let attempts = 0;
  s.setRatingImplementation(async () => {
    if (++attempts === 1) throw new Error("intentional test rating failure");
  });
  const props = s.show(1);
  findClass(props.body, "zest-info-stars").children[3].listeners.click();
  // Flush the event loop so Node's test runner also detects an uncaught rejection.
  await new Promise((resolve) => require("node:timers").setImmediate(resolve));
  assert.equal(attempts, 1);
  const feedback = () =>
    findClass(
      findClass(props.body, "zest-info-workspace"),
      "zest-info-feedback",
    );
  assert.equal(feedback().getAttribute("role"), "status");
  assert.equal(feedback().textContent, "info-rating-save-failed");
  assert.equal(
    findClass(props.body, "zest-info-stars").children[1].getAttribute(
      "aria-pressed",
    ),
    "true",
  );
  s.panel.refreshInfoSections(1);
  assert.equal(feedback().textContent, "info-rating-save-failed");
  const retry = findClass(props.body, "zest-info-stars").children[3];
  assert.equal(retry.disabled, false);
  retry.listeners.click();
  await new Promise((resolve) => require("node:timers").setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.deepEqual(s.ratingWrites, [
    { itemID: 1, value: 4 },
    { itemID: 1, value: 4 },
  ]);
  assert.equal(feedback().textContent, "");
  assert.equal(
    findClass(props.body, "zest-info-stars").children[3].getAttribute(
      "aria-pressed",
    ),
    "true",
  );
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0][0], "[info] rating save failed");
});

test("reading heat buttons have page labels and one roving tab stop with Arrow, Home and End navigation", () => {
  const s = setup({
    readingRecord: { total: 180, pages: 6, primaryAtt: "ATT1" },
  });
  const props = s.show(1);
  const segments = findClass(props.body, "zest-info-heat").children;
  assert.equal(segments.length, 3);
  assert.ok(
    segments.every((seg) => seg.tag === "button" && seg.type === "button"),
  );
  assert.deepEqual(
    segments.map((seg) => seg.getAttribute("aria-label")),
    ["info-heat-tip 1", "info-heat-tip 3", "info-heat-tip 5"],
  );
  assert.deepEqual(
    segments.map((seg) => seg.tabIndex),
    [0, -1, -1],
  );
  let prevented = 0;
  const press = (index, key) =>
    segments[index].listeners.keydown({
      key,
      preventDefault: () => prevented++,
    });
  segments[0].focus();
  press(0, "ArrowRight");
  assert.equal(s.doc.activeElement, segments[1]);
  assert.deepEqual(
    segments.map((seg) => seg.tabIndex),
    [-1, 0, -1],
  );
  press(1, "End");
  assert.equal(s.doc.activeElement, segments[2]);
  press(2, "ArrowLeft");
  assert.equal(s.doc.activeElement, segments[1]);
  press(1, "Home");
  assert.equal(s.doc.activeElement, segments[0]);
  assert.deepEqual(
    segments.map((seg) => seg.tabIndex),
    [0, -1, -1],
  );
  assert.equal(prevented, 4);
  press(0, "ArrowLeft");
  press(0, "Tab");
  assert.equal(
    prevented,
    4,
    "unhandled keys and boundary arrows retain native behavior",
  );
  assert.equal(s.doc.activeElement, segments[0]);
  assert.deepEqual(s.writes, []);
  assert.deepEqual(s.logs, []);
});
