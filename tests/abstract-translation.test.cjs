const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

const SOURCE = "Methods\nA literal <b> label.\n\nResults\nP<0.001 and >90%.";
const TRANSLATED = "方法\n字面 <b> 标签。\n\n结果\nP<0.001 且 >90%。";
const ok = (text = TRANSLATED) => ({
  kind: "ok",
  status: 200,
  value: [{ translations: [{ text }] }],
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function harness({ translate, respond = () => ok() } = {}) {
  const calls = [];
  const logs = [];
  const timers = new Map();
  let now = 1000;
  let nextTimer = 0;
  const Zotero = {
    ...(translate ? { PDFTranslate: { api: { translate } } } : {}),
    Items: new Proxy({}, { get: () => assert.fail("No item access") }),
  };
  const h = createHarness({
    mocks: {
      "src/core/http.ts": {
        http: {
          requestResult(...args) {
            calls.push(args);
            return respond(...args);
          },
        },
      },
      "src/utils/timers.ts": {
        setTimeout(fn, ms) {
          timers.set(++nextTimer, { fn, at: now + ms });
          return nextTimer;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
      },
    },
    globals: {
      Zotero,
      ztoolkit: { log: (...args) => logs.push(args) },
      Date: class extends Date {
        static now() {
          return now;
        }
      },
    },
  });
  return {
    api: h.load("src/panes/abstractTranslation.ts"),
    calls,
    logs,
    timers,
    Zotero,
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.fn();
      }
      await flush();
    },
  };
}

test("provider discovery is read-only and does not auto-translate", () => {
  let count = 0;
  const h = harness({ translate: () => count++ });
  assert.equal(h.api.translationProvider().id, "pdftranslate");
  assert.equal(h.api.translationProvider().label, "Translate for Zotero");
  assert.equal(count, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
  const fallback = harness();
  assert.equal(fallback.api.translationProvider().id, "bing");
  assert.equal(fallback.calls.length, 0);
});

test("official custom API explicitly sets both languages, caller and no itemID", async () => {
  let input;
  let receiver;
  const h = harness({
    translate: function (...args) {
      receiver = this;
      input = args;
      return {
        status: "success",
        result: TRANSLATED,
        secret: "NEVER-EXPOSE",
        extraTasks: [{ secret: "SECOND-SECRET" }],
      };
    },
  });
  const result = await h.api.translateAbstract(SOURCE);
  assert.equal(result.kind, "ok");
  assert.equal(result.text, TRANSLATED);
  assert.equal(result.provider, "Translate for Zotero");
  assert.equal(receiver, h.Zotero.PDFTranslate.api);
  assert.equal(input[0], SOURCE);
  assert.deepEqual(JSON.parse(JSON.stringify(input[1])), {
    pluginID: "zest@zotero-zest.app",
    langfrom: "en-US",
    langto: "zh-CN",
  });
  assert.deepEqual(Object.keys(result).sort(), ["kind", "provider", "text"]);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.logs, []);
  assert.equal(h.timers.size, 0);
});

test("configured provider failures never leak tasks or silently use Bing", async () => {
  for (const translate of [
    () => ({ status: "fail", result: "SECRET failure", secret: "SECRET" }),
    () => ({ status: "processing", result: TRANSLATED }),
    () => null,
    () => Promise.reject(new Error("SECRET token")),
    () => {
      throw { secret: "SECRET", result: "SECRET" };
    },
    () => ({ status: "success", result: {} }),
  ]) {
    const h = harness({ translate });
    const result = await h.api.translateAbstract(SOURCE);
    assert.equal(result.kind, "error");
    assert.equal(result.text, undefined);
    assert.doesNotMatch(JSON.stringify(result), /SECRET/);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.logs, []);
    assert.equal(h.timers.size, 0);
  }
});

