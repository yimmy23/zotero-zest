/**
 * Native citation-menu batch probe. Run serially in the isolated dev profile.
 * Synthetic HTTP outcomes only; all native transport is blocked until cleanup.
 */
const out = { ok: [], fail: [], notes: [], summary: "" };
if (
  !String(PathUtils.profileDir).endsWith("/.scaffold/dev-profile") ||
  !String(Zotero.DataDirectory.dir).endsWith("/.scaffold/dev-data") ||
  !addon.data.alive ||
  typeof dev.menus?.updateCitationsFor !== "function" ||
  typeof dev.httpMod?.http?.requestResult !== "function" ||
  typeof Zotero.ProgressWindowSet?.add !== "function"
) {
  out.fail.push(
    "Live isolated dev profile with menu/HTTP/progress APIs required",
  );
  out.summary = "0 passed, 1 failed; no state changed";
  return out;
}

const check = (name, condition) => (condition ? out.ok : out.fail).push(name);
async function until(read, description) {
  for (let n = 0; n < 100; n++) {
    const value = read();
    if (value) return value;
    await Zotero.Promise.delay(50);
  }
  throw new Error(`Timed out: ${description}`);
}
const preferences = new Map();
const restorers = [];
const items = [];
const itemIDs = [];
const requests = [];
const batches = [];
const progress = [];
const alerts = [];
const ownedDOIs = new Set();
const prefix = "extensions.zotero.zest.";
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let confirmed = true;
let blockedTransport = 0;
let unexpectedHTTP = 0;
let expectedTitle = "";
function replaceMethod(object, key, replacement) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  const original = object[key];
  restorers.push(() => {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else delete object[key];
    check(`restored method: ${key}`, object[key] === original);
  });
  object[key] = replacement;
  if (object[key] !== replacement)
    throw new Error(`Could not replace ${key} for the isolated probe`);
  return original;
}
function setPref(name, value) {
  const key = prefix + name;
  if (!preferences.has(key))
    preferences.set(key, {
      had: Services.prefs.prefHasUserValue(key),
      value: Zotero.Prefs.get(key, true),
    });
  Zotero.Prefs.set(key, value, true);
}
const persistedExtra = async (item) =>
  (await Zotero.DB.valueQueryAsync(
    "SELECT v.value FROM itemData d JOIN itemDataValues v USING (valueID) WHERE d.itemID=? AND d.fieldID=?",
    [item.id, Zotero.ItemFields.getID("extra")],
  )) || "";
function startBatch() {
  const promise = dev.menus.updateCitationsFor(items, false);
  batches.push(promise);
  return promise;
}
const success = () => ({
  kind: "ok",
  status: 200,
  value: { message: { "is-referenced-by-count": 42 } },
});
async function clickProgress(index) {
  const entry = await until(() => {
    const entry = progress[index];
    return entry &&
      !entry.window.closed &&
      entry.window.document.readyState === "complete"
      ? entry
      : null;
  }, "native progress window loaded");
  entry.window.dispatchEvent(new entry.window.MouseEvent("mouseup"));
  await until(() => entry.window.closed, "native click closed progress");
}

