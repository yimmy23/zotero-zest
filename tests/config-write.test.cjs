const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate } = require("node:timers/promises");
const { createHarness } = require("./helpers.cjs");

function setup({ damaged = false } = {}) {
  const timers = new Map();
  const writes = [];
  let nextTimer = 0;
  let active = 0;
  let maxActive = 0;
  let stored = null;
  const harness = createHarness({
    mocks: {
      "src/utils/locale.ts": { getString: (id) => id },
      "src/utils/timers.ts": {
        setTimeout(fn) {
          const id = ++nextTimer;
          timers.set(id, fn);
          return id;
        },
        clearTimeout(id) {
          timers.delete(id);
        },
      },
    },
    globals: {
      PathUtils: { join: (...parts) => parts.join("/") },
      IOUtils: {
        async exists() {
          return damaged;
        },
        async move() {
          throw new Error("cannot back up damaged file");
        },
      },
      Zotero: {
        DataDirectory: { dir: "/test" },
        File: {
          async getContentsAsync() {
            return "invalid JSON";
          },
          putContentsAsync(path, contents) {
            active++;
            maxActive = Math.max(maxActive, active);
            return new Promise((resolve, reject) => {
              writes.push({
                path,
                contents: JSON.parse(contents),
                succeed() {
                  stored = JSON.parse(contents);
                  active--;
                  resolve();
                },
                fail() {
                  active--;
                  reject(new Error("disk unavailable"));
                },
              });
            });
          },
        },
      },
    },
  });
  const { ConfigStore } = harness.load("src/core/config.ts");
  return {
    store: new ConfigStore(),
    writes,
    get stored() {
      return stored;
    },
    get maxActive() {
      return maxActive;
    },
    runTimers() {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  };
}

function updateDataset(store, name) {
  store.update((draft) => {
    draft.datasets = [
      { id: "showjcr-jcr", name, rows: 1, fields: ["sciif"], updated: 1 },
    ];
  });
}

test("a slow background write finishes before a newer explicit flush", async () => {
  const env = setup();
  await env.store.init();
  updateDataset(env.store, "Old dataset");
  env.runTimers();
  await setImmediate();
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0].contents.datasets[0].name, "Old dataset");

  updateDataset(env.store, "Updated dataset");
  let flushed = false;
  const latest = env.store.flush().then(() => {
    flushed = true;
  });
  await setImmediate();
  assert.equal(env.writes.length, 1, "the updated write must wait");
  assert.equal(flushed, false);

  env.writes[0].succeed();
  await setImmediate();
  assert.equal(env.writes.length, 2);
  assert.equal(env.writes[1].contents.datasets[0].name, "Updated dataset");
  assert.equal(flushed, false, "flush must await its own disk write");
  env.writes[1].succeed();
  await latest;
  assert.equal(env.maxActive, 1);
  assert.equal(env.stored.datasets[0].name, "Updated dataset");
});

test("a failed write rejects its caller without poisoning queued writes", async () => {
  const env = setup();
  await env.store.init();
  updateDataset(env.store, "Old dataset");
  const first = env.store.flush();
  const failure = assert.rejects(first, /disk unavailable/);
  await setImmediate();

  updateDataset(env.store, "Retried dataset");
  const retry = env.store.flush();
  await setImmediate();
  assert.equal(env.writes.length, 1);
  env.writes[0].fail();
  await failure;
  await setImmediate();
  assert.equal(env.writes.length, 2);
  assert.equal(env.writes[1].contents.datasets[0].name, "Retried dataset");
  env.writes[1].succeed();
  await retry;
  assert.equal(env.maxActive, 1);
  assert.equal(env.stored.datasets[0].name, "Retried dataset");
});

test("flush does not write before configuration initialization", async () => {
  const env = setup();
  updateDataset(env.store, "Uninitialized dataset");
  env.runTimers();
  await env.store.flush();
  assert.equal(env.writes.length, 0);
});

test("flush preserves a damaged configuration when backup fails", async () => {
  const env = setup({ damaged: true });
  await env.store.init();
  assert.equal(env.store.isDamaged, true);
  updateDataset(env.store, "Must not replace damaged file");
  env.runTimers();
  await env.store.flush();
  assert.equal(env.writes.length, 0);
});
