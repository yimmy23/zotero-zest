const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

test("cached regex tag predicates ignore global and sticky state across tags and renders", () => {
  const { parseTagRule } = createHarness().load("src/tags/match.ts");
  for (const flags of ["y", "g", "gy", "igy"]) {
    const rule = `/^#(.+)/${flags}`;
    const matcher = parseTagRule(rule);
    for (let n = 0; n < 3; n++) {
      assert.equal(matcher.test("#Lung"), "Lung");
      assert.equal(matcher.test("plain"), null);
      assert.equal(matcher.test("#Other"), "Other");
      assert.equal(parseTagRule(rule), matcher);
    }
  }
  assert.equal(parseTagRule("/(/y").test("#Lung"), null);
  assert.equal(parseTagRule("/^#(.+)/ii").test("#Lung"), null);
});

test("rank rewrite predicates and substitutions cannot share sticky lastIndex", () => {
  const { parseRewriteRules, applyRewrite } =
    createHarness().load("src/rank/map.ts");
  for (const flags of ["y", "g", "gy", "igy"]) {
    const rules = parseRewriteRules(`/^JCR (\\d)/${flags}=Q$1`);
    for (let n = 0; n < 3; n++) {
      assert.equal(applyRewrite(rules, "JCR 2"), "Q2");
      assert.equal(applyRewrite(rules, "Unknown"), "Unknown");
      assert.equal(applyRewrite(rules, "JCR 1"), "Q1");
    }
  }
});

test("rank numeric parsing distinguishes zero from unknown and preserves signs as invalid", () => {
  const h = createHarness({
    mocks: { "src/utils/prefs.ts": { getPref: () => "" } },
  });
  const { parseRankNumber, numberOf } = h.load("src/rank/types.ts");
  const { inferRank, sortKeyFor, validatedRank } = h.load("src/rank/rank.ts");
  for (const value of [
    "N/A",
    "",
    " ",
    "-12",
    "−12",
    "－１２",
    "+12",
    "Q1",
    "12 kg",
    "1e2",
    "0x10",
    "Infinity",
    "1.2.3",
    "12,4",
    "1,23",
    "1 234",
    null,
    undefined,
    false,
    -12,
    Infinity,
    NaN,
  ]) {
    assert.equal(parseRankNumber(value), undefined, String(value));
    assert.equal(inferRank("sciif", value), undefined, String(value));
    assert.equal(validatedRank("sciif", value, 1), undefined, String(value));
  }
  for (const [raw, numeric] of [
    ["0", 0],
    ["0.0", 0],
    [0, 0],
    ["12.4", 12.4],
    [".5", 0.5],
    ["12.", 12],
    ["１２．４", 12.4],
    [" 1,234.50 ", 1234.5],
    ["１，２３４．５", 1234.5],
  ]) {
    assert.equal(parseRankNumber(raw), numeric, String(raw));
  }
  assert.equal(inferRank("sciif", "0"), 5);
  assert.equal(inferRank("sciif", "１２．４"), 1);
  assert.equal(inferRank("impact factor", "１２．４"), 1);
  assert.equal(inferRank("sci", "２区"), 2);
  assert.ok(sortKeyFor("sciif", "N/A") > sortKeyFor("sciif", "0"));
  assert.equal(sortKeyFor("sciif", "N/A"), sortKeyFor("sciif", "-12"));
  const record = (first) => ({
    values: [
      { field: "sciif", value: first },
      { field: "sciif5", value: "4.5" },
    ],
  });
  assert.equal(numberOf(record("N/A"), ["sciif", "sciif5"]), 4.5);
  assert.equal(numberOf(record("-12"), ["sciif", "sciif5"]), 4.5);
  assert.equal(numberOf(record("0"), ["sciif", "sciif5"]), 0);
  assert.equal(validatedRank("custom", "Premium", 2), 2);
  for (const bad of [-1, 0, 1.5, 6, Infinity, NaN])
    assert.equal(validatedRank("custom", "Premium", bad), undefined);
});

test("OpenAlex metrics require nonnegative JSON numbers, and h-index requires an integer", async () => {
  let stats;
  const h = createHarness({
    mocks: {
      "src/core/http.ts": {
        politeParam: () => "",
        http: {
          request: async () => ({ issn_l: "1234-5678", summary_stats: stats }),
        },
      },
    },
  });
  const { fetchOpenAlexByISSN } = h.load("src/rank/sources/openalex.ts");
  for (const value of [-12, "12.4", "1,234.5", "N/A", null, Infinity]) {
    stats = { "2yr_mean_citedness": value, h_index: value };
    assert.equal((await fetchOpenAlexByISSN("1234-5678")).values.length, 0);
  }
  stats = { "2yr_mean_citedness": 0, h_index: 0 };
  assert.deepEqual(
    Array.from((await fetchOpenAlexByISSN("1234-5678")).values, (v) => v.value),
    ["0.00", "0"],
  );
  stats = { "2yr_mean_citedness": 12.4, h_index: 1.5 };
  assert.equal((await fetchOpenAlexByISSN("1234-5678")).values.length, 1);
});

test("easyScholar custom levels reject blank, signed, fractional and out-of-range ranks", async () => {
  const levels = ["", "N/A", "-1", "0", "1.5", "6", "1", "5"];
  const h = createHarness({
    mocks: {
      "src/core/secrets.ts": { getSecret: async () => "synthetic" },
      "src/core/http.ts": {
        http: {
          throttledFor: () => 0,
          requestResult: async () => ({
            kind: "ok",
            value: {
              code: 200,
              data: {
                customRank: {
                  rank: levels.map((level) => `test&&&${level}`),
                  rankInfo: [
                    {
                      uuid: "test",
                      abbName: "custom",
                      oneRankText: "First",
                      fiveRankText: "Last",
                    },
                  ],
                },
              },
            },
          }),
        },
      },
    },
  });
  const result = await h
    .load("src/rank/sources/easyscholar.ts")
    .fetchEasyScholar("Example");
  assert.deepEqual(
    Array.from(result.values, (v) => [v.value, v.rank]),
    [
      ["First", 1],
      ["Last", 5],
    ],
  );
});
