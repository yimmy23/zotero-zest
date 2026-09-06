const test = require("node:test");
const assert = require("node:assert/strict");
const { URL } = require("node:url");
const { createHarness } = require("./helpers.cjs");

const DOI = "10.1056/nejmoa2302983";
const PMID = "37272513";
const TEXT =
  "A carefully preserved abstract describes the trial population and its outcomes. P<0.001 and response >90% remain intact.";
const ok = (value) => ({ kind: "ok", value, status: 200 });
const miss = () => ok({ hitCount: 0, resultList: { result: [] } });
const epmc = (overrides = {}) =>
  ok({
    hitCount: 1,
    resultList: {
      result: [
        {
          source: "MED",
          id: PMID,
          doi: DOI,
          abstractText: `<h4>Methods</h4>${TEXT}<h4>Results</h4>${TEXT}`,
          ...overrides,
        },
      ],
    },
  });
function item(fields = {}) {
  const values = { DOI, ...fields };
  return {
    values,
    getField: (name) => values[name] || "",
    setField: () => assert.fail("Must never modify an item"),
    saveTx: () => assert.fail("Must never save an item"),
  };
}

function harness(respond = () => epmc(), xml = {}) {
  const entries = new Map();
  const configured = [];
  const calls = [];
  const parsed = [];
  const selectors = [];
  const cache = {
    configure: (...args) => configured.push(args),
    get(ns, key, sanitize, ttl) {
      const entry = entries.get(`${ns}/${key}`);
      if (!entry || (ttl && Date.now() - entry.t > ttl)) return undefined;
      const data = sanitize(entry.data);
      return data === null ? undefined : { data, age: Date.now() - entry.t };
    },
    set(ns, key, data) {
      entries.set(`${ns}/${key}`, { data, t: Date.now() });
    },
  };
  // A narrow DOM API substitute; actual XML parsing is smoke-tested in Zotero.
  const article = {
    querySelector(selector) {
      selectors.push(selector);
      assert.equal(selector, "MedlineCitation > PMID");
      return { textContent: xml.pmid || PMID };
    },
    querySelectorAll(selector) {
      selectors.push(selector);
      if (selector.includes("ArticleIdList"))
        return [{ textContent: xml.doi || DOI }];
      assert.equal(
        selector,
        "MedlineCitation > Article > Abstract > AbstractText",
      );
      return (
        xml.sections || ["BACKGROUND", "METHODS", "RESULTS", "CONCLUSIONS"]
      ).map((label) => ({
        textContent: xml.text ?? TEXT,
        getAttribute: (name) => (name === "Label" ? label : null),
      }));
    },
  };
  class DOMParser {
    parseFromString(value, type) {
      parsed.push(value);
      assert.equal(type, "application/xml");
      assert.doesNotMatch(value, /<!DOCTYPE|<!ENTITY/i);
      return {
        querySelector: () => (xml.malformed ? {} : null),
        querySelectorAll: (selector) => {
          assert.equal(selector, "PubmedArticle");
          return [article];
        },
      };
    }
  }
  const h = createHarness({
    mocks: {
      "src/core/storage.ts": { cache },
      "src/core/http.ts": {
        http: {
          requestResult: (...args) => {
            calls.push(args);
            return respond(...args);
          },
        },
      },
    },
    globals: {
      Zotero: {
        getMainWindow: () => ({ DOMParser }),
        Promise: { delay: async () => {} },
      },
    },
  });
  return {
    api: h.load("src/panes/abstractSource.ts"),
    entries,
    calls,
    configured,
    parsed,
    selectors,
  };
}

test("abstract lookup is identifier-only, normalizes DOI, and never writes items", async () => {
  const h = harness();
  const paper = item({
    DOI: "https://doi.org/10.1056/NEJMoa2302983",
    extra: "Private note: never transmit this",
    abstractNote: "My original summary",
  });
  assert.equal(h.api.abstractIdentity(paper).doi, DOI);
  assert.equal((await h.api.fetchAbstract(paper)).kind, "ok");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], "GET");
  const url = new URL(h.calls[0][1]);
  assert.equal(url.searchParams.get("query"), `DOI:"${DOI}"`);
  assert.equal(url.searchParams.get("resultType"), "core");
  assert.equal(h.calls[0][2].body, undefined);
  assert.equal(h.calls[0][2].noCache, true);
  assert.equal(paper.values.abstractNote, "My original summary");
  assert.deepEqual(h.configured, [["abstracts", 500]]);
});

