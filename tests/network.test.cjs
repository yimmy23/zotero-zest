const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout, clearTimeout, setImmediate } = require("node:timers");
const { createHarness } = require("./helpers.cjs");

function memoryCache() {
  const entries = new Map();
  return {
    entries,
    get(ns, key, sanitize) {
      const value = entries.get(`${ns}/${key}`);
      if (value === undefined) return undefined;
      const data = sanitize(value);
      return data ? { data, age: 0 } : undefined;
    },
    ageOf: (ns, key) => (entries.has(`${ns}/${key}`) ? 0 : undefined),
    set: (ns, key, value) => entries.set(`${ns}/${key}`, value),
    remove: (ns, key) => entries.delete(`${ns}/${key}`),
  };
}

function httpHarness({
  status = 200,
  body = { answer: 42 },
  retryAfter,
  send,
} = {}) {
  const logs = [];
  let publicCalls = 0;
  let secretCalls = 0;
  class XHR {
    open() {}
    setRequestHeader() {}
    getResponseHeader() {
      return retryAfter ?? null;
    }
    send() {
      secretCalls++;
      this.status = status;
      this.responseText = JSON.stringify(body);
      if (status === 0) this.ontimeout();
      else this.onload();
    }
  }
  const h = createHarness({
    mocks: {
      "src/utils/prefs.ts": { getPref: () => "", getNumPref: () => 168 },
      "src/utils/timers.ts": { setTimeout, clearTimeout },
    },
    globals: {
      AbortController: globalThis.AbortController,
      ztoolkit: { log: (...args) => logs.push(args.join(" ")) },
      Zotero: {
        getMainWindow: () => ({ XMLHttpRequest: XHR }),
        HTTP: {
          request: async () => {
            publicCalls++;
            return send
              ? send()
              : {
                  status,
                  response: body,
                  getResponseHeader: () => retryAfter ?? null,
                };
          },
        },
        Promise: { delay: async () => {} },
      },
    },
  });
  return {
    ...h,
    http: h.load("src/core/http.ts").http,
    logs,
    counts: () => ({ publicCalls, secretCalls }),
  };
}

test("keyed and ordinary requests classify HTTP and transport outcomes identically", async () => {
  for (const [status, kind] of [
    [200, "ok"],
    [404, "not-found"],
    [401, "error"],
    [429, "throttled"],
    [503, "throttled"],
    [0, "unreachable"],
  ]) {
    for (const secret of [false, true]) {
      const h = httpHarness({ status });
      const result = await h.http.requestResult(
        "GET",
        "https://api.semanticscholar.org/example?api_key=fake-review-key",
        { secret, noCache: true, retries: 0 },
      );
      assert.equal(result.kind, kind, `${status}, secret=${secret}`);
      if (status === 429)
        assert.ok(h.http.throttledFor("https://api.semanticscholar.org/") > 0);
      if (status === 0) assert.equal(h.http.recentlyUnreachable(), true);
      assert.equal(h.logs.join(" ").includes("fake-review-key"), false);
      if (secret) assert.equal(h.counts().publicCalls, 0);
    }
  }
});

test("keyed Semantic Scholar throttling is not saved as a six-hour citation miss", async () => {
  const h = httpHarness({ status: 429 });
  const cache = memoryCache();
  h.mocks["src/utils/prefs.ts"] = {
    getPref: (key) => key === "cite.useSemanticScholar",
    getNumPref: () => 168,
  };
  h.mocks["src/core/storage.ts"] = { cache };
  h.mocks["src/core/secrets.ts"] = { getSecret: async () => "fake-review-key" };
  const cite = h.load("src/cite/index.ts");
  const outcome = await cite.updateCitations({
    libraryID: 1,
    key: "TEST",
    getField: (field) => (field === "DOI" ? "10.1234/test" : ""),
  });
  assert.equal(outcome.status, "throttled");
  assert.equal(cache.entries.size, 0);
});

test("back-off survives a force refresh and honours a long or HTTP-date Retry-After", async () => {
  for (const retryAfter of [
    "3600",
    new Date(Date.now() + 3600000).toUTCString(),
  ]) {
    const h = httpHarness({ status: 429, retryAfter });
    await h.http.requestResult("GET", "https://example.org/a", { retries: 0 });
    assert.ok(h.http.throttledFor("https://example.org/") > 3500000);
    const forced = await h.http.requestResult("GET", "https://example.org/b", {
      noCache: true,
    });
    assert.equal(forced.kind, "throttled");
    assert.equal(h.counts().publicCalls, 1);
  }
});

test("a queued request checks cancellation and a newly received host back-off before sending", async () => {
  for (const mode of ["cancel", "throttle"]) {
    const completions = [];
    let wanted = true;
    const h = httpHarness({
      send: () => new Promise((resolve) => completions.push(resolve)),
    });
    const running = Array.from({ length: 4 }, (_, i) =>
      h.http.requestResult("GET", `https://example.org/${i}`),
    );
    const queued = h.http.requestResult("GET", "https://example.org/queued", {
      shouldContinue: () => wanted,
    });
    await new Promise(setImmediate);
    assert.equal(completions.length, 4);
    wanted = mode !== "cancel";
    completions.forEach((resolve, i) =>
      resolve({
        status: mode === "throttle" && i === 0 ? 429 : 200,
        response: {},
        getResponseHeader: () => "60",
      }),
    );
    await Promise.all(running);
    assert.equal(
      (await queued).kind,
      mode === "cancel" ? "cancelled" : "throttled",
    );
    assert.equal(h.counts().publicCalls, 4);
  }
});