test("built-in translator sends one private, uncached POST and preserves literal text", async () => {
  const h = harness();
  const result = await h.api.translateAbstract(SOURCE);
  assert.equal(result.text, TRANSLATED);
  assert.equal(result.provider, "Microsoft Translator");
  assert.equal(h.calls.length, 1);
  const [method, url, options] = h.calls[0];
  assert.equal(method, "POST");
  assert.equal(
    url,
    "https://edge.microsoft.com/translate/translatetext?from=en-US&to=zh-CN&isEnterpriseClient=false",
  );
  assert.deepEqual(JSON.parse(options.body), [
    "方法\nA literal <b> label.\n\n结果\nP<0.001 and >90%.",
  ]);
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.equal(options.secret, true);
  assert.equal(options.noCache, true);
  assert.equal(options.retries, 0);
  assert.equal(options.timeout, 20000);
  assert.equal(options.shouldContinue(), false);
  assert.deepEqual(h.logs, []);
});

test("Bing localizes only standalone section headings, not prose or statistics", async () => {
  const source =
    "Background\nResults were assessed after pembrolizumab treatment.\n\n" +
    "Methods:\nP<0.001; HR 0.58 (95% CI 0.46–0.72); literal <b>.\n\n" +
    "  RESULTS ： \nThe Results section reports response >90%.\n\n" +
    "Conclusions\nNo global Results replacement is allowed.\n\n" +
    "Objective:\nA prespecified primary endpoint.\n\n" +
    "Objectives\nAdditional endpoints.\n\n" +
    "Results: same-line prose remains unchanged.\n" +
    "Secondary Results\nNot a supported standalone heading.\n" +
    "Methods and Results\nAnother unsupported heading.";
  const expected =
    "背景\nResults were assessed after pembrolizumab treatment.\n\n" +
    "方法:\nP<0.001; HR 0.58 (95% CI 0.46–0.72); literal <b>.\n\n" +
    "  结果 ： \nThe Results section reports response >90%.\n\n" +
    "结论\nNo global Results replacement is allowed.\n\n" +
    "目的:\nA prespecified primary endpoint.\n\n" +
    "目的\nAdditional endpoints.\n\n" +
    "Results: same-line prose remains unchanged.\n" +
    "Secondary Results\nNot a supported standalone heading.\n" +
    "Methods and Results\nAnother unsupported heading.";
  const before = source;
  const h = harness({ respond: () => ok("正文中的选举结果不会被输出替换。") });
  const result = await h.api.translateAbstract(source);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(h.calls[0][2].body), [expected]);
  assert.equal(source, before);
  assert.equal(result.text, "正文中的选举结果不会被输出替换。");
  // Cache identity is still the original complete text, not the adjusted payload.
  await h.api.translateAbstract(source);
  assert.equal(h.calls.length, 1);
  await h.api.translateAbstract(expected);
  assert.equal(h.calls.length, 2);
});

test("standalone Results cannot regress into the observed election-results heading", async () => {
  const source =
    "Background\nA controlled clinical trial.\n\n" +
    "Methods\nParticipants received pembrolizumab.\n\n" +
    "Results\nP<0.001; HR 0.58 (95% CI 0.46–0.72).\n\n" +
    "Conclusions\nThe primary endpoint improved.";
  const h = harness({
    respond: (_method, _url, options) => {
      const text = JSON.parse(options.body)[0];
      // Reproduce the live service's ambiguous English heading interpretation.
      const heading = /^Results$/m.test(text) ? "选举结果" : "结果";
      return ok(
        "背景\n一项对照临床试验。\n\n方法\n受试者接受 pembrolizumab。\n\n" +
          `${heading}\nP<0.001; HR 0.58 (95% CI 0.46–0.72).\n\n` +
          "结论\n主要终点得到改善。",
      );
    },
  });
  const result = await h.api.translateAbstract(source);
  const { abstractParagraphs } = createHarness().load(
    "src/panes/abstractText.ts",
  );
  assert.deepEqual(
    Array.from(
      abstractParagraphs(result.text, { plainText: true }),
      (part) => part.heading,
    ),
    ["背景", "方法", "结果", "结论"],
  );
  assert.doesNotMatch(result.text, /选举结果/);
  assert.match(
    JSON.parse(h.calls[0][2].body)[0],
    /P<0\.001; HR 0\.58 \(95% CI 0\.46–0\.72\)/,
  );
  assert.equal(h.calls.length, 1);
});

