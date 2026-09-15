const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");

function load(Zotero, prefs = { enabled: true }) {
  return createHarness({
    globals: { Zotero },
    mocks: {
      "src/utils/prefs.ts": { getPref: () => prefs.enabled },
      "src/reading/status.ts": {
        STATUS_KEYS: ["Read_Status"],
        STATUS_DATE_KEYS: ["Read_Status_Date"],
      },
      "src/columns/rating.ts": { RATING_KEYS: ["Rating"] },
    },
  }).load("src/modules/exportPatch.ts");
}

for (const ordering of ["retire-first", "install-first"]) {
  test(`export upgrade keeps foreign behavior and current stripping: ${ordering}`, () => {
    const native = function (suffix) {
      return { extra: this.extra + suffix };
    };
    const target = {
      itemToExportFormat: native,
      extra: "User note\nRating: 5",
    };
    const Zotero = { Utilities: { Internal: target } };
    const a = load(Zotero);
    const b = load(Zotero);
    a.installExportPatch();
    const oldWrapper = target.itemToExportFormat;
    const foreign = function (...args) {
      return { ...oldWrapper.apply(this, args), foreign: true };
    };
    target.itemToExportFormat = foreign;
    if (ordering === "retire-first") a.uninstallExportPatch();
    b.installExportPatch();
    const current = target.itemToExportFormat;
    b.installExportPatch();
    assert.equal(target.itemToExportFormat, current);
    if (ordering === "install-first") a.uninstallExportPatch();
    const result = target.itemToExportFormat("\nOther: kept");
    assert.equal(result.extra, "User note\nOther: kept");
    assert.equal(result.foreign, true);
    assert.equal(target.extra, "User note\nRating: 5");
    b.uninstallExportPatch();
    assert.equal(target.itemToExportFormat, foreign);
    assert.equal(target.itemToExportFormat("").extra, target.extra);
    b.installExportPatch();
    // Removing the final owned line leaves the user's preceding delimiter.
    assert.equal(target.itemToExportFormat("").extra, "User note\n");
    b.uninstallExportPatch();
  });
}

test("legacy global marker cannot prevent a new export patch installing", () => {
  const native = () => ({ extra: "User note\nRating: 4" });
  const target = {
    itemToExportFormat: native,
    __zestOrigItemToExportFormat: native,
  };
  const patch = load({ Utilities: { Internal: target } });
  patch.installExportPatch();
  assert.equal(target.itemToExportFormat().extra, "User note\n");
  patch.uninstallExportPatch();
  assert.equal(target.itemToExportFormat, native);
});

test("export wrappers retire per installation and never restore over a foreign hook", () => {
  const native = () => ({ extra: "Rating: 2" });
  const target = { itemToExportFormat: native };
  const patch = load({ Utilities: { Internal: target } });
  patch.installExportPatch();
  const first = target.itemToExportFormat;
  const foreign = () => ({ ...first(), foreign: true });
  target.itemToExportFormat = foreign;
  patch.installExportPatch();
  patch.uninstallExportPatch();
  assert.equal(target.itemToExportFormat, foreign);
  assert.equal(foreign().extra, "Rating: 2");
  patch.installExportPatch();
  assert.equal(foreign().extra, "Rating: 2");
  assert.equal(target.itemToExportFormat().extra, "");
});
