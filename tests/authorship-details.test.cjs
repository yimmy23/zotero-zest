const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const plain = (value) => JSON.parse(JSON.stringify(value));
const legacy = [{ i: "A1", n: "Alice First", a: "Old Institute" }];
const raw = (extra = {}) => ({
  author: { id: "https://openalex.org/A1", display_name: "Alice First" },
  author_position: "first",
  is_corresponding: true,
  institutions: [
    { id: "https://openalex.org/I1", display_name: "Full Institute" },
    { id: "https://openalex.org/I2", display_name: "Second Institute" },
  ],
  ...extra,
});
const success = (authorships = [raw()]) => ({
  kind: "ok",
  status: 200,
  value: { authorships },
});

function fixture(request = async () => success()) {
  const entries = new Map();
  const cache = {
    entries,
    get(ns, key, sanitize) {
      const entry = entries.get(`${ns}/${key}`);
      if (!entry) return undefined;
      const data = sanitize(entry.data);
      return data ? { data, age: entry.age } : undefined;
    },
    ageOf: (ns, key) => entries.get(`${ns}/${key}`)?.age,
    set: (ns, key, data) => entries.set(`${ns}/${key}`, { data, age: 0 }),
    remove: (ns, key) => entries.delete(`${ns}/${key}`),
  };
  let calls = 0;
  const h = createHarness({
    mocks: {
      "src/core/storage.ts": { cache },
      "src/core/http.ts": {
        politeParam: () => "",
        http: {
          requestResult: (...args) => {
            calls++;
            return request(...args);
          },
        },
      },
      "src/cite/sources.ts": { cleanDOI: (item) => item.doi },
      "src/utils/prefs.ts": { getPref: () => true },
    },
  });
  const item = {
    libraryID: 1,
    key: "ITEM",
    doi: "10.1234/paper",
    getField() {
      return this.doi;
    },
  };
  return {
    item,
    cache,
    api: h.load("src/graph/authorIdentity.ts"),
    fetch: h.load("src/graph/authorFetch.ts").ensureAuthorships,
    calls: () => calls,
  };
}

test("detailed authorship cache round-trips strict roles and complete multiple affiliations", () => {
  const h = fixture();
  const name = "A complete university medical center affiliation "
    .repeat(8)
    .trim();
  const compact = h.api.compactAuthorships(
    [
      raw({
        institutions: [
          { id: "https://openalex.org/I1", display_name: name },
          { id: "https://openalex.org/I2", display_name: "Second Institute" },
        ],
      }),
    ],
    "https://doi.org/10.1234/PAPER",
  );
  h.cache.set("oaAuthors", "1/ITEM", compact);
  const result = h.api.cachedAuthorships(h.item);
  assert.deepEqual(plain(result), plain(compact));
  assert.equal(result[0].af[0].n, name);
  assert.equal(result[0].a, name.slice(0, 120).trim());
  assert.equal(result[0].af.length, 2);
  assert.equal(result[0].c, true);
  assert.equal(result[0].p, "first");
  assert.equal(result[0].d, "10.1234/paper");
});

test("legacy arrays survive unchanged while new unknown roles are marked detailed", () => {
  const h = fixture();
  h.cache.set("oaAuthors", "1/ITEM", legacy);
  assert.deepEqual(plain(h.api.cachedAuthorships(h.item)), legacy);
  const [record] = h.api.compactAuthorships([
    raw({ author_position: "corresponding", is_corresponding: "true" }),
  ]);
  assert.equal(record.v, 2);
  assert.equal(record.p, undefined);
  assert.equal(record.c, undefined);
  h.cache.set("oaAuthors", "1/ITEM", [
    {
      ...record,
      p: "anything",
      c: 1,
      af: [{ n: 3 }, { n: " Real Institute " }],
    },
  ]);
  const [sanitized] = h.api.cachedAuthorships(h.item);
  assert.equal(sanitized.p, undefined);
  assert.equal(sanitized.c, undefined);
  assert.deepEqual(plain(sanitized.af), [{ n: "Real Institute" }]);
});

test("raw affiliation fallback preserves each full string and bounds malformed inputs", () => {
  const h = fixture();
  const rows = h.api.compactAuthorships(
    Array.from({ length: 120 }, () =>
      raw({
        institutions: [],
        raw_affiliation_strings: [
          "One full institute",
          "Second full institute",
          17,
        ],
      }),
    ),
  );
  assert.equal(rows.length, 100);
  assert.deepEqual(plain(rows[0].af), [
    { n: "One full institute" },
    { n: "Second full institute" },
  ]);
  assert.equal(
    h.api.compactAuthorships([{ author: { id: {}, display_name: 4 } }]),
    null,
  );
});

test("details mode upgrades legacy records exactly once; graph mode keeps old cheap cache reads", async () => {
  const h = fixture();
  h.cache.set("oaAuthors", "1/ITEM", legacy);
  assert.equal(await h.fetch([h.item]), false);
  assert.equal(h.calls(), 0);
  assert.equal(await h.fetch([h.item], { details: true }), true);
  assert.equal(h.calls(), 1);
  assert.equal(h.api.cachedAuthorships(h.item)[0].v, 2);
  assert.equal(await h.fetch([h.item], { details: true }), false);
  assert.equal(h.calls(), 1);
});

test("successful unknown role responses are not repeatedly upgraded", async () => {
  const h = fixture(async () =>
    success([raw({ author_position: undefined, is_corresponding: undefined })]),
  );
  h.cache.set("oaAuthors", "1/ITEM", legacy);
  assert.equal(await h.fetch([h.item], { details: true }), true);
  assert.equal(h.api.cachedAuthorships(h.item)[0].c, undefined);
  assert.equal(await h.fetch([h.item], { details: true }), false);
  assert.equal(h.calls(), 1);
});