test("invalid, empty, huge or control-bearing input never leaves Zotero", async () => {
  const h = harness();
  for (const source of [
    undefined,
    null,
    42,
    {},
    "",
    "  \n ",
    "a\0b",
    "x".repeat(40001),
  ]) {
    assert.equal((await h.api.translateAbstract(source)).kind, "error");
  }
  assert.equal(h.calls.length, 0);
});

test("malformed service results are errors, never HTML or task error messages", async () => {
  for (const value of [
    null,
    {},
    [],
    [null],
    [{ translations: [] }],
    [{ translations: { 0: { text: TRANSLATED } } }],
    [{ translations: [{ text: {} }] }],
    [{ translations: [{ text: "  " }] }],
    [{ translations: [{ text: "x".repeat(80001) }] }],
    [{ translations: [{ text: "a\0b" }] }],
    [{ translations: [{ text: undefined }] }],
    [{ translations: [{ text: false }] }],
  ]) {
    const h = harness({ respond: () => ({ kind: "ok", value, status: 200 }) });
    assert.equal((await h.api.translateAbstract(SOURCE)).kind, "error");
  }
});

test("cache uses full source and provider, and callers cannot mutate cached results", async () => {
  const h = harness();
  const first = await h.api.translateAbstract(SOURCE);
  first.text = "Changed by caller";
  assert.equal((await h.api.translateAbstract(SOURCE)).text, TRANSLATED);
  await h.api.translateAbstract(`${SOURCE} different ending`);
  assert.equal(h.calls.length, 2);
  let pluginCalls = 0;
  h.Zotero.PDFTranslate = {
    api: {
      translate: () => (pluginCalls++, { status: "success", result: "新译文" }),
    },
  };
  assert.equal((await h.api.translateAbstract(SOURCE)).text, "新译文");
  assert.equal(pluginCalls, 1);
  h.Zotero.PDFTranslate.api.translate = () => ({
    status: "success",
    result: "新接口译文",
  });
  assert.equal((await h.api.translateAbstract(SOURCE)).text, "新接口译文");
});

test("temporary errors back off briefly and allow an explicit retry afterward", async () => {
  for (const kind of ["error", "unreachable", "throttled"]) {
    let succeed = false;
    const h = harness({
      respond: () => (succeed ? ok() : { kind, value: null, status: 0 }),
    });
    assert.equal((await h.api.translateAbstract(SOURCE)).kind, kind);
    succeed = true;
    assert.equal(
      (await h.api.translateAbstract(`${SOURCE} another`)).kind,
      kind,
    );
    assert.equal(h.calls.length, 1);
    await h.advance(kind === "throttled" ? 30000 : 5000);
    assert.equal((await h.api.translateAbstract(SOURCE)).kind, "ok");
    assert.equal(h.calls.length, 2);
  }
});

test("provider failure backoff prevents repeated billable/error requests", async () => {
  let count = 0;
  const h = harness({
    translate: () => (count++, { status: "fail", result: "SECRET" }),
  });
  await h.api.translateAbstract(SOURCE);
  await h.api.translateAbstract(SOURCE);
  await h.api.translateAbstract("Another abstract");
  assert.equal(count, 1);
  await h.advance(5000);
  await h.api.translateAbstract(SOURCE);
  assert.equal(count, 2);
});

test("cancelled callers and throwing lifetime guards perform no request", async () => {
  const h = harness();
  for (const shouldContinue of [
    () => false,
    () => {
      throw new Error("closed");
    },
  ]) {
    assert.equal(
      (await h.api.translateAbstract(SOURCE, { shouldContinue })).kind,
      "cancelled",
    );
  }
  assert.equal(h.calls.length, 0);
});

test("concurrent consumers share one request and one cancellation cannot cancel another", async () => {
  const reply = deferred();
  const h = harness({ respond: () => reply.promise });
  let firstActive = true;
  const first = h.api.translateAbstract(SOURCE, {
    shouldContinue: () => firstActive,
  });
  const second = h.api.translateAbstract(SOURCE);
  await flush();
  assert.equal(h.calls.length, 1);
  firstActive = false;
  assert.equal(h.calls[0][2].shouldContinue(), true);
  reply.resolve(ok());
  assert.equal((await first).kind, "cancelled");
  assert.equal((await second).kind, "ok");
  assert.equal((await h.api.translateAbstract(SOURCE)).kind, "ok");
  assert.equal(h.calls.length, 1);
});