test("no identifier or a cancelled caller performs no network or cache writes", async () => {
  const h = harness();
  assert.equal(
    (await h.api.fetchAbstract(item({ DOI: "not-a-doi" }))).kind,
    "no-id",
  );
  assert.equal(
    (await h.api.fetchAbstract(item(), { shouldContinue: () => false })).kind,
    "cancelled",
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.entries.size, 0);
  assert.equal(
    h.api.abstractIdentity(item({ DOI: "", extra: "PMID: 37272513 bad" })),
    null,
  );
});

test("PMID-only lookup supports the real field and exact legacy Extra line", async () => {
  for (const fields of [
    { PMID },
    { extra: `Private: hidden\nPMID: ${PMID}\nOther: hidden` },
  ]) {
    const h = harness();
    const paper = item({ DOI: "", ...fields });
    assert.equal(h.api.abstractIdentity(paper).pmid, PMID);
    const result = await h.api.fetchAbstract(paper);
    assert.equal(result.kind, "ok");
    assert.equal(
      new URL(h.calls[0][1]).searchParams.get("query"),
      `EXT_ID:${PMID} AND SRC:MED`,
    );
    assert.equal(result.record.pmid, PMID);
  }
});

test("Europe PMC retains structured sections and clinical comparisons, with a 30-day cache", async () => {
  const h = harness();
  const paper = item();
  const result = await h.api.fetchAbstract(paper);
  assert.equal(result.record.source, "Europe PMC");
  assert.match(result.record.text, /Methods\n\n/);
  assert.match(result.record.text, /P<0\.001 and response >90%/);
  assert.doesNotMatch(result.record.text, /<h4>/);
  assert.equal(h.api.cachedAbstract(paper).text, result.record.text);
  await h.api.fetchAbstract(paper);
  assert.equal(h.calls.length, 1);
  const entry = [...h.entries.values()][0];
  entry.t -= 31 * 24 * 60 * 60 * 1000;
  assert.equal(h.api.cachedAbstract(paper), undefined);
  await h.api.fetchAbstract(paper);
  assert.equal(h.calls.length, 2);
});

test("DOI plus PMID are part of cache identity; identifier edits invalidate old data", async () => {
  const h = harness();
  const paper = item({ PMID });
  await h.api.fetchAbstract(paper);
  assert.ok(h.api.cachedAbstract(paper));
  paper.values.PMID = "12345";
  assert.equal(h.api.cachedAbstract(paper), undefined);
  paper.values.PMID = PMID;
  paper.values.DOI = "10.1234/other";
  assert.equal(h.api.cachedAbstract(paper), undefined);
});

test("Crossref fallback requires the exact DOI and strips JATS markup safely", async () => {
  const h = harness((method, url) =>
    url.includes("europepmc")
      ? miss()
      : ok({
          message: {
            DOI,
            abstract: `<jats:abstract><jats:p>${TEXT}</jats:p></jats:abstract>`,
          },
        }),
  );
  const result = await h.api.fetchAbstract(item());
  assert.equal(result.kind, "ok");
  assert.equal(result.record.source, "Crossref");
  assert.equal(result.record.text, TEXT);
  assert.equal(h.calls.length, 2);
});

const XML =
  '<?xml version="1.0"?><!DOCTYPE PubmedArticleSet PUBLIC "-//NLM//DTD PubMedArticle, 1st January 2025//EN" "https://dtd.nlm.nih.gov/ncbi/pubmed/out/pubmed_250101.dtd"><PubmedArticleSet><PubmedArticle/></PubmedArticleSet>';