try {
  const message = addon.data.locale.current.formatMessagesSync([
    { id: "zest-menu-citations-update" },
  ])[0];
  expectedTitle = message.attributes.find(
    (entry) => entry.name === "label",
  ).value;
  setPref("rank.autoFetch", false);
  setPref("info.affiliations.autoFetch", false);
  setPref("cite.useCrossref", true);
  setPref("cite.useOpenAlex", false);
  setPref("cite.useSemanticScholar", false);
  setPref("network.email", "");
  replaceMethod(Zotero.HTTP, "request", async () => {
    blockedTransport++;
    throw new Error("Native transport is disabled by the isolated batch probe");
  });
  replaceMethod(
    dev.httpMod.http,
    "requestResult",
    (method, rawURL, options) => {
      const url = new URL(rawURL);
      const doi = decodeURIComponent(url.pathname.replace(/^\/works\//, ""));
      if (
        method !== "GET" ||
        url.origin !== "https://api.crossref.org" ||
        !url.pathname.startsWith("/works/") ||
        !ownedDOIs.has(doi)
      ) {
        unexpectedHTTP++;
        return Promise.reject(
          new Error("Unexpected request blocked by batch probe"),
        );
      }
      return new Promise((resolve) => requests.push({ options, resolve, doi }));
    },
  );
  // nsIPromptService methods are read-only XPCOM members. Replace only the
  // configurable Services getter value; bind every unhandled method to the
  // original native service and restore the exact property descriptor.
  const promptService = Services.prompt;
  replaceMethod(
    Services,
    "prompt",
    new Proxy(
      {},
      {
        get(_target, key) {
          if (key === "confirm")
            return (_win, title) => {
              if (title !== expectedTitle)
                throw new Error("Unexpected confirmation");
              return confirmed;
            };
          if (key === "alert")
            return (_win, title, text) => {
              if (title !== expectedTitle) throw new Error("Unexpected alert");
              alerts.push(String(text));
            };
          const value = promptService[key];
          return typeof value === "function"
            ? value.bind(promptService)
            : value;
        },
      },
    ),
  );
  const originalAdd = Zotero.ProgressWindowSet.add;
  replaceMethod(Zotero.ProgressWindowSet, "add", function (window, instance) {
    progress.push({ window, instance });
    return originalAdd.call(this, window, instance);
  });

  for (let n = 0; n < 3; n++) {
    const item = new Zotero.Item("journalArticle");
    item.libraryID = Zotero.Libraries.userLibraryID;
    item.setField("title", `zest batch probe ${stamp} ${n}`);
    const doi = `10.5555/zest-phase-b-batch-${stamp}-${n}`;
    ownedDOIs.add(doi);
    item.setField("DOI", doi);
    item.setField("extra", `Private note ${n}\r\n\nOtherPlugin: preserve\n  `);
    await item.saveTx({ skipSelect: true });
    items.push(item);
    itemIDs.push(item.id);
  }
  const before = await Promise.all(items.map(persistedExtra));

  const throttled = startBatch();
  await until(() => requests.length === 1, "first citation request");
  requests[0].resolve({ kind: "throttled", status: 429, value: null });
  const throttleResult = await throttled;
  check("throttle stops after one request", requests.length === 1);
  check(
    "throttle tallies one failure and two untouched",
    throttleResult.failed === 1 &&
      throttleResult.stopped === 2 &&
      throttleResult.updated === 0 &&
      !throttleResult.cancelled,
  );
  check("throttle shows exactly one result alert", alerts.length === 1);
  await clickProgress(0);
  check(
    "throttle retains all native Extra values",
    JSON.stringify(await Promise.all(items.map(persistedExtra))) ===
      JSON.stringify(before),
  );

  const cancelled = startBatch();
  await until(() => requests.length === 2, "pending citation before close");
  await clickProgress(1);
  check(
    "native progress click invalidates the request guard",
    !requests[1].options.shouldContinue(),
  );
  requests[1].resolve(success());
  const cancelResult = await cancelled;
  check(
    "cancelled request is untouched, not success or failure",
    cancelResult.cancelled &&
      cancelResult.stopped === 3 &&
      cancelResult.updated === 0 &&
      cancelResult.failed === 0,
  );
  check(
    "close creates no late alert or replacement progress",
    alerts.length === 1 && progress.length === 2,
  );
  check(
    "close dispatches no remaining citation request",
    requests.length === 2,
  );
  check(
    "cancelled response leaves native SQLite unchanged",
    JSON.stringify(await Promise.all(items.map(persistedExtra))) ===
      JSON.stringify(before),
  );

  const partial = startBatch();
  await until(() => requests.length === 3, "successful first citation");
  requests[2].resolve(success());
  await until(
    () => requests.length === 4,
    "second citation pending after first save",
  );
  await clickProgress(2);
  requests[3].resolve(success());
  const partialResult = await partial;
  check(
    "partial cancellation counts the completed save and two untouched",
    partialResult.cancelled &&
      partialResult.updated === 1 &&
      partialResult.failed === 0 &&
      partialResult.stopped === 2,
  );
  check(
    "only completed first citation persisted",
    String(await persistedExtra(items[0])).includes(
      "Citations: 42 (Crossref)",
    ) &&
      (await persistedExtra(items[1])) === before[1] &&
      (await persistedExtra(items[2])) === before[2],
  );
  confirmed = false;
  check("declined batch returns no result", (await startBatch()) === undefined);
  check(
    "declined/closed batches produce no late UI or requests",
    requests.length === 4 && progress.length === 3 && alerts.length === 1,
  );
  check(
    "no native or unrelated network request occurred",
    blockedTransport === 0 && unexpectedHTTP === 0,
  );
  out.notes.push(
    `Zotero ${Zotero.version}; real menu, runner, citation modules and native progress clicks; 4 synthetic HTTP outcomes, no external transport.`,
  );
} catch (error) {
  out.fail.push("native batch probe completed");
  out.notes.push(String(error));
} finally {
  // Invalidate all work while both HTTP guards are still installed, then settle.
  for (const entry of progress) {
    try {
      entry.instance.close();
    } catch {
      /* already closed */
    }
  }
  for (const request of requests)
    request.resolve({ kind: "cancelled", status: 0, value: null });
  await Promise.allSettled(batches);
  for (const item of items.reverse()) {
    try {
      await item.eraseTx();
    } catch (error) {
      out.fail.push("fixture item erased");
      out.notes.push(String(error));
    }
  }
  if (itemIDs.length) {
    try {
      check(
        "native fixture items removed",
        (await Zotero.DB.valueQueryAsync(
          "SELECT COUNT(*) FROM items WHERE itemID IN (" +
            itemIDs.map(() => "?").join(",") +
            ")",
          itemIDs,
        )) === 0,
      );
    } catch (error) {
      out.fail.push("fixture deletion verified");
      out.notes.push(String(error));
    }
  }
  for (const restore of restorers.reverse()) {
    try {
      restore();
    } catch (error) {
      out.fail.push("probe method restored");
      out.notes.push(String(error));
    }
  }
  for (const [key, prior] of preferences) {
    try {
      if (prior.had) Zotero.Prefs.set(key, prior.value, true);
      else Zotero.Prefs.clear(key, true);
      check(
        `preference restored: ${key.slice(prefix.length)}`,
        Services.prefs.prefHasUserValue(key) === prior.had &&
          (!prior.had || Zotero.Prefs.get(key, true) === prior.value),
      );
    } catch (error) {
      out.fail.push("probe preference restored");
      out.notes.push(String(error));
    }
  }
}
out.summary = `${out.ok.length} passed, ${out.fail.length} failed`;
return out;
