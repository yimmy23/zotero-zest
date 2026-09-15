const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHarness } = require("./helpers.cjs");

const root = path.resolve(path.dirname(module.filename), "..");
const copy = (value) => JSON.parse(JSON.stringify(value));
const rankValue = (field, value, source = "easyscholar") => ({
  field,
  value,
  source,
});
const journal = (xr = "医学1区") => ({
  key: "issn:1234-5678",
  name: "Example Journal",
  issn: "1234-5678",
  updated: 1767225600000,
  values: [
    ...(xr === undefined ? [] : [rankValue("xr", xr)]),
    rankValue("sciUp", "医学2区", "dataset"),
    rankValue("sci", "Q1"),
    rankValue("sciif", "12.3"),
  ],
});

function displayHarness({
  locale = "zh-CN",
  prefs = {},
  record = journal(),
} = {}) {
  const entries = new Map([[record.key, record]]);
  const localeFile = /^zh(?:-|$)/i.test(locale) ? "zh-CN" : "en-US";
  const messages = Object.fromEntries(
    Array.from(
      fs
        .readFileSync(
          path.join(root, "addon/locale", localeFile, "addon.ftl"),
          "utf8",
        )
        .matchAll(/^([\w-]+) = (.+)$/gm),
      (match) => [match[1], match[2]],
    ),
  );
  class Item {
    id = 1;
    isRegularItem() {
      return true;
    }
    getField(field) {
      return { publicationTitle: record.name, ISSN: record.issn }[field] || "";
    }
  }
  const item = new Item();
  const h = createHarness({
    globals: { Zotero: { locale, Item, Items: { get: () => item } } },
    mocks: {
      "src/utils/prefs.ts": {
        getPref: (key) => prefs[key],
        getNumPref: () => 30,
      },
      "src/utils/locale.ts": {
        getString(id, { args = {} } = {}) {
          assert.ok(
            Object.hasOwn(messages, id),
            `missing ${localeFile} message ${id}`,
          );
          return messages[id].replace(/\{ \$(\w+) \}/g, (_, key) => args[key]);
        },
      },
      "src/utils/timers.ts": {},
      "src/core/storage.ts": {
        cache: {
          get(ns, key, sanitize) {
            const data = sanitize(entries.get(key));
            return data ? { data, age: 0 } : undefined;
          },
        },
      },
      "src/core/http.ts": { http: {} },
      "src/rank/sources/easyscholar.ts": {},
      "src/rank/sources/openalex.ts": {},
      "src/rank/sources/localDataset.ts": {},
      "src/reading/store.ts": {},
      "src/reading/status.ts": {},
      "src/columns/rating.ts": {},
      "src/cite/index.ts": {},
      "src/annots/density.ts": {},
      "src/columns/textTags.ts": {},
    },
  });
  const rank = h.load("src/rank/index.ts");
  const display = h.load("src/rank/display.ts");
  const configured = h.load("src/rank/rank.ts");
  return {
    ...h,
    prefs,
    record,
    item,
    rank,
    display,
    fields: () =>
      display.rankFieldsForDisplay(configured.displayFields(), record),
    shown() {
      return rank.displayValuesForUI(record, this.fields());
    },
  };
}

test("current and legacy shipped defaults use one XinRui slot and preserve locale positions", () => {
  for (const locale of ["zh-CN", "zh-TW", "en-US", "de-DE"]) {
    for (const fields of [
      undefined,
      "xr, sci, sciif",
      "sciUp, sci, sciif",
      "sciUp, sciif, sci",
      "SCIUP； SCI，SCIIF",
    ]) {
      const prefs = fields === undefined ? {} : { "rank.fields": fields };
      const before = copy(prefs);
      const h = displayHarness({ locale, prefs });
      assert.deepEqual(
        copy(h.shown()).map((value) => value.sourceField),
        locale.startsWith("zh")
          ? ["xr", "sci", "sciif"]
          : ["sci", "xr", "sciif"],
      );
      assert.deepEqual(
        prefs,
        before,
        "display migration never rewrites preferences",
      );
    }
  }
});