test("PubMed fallback removes the standard external DTD and reads every structured segment", async () => {
  const h = harness((method, url) =>
    url.includes("europepmc") ? epmc({ abstractText: undefined }) : ok(XML),
  );
  const result = await h.api.fetchAbstract(item());
  assert.equal(result.kind, "ok");
  assert.equal(result.record.source, "PubMed");
  for (const label of ["BACKGROUND", "METHODS", "RESULTS", "CONCLUSIONS"])
    assert.ok(result.record.text.includes(`${label}:\n`));
  assert.match(result.record.text, /P<0\.001/);
  assert.equal(h.parsed.length, 1);
  assert.doesNotMatch(h.parsed[0], /DOCTYPE/);
  assert.equal(h.calls[1][2].responseType, "text");
  assert.equal(new URL(h.calls[1][1]).searchParams.get("id"), PMID);
});

test("PubMed rejects entities/internal DTD subsets before parsing and never caches the failure", async () => {
  for (const xml of [
    '<!DOCTYPE PubmedArticleSet [<!ENTITY ext SYSTEM "file:///private">]><PubmedArticleSet/>',
    '<!ENTITY ext SYSTEM "https://example.org"><PubmedArticleSet/>',
  ]) {
    const h = harness((method, url) =>
      url.includes("europepmc")
        ? epmc({ abstractText: undefined })
        : url.includes("eutils")
          ? ok(xml)
          : ok({ message: { DOI } }),
    );
    assert.equal((await h.api.fetchAbstract(item())).kind, "error");
    assert.equal(h.parsed.length, 0);
    assert.equal(h.entries.size, 0);
  }
});

test("PubMed mismatched main DOI/PMID and parse errors never become a miss cache", async () => {
  for (const xml of [
    { doi: "10.9999/other" },
    { pmid: "12345" },
    { malformed: true },
  ]) {
    const h = harness(
      (method, url) =>
        url.includes("europepmc")
          ? miss()
          : url.includes("eutils")
            ? ok(XML)
            : ok({ message: { DOI } }),
      xml,
    );
    assert.equal((await h.api.fetchAbstract(item({ PMID }))).kind, "error");
    assert.equal(h.entries.size, 0);
  }
});

test("all definite misses are cached for six hours, not thirty days", async () => {
  const h = harness((method, url) =>
    url.includes("europepmc") ? miss() : ok({ message: { DOI } }),
  );
  const paper = item();
  assert.equal((await h.api.fetchAbstract(paper)).kind, "missing");
  assert.equal(h.api.cachedAbstract(paper), undefined);
  await h.api.fetchAbstract(paper);
  assert.equal(h.calls.length, 2);
  [...h.entries.values()][0].t -= 7 * 60 * 60 * 1000;
  await h.api.fetchAbstract(paper);
  assert.equal(h.calls.length, 4);
});

test("malformed, mismatched and oversized abstracts are not cached as definite misses", async () => {
  for (const response of [
    ok({}),
    epmc({ doi: "10.1111/wrong" }),
    epmc({ abstractText: "short" }),
    epmc({ abstractText: "x".repeat(40_001) }),
  ]) {
    const h = harness((method, url) =>
      url.includes("europepmc")
        ? response
        : url.includes("eutils")
          ? { kind: "not-found", status: 404, value: null }
          : ok({ message: { DOI } }),
    );
    assert.equal((await h.api.fetchAbstract(item())).kind, "error");
    assert.equal(h.entries.size, 0);
  }
});

test("transport errors and rate limits retain their kind and never poison the miss cache", async () => {
  for (const kind of ["throttled", "unreachable", "error"]) {
    const h = harness((method, url) =>
      url.includes("europepmc")
        ? { kind, value: null, status: kind === "throttled" ? 429 : 0 }
        : ok({ message: { DOI } }),
    );
    assert.equal((await h.api.fetchAbstract(item())).kind, kind);
    assert.equal(h.entries.size, 0);
  }
});

