const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate } = require("node:timers");
const { createHarness } = require("./helpers.cjs");

const csv = [
  "Journal,ISSN,eISSN,IF(2025),Category_1,IF Quartile(2025)_1,IF Rank(2025)_1",
  '"Cancer Immunology, Immunotherapy",0340-7004,1432-0851,5.8,IMMUNOLOGY,Q1,40/183',
].join("\n");
const parserHarness = createHarness({ mocks: { "src/core/config.ts": {} } });
const { parseCsvRows } = parserHarness.load("src/rank/sources/localDataset.ts");
const { parseShowJCRRows } = parserHarness.load("src/rank/sources/showjcr.ts");

function fixture({
  response = { kind: "ok", status: 200, value: csv },
  transport,
  parse,
  save,
} = {}) {
  const requests = [];
  const saves = [];
  const parsedInputs = [];
  const meta = {
    id: "showjcr-jcr",
    name: "ShowJCR 2025",
    rows: 22643,
    fields: ["sciif"],
    updated: 1,
  };
  const h = createHarness({
    mocks: {
      "src/core/http.ts": {
        http: {
          async requestResult(...args) {
            requests.push(args);
            return transport ? transport(...args) : response;
          },
        },
      },
      "src/rank/sources/localDataset.ts": {
        parseCsvRows,
        async saveShowJCRDataset(parsed) {
          saves.push(parsed);
          return save ? save(parsed) : meta;
        },
      },
      "src/rank/sources/showjcr.ts": {
        parseShowJCRRows(rows) {
          parsedInputs.push(rows);
          if (parse) return parse(rows);
          const result = parseShowJCRRows(rows);
          // Cardinality stands in for the pinned full snapshot. The first row
          // still goes through the real CSV and journal metadata adapters.
          return result?.rows.length
            ? { ...result, rows: Array(22643).fill(result.rows[0]) }
            : result;
        },
      },
    },
  });
  const downloader = h.load("src/rank/sources/showjcrDownload.ts");
  return { ...h, downloader, requests, saves, parsedInputs, meta };
}

test("ShowJCR downloads only on explicit action and passes a complete parsed table to managed storage", async () => {
  const h = fixture();
  assert.equal(h.requests.length, 0);
  assert.equal(await h.downloader.downloadShowJCR(), h.meta);
  assert.equal(h.requests.length, 1);
  const [method, url, options] = h.requests[0];
  assert.equal(method, "GET");
  assert.equal(url, h.downloader.SHOWJCR_URL);
  assert.match(url, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.ok(url.includes(h.downloader.SHOWJCR_REVISION));
  assert.match(h.downloader.SHOWJCR_REVISION, /^[a-f0-9]{40}$/);
  assert.equal(h.downloader.SHOWJCR_EXPECTED_ROWS, 22643);
  assert.equal(options.responseType, "text");
  assert.equal(options.noCache, true);
  assert.equal(options.retries, 0);
  assert.ok(options.timeout > 0 && options.timeout <= 60000);
  assert.equal(options.shouldContinue(), true);
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].rows.length, h.downloader.SHOWJCR_EXPECTED_ROWS);
  assert.equal(h.saves[0].rows[0].jcr.year, 2025);
  assert.equal(h.saves[0].rows[0].jcr.provider, "showjcr");
  assert.equal(h.saves[0].rows[0].jcr.categories[0].rank, "40/183");
});

test("failed, cancelled, malformed or over-limit responses never write a dataset", async () => {
  const responses = [
    { kind: "unreachable", status: 0, value: null },
    { kind: "throttled", status: 429, value: null },
    { kind: "not-found", status: 404, value: null },
    { kind: "error", status: 500, value: "private upstream message" },
    { kind: "cancelled", status: 0, value: null },
    { kind: "ok", status: 200, value: {} },
    { kind: "ok", status: 200, value: "<html>error page</html>" },
    { kind: "ok", status: 200, value: csv.split("\n")[0] },
    { kind: "ok", status: 200, value: "x".repeat(16 * 1024 * 1024 + 1) },
  ];
  for (const response of responses) {
    const h = fixture({ response });
    await assert.rejects(h.downloader.downloadShowJCR(), (error) => {
      assert.doesNotMatch(error.message, /private upstream message/);
      return true;
    });
    assert.equal(h.saves.length, 0, response.kind);
  }
  const truncated = fixture({ parse: parseShowJCRRows });
  await assert.rejects(truncated.downloader.downloadShowJCR(), /Invalid/);
  assert.equal(truncated.saves.length, 0);
  const excessive = fixture({
    parse: () => ({
      name: "ShowJCR",
      rows: Array(100001).fill({}),
      fields: [],
    }),
  });
  await assert.rejects(excessive.downloader.downloadShowJCR(), /Invalid/);
  assert.equal(excessive.saves.length, 0);
});

test("shutdown during download invalidates the request continuation and prevents parsing or saving", async () => {
  let release;
  const h = fixture({
    transport: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const job = h.downloader.downloadShowJCR();
  h.context.addon.data.alive = false;
  assert.equal(h.requests[0][2].shouldContinue(), false);
  release({ kind: "ok", status: 200, value: csv });
  await assert.rejects(job, /cancelled/);
  assert.equal(h.parsedInputs.length, 0);
  assert.equal(h.saves.length, 0);
});

test("concurrent downloads share one request, parse and save, and later actions can refresh again", async () => {
  let release;
  const h = fixture({
    transport: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const first = h.downloader.downloadShowJCR();
  const second = h.downloader.downloadShowJCR();
  assert.equal(first, second);
  assert.equal(h.requests.length, 1);
  release({ kind: "ok", status: 200, value: csv });
  await Promise.all([first, second]);
  assert.equal(h.parsedInputs.length, 1);
  assert.equal(h.saves.length, 1);
  const next = h.downloader.downloadShowJCR();
  assert.notEqual(next, first);
  assert.equal(h.requests.length, 2);
  release({ kind: "ok", status: 200, value: csv });
  await next;
  assert.equal(h.saves.length, 2);
});

test("a failed download or storage operation clears pending state so a later explicit retry can succeed", async () => {
  let requestCount = 0;
  const h = fixture({
    transport: async () => {
      requestCount++;
      return requestCount === 1
        ? { kind: "unreachable", status: 0, value: null }
        : { kind: "ok", status: 200, value: csv };
    },
  });
  await assert.rejects(h.downloader.downloadShowJCR(), /failed/);
  assert.equal(h.saves.length, 0);
  assert.equal(await h.downloader.downloadShowJCR(), h.meta);
  let saves = 0;
  const failingSave = fixture({
    save: async () => {
      saves++;
      if (saves === 1) throw new Error("disk failure");
      return { id: "showjcr-jcr" };
    },
  });
  await assert.rejects(
    failingSave.downloader.downloadShowJCR(),
    /disk failure/,
  );
  await new Promise(setImmediate);
  assert.equal(
    (await failingSave.downloader.downloadShowJCR()).id,
    "showjcr-jcr",
  );
  assert.equal(failingSave.requests.length, 2);
});