test("missing, empty and malformed XinRui values fall back to CAS without changing stored values", () => {
  for (const value of [
    null,
    false,
    {},
    [],
    "",
    "  ",
    "N/A",
    "Ｎ／Ａ",
    "n.a.",
    "null",
    "undefined",
    "unknown",
    "not available",
    "暂无数据",
    "无分区",
    "未知",
    "未收录",
    "—",
    "--",
    "?",
    "NaN",
    "Infinity",
    "false",
    "[object Object]",
    "{}",
    "[]",
    "0",
    "-1",
    "999",
    "0区",
    "99区",
    "医学0区",
    "医学6区",
    "医学９９区。",
    "新兴交叉学科-1区",
    "医学1.5区",
    "未知学科零区",
    "医学六区",
    "医学十一区。",
    "新兴交叉学科玖区",
  ]) {
    for (const locale of ["zh-CN", "en-US"]) {
      const record = journal(value);
      const before = copy(record);
      const h = displayHarness({ locale, record });
      assert.deepEqual(
        copy(h.shown()).map((entry) => entry.sourceField),
        locale === "zh-CN"
          ? ["sciUp", "sci", "sciif"]
          : ["sci", "sciUp", "sciif"],
        `XR ${JSON.stringify(value)} in ${locale}`,
      );
      assert.deepEqual(record, before);
    }
  }
  const record = journal();
  record.values = record.values.filter((value) => value.field !== "xr");
  const h = displayHarness({ record });
  assert.deepEqual(copy(h.fields()), ["sciUp", "sci", "sciif"]);
});

test("unknown subjects and unfamiliar nonempty XinRui labels remain available", () => {
  for (const value of [
    "新兴交叉学科1区",
    "新兴交叉学科5区",
    "新兴交叉学科五区",
    "未知学科伍区",
    "医学：内科一区。",
    "超一流期刊",
    "未来等级",
    "1",
    "Ａ类",
  ]) {
    const h = displayHarness({ record: journal(value) });
    assert.equal(h.shown()[0].sourceField, "xr", value);
  }
});

test("absent CAS or both partitions never removes the remaining JCR and impact factor", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    for (const keepXR of [true, false]) {
      const record = journal();
      record.values = record.values.filter(
        (value) => value.field !== "sciUp" && (keepXR || value.field !== "xr"),
      );
      const h = displayHarness({ locale, record });
      assert.deepEqual(
        copy(h.shown()).map((value) => value.sourceField),
        keepXR
          ? locale === "zh-CN"
            ? ["xr", "sci", "sciif"]
            : ["sci", "xr", "sciif"]
          : ["sci", "sciif"],
      );
    }
  }
});

test("custom field lists retain exact fields and order, including both systems and explicit CAS only", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    for (const fields of [
      ["sciUp"],
      ["sciif", "sciUp", "sci"],
      ["sciUp", "xr", "sci", "sciif"],
      ["xr", "sciUp"],
      ["sci", "xr"],
      ["XR", "sciUp", "SCIIF"],
    ]) {
      const h = displayHarness({
        locale,
        prefs: { "rank.fields": fields.join(", ") },
      });
      assert.deepEqual(copy(h.fields()), fields);
      assert.deepEqual(
        copy(h.shown()).map((value) => value.sourceField),
        fields,
      );
    }
    const h = displayHarness({
      locale,
      prefs: { "rank.fields": "xr, sciif" },
      record: journal("N/A"),
    });
    assert.deepEqual(
      copy(h.shown()).map((value) => value.value),
      ["N/A", "12.3"],
    );
  }
});

test("Map renames, replacements and hiding remain exact after default selection", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    for (const map of [
      "xr=My partition\n医学1区=Keep this exact label",
      "医学1区=医学2区",
      "xr=My partition",
    ]) {
      const h = displayHarness({ locale, prefs: { "rank.map": map } });
      const value = h.shown().find((entry) => entry.sourceField === "xr");
      assert.equal(value.customized, true);
      const display = h.display.rankValueDisplay(
        value,
        value.sourceField,
        value.customized,
      );
      assert.equal(display.text, value.value);
      assert.equal(display.description, value.value);
    }
    for (const map of ["xr=", "医学1区="]) {
      const h = displayHarness({ locale, prefs: { "rank.map": map } });
      assert.deepEqual(
        copy(h.shown()).map((value) => value.sourceField),
        ["sci", "sciif"],
      );
    }
    const h = displayHarness({
      locale,
      prefs: {
        "rank.fields": "xr, sciUp",
        "rank.map": "xr=New\nsciUp=Old\n医学1区=First\n医学2区=Second",
      },
    });
    assert.deepEqual(
      copy(h.shown()).map(({ field, value }) => ({ field, value })),
      [
        { field: "New", value: "First" },
        { field: "Old", value: "Second" },
      ],
    );
  }
});

