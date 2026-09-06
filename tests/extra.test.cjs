const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

test("adding an owned Extra key preserves trailing user-authored whitespace", () => {
  const { upsertExtraText } = createHarness().load("src/utils/extra.ts");
  const before = "Personal note\r\n\r\n  \r\n";
  assert.equal(
    upsertExtraText(before, ["Remark"], "Read this"),
    `${before}\r\nRemark: Read this`,
  );
});

test("translated abstracts retain structured headings and stop at a real Extra field", () => {
  const { getExtraBlockText } = createHarness().load("src/utils/extra.ts");
  const headings = [
    "Background",
    "Objective",
    "Objectives",
    "Importance",
    "Context",
    "Introduction",
    "Design",
    "Setting",
    "Participants",
    "Interventions",
    "Methods",
    "Main outcomes and measures",
    "Results",
    "Conclusions",
    "Funding",
    "Trial registration",
    "Registration",
  ];
  const body = ["译文首段", ...headings.map((h) => `${h}: 译文正文`)].join(
    "\n",
  );
  for (const next of [
    "PMID: 123456",
    "titleTranslation: 题目",
    "Custom_Key: user value",
  ]) {
    const extra = `abstractTranslation: ${body}\n\n${next}\nnot abstract`;
    assert.equal(getExtraBlockText(extra, ["abstractTranslation"]).value, body);
  }
});

test("translated abstract headings are case insensitive and retain Chinese paragraphs and blank lines", () => {
  const { getExtraBlockText } = createHarness().load("src/utils/extra.ts");
  const body =
    "首段\n\n方法：保留中文标题\n\n  METHODS : 正文\nRESULTS: 结果\n\n结论：最后一段";
  const extra = `AbstractTranslation: ${body.replaceAll("\n", "\r\n")}\r\n\r\nRating: 4`;
  const result = getExtraBlockText(extra, ["abstractTranslation"]);
  assert.equal(result.key, "AbstractTranslation");
  assert.equal(result.value, body);
});

test("structured heading exceptions do not change title or ordinary Extra block boundaries", () => {
  const { getExtraBlockText } = createHarness().load("src/utils/extra.ts");
  for (const key of ["titleTranslation", "CustomBlock"]) {
    const result = getExtraBlockText(
      `${key}: first\nMethods: next value\nlast`,
      [key],
    );
    assert.equal(result.value, "first");
  }
});

test("reading a translated abstract never writes its Extra field", () => {
  const { getExtraBlock } = createHarness().load("src/utils/extra.ts");
  const extra =
    "abstractTranslation: First\nResults: Second\nRead_Status: read\n";
  let reads = 0;
  const item = {
    getField(field) {
      assert.equal(field, "extra");
      reads++;
      return extra;
    },
    setField() {
      assert.fail("reading must not write Extra");
    },
    saveTx() {
      assert.fail("reading must not save the item");
    },
  };
  assert.equal(
    getExtraBlock(item, ["abstractTranslation"]).value,
    "First\nResults: Second",
  );
  assert.equal(reads, 1);
});

test("all short English formatter headings remain prose in the translated abstract reader", () => {
  const h = createHarness();
  const { abstractParagraphs } = h.load("src/panes/abstractText.ts");
  const { getExtraBlockText } = h.load("src/utils/extra.ts");
  const headings = [
    "Background",
    "Objectives",
    "Objective",
    "Purpose",
    "Importance",
    "Context",
    "Introduction",
    "Aims",
    "Aim",
    "Methods",
    "Design",
    "Setting",
    "Participants",
    "Interventions",
    "Intervention",
    "Results",
    "Findings",
    "Discussion",
    "Conclusions",
    "Conclusion",
    "Interpretation",
    "Funding",
    "Registration",
    "Trial registration",
  ];
  for (const heading of headings) {
    const body = `Opening paragraph\n${heading}: Source content\nResults: Last paragraph`;
    const formatted = abstractParagraphs(body);
    assert.ok(
      formatted.some((paragraph) => paragraph.heading === heading),
      heading,
    );
    assert.equal(
      getExtraBlockText(`abstractTranslation: ${body}\nPMID: 37272513`, [
        "abstractTranslation",
      ]).value,
      body,
      heading,
    );
  }
});