test("failed and negative legacy upgrades preserve old data and back off retries", async () => {
  for (const result of [
    { kind: "unreachable", status: 0 },
    { kind: "throttled", status: 429 },
    { kind: "error", status: 500 },
    { kind: "not-found", status: 404 },
    success([]),
    { kind: "ok", status: 200, value: {} },
  ]) {
    const h = fixture(async () => result);
    h.cache.set("oaAuthors", "1/ITEM", legacy);
    assert.equal(await h.fetch([h.item], { details: true }), false);
    assert.deepEqual(plain(h.api.cachedAuthorships(h.item)), legacy);
    assert.equal(await h.fetch([h.item], { details: true }), false);
    assert.equal(h.calls(), 1, result.kind);
    if (
      result.kind === "not-found" ||
      result.value?.authorships?.length === 0
    ) {
      for (const [key, entry] of h.cache.entries) {
        if (!key.startsWith("oaAuthors/")) entry.age = 31 * 1000;
      }
      assert.equal(await h.fetch([h.item], { details: true }), false);
      assert.equal(h.calls(), 1, "true missing records still wait six hours");
    }
    for (const [key, entry] of h.cache.entries) {
      if (!key.startsWith("oaAuthors/")) entry.age = 7 * 60 * 60 * 1000;
    }
    await h.fetch([h.item], { details: true });
    assert.equal(h.calls(), 2, "backoff expires");
  }
});

test("a transient detail failure retries after 30 seconds when connectivity recovers", async () => {
  for (const initial of [
    { kind: "unreachable", status: 0 },
    { kind: "throttled", status: 429 },
    { kind: "error", status: 500 },
    { kind: "ok", status: 200, value: {} },
  ]) {
    let recovered = false;
    const h = fixture(async () => (recovered ? success() : initial));
    h.cache.set("oaAuthors", "1/ITEM", legacy);
    assert.equal(await h.fetch([h.item], { details: true }), false);
    recovered = true;
    for (const [key, entry] of h.cache.entries) {
      if (key.startsWith("oaAuthorsDetailsRetry/")) entry.age = 29 * 1000;
    }
    assert.equal(await h.fetch([h.item], { details: true }), false);
    assert.equal(
      h.calls(),
      1,
      "brief repaint bursts do not hammer the endpoint",
    );
    for (const [key, entry] of h.cache.entries) {
      if (key.startsWith("oaAuthorsDetailsRetry/")) entry.age = 30 * 1000;
    }
    assert.equal(await h.fetch([h.item], { details: true }), true);
    assert.equal(h.calls(), 2, initial.kind);
    assert.equal(h.api.cachedAuthorships(h.item)[0].v, 2);
    assert.equal(
      [...h.cache.entries.keys()].some((key) =>
        key.startsWith("oaAuthorsDetailsRetry/"),
      ),
      false,
    );
  }
});

test("a DOI accessor failure safely invalidates transport callbacks and late responses", async () => {
  let complete;
  let shouldContinue;
  const h = fixture((_method, _url, options) => {
    shouldContinue = options.shouldContinue;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  h.cache.set("oaAuthors", "1/ITEM", legacy);
  const running = h.fetch([h.item], { details: true });
  Object.defineProperty(h.item, "doi", {
    get() {
      throw new Error("item is no longer readable");
    },
  });
  assert.equal(shouldContinue(), false);
  complete(success());
  assert.equal(await running, false);
  assert.deepEqual(plain(h.api.cachedAuthorships(h.item)), legacy);
  assert.equal(h.cache.entries.size, 1);
});

test("cancelled legacy upgrades neither overwrite nor poison retries", async () => {
  let complete;
  let current = true;
  const h = fixture(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  h.cache.set("oaAuthors", "1/ITEM", legacy);
  const running = h.fetch([h.item], {
    details: true,
    shouldContinue: () => current,
  });
  current = false;
  complete(success());
  assert.equal(await running, false);
  assert.equal(h.cache.entries.size, 1);
  assert.deepEqual(plain(h.api.cachedAuthorships(h.item)), legacy);
  const retry = h.fetch([h.item], { details: true });
  complete(success());
  assert.equal(await retry, true);
  assert.equal(h.calls(), 2);
});

test("DOI changes invalidate detailed identities and discard in-flight old-paper responses", async () => {
  let complete;
  const h = fixture(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  h.cache.set(
    "oaAuthors",
    "1/ITEM",
    h.api.compactAuthorships([raw()], h.item.doi),
  );
  h.item.doi = "10.1234/another";
  assert.equal(h.api.cachedAuthorships(h.item), null);
  const running = h.fetch([h.item], { details: true });
  h.item.doi = "10.1234/third";
  complete(success());
  assert.equal(await running, false);
  assert.equal(h.api.cachedAuthorships(h.item), null);
  const retry = h.fetch([h.item], { details: true });
  complete(success());
  assert.equal(await retry, true);
  assert.equal(h.api.cachedAuthorships(h.item)[0].d, "10.1234/third");
  h.item.doi = "";
  assert.equal(h.api.cachedAuthorships(h.item), null);
});

test("a failed lookup for one DOI does not block lookup after the DOI is corrected", async () => {
  const h = fixture(async () => ({ kind: "not-found", status: 404 }));
  await h.fetch([h.item], { details: true });
  await h.fetch([h.item], { details: true });
  assert.equal(h.calls(), 1);
  h.item.doi = "10.1234/corrected";
  await h.fetch([h.item], { details: true });
  assert.equal(h.calls(), 2);
});