test("all cancelled consumers discard a late reply without caching it", async () => {
  const reply = deferred();
  const h = harness({ respond: () => reply.promise });
  let active = true;
  const first = h.api.translateAbstract(SOURCE, {
    shouldContinue: () => active,
  });
  await flush();
  active = false;
  await h.advance(200);
  assert.equal((await first).kind, "cancelled");
  reply.resolve(ok());
  await flush();
  assert.equal((await h.api.translateAbstract(SOURCE)).kind, "ok");
  assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 0);
});

test("shutdown invalidates pending work, clears cache, and a new generation can translate", async () => {
  const old = deferred();
  let count = 0;
  const h = harness({ respond: () => (++count === 1 ? old.promise : ok()) });
  const first = h.api.translateAbstract(SOURCE);
  await flush();
  h.api.stopAbstractTranslations();
  assert.equal((await first).kind, "cancelled");
  assert.equal(h.timers.size, 0);
  assert.equal((await h.api.translateAbstract(SOURCE)).kind, "ok");
  old.resolve(ok("Stale translation"));
  await flush();
  assert.equal((await h.api.translateAbstract(SOURCE)).text, TRANSLATED);
  h.api.stopAbstractTranslations();
  await h.api.translateAbstract(SOURCE);
  assert.equal(count, 3);
});

test("an obsolete request cannot remove the replacement job for the same source", async () => {
  const old = deferred();
  const next = deferred();
  let count = 0;
  const h = harness({
    respond: () => (++count === 1 ? old.promise : next.promise),
  });
  let active = true;
  const first = h.api.translateAbstract(SOURCE, {
    shouldContinue: () => active,
  });
  await flush();
  active = false;
  const second = h.api.translateAbstract(SOURCE);
  await flush();
  old.resolve(ok("Old"));
  assert.equal((await first).kind, "cancelled");
  const third = h.api.translateAbstract(SOURCE);
  await flush();
  assert.equal(count, 2);
  next.resolve(ok());
  assert.equal((await second).kind, "ok");
  assert.equal((await third).kind, "ok");
});

test("uncancellable plugin tasks time out safely and late rejections are absorbed", async () => {
  const reply = deferred();
  const h = harness({ translate: () => reply.promise });
  const task = h.api.translateAbstract(SOURCE);
  await flush();
  await h.advance(30000);
  assert.equal((await task).kind, "unreachable");
  assert.equal(h.timers.size, 0);
  reply.reject(new Error("SECRET late error"));
  await flush();
  assert.deepEqual(h.logs, []);
});

test("pending translations are bounded while duplicate consumers can still join", async () => {
  const reply = deferred();
  const h = harness({ respond: () => reply.promise });
  const jobs = Array.from({ length: 4 }, (_, i) =>
    h.api.translateAbstract(`${SOURCE}${i}`),
  );
  await flush();
  assert.equal(
    (await h.api.translateAbstract(`${SOURCE}overflow`)).kind,
    "throttled",
  );
  const duplicate = h.api.translateAbstract(`${SOURCE}0`);
  await flush();
  assert.equal(h.calls.length, 4);
  reply.resolve(ok());
  assert.ok(
    (await Promise.all([...jobs, duplicate])).every((r) => r.kind === "ok"),
  );
});

test("memory cache has bounded LRU capacity and expires", async () => {
  const h = harness();
  for (let i = 0; i < 32; i++) await h.api.translateAbstract(`${SOURCE}${i}`);
  await h.api.translateAbstract(`${SOURCE}0`);
  await h.api.translateAbstract(`${SOURCE}32`);
  assert.equal(h.calls.length, 33);
  await h.api.translateAbstract(`${SOURCE}0`);
  assert.equal(h.calls.length, 33);
  await h.api.translateAbstract(`${SOURCE}1`);
  assert.equal(h.calls.length, 34);
  await h.advance(3600000);
  await h.api.translateAbstract(`${SOURCE}0`);
  assert.equal(h.calls.length, 35);
});