test("verified multiword metadata keys stop blocks without cutting long abstract headings", () => {
  const { getExtraBlockText } = createHarness().load("src/utils/extra.ts");
  const body = [
    "First paragraph",
    "Patients and methods: Participants and treatment",
    "Main outcomes and measures: Endpoints",
    "Research in context: Source discussion",
    "Conclusions and relevance: Last paragraph",
  ].join("\n");
  for (const boundary of [
    "Number of Pages: 17",
    "Number of Volumes: 2",
    "Original Dictionary Title: Original volume",
    "  number\tof\tpages : 17",
  ]) {
    const extra = `abstractTranslation: ${body}\n\n${boundary}\nNot part of the abstract`;
    assert.equal(getExtraBlockText(extra, ["abstractTranslation"]).value, body);
    assert.equal(
      getExtraBlockText(`titleTranslation: Title\n${boundary}\nLater text`, [
        "titleTranslation",
      ]).value,
      "Title",
    );
  }
});

for (const batch of [false, true]) {
  const setterName = batch ? "setExtraLines" : "setExtraLine";
  const update = (api, item, value = "Draft to save") =>
    batch
      ? api.setExtraLines(item, [
          [["Remark"], value],
          [["Read_Status"], value === null ? null : "read"],
        ])
      : api.setExtraLine(item, ["Remark"], value);

  test(`${setterName} restores failed in-memory changes so the same value can be retried`, async () => {
    const api = createHarness().load("src/utils/extra.ts");
    const before =
      "Private note\r\nRemark: Original\r\nRead_Status: unread\r\n\r\n  \r\n";
    let extra = before;
    let saved = before;
    let attempts = 0;
    const failure = new Error("Save failed");
    const item = {
      getField: () => extra,
      setField(name, value) {
        assert.equal(name, "extra");
        extra = value;
      },
      async saveTx() {
        attempts++;
        if (attempts === 1) throw failure;
        saved = extra;
      },
    };
    await assert.rejects(update(api, item), (error) => error === failure);
    assert.equal(extra, before);
    assert.equal(saved, before);
    assert.equal(await update(api, item), true);
    assert.equal(attempts, 2);
    assert.equal(saved, extra);
    assert.ok(saved.startsWith("Private note\r\nRemark: Draft to save\r\n"));
    assert.ok(saved.endsWith("\r\n\r\n  \r\n"));
    assert.equal(await update(api, item), false);
    assert.equal(attempts, 2);
  });

  test(`${setterName} restores deleted keys exactly after save failure`, async () => {
    const api = createHarness().load("src/utils/extra.ts");
    const before =
      "Remark: Existing\nPrivate: Keep this\nRead_Status: unread\n\n";
    let extra = before;
    let failed = true;
    const item = {
      getField: () => extra,
      setField(name, value) {
        extra = value;
      },
      async saveTx() {
        if (failed) throw new Error("Delete failed");
      },
    };
    await assert.rejects(update(api, item, null), /Delete failed/);
    assert.equal(extra, before);
    failed = false;
    assert.equal(await update(api, item, null), true);
    assert.equal(
      extra,
      batch
        ? "Private: Keep this\n\n"
        : "Private: Keep this\nRead_Status: unread\n\n",
    );
  });

  test(`${setterName} never rolls back another writer's changes while its save is pending`, async () => {
    const api = createHarness().load("src/utils/extra.ts");
    for (const changeOwnedKey of [false, true]) {
      let extra = "Remark: Original\nPrivate: Original note";
      let saved;
      let attempts = 0;
      let rejectSave;
      const failure = new Error("Pending save failed");
      const item = {
        getField: () => extra,
        setField(name, value) {
          extra = value;
        },
        saveTx() {
          attempts++;
          if (attempts === 1)
            return new Promise((resolve, reject) => {
              rejectSave = reject;
            });
          saved = extra;
          return Promise.resolve();
        },
      };
      const pending = update(api, item);
      const external = changeOwnedKey
        ? extra.replace("Remark: Draft to save", "Remark: Another writer")
        : `${extra}\nExternal_Key: A newer edit`;
      item.setField("extra", external);
      rejectSave(failure);
      await assert.rejects(pending, (error) => error === failure);
      assert.equal(extra, external);
      const retryValue = changeOwnedKey ? "Another writer" : "Draft to save";
      assert.equal(await update(api, item, retryValue), true);
      assert.equal(attempts, 2);
      assert.equal(saved, external);
      assert.equal(extra, external);
      assert.equal(await update(api, item, retryValue), false);
      assert.equal(attempts, 2);
    }
  });
}
