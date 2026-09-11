const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers.cjs");
const { windowFixture } = require("./dialog-fixture.cjs");

function setup({ preview, commit } = {}) {
  const dialog = windowFixture();
  const host = windowFixture();
  let opens = 0;
  host.openDialog = () => {
    opens++;
    return dialog;
  };
  const commits = [];
  const h = createHarness({
    globals: { ztoolkit: { log() {} } },
    mocks: {
      "../utils/locale": {
        getString: (id, options) => {
          const args = options?.args;
          return args ? `${id}:${Object.values(args).join(",")}` : id;
        },
      },
      "../ui/dialogTheme": { dialogThemeCSS: () => "" },
      "../rating/tagImport": {
        collectRatingImportPreview: () =>
          preview || {
            total: 1,
            eligible: 1,
            skipped: 0,
            rows: [
              {
                title: "<unsafe>",
                existingRating: 0,
                tagCandidates: ["★★"],
                candidateRating: 2,
                status: "ready",
              },
            ],
          },
        commitRatingImport: async (value, options) => {
          commits.push([value, options]);
          return commit
            ? await commit(value, options)
            : { imported: 1, skipped: 0, failed: 0 };
        },
      },
    },
  });
  return {
    ...h.load("src/panes/ratingImport.ts"),
    host,
    dialog,
    commits,
    opens: () => opens,
  };
}

test("dialog renders a safe reviewed table and opening again focuses the owner-scoped window", () => {
  const app = setup();
  app.openRatingImport(app.host, [{}]);
  assert.equal(app.opens(), 1);
  assert.match(app.dialog.document.body.textContent, /<unsafe>/);
  assert.equal(
    app.dialog.document.body.querySelector("table").children.length,
    2,
  );
  app.openRatingImport(app.host, [{}]);
  assert.equal(app.opens(), 1);
  assert.equal(app.dialog.focusCount, 1);
});

test("closing the owner before dialog load removes the pending load listener", () => {
  const app = setup();
  app.dialog.document.readyState = "loading";
  app.dialog.location.href = "about:blank";
  app.openRatingImport(app.host, [{}]);
  assert.equal(app.dialog.listeners.get("load").size, 1);
  app.host.dispatch("unload");
  assert.equal(app.dialog.closed, true);
  assert.equal(app.dialog.listeners.get("load").size, 0);
});

test("confirm cannot run twice while its first save is pending and disposal makes the model cancel", async () => {
  let resolve;
  const app = setup({
    commit: (_preview, options) =>
      new Promise((done) => {
        resolve = () =>
          done({
            imported: 1,
            skipped: 0,
            failed: 0,
            cancelled: options.isCancelled(),
          });
      }),
  });
  app.openRatingImport(app.host, [{}]);
  const buttons = app.dialog.document.body.querySelectorAll("button");
  const confirm = buttons.at(-1);
  confirm.click();
  confirm.click();
  assert.equal(app.commits.length, 1);
  app.closeRatingImport(app.host);
  assert.equal(app.dialog.closed, true);
  resolve();
  await Promise.resolve();
  assert.equal(app.commits[0][1].isCancelled(), true);
});

test("preview pagination limits the visible table to fifty rows", () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    title: `Paper ${index + 1}`,
    existingRating: 0,
    tagCandidates: ["★"],
    candidateRating: 1,
    status: "ready",
  }));
  const app = setup({ preview: { rows, total: 51, eligible: 51, skipped: 0 } });
  app.openRatingImport(app.host, [{}]);
  const body = app.dialog.document.body.querySelector("tbody");
  assert.equal(body.children.length, 50);
});
