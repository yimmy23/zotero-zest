const assert = require("node:assert/strict");
const test = require("node:test");
const { setImmediate } = require("node:timers/promises");
const { createHarness } = require("./helpers.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture({ source = "Crossref", extra = "User note", save } = {}) {
  const prefs = new Map([
    ["cite.useCrossref", source === "Crossref"],
    ["cite.useOpenAlex", source === "OpenAlex"],
    ["cite.useSemanticScholar", source === "Semantic Scholar"],
  ]);
  const requests = [];
  const cacheEntries = new Map();
  const fields = { DOI: "10.1234/original", PMID: "", extra };
  let saved = extra;
  let saves = 0;
  let editable = true;
  const item = {
    libraryID: 1,
    key: "CITE0001",
    deleted: false,
    isRegularItem: () => true,
    isEditable: () => editable,
    getField: (field) => fields[field] || "",
    setField: (field, value) => {
      fields[field] = value;
    },
    async saveTx() {
      saves++;
      if (save) await save({ fields, saves });
      saved = fields.extra;
    },
  };
  const h = createHarness({
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (key) => prefs.get(key),
        getNumPref: () => 90,
      },
      "src/core/storage.ts": {
        cache: {
          ageOf: (ns, key) =>
            cacheEntries.has(`${ns}/${key}`) ? 0 : undefined,
          set: (ns, key, value) => cacheEntries.set(`${ns}/${key}`, value),
          remove: (ns, key) => cacheEntries.delete(`${ns}/${key}`),
        },
      },
      "src/core/http.ts": {
        politeParam: () => "",
        http: {
          requestResult(method, url, options) {
            const response = deferred();
            requests.push({ url, options, response });
            return response.promise;
          },
        },
      },
      "src/core/secrets.ts": { getSecret: async () => "" },
      "src/graph/authorIdentity.ts": {
        compactAuthorships: () => null,
      },
    },
  });
  return {
    ...h,
    cite: h.load("src/cite/index.ts"),
    item,
    fields,
    prefs,
    requests,
    cacheEntries,
    saved: () => saved,
    saves: () => saves,
    lock: () => {
      editable = false;
    },
    reply(index, count = 42) {
      requests[index].response.resolve({
        kind: "ok",
        status: 200,
        value: {
          message: { "is-referenced-by-count": count },
          cited_by_count: count,
          citationCount: count,
        },
      });
    },
  };
}

test("citation save failure restores memory and the identical result retries persistence", async () => {
  const before = "User note\r\n\r\n  \r\n";
  const h = fixture({
    extra: before,
    save: ({ saves }) => {
      if (saves === 1) throw new Error("Temporary save failure");
    },
  });
  const first = h.cite.updateCitations(h.item);
  h.reply(0);
  assert.equal((await first).status, "failed");
  assert.equal(h.fields.extra, before);
  assert.equal(h.saved(), before);
  const retry = h.cite.updateCitations(h.item);
  h.reply(1);
  assert.equal((await retry).status, "updated");
  assert.equal(h.saves(), 2);
  assert.ok(h.saved().startsWith(`${before}\r\nCitations: 42 (Crossref)`));
  const repeat = h.cite.updateCitations(h.item);
  h.reply(2);
  assert.equal((await repeat).status, "unchanged");
  assert.equal(h.saves(), 2);
});

test("citation retry persists the matching unsaved value without rolling back another editor", async () => {
  const gate = deferred();
  const h = fixture({
    save: ({ saves }) => (saves === 1 ? gate.promise : null),
  });
  const first = h.cite.updateCitations(h.item);
  h.reply(0);
  await setImmediate();
  h.fields.extra += "\nOtherPlugin: concurrent edit\r\n\n";
  const newer = h.fields.extra;
  gate.reject(new Error("Save rejected"));
  assert.equal((await first).status, "failed");
  assert.equal(h.fields.extra, newer);
  const retry = h.cite.updateCitations(h.item);
  h.reply(1);
  assert.equal((await retry).status, "updated");
  assert.equal(h.saves(), 2);
  assert.equal(h.saved(), newer);
});

test("an unchanged count from a different source replaces the source on the same day", async () => {
  const h = fixture();
  const date = h.load("src/cite/extraFormat.ts").todayISO();
  h.fields.extra = `User note\r\nCitations: 42 (OpenAlex) [${date}]\nForeign: unchanged\r\n`;
  const update = h.cite.updateCitations(h.item);
  h.reply(0);
  assert.equal((await update).status, "updated");
  assert.equal(
    h.saved(),
    `User note\r\nCitations: 42 (Crossref) [${date}]\nForeign: unchanged\r\n`,
  );
});

