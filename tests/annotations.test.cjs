const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./helpers.cjs");

function setup() {
  let observer;
  let readingChanged;
  const jobs = new Map();
  let nextJob = 0;
  const refreshed = [];
  const records = new Map();
  const annotation = {
    id: 3,
    parentItemID: 2,
    annotationText: "A highlight",
    annotationPosition: '{"pageIndex":9}',
    isAnnotation: () => true,
  };
  const attachment = {
    id: 2,
    parentItemID: 1,
    isAttachment: () => true,
    getAnnotations: () => [annotation],
  };
  const parent = {
    id: 1,
    libraryID: 1,
    key: "PARENT01",
    attachments: [2],
    isRegularItem: () => true,
    getAttachments() {
      return this.attachments;
    },
  };
  const items = new Map([
    [1, parent],
    [2, attachment],
    [3, annotation],
  ]);
  const harness = createHarness({
    mocks: {
      "src/reading/store.ts": {
        readingStore: {
          items: records,
          getForItem: () => records.get("1/PARENT01"),
          onChange(fn) {
            readingChanged = fn;
            return () => (readingChanged = undefined);
          },
        },
      },
      "src/utils/timers.ts": {
        setTimeout(fn) {
          jobs.set(++nextJob, fn);
          return nextJob;
        },
        clearTimeout: (id) => jobs.delete(id),
      },
    },
    globals: {
      Zotero: {
        Items: { get: (id) => items.get(id) || false },
        Promise: { delay: async () => {} },
        Notifier: {
          registerObserver(value) {
            observer = value;
            return "annotations";
          },
          unregisterObserver() {},
        },
      },
    },
  });
  const density = harness.load("src/annots/density.ts");
  density.startAnnotationWatch((ids) => refreshed.push(...ids));
  function populate() {
    density.requestSummary(parent);
    for (const [id, run] of jobs) {
      jobs.delete(id);
      run();
    }
    refreshed.length = 0;
  }
  return {
    density,
    parent,
    attachment,
    annotation,
    records,
    refreshed,
    jobs,
    populate,
    notify: (...args) => observer.notify(...args),
    reading: () => readingChanged?.(["1/PARENT01"]),
  };
}

test("moving an attachment invalidates the old and new parent summaries", () => {
  const s = setup();
  s.populate();
  assert.equal(s.density.getSummary(1).count, 1);
  s.parent.attachments = [];
  s.attachment.parentItemID = 4;
  s.notify("modify", "item", [2]);
  assert.equal(s.density.getSummary(1), undefined);
  assert.deepEqual(s.refreshed, [1, 4]);
  s.populate();
  assert.equal(s.density.getSummary(1).count, 0);
});

test("page count changes rescale the histogram; time-only ticks do no work", () => {
  const s = setup();
  s.populate();
  assert.equal(s.density.getSummary(1).histogram[36], 1);
  s.records.set("1/PARENT01", { pages: 400, total: 5 });
  s.reading();
  assert.deepEqual(s.refreshed, [1]);
  s.populate();
  const cached = s.density.getSummary(1);
  assert.equal(cached.histogram[0], 1);
  for (let i = 0; i < 100; i++) s.reading();
  assert.equal(s.density.getSummary(1), cached);
  assert.equal(s.refreshed.length, 0);
  assert.equal(s.jobs.size, 0);
});

test("ordinary attachment saves do not recompute annotations", () => {
  const s = setup();
  s.populate();
  const cached = s.density.getSummary(1);
  s.notify("modify", "item", [2]);
  assert.equal(s.density.getSummary(1), cached);
  assert.equal(s.refreshed.length, 0);
});

test("restoring an attachment from Trash invalidates its library summary", () => {
  const s = setup();
  s.populate();
  s.parent.attachments = [];
  s.notify("trash", "item", [2]);
  s.populate();
  assert.equal(s.density.getSummary(1).count, 0);
  s.parent.attachments = [2];
  s.notify("refresh", "trash", [1]);
  assert.equal(s.density.getSummary(1), undefined);
  s.populate();
  assert.equal(s.density.getSummary(1).count, 1);
});

test("shutdown cancels queued summaries and reading subscriptions", () => {
  const s = setup();
  s.density.requestSummary(s.parent);
  assert.equal(s.jobs.size, 1);
  s.density.stopAnnotationWatch();
  assert.equal(s.jobs.size, 0);
  s.reading();
  assert.equal(s.refreshed.length, 0);
});
