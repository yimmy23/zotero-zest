/**
 * Native citation persistence/cancellation regression, synthetic transport only.
 * ZEST_DEV_PORT=23134 scripts/dev-eval.sh -f scripts/citation-lifecycle-probe.js
 * Coordinate with other probes: this temporarily owns citation prefs + HTTP.
 */
const out = { ok: [], fail: [], notes: [], summary: "" };
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data")
) {
  out.fail.push("Isolated development profile and data directory required");
  out.summary = "0 passed, 1 failed; no state changed";
  return out;
}
if (
  !addon.data.alive ||
  typeof dev.cite?.updateCitations !== "function" ||
  typeof dev.cite?.stopCitations !== "function" ||
  typeof dev.cite?.startCitations !== "function"
) {
  out.fail.push("Live citation lifecycle API required");
  out.summary = "0 passed, 1 failed; no state changed";
  return out;
}

const check = (name, condition) => (condition ? out.ok : out.fail).push(name);
const delay = (ms) => Zotero.Promise.delay(ms);
async function until(read, description) {
  for (let n = 0; n < 100; n++) {
    const value = read();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}
const preferences = new Map();
const prefix = "extensions.zotero.zest.";
function setPref(name, value) {
  const key = prefix + name;
  if (!preferences.has(key))
    preferences.set(key, {
      had: Services.prefs.prefHasUserValue(key),
      value: Zotero.Prefs.get(key, true),
    });
  Zotero.Prefs.set(key, value, true);
}
const items = [];
const itemIDs = [];
const pending = [];
const responses = [];
const ownedDOIs = new Set();
const savedMethods = [];
const originalHTTP = Zotero.HTTP.request;
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let holdResponses = false;
let requests = 0;
let blockedRequests = 0;
const response = () => ({
  status: 200,
  response: { message: { "is-referenced-by-count": 42 } },
  getResponseHeader: () => null,
});
const fixtureHTTP = async (method, rawURL) => {
  const url = new URL(rawURL);
  const doi = decodeURIComponent(url.pathname.replace(/^\/works\//, ""));
  if (
    method !== "GET" ||
    url.origin !== "https://api.crossref.org" ||
    !url.pathname.startsWith("/works/") ||
    !ownedDOIs.has(doi)
  ) {
    blockedRequests++;
    throw new Error("Citation probe blocked unexpected transport");
  }
  requests++;
  if (holdResponses)
    return new Promise((resolve) => responses.push(() => resolve(response())));
  return response();
};
const persistedExtra = async (item) =>
  (await Zotero.DB.valueQueryAsync(
    "SELECT v.value FROM itemData d JOIN itemDataValues v USING (valueID) WHERE d.itemID=? AND d.fieldID=?",
    [item.id, Zotero.ItemFields.getID("extra")],
  )) || "";
async function makeItem(name) {
  const item = new Zotero.Item("journalArticle");
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField("title", `zest citation lifecycle probe ${stamp} ${name}`);
  const doi = `10.5555/zest-phase-a-${stamp}-${name}`;
  ownedDOIs.add(doi);
  item.setField("DOI", doi);
  item.setField("extra", "User note\n\nOtherPlugin: preserve");
  await item.saveTx({ skipSelect: true });
  items.push(item);
  itemIDs.push(item.id);
  return item;
}
function track(promise) {
  pending.push(promise);
  return promise;
}

try {
  // Disable automatic request producers before creating any native fixture.
  setPref("rank.autoFetch", false);
  setPref("info.affiliations.autoFetch", false);
  setPref("cite.useCrossref", true);
  setPref("cite.useOpenAlex", false);
  setPref("cite.useSemanticScholar", false);
  setPref("network.email", "");
  Zotero.HTTP.request = fixtureHTTP;
  if (Zotero.HTTP.request !== fixtureHTTP)
    throw new Error("Could not install synthetic HTTP transport");

  const retry = await makeItem("retry");
  const before = retry.getField("extra");
  const ownSave = Object.getOwnPropertyDescriptor(retry, "saveTx");
  const saveTx = retry.saveTx;
  savedMethods.push(() => {
    if (ownSave) Object.defineProperty(retry, "saveTx", ownSave);
    else delete retry.saveTx;
  });
  let attempts = 0;
  retry.saveTx = function (...args) {
    attempts++;
    if (attempts === 1)
      return Promise.reject(new Error("Citation probe injected save failure"));
    return saveTx.apply(this, args);
  };
  const failed = await track(dev.cite.updateCitations(retry, true));
  check("save failure is reported", failed.status === "failed");
  check(
    "failed save restores native in-memory Extra",
    retry.getField("extra") === before,
  );
  check(
    "failed save leaves native SQLite Extra unchanged",
    (await persistedExtra(retry)) === before,
  );
  const retried = await track(dev.cite.updateCitations(retry, true));
  check(
    "same count retry saves again",
    retried.status === "updated" && attempts === 2,
  );
  const expected = `${before}\nCitations: 42 (Crossref) [${dev.citeExtra.todayISO()}]`;
  check(
    "retry persisted exact owned line and retained user text",
    (await persistedExtra(retry)) === expected,
  );
  const repeated = await track(dev.cite.updateCitations(retry, true));
  check(
    "persisted identical count skips another save",
    repeated.status === "unchanged" && attempts === 2,
  );

  const changed = await makeItem("identity");
  const changedBefore = changed.getField("extra");
  holdResponses = true;
  const firstResponse = responses.length;
  const stale = track(dev.cite.updateCitations(changed, true));
  await until(() => responses.length > firstResponse, "DOI response queued");
  changed.setField("DOI", `10.5555/zest-phase-a-${stamp}-corrected`);
  await changed.saveTx({ skipSelect: true });
  responses[firstResponse]();
  check(
    "pending response cancelled after saved DOI correction",
    (await stale).status === "cancelled",
  );
  check(
    "DOI correction does not receive stale citation in SQLite",
    (await persistedExtra(changed)) === changedBefore,
  );
  check(
    "corrected DOI remains persisted",
    changed.getField("DOI").endsWith("-corrected"),
  );

  const shutdown = await makeItem("shutdown");
  const shutdownBefore = shutdown.getField("extra");
  const nextResponse = responses.length;
  const late = track(dev.cite.updateCitations(shutdown, true));
  await until(
    () => responses.length > nextResponse,
    "shutdown response queued",
  );
  dev.cite.stopCitations();
  responses[nextResponse]();
  check(
    "pending response cancelled on citation shutdown",
    (await late).status === "cancelled",
  );
  check(
    "shutdown response does not write SQLite Extra",
    (await persistedExtra(shutdown)) === shutdownBefore,
  );
  const beforeStopped = requests;
  check(
    "stopped citation service refuses new work",
    (await track(dev.cite.updateCitations(shutdown, true))).status ===
      "cancelled" && requests === beforeStopped,
  );
  dev.cite.startCitations();
  holdResponses = false;
  check(
    "citation service can start again",
    (await track(dev.cite.updateCitations(shutdown, true))).status ===
      "updated",
  );
  check(
    "restarted service persists to native SQLite",
    String(await persistedExtra(shutdown)).includes("Citations: 42 (Crossref)"),
  );
  check(
    "only synthetic fixture HTTP requests occurred",
    blockedRequests === 0 && requests === 6,
  );
  out.notes.push(
    `Zotero ${Zotero.version}; ${requests} synthetic Crossref responses, zero delegated network requests.`,
  );
} catch (e) {
  out.fail.push("native citation probe completed");
  out.notes.push(String(e));
} finally {
  // Cancel/settle everything while the synthetic transport is still installed.
  dev.cite.stopCitations();
  for (const resolve of responses) resolve();
  await Promise.allSettled(pending);
  for (const restore of savedMethods.reverse()) {
    try {
      restore();
    } catch (e) {
      out.fail.push("fixture save method restored");
      out.notes.push(String(e));
    }
  }
  for (const item of items.reverse()) {
    try {
      await item.eraseTx();
    } catch (e) {
      out.fail.push("fixture item erased");
      out.notes.push(String(e));
    }
  }
  try {
    check(
      "owned fixture items removed from SQLite",
      !itemIDs.length ||
        (await Zotero.DB.valueQueryAsync(
          "SELECT COUNT(*) FROM items WHERE itemID IN (" +
            itemIDs.map(() => "?").join(",") +
            ")",
          itemIDs,
        )) === 0,
    );
  } catch (e) {
    out.fail.push("fixture deletion verified in SQLite");
    out.notes.push(String(e));
  }
  Zotero.HTTP.request = originalHTTP;
  check("native HTTP method restored", Zotero.HTTP.request === originalHTTP);
  for (const [key, prior] of preferences) {
    try {
      if (prior.had) Zotero.Prefs.set(key, prior.value, true);
      else Zotero.Prefs.clear(key, true);
      check(
        `preference restored: ${key.slice(prefix.length)}`,
        Services.prefs.prefHasUserValue(key) === prior.had &&
          (!prior.had || Zotero.Prefs.get(key, true) === prior.value),
      );
    } catch (e) {
      out.fail.push(`preference restored: ${key.slice(prefix.length)}`);
      out.notes.push(String(e));
    }
  }
  if (addon.data.alive) dev.cite.startCitations();
}
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return out;
