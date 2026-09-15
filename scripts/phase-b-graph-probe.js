/** Native graph controller/DOM + synthetic in-memory data and transport.
 * Run only through scripts/dev-eval.sh in the scaffold instance.
 * For screenshots set win.__zestPhaseBGraphKeepUI=true before running; call
 * win.__zestPhaseBGraphCleanup() afterwards. No Zotero item is saved.
 */
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
)
  throw Error("Isolated development profile and data directory required");
const win = Zotero.getMainWindow(),
  doc = win.document;
if (dev.graphPane.isGraphVisible(win))
  throw Error(
    "Close the existing dev graph first; this probe only owns its own pane",
  );
const keepUI = win.__zestPhaseBGraphKeepUI === true;
const out = {
  ok: [],
  fail: [],
  notes: [],
  selectors: {
    pane: "#zest-graph-pane",
    manual: ".zest-graph-authors",
    status: ".zest-graph-status",
  },
};
const check = (name, value) => {
  (value ? out.ok : out.fail).push(name);
  if (!value) throw Error(name);
};
const delay = (ms) => Zotero.Promise.delay(ms);
async function ready() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const canvas = doc.querySelector(".zest-graph-canvas");
    if (canvas?.getAttribute("aria-busy") === "false") return;
    await delay(25);
  }
  throw Error("Graph build did not finish");
}
const prefs = new Map(),
  cleanups = [],
  entries = new Map(),
  itemMap = new Map();
const prefix = "extensions.zotero.zest.";
function setPref(name, value) {
  const key = prefix + name;
  if (!prefs.has(key)) prefs.set(key, Zotero.Prefs.get(key, true));
  Zotero.Prefs.set(key, value, true);
}
function replace(owner, key, fn) {
  const previous = owner[key];
  owner[key] = fn(previous);
  const installed = owner[key];
  cleanups.push(() => {
    if (owner[key] === installed) owner[key] = previous;
  });
}
function makeItem(
  index,
  family = "Wang",
  given = `Name${String(index).padStart(6, "0")}`,
) {
  const item = Object.create(Zotero.Item.prototype);
  const key = `ZBG${String(index).padStart(5, "0")}`;
  Object.defineProperties(item, {
    id: { value: 8000000 + index },
    libraryID: { value: Zotero.Libraries.userLibraryID },
    key: { value: key },
    firstCreator: { value: family },
    isRegularItem: { value: () => true },
    getCreators: {
      value: () => [{ lastName: family, firstName: given }],
      configurable: true,
    },
    getField: {
      value: (field) =>
        field === "DOI"
          ? `10.9999/zbg${index}`
          : field === "title"
            ? `Graph fixture paper ${index}`
            : "",
    },
    getTags: {
      value: () => [{ tag: `Group${Math.floor(index / 2)}`, type: 0 }],
    },
  });
  itemMap.set(`${item.libraryID}/${key}`, item);
  return item;
}
const papers = Array.from({ length: 502 }, (_, index) => makeItem(index));
let scope = papers.slice(0, 65),
  requests = 0,
  pendingResolve,
  pendingOptions,
  transport = "success";