test("only true missing records enter the HTTP negative cache", async () => {
  for (const [status, expectedCalls] of [
    [404, 1],
    [0, 2],
    [401, 2],
  ]) {
    const h = httpHarness({ status });
    await h.http.request("GET", "https://example.org/a", { retries: 0 });
    await h.http.request("GET", "https://example.org/a", { retries: 0 });
    assert.equal(h.counts().publicCalls, expectedCalls);
  }
});

test("cancelling an active request preserves a server's Retry-After before releasing its queue slot", async () => {
  let complete;
  let wanted = true;
  const h = httpHarness({
    send: () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  });
  const running = h.http.requestResult("GET", "https://example.org/first", {
    shouldContinue: () => wanted,
  });
  await new Promise(setImmediate);
  wanted = false;
  complete({ status: 429, response: {}, getResponseHeader: () => "3600" });
  const result = await running;
  assert.equal(result.kind, "cancelled");
  assert.equal(result.value, null);
  assert.ok(h.http.throttledFor("https://example.org/") > 3500000);
  assert.equal(
    (
      await h.http.requestResult("GET", "https://example.org/second", {
        noCache: true,
      })
    ).kind,
    "throttled",
  );
  assert.equal(h.counts().publicCalls, 1);
});

test("a cancelled easyScholar response still preserves the HTTP-200 business rate limit", async () => {
  let complete;
  let wanted = true;
  const h = httpHarness();
  h.context.Zotero.getMainWindow = () => ({
    XMLHttpRequest: class {
      open() {}
      setRequestHeader() {}
      getResponseHeader() {
        return null;
      }
      send() {
        complete = () => {
          this.status = 200;
          this.responseText = JSON.stringify({ code: 40006 });
          this.onload();
        };
      }
    },
  });
  h.mocks["src/core/secrets.ts"] = { getSecret: async () => "fake-review-key" };
  const es = h.load("src/rank/sources/easyscholar.ts");
  const running = es.fetchEasyScholar("Example", () => wanted);
  await new Promise(setImmediate);
  wanted = false;
  complete();
  assert.equal((await running).error, "rate");
  assert.equal(es.easyScholarBlocked(), true);
  assert.equal((await es.fetchEasyScholar("Next")).error, "rate");
});

test("transport failure tracking can be scoped to one host", async () => {
  const h = httpHarness({ status: 0 });
  await h.http.requestResult("GET", "https://api.crossref.org/example", {
    retries: 0,
  });
  assert.equal(h.http.recentlyUnreachable("https://api.crossref.org/"), true);
  assert.equal(h.http.recentlyUnreachable("https://api.openalex.org/"), false);
});

function authorHarness(request) {
  const cache = memoryCache();
  let automatic = false;
  let calls = 0;
  const h = createHarness({
    mocks: {
      "src/core/storage.ts": { cache },
      "src/core/http.ts": {
        politeParam: () => "",
        http: {
          requestResult: async (...args) => {
            calls++;
            return request(...args);
          },
        },
      },
      "src/cite/sources.ts": { cleanDOI: (item) => item.doi },
      "src/utils/prefs.ts": { getPref: () => automatic },
    },
  });
  return {
    cache,
    api: h.load("src/graph/authorFetch.ts"),
    calls: () => calls,
    enable: () => {
      automatic = true;
    },
  };
}
const items = (count) =>
  Array.from({ length: count }, (_, i) => ({
    libraryID: 1,
    key: `K${i}`,
    doi: `10.1234/${i}`,
  }));
const authorSuccess = {
  kind: "ok",
  status: 200,
  value: {
    authorships: [
      {
        author: {
          id: "https://openalex.org/A1",
          display_name: "Example Author",
        },
      },
    ],
  },
};

test("automatic authorship lookup is opt-in; offline requests stop without poisoning miss cache", async () => {
  const h = authorHarness(async () => ({
    kind: "unreachable",
    status: 0,
    value: null,
  }));
  assert.equal(
    await h.api.ensureAuthorships(items(40), { automatic: true }),
    false,
  );
  assert.equal(h.calls(), 0);
  h.enable();
  await h.api.ensureAuthorships(items(40), { automatic: true });
  assert.equal(h.calls(), 1);
  assert.equal(h.cache.entries.size, 0);
});

test("concurrent authorship consumers share a DOI request while keeping separate item caches", async () => {
  let complete;
  const h = authorHarness(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const [a, b] = items(2);
  b.doi = a.doi;
  const first = h.api.ensureAuthorships([a]);
  const second = h.api.ensureAuthorships([b]);
  assert.equal(h.calls(), 1);
  complete(authorSuccess);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(h.cache.entries.size, 2);
});

test("closing a caller or stopping the plugin discards late authorship responses", async () => {
  for (const stop of [false, true]) {
    let complete;
    let wanted = true;
    const h = authorHarness(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const running = h.api.ensureAuthorships(items(3), {
      shouldContinue: () => wanted,
    });
    if (stop) h.api.stopAuthorshipFetches();
    else wanted = false;
    complete(authorSuccess);
    assert.equal(await running, false);
    assert.equal(h.calls(), 1);
    assert.equal(h.cache.entries.size, 0);
  }
});

test("malformed responses stop at the author error limit rather than becoming durable misses", async () => {
  const h = authorHarness(async () => ({ kind: "ok", status: 200, value: {} }));
  await h.api.ensureAuthorships(items(40));
  assert.equal(h.calls(), 3);
  assert.equal(h.cache.entries.size, 0);
});