test("consumers share a request while one closing consumer cannot cancel another", async () => {
  let complete;
  let firstValid = true;
  const h = harness(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const first = h.api.fetchAbstract(item(), {
    shouldContinue: () => firstValid,
  });
  const second = h.api.fetchAbstract(item());
  await Promise.resolve();
  assert.equal(h.calls.length, 1);
  firstValid = false;
  assert.equal(h.calls[0][2].shouldContinue(), true);
  complete(epmc());
  assert.equal((await first).kind, "cancelled");
  assert.equal((await second).kind, "ok");
  assert.equal(h.entries.size, 1);
});

test("closing, editing identity, and generation teardown discard late responses without permanent disablement", async () => {
  for (const reason of ["closed", "edited", "stopped"]) {
    let complete;
    let wanted = true;
    let response = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    const h = harness((...args) => response(...args));
    const paper = item();
    const running = h.api.fetchAbstract(paper, {
      shouldContinue: () => wanted,
    });
    await Promise.resolve();
    if (reason === "closed") wanted = false;
    if (reason === "edited") paper.values.DOI = "10.1234/other";
    if (reason === "stopped") h.api.stopAbstractFetches();
    assert.equal(h.calls[0][2].shouldContinue(), false);
    complete(epmc());
    assert.equal((await running).kind, "cancelled");
    assert.equal(h.entries.size, 0);
    assert.equal(h.calls.length, 1);
    response = () => epmc();
    assert.equal((await h.api.fetchAbstract(item())).kind, "ok");
  }
});

test("corrupted cached source URLs and future timestamps are not trusted", async () => {
  const h = harness();
  const paper = item();
  await h.api.fetchAbstract(paper);
  const entry = [...h.entries.values()][0];
  const original = { ...entry.data };
  entry.data.url = "javascript:alert(1)";
  assert.equal(h.api.cachedAbstract(paper), undefined);
  entry.data = { ...original, fetchedAt: Date.now() + 60 * 60 * 1000 };
  assert.equal(h.api.cachedAbstract(paper), undefined);
  entry.data = { ...original, doi: "10.1234/other" };
  assert.equal(h.api.cachedAbstract(paper), undefined);
});

test("a new generation can fetch the same identity before an old response arrives", async () => {
  const completes = [];
  const h = harness(() => new Promise((resolve) => completes.push(resolve)));
  const old = h.api.fetchAbstract(item());
  await Promise.resolve();
  h.api.stopAbstractFetches();
  const fresh = h.api.fetchAbstract(item());
  await Promise.resolve();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0][2].shouldContinue(), false);
  assert.equal(h.calls[1][2].shouldContinue(), true);
  completes[0](epmc({ abstractText: `${TEXT} Old generation.` }));
  assert.equal((await old).kind, "cancelled");
  assert.equal(h.entries.size, 0);
  completes[1](epmc());
  assert.equal((await fresh).kind, "ok");
  assert.ok(h.api.cachedAbstract(item()));
});

test("a failed source can fall back successfully without merging abstracts", async () => {
  const h = harness((method, url) =>
    url.includes("europepmc")
      ? { kind: "unreachable", value: null, status: 0 }
      : ok({ message: { DOI, abstract: TEXT } }),
  );
  const result = await h.api.fetchAbstract(
    item({ abstractNote: "Private draft" }),
  );
  assert.equal(result.kind, "ok");
  assert.equal(result.record.text, TEXT);
  assert.equal(result.record.source, "Crossref");
  assert.equal(h.entries.size, 1);
});

test("conflicting DOI and PMID cannot be accepted through an unverified Crossref fallback", async () => {
  const h = harness(
    (method, url) =>
      url.includes("europepmc")
        ? epmc({ id: "12345" })
        : url.includes("eutils")
          ? ok(XML)
          : ok({ message: { DOI, abstract: TEXT } }),
    { doi: "10.1234/a-different-paper" },
  );
  const result = await h.api.fetchAbstract(item({ PMID }));
  assert.equal(result.kind, "error");
  assert.equal(result.record, undefined);
  assert.equal(h.entries.size, 0);
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(([, url]) => !url.includes("crossref")));
});

test("cached Crossref records cannot claim an unverified PMID", async () => {
  const h = harness((method, url) =>
    url.includes("europepmc")
      ? miss()
      : ok({ message: { DOI, abstract: TEXT } }),
  );
  const paper = item();
  const result = await h.api.fetchAbstract(paper);
  assert.equal(result.record.source, "Crossref");
  assert.equal(result.record.pmid, undefined);
  [...h.entries.values()][0].data.pmid = PMID;
  assert.equal(h.api.cachedAbstract(paper), undefined);
});