const listeners = new Set();
const cacheKey = (ns, key) => `${ns}/${key}`;
const ownedKey = (key) => String(key).includes("/ZBG");
const response = (url) => {
  const index = Number(decodeURIComponent(url).match(/zbg(\d+)/)?.[1] || 0);
  return {
    kind: "ok",
    value: {
      authorships: [
        {
          author: {
            id: `https://openalex.org/A${8000000 + index}`,
            display_name: `Name${String(index).padStart(6, "0")} Wang`,
          },
        },
      ],
    },
  };
};
let lastURL;
const cleanup = () => {
  dev.graphPane.hideGraphPane(win, false);
  while (cleanups.length) cleanups.pop()();
  for (const [key, value] of prefs) {
    if (value === undefined) Zotero.Prefs.clear(key, true);
    else Zotero.Prefs.set(key, value, true);
  }
  delete win.__zestPhaseBGraphCleanup;
  delete win.__zestPhaseBGraphKeepUI;
};
try {
  const itemView = win.ZoteroPane.itemsView;
  replace(itemView, "getSortedItems", () => () => scope);
  replace(win.ZoteroPane, "getSelectedItems", () => () => []);
  replace(
    Zotero.Items,
    "getByLibraryAndKey",
    (previous) =>
      function (library, key) {
        return (
          itemMap.get(`${library}/${key}`) || previous.call(this, library, key)
        );
      },
  );
  replace(
    itemView.onRefresh,
    "addListener",
    (previous) =>
      function (fn) {
        listeners.add(fn);
        return previous.call(this, fn);
      },
  );
  replace(
    itemView.onRefresh,
    "removeListener",
    (previous) =>
      function (fn) {
        listeners.delete(fn);
        return previous.call(this, fn);
      },
  );
  replace(
    dev.cache,
    "get",
    (previous) =>
      function (ns, key, sanitize) {
        if (!ownedKey(key)) return previous.call(this, ns, key, sanitize);
        const data = sanitize(entries.get(cacheKey(ns, key)));
        return data ? { data, age: 0 } : undefined;
      },
  );
  replace(
    dev.cache,
    "set",
    (previous) =>
      function (ns, key, value) {
        if (ownedKey(key)) entries.set(cacheKey(ns, key), value);
        else return previous.call(this, ns, key, value);
      },
  );
  replace(
    dev.cache,
    "remove",
    (previous) =>
      function (ns, key) {
        if (ownedKey(key)) entries.delete(cacheKey(ns, key));
        else return previous.call(this, ns, key);
      },
  );
  replace(
    dev.cache,
    "ageOf",
    (previous) =>
      function (ns, key) {
        return ownedKey(key) ? undefined : previous.call(this, ns, key);
      },
  );
  replace(
    dev.httpMod.http,
    "requestResult",
    () =>
      async function (_method, url, options) {
        if (!decodeURIComponent(url).includes("10.9999/zbg"))
          return { kind: "cancelled" };
        requests++;
        lastURL = url;
        if (transport === "pending") {
          pendingOptions = options;
          return await new Promise((resolve) => {
            pendingResolve = resolve;
          });
        }
        if (transport === "throttled")
          return { kind: "throttled", status: 429 };
        return response(url);
      },
  );
  const trimmed = await dev.graphBuild.buildGraph(papers, "tag", {
    maxNodes: 250,
  });
  check(
    "budget.connectedRelationshipsRemain",
    trimmed.truncated &&
      trimmed.nodes.length <= 250 &&
      trimmed.edges.length > 0,
  );
  check(
    "budget.noOrphanCategories",
    trimmed.nodes.every((node) =>
      trimmed.edges.some(
        (edge) => edge.source === node.id || edge.target === node.id,
      ),
    ),
  );
  const a = makeItem(1000, "Smith", "J."),
    b = makeItem(1001, "Smith", "John"),
    alias = makeItem(1002, "Smyth", "John");
  entries.set(cacheKey("oaAuthors", `${a.libraryID}/${a.key}`), [
    { i: "A1", n: "J Smith" },
  ]);
  entries.set(cacheKey("oaAuthors", `${b.libraryID}/${b.key}`), [
    { i: "A2", n: "John Smith" },
  ]);
  entries.set(cacheKey("oaAuthors", `${alias.libraryID}/${alias.key}`), [
    { i: "A1", n: "John Smyth" },
  ]);
  const resolver = await dev.authorIdentity.buildAuthorResolverAsync([
    a,
    b,
    alias,
  ]);
  const ids = [
    ...resolver.memberItemIDs({ family: "Smith", given: "J.", oaId: "A1" }),
  ];
  check(
    "identity.knownIDExcludesOtherIDsAcrossAliases",
    ids.length === 2 &&
      ids.includes(a.id) &&
      ids.includes(alias.id) &&
      !ids.includes(b.id),
  );
  for (const automatic of [true, false]) {
    setPref("info.affiliations.autoFetch", automatic);
    setPref("graph.mode", "author");
    setPref("graph.visible", true);
    setPref("graph.maxNodes", 120);
    dev.graphPane.restoreGraphPane(win);
    await ready();
    check(`restore.cacheOnly.autoFetch${automatic}`, requests === 0);
    for (const listener of listeners) listener();
    await delay(700);
    await ready();
    check(`scope.cacheOnly.autoFetch${automatic}`, requests === 0);
    dev.graphPane.hideGraphPane(win, false);
  }
  dev.graphPane.showGraphPane(win);
  await ready();
  const manual = doc.querySelector(".zest-graph-authors");
  check(
    "manual.visibleAccessibleControl",
    !manual.hidden && manual.textContent.trim() && manual.title.trim(),
  );
  const before = requests;
  manual.click();
  check(
    "manual.loadingVisible",
    manual.disabled && manual.getAttribute("aria-busy") === "true",
  );
  await delay(50);
  await ready();
  check("manual.boundedAt30WithoutAutoChain", requests - before === 30);
  check(
    "manual.completionVisible",
    !manual.disabled &&
      manual.getAttribute("aria-busy") === "false" &&
      doc.querySelector(".zest-graph-status").textContent.includes("30"),
  );
  for (const action of ["scope", "hide"]) {
    transport = "pending";
    const beforeCancel = requests;
    const job = dev.graphPane.completeAuthorIdentities(win);
    check(`cancel.${action}.requestStarted`, requests === beforeCancel + 1);
    if (action === "scope") for (const listener of listeners) listener();
    else dev.graphPane.hideGraphPane(win, false);
    check(
      `cancel.${action}.transportInvalid`,
      pendingOptions.shouldContinue() === false,
    );
    pendingResolve(response(lastURL));
    await job;
    check(`cancel.${action}.noMoreRequests`, requests === beforeCancel + 1);
    check(
      `cancel.${action}.noLateCacheWrite`,
      !entries.has(
        cacheKey("oaAuthors", `${scope[30].libraryID}/${scope[30].key}`),
      ),
    );
    if (action === "hide") dev.graphPane.showGraphPane(win);
    else await delay(700);
    await ready();
  }
  transport = "throttled";
  const beforeThrottle = requests;
  await dev.graphPane.completeAuthorIdentities(win);
  check("manual.throttleStopsBatch", requests === beforeThrottle + 1);
  transport = "success";
  // A final local rebuild leaves a representative native graph for screenshots.
  doc.querySelector(".zest-graph-actions button").click();
  await ready();
  out.notes.push(
    "Native DOM/controller validation uses in-memory Item-prototype fixtures and a transport spy; no item save and no real OpenAlex request.",
  );
  if (keepUI) {
    win.__zestPhaseBGraphCleanup = cleanup;
    out.notes.push(
      "UI retained; call Zotero.getMainWindow().__zestPhaseBGraphCleanup() after screenshots.",
    );
  }
} catch (error) {
  out.fail.push(String(error));
} finally {
  if (!keepUI || out.fail.length) cleanup();
}
return out;