test("partition badges and descriptions identify XinRui and historical CAS in both locales", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    const h = displayHarness({ locale });
    for (const field of [
      "xr",
      "xrSmall",
      "xrTop",
      "sciUp",
      "sciUpSmall",
      "sciUpTop",
      "sciBase",
    ]) {
      for (const raw of [
        "医学1区",
        "新兴交叉学科1区",
        "1区",
        "医学TOP",
        "未来等级",
      ]) {
        const value = rankValue(field, raw, "dataset");
        const before = copy(value);
        const display = h.display.rankValueDisplay(value);
        const xr = field.startsWith("xr");
        assert.match(
          display.text,
          locale === "zh-CN"
            ? xr
              ? /^新锐 /
              : /^中科院 /
            : xr
              ? /^XR /
              : /^CAS /,
        );
        assert.match(
          display.description,
          locale === "zh-CN"
            ? xr
              ? /新锐/
              : /中科院历史/
            : xr
              ? /XinRui/
              : /CAS.*historical/,
        );
        if (
          locale === "zh-CN" ||
          raw === "新兴交叉学科1区" ||
          raw === "未来等级"
        ) {
          assert.ok(display.text.includes(raw));
        } else {
          assert.doesNotMatch(display.text, /医学|区/);
        }
        assert.deepEqual(value, before);
      }
    }
    const custom = rankValue("myCustom", "医学1区");
    assert.deepEqual(copy(h.display.rankValueDisplay(custom)), {
      text: "医学1区",
      description: "医学1区",
    });
  }
});

test("journalRanks shares default priority and locale order but keeps raw cache and API values", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    for (const xr of ["医学1区", "N/A"]) {
      const record = journal(xr);
      const before = copy(record);
      const h = displayHarness({ locale, record });
      const api = h.load("src/api.ts").api;
      const values = copy(api.journalRanks(h.item));
      assert.equal(values.length, 3);
      const partition = xr === "N/A" ? "sciUp" : "xr";
      assert.deepEqual(
        values.map((value) => value.field),
        locale === "zh-CN"
          ? [partition, "sci", "sciif"]
          : ["sci", partition, "sciif"],
      );
      assert.equal(
        values.find((value) => value.field === partition).value,
        xr === "N/A" ? "医学2区" : xr,
      );
      for (const value of values)
        assert.deepEqual(Object.keys(value), ["field", "value", "source"]);
      values[0].value = "caller edit";
      assert.notEqual(api.journalRanks(h.item)[0].value, "caller edit");
      assert.deepEqual(record, before);
      assert.deepEqual(
        copy(h.rank.getJournalRecord(h.item)).values.map(
          ({ field, value, source }) => ({ field, value, source }),
        ),
        before.values,
      );
    }
  }
});

test("journalRanks retains custom Map output and its existing all-record fallback contract", () => {
  const h = displayHarness({
    prefs: { "rank.fields": "sciUp, xr", "rank.map": "xr=New\n医学1区=Custom" },
  });
  const api = h.load("src/api.ts").api;
  assert.deepEqual(copy(api.journalRanks(h.item)), [
    rankValue("sciUp", "医学2区", "dataset"),
    rankValue("New", "Custom"),
  ]);
  h.prefs["rank.fields"] = "absentCustomField";
  assert.deepEqual(copy(api.journalRanks(h.item)), h.record.values);
});

test("journalRanks never revives configured ranks hidden by Map when the result is empty", () => {
  for (const locale of ["zh-CN", "en-US"]) {
    for (const scenario of [
      { fields: undefined, xr: "医学1区", map: "xr=" },
      { fields: undefined, xr: "医学1区", map: "医学1区=" },
      { fields: undefined, xr: "N/A", map: "sciUp=" },
      { fields: "XR", xr: "医学1区", map: "xr=" },
      { fields: "sciUp, xr", xr: "医学1区", map: "xr=\nsciUp=" },
    ]) {
      const record = journal(scenario.xr);
      record.values = record.values.filter((value) =>
        ["xr", "sciUp"].includes(value.field),
      );
      const before = copy(record);
      const h = displayHarness({
        locale,
        record,
        prefs: { "rank.fields": scenario.fields, "rank.map": scenario.map },
      });
      const api = h.load("src/api.ts").api;
      assert.deepEqual(copy(h.shown()), [], JSON.stringify(scenario));
      assert.deepEqual(
        copy(api.journalRanks(h.item)),
        [],
        JSON.stringify(scenario),
      );
      assert.equal(api.journalRank(h.item), "");
      assert.deepEqual(record, before);
    }
  }
});