for (const change of [
  "DOI",
  "PMID",
  "Extra PMID",
  "library",
  "key",
  "deleted",
  "read-only",
]) {
  test(`citation responses are discarded after a ${change} change`, async () => {
    const h = fixture();
    if (change === "PMID") h.fields.PMID = "12345";
    if (change === "Extra PMID") h.fields.extra += "\nPMID: 12345";
    const update = h.cite.updateCitations(h.item);
    if (change === "DOI") h.fields.DOI = "10.1234/replacement";
    if (change === "PMID") h.fields.PMID = "67890";
    if (change === "Extra PMID") h.fields.extra = "PMID: 67890\nUser note";
    if (change === "library") h.item.libraryID = 2;
    if (change === "key") h.item.key = "CITE0002";
    if (change === "deleted") h.item.deleted = true;
    if (change === "read-only") h.lock();
    assert.equal(h.requests[0].options.shouldContinue(), false);
    const before = h.fields.extra;
    h.reply(0);
    assert.equal((await update).status, "cancelled");
    assert.equal(h.saves(), 0);
    assert.equal(h.fields.extra, before);
    assert.equal(h.cacheEntries.size, 0);
  });
}

test("equivalent DOI spelling does not invalidate a citation request", async () => {
  const h = fixture();
  const update = h.cite.updateCitations(h.item);
  h.fields.DOI = "https://doi.org/10.1234/ORIGINAL";
  h.reply(0);
  assert.equal((await update).status, "updated");
});

test("shutdown and restart cannot revive a response from the previous citation lifetime", async () => {
  const h = fixture();
  const old = h.cite.updateCitations(h.item);
  h.cite.stopCitations();
  assert.equal(h.requests[0].options.shouldContinue(), false);
  assert.equal((await h.cite.updateCitations(h.item)).status, "cancelled");
  h.cite.startCitations();
  const fresh = h.cite.updateCitations(h.item);
  h.reply(1, 77);
  assert.equal((await fresh).status, "updated");
  h.reply(0, 42);
  assert.equal((await old).status, "cancelled");
  assert.equal(h.saves(), 1);
  assert.match(h.saved(), /Citations: 77 /);
});

test("two sources completing in reverse order retain the latest user request", async () => {
  const h = fixture();
  const older = h.cite.updateCitations(h.item, true);
  h.prefs.set("cite.useCrossref", false);
  h.prefs.set("cite.useOpenAlex", true);
  const newer = h.cite.updateCitations(h.item, true);
  h.reply(1, 50);
  assert.equal((await newer).status, "updated");
  h.reply(0, 100);
  assert.equal((await older).status, "cancelled");
  assert.equal(h.saves(), 1);
  assert.match(h.saved(), /Citations: 50 \(OpenAlex\)/);
});

test("a citation queued behind another Extra save rechecks identity before committing", async () => {
  const gate = deferred();
  const h = fixture({
    save: ({ saves }) => (saves === 1 ? gate.promise : null),
  });
  const utils = h.load("src/utils/extra.ts");
  const remark = utils.setExtraLine(h.item, ["Remark"], "User draft");
  const citation = h.cite.updateCitations(h.item);
  h.reply(0);
  await setImmediate();
  h.fields.DOI = "10.1234/new";
  gate.resolve();
  assert.equal(await remark, true);
  assert.equal((await citation).status, "cancelled");
  assert.equal(h.saves(), 1);
  assert.equal(h.saved(), "User note\nRemark: User draft");
});

test("citation and ordinary Extra saves share a queue and retain both latest edits", async () => {
  const gate = deferred();
  const h = fixture({
    save: ({ saves }) => (saves === 1 ? gate.promise : null),
  });
  const utils = h.load("src/utils/extra.ts");
  const citation = h.cite.updateCitations(h.item);
  h.reply(0);
  await setImmediate();
  const remark = utils.setExtraLine(h.item, ["Remark"], "User draft");
  await setImmediate();
  assert.equal(h.saves(), 1);
  assert.equal(h.fields.extra.includes("Remark:"), false);
  h.fields.extra += "\nExternal: Latest note";
  gate.resolve();
  assert.equal((await citation).status, "updated");
  assert.equal(await remark, true);
  assert.equal(h.saves(), 2);
  assert.ok(h.saved().includes("Citations: 42 (Crossref)"));
  assert.ok(h.saved().endsWith("\nExternal: Latest note\nRemark: User draft"));
});

test("changing identifiers bypasses a previous identity's not-found backoff", async () => {
  const h = fixture();
  const first = h.cite.updateCitations(h.item);
  h.requests[0].response.resolve({
    kind: "not-found",
    status: 404,
    value: null,
  });
  assert.equal((await first).status, "not-found");
  assert.equal((await h.cite.updateCitations(h.item)).status, "failed");
  assert.equal(h.requests.length, 1);
  h.fields.DOI = "10.1234/corrected";
  const corrected = h.cite.updateCitations(h.item);
  assert.equal(h.requests.length, 2);
  h.reply(1);
  assert.equal((await corrected).status, "updated");
});

test("citation sources forward cancellation and do not request S2 after cancelled key lookup", async () => {
  for (const source of ["Crossref", "OpenAlex", "Semantic Scholar"]) {
    const h = fixture({ source });
    let wanted = true;
    const update = h.cite.updateCitations(h.item, true, () => wanted);
    if (source === "Semantic Scholar") wanted = false;
    await setImmediate();
    if (source === "Semantic Scholar") assert.equal(h.requests.length, 0);
    else {
      wanted = false;
      assert.equal(h.requests[0].options.shouldContinue(), false);
      h.reply(0);
    }
    assert.equal((await update).status, "cancelled");
    assert.equal(h.saves(), 0);
  }
});