test("online markup is normalized only once through repeated cache round trips", async () => {
  const encoded = `${TEXT} A&lt;B and C&gt;D; literal &lt;b&gt; and &amp;lt; remain.`;
  const expected = `${TEXT} A<B and C>D; literal <b> and &lt; remain.`;
  for (const source of ["Europe PMC", "Crossref"]) {
    const h = harness((method, url) =>
      url.includes("europepmc")
        ? source === "Europe PMC"
          ? epmc({ abstractText: `<p>${encoded}</p>` })
          : miss()
        : ok({ message: { DOI, abstract: `<jats:p>${encoded}</jats:p>` } }),
    );
    const paper = item();
    const result = await h.api.fetchAbstract(paper);
    assert.equal(result.record.source, source);
    assert.equal(result.record.text, expected);
    for (let i = 0; i < 3; i++) {
      assert.equal(h.api.cachedAbstract(paper).text, expected);
      assert.equal((await h.api.fetchAbstract(paper)).record.text, expected);
    }
    assert.equal(h.calls.length, source === "Europe PMC" ? 1 : 2);
  }
});

test("PubMed DOM textContent preserves decoded literal markup and entities without reprocessing", async () => {
  const text = `${TEXT} A<B and C>D; literal <b> and &lt; remain.`;
  const h = harness(
    (method, url) =>
      url.includes("europepmc") ? epmc({ abstractText: undefined }) : ok(XML),
    { sections: ["RESULTS"], text },
  );
  const paper = item();
  const result = await h.api.fetchAbstract(paper);
  assert.equal(result.record.source, "PubMed");
  assert.equal(result.record.text, `RESULTS:\n${text}`);
  assert.equal(h.api.cachedAbstract(paper).text, result.record.text);
  assert.equal(
    (await h.api.fetchAbstract(paper)).record.text,
    result.record.text,
  );
});

test("legacy PMID uses a single Extra line and accepts harmless field indentation", () => {
  const h = harness();
  for (const extra of [
    "  PMID: 37272513",
    "\tpmid \t: \t37272513\r\nPrivate: hidden",
  ]) {
    assert.equal(h.api.abstractIdentity(item({ DOI: "", extra })).pmid, PMID);
  }
  for (const extra of [
    "PMID:\n37272513",
    "PMID: \r\n37272513\r\n",
    "PMID: 37272513 trailing prose",
  ]) {
    assert.equal(h.api.abstractIdentity(item({ DOI: "", extra })), null);
  }
});

test("Europe PMC MED cache links must agree with their record PMID", async () => {
  const h = harness();
  const paper = item();
  await h.api.fetchAbstract(paper);
  const entry = [...h.entries.values()][0];
  const original = { ...entry.data };
  entry.data.url = "https://europepmc.org/article/MED/99999999";
  assert.equal(h.api.cachedAbstract(paper), undefined);
  entry.data = { ...original, pmid: undefined };
  assert.equal(h.api.cachedAbstract(paper), undefined);
  entry.data = original;
  assert.equal(h.api.cachedAbstract(paper).pmid, PMID);
});

test("Europe PMC non-MED rows never inherit a PMID from an earlier matching row", async () => {
  const h = harness(() =>
    ok({
      hitCount: 2,
      resultList: {
        result: [
          { source: "MED", id: PMID, doi: DOI },
          { source: "PMC", id: "PMC123456", doi: DOI, abstractText: TEXT },
        ],
      },
    }),
  );
  const paper = item();
  const result = await h.api.fetchAbstract(paper);
  assert.equal(result.kind, "ok");
  assert.equal(result.record.pmid, undefined);
  assert.equal(
    result.record.url,
    "https://europepmc.org/article/PMC/PMC123456",
  );
  assert.equal(h.api.cachedAbstract(paper).text, TEXT);
  [...h.entries.values()][0].data.pmid = PMID;
  assert.equal(h.api.cachedAbstract(paper), undefined);
});
