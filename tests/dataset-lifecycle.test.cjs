const test = require("node:test");
const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const { setImmediate } = require("node:timers/promises");
const { createHarness } = require("./helpers.cjs");

const configPath = "/memory/zest-config.json";
const dataPath = "/memory/zest-datasets/showjcr-jcr.json";
const parsed = (year = 2025, value = "5.2") => ({
  name: `ShowJCR ${year}`,
  fields: ["sciif"],
  rows: [{ name: "Example", fields: { sciif: value } }],
});

function environment() {
  const files = new Map();
  const writes = [];
  let pendingWrite;
  let releaseWrite;
  let failConfig = false;
  let pendingRead;
  let releaseRead;
  let failRead = false;
  const host = {
    DataDirectory: { dir: "/memory" },
    File: {
      async getContentsAsync(path) {
        if (path === configPath && pendingRead) {
          await pendingRead;
          if (failRead) {
            failRead = false;
            throw new Error("injected config read failure");
          }
        }
        return files.get(path);
      },
      async putContentsAsync(path, contents) {
        if (path === configPath && failConfig) {
          failConfig = false;
          throw new Error("injected config failure");
        }
        files.set(path, contents);
        writes.push(path);
      },
    },
  };
  const io = {
    async exists(path) {
      return files.has(path);
    },
    async read(path) {
      return Buffer.from(files.get(path));
    },
    async makeDirectory() {},
    async writeUTF8(path, contents) {
      if (pendingWrite) await pendingWrite;
      files.set(path, contents);
      writes.push(path);
    },
    async write(path, bytes) {
      files.set(path, Buffer.from(bytes).toString());
      writes.push(path);
    },
    async remove(path) {
      files.delete(path);
    },
    async move(path, destination) {
      files.set(destination, files.get(path));
      files.delete(path);
    },
  };
  function copy() {
    const h = createHarness({
      mocks: {
        "src/utils/locale.ts": { getString: (id) => id },
        "src/utils/timers.ts": {
          setTimeout: () => 1,
          clearTimeout() {},
        },
      },
      globals: {
        PathUtils: {
          join: (...parts) => parts.join("/"),
          filename: (path) => path.split("/").at(-1),
        },
        IOUtils: io,
        Zotero: host,
      },
    });
    const { zestConfig } = h.load("src/core/config.ts");
    const datasets = h.load("src/rank/sources/localDataset.ts");
    let configReady;
    return {
      ...h,
      config: zestConfig,
      datasets,
      async start() {
        await datasets.startDatasetSession();
        if (!h.context.addon.data.alive) return;
        configReady = zestConfig.init();
        await configReady;
        if (!h.context.addon.data.alive) return;
        await datasets.loadDatasets();
      },
      stop() {
        h.context.addon.data.alive = false;
        void datasets.stopDatasetOperations();
        return datasets.finishDatasetSession(configReady);
      },
    };
  }
  return {
    files,
    writes,
    host,
    copy,
    blockWrite() {
      pendingWrite = new Promise((resolve) => {
        releaseWrite = resolve;
      });
    },
    releaseWrite() {
      pendingWrite = undefined;
      releaseWrite();
    },
    failNextConfigWrite() {
      failConfig = true;
    },
    blockConfigRead(fail = false) {
      failRead = fail;
      pendingRead = new Promise((resolve) => {
        releaseRead = resolve;
      });
    },
    releaseConfigRead() {
      pendingRead = undefined;
      releaseRead();
    },
    diskConfig: () => JSON.parse(files.get(configPath)),
  };
}

test("new plugin config waits for the outgoing dataset transaction and final flush", async () => {
  const env = environment();
  const outgoing = env.copy();
  await outgoing.start();
  env.blockWrite();
  const saving = outgoing.datasets.saveShowJCRDataset(parsed());
  await setImmediate();
  const shutdown = outgoing.stop();
  assert.equal(outgoing.datasets.finishDatasetSession(), shutdown);
  const incoming = env.copy();
  let started = false;
  const startup = incoming.start().then(async () => {
    started = true;
    incoming.config.update((draft) => {
      draft.tagRules = [{ prefix: "New session rule", color: "#123456" }];
    });
    await incoming.config.flush();
  });
  await setImmediate();
  assert.equal(started, false, "new config must not read an old snapshot");
  assert.equal(env.files.has(configPath), false);
  env.releaseWrite();
  await Promise.all([saving, shutdown, startup]);
  assert.equal(env.diskConfig().tagRules[0].prefix, "New session rule");
  assert.equal(env.diskConfig().datasets[0].name, "ShowJCR 2025");
  assert.equal(
    incoming.datasets.lookupDatasetRecord("example").values[0].value,
    "5.2",
    "the newly enabled instance loads the committed local data",
  );
  const settledWrites = env.writes.length;
  // A duplicate shutdown callback after the next instance starts must remain
  // a no-op; re-flushing the outgoing snapshot would erase the new tag rule.
  await outgoing.datasets.finishDatasetSession();
  await setImmediate();
  assert.equal(env.writes.length, settledWrites, "old copy has no late writes");
  assert.equal(env.diskConfig().tagRules[0].prefix, "New session rule");
  await incoming.stop();
  assert.equal(env.host.__zestDatasetPersistence, undefined);
});

test("shutdown cancels queued imports and removals while completing the active transaction", async () => {
  const env = environment();
  const outgoing = env.copy();
  await outgoing.start();
  env.blockWrite();
  const active = outgoing.datasets.saveShowJCRDataset(parsed(2024, "4.2"));
  await setImmediate();
  const queued = [
    outgoing.datasets.saveShowJCRDataset(parsed()),
    outgoing.datasets.removeDataset("showjcr-jcr"),
    outgoing.datasets.saveDataset("Must not save", parsed()),
  ];
  const cancelled = queued.map((job) => assert.rejects(job, /cancelled/));
  let stopped = false;
  const shutdown = outgoing.stop().then(() => {
    stopped = true;
  });
  await setImmediate();
  assert.equal(stopped, false);
  env.releaseWrite();
  await Promise.all([active, shutdown, ...cancelled]);
  assert.equal(env.diskConfig().datasets.length, 1);
  assert.equal(env.diskConfig().datasets[0].name, "ShowJCR 2024");
  assert.equal(JSON.parse(env.files.get(dataPath)).name, "ShowJCR 2024");
  assert.equal(env.writes.filter((path) => path === dataPath).length, 1);
  await assert.rejects(
    outgoing.datasets.saveShowJCRDataset(parsed()),
    /cancelled/,
  );
  await assert.rejects(
    outgoing.datasets.removeDataset("showjcr-jcr"),
    /cancelled/,
  );
  const incoming = env.copy();
  await incoming.start();
  await incoming.datasets.saveShowJCRDataset(parsed());
  assert.equal(env.diskConfig().datasets[0].name, "ShowJCR 2025");
  await incoming.stop();
});

test("a failing active transaction rolls back before incoming configuration reads", async () => {
  const env = environment();
  const outgoing = env.copy();
  await outgoing.start();
  await outgoing.datasets.saveShowJCRDataset(parsed(2024, "4.2"));
  const originalFile = env.files.get(dataPath);
  env.blockWrite();
  const saving = outgoing.datasets.saveShowJCRDataset(parsed());
  const failure = assert.rejects(saving, /injected config failure/);
  await setImmediate();
  const shutdown = outgoing.stop();
  const incoming = env.copy();
  let started = false;
  const startup = incoming.start().then(() => {
    started = true;
  });
  await setImmediate();
  assert.equal(started, false);
  env.failNextConfigWrite();
  env.releaseWrite();
  await Promise.all([failure, shutdown, startup]);
  assert.equal(env.files.get(dataPath), originalFile);
  assert.equal(env.diskConfig().datasets[0].name, "ShowJCR 2024");
  assert.equal(incoming.config.get().datasets[0].name, "ShowJCR 2024");
  assert.equal(
    incoming.datasets.lookupDatasetRecord("example").values[0].value,
    "4.2",
  );
  await incoming.stop();
});

test("disabling a waiting copy cannot let a third copy bypass the original writer", async () => {
  const env = environment();
  const first = env.copy();
  await first.start();
  env.blockWrite();
  const saving = first.datasets.saveShowJCRDataset(parsed());
  await setImmediate();
  const firstShutdown = first.stop();
  const second = env.copy();
  const secondStartup = second.start();
  const secondShutdown = second.stop();
  const third = env.copy();
  let thirdStarted = false;
  const thirdStartup = third.start().then(() => {
    thirdStarted = true;
  });
  await setImmediate();
  assert.equal(thirdStarted, false);
  env.releaseWrite();
  await Promise.all([
    saving,
    firstShutdown,
    secondStartup,
    secondShutdown,
    thirdStartup,
  ]);
  assert.equal(third.config.get().datasets[0].name, "ShowJCR 2025");
  await third.stop();
  assert.equal(env.host.__zestDatasetPersistence, undefined);
});

test("slow config initialization and its recovery complete before the shutdown lease is released", async () => {
  for (const recover of [false, true]) {
    const env = environment();
    const seed = env.copy();
    await seed.start();
    await seed.datasets.saveShowJCRDataset(parsed(2024, "4.2"));
    await seed.stop();
    const originalConfig = env.files.get(configPath);
    env.blockConfigRead(recover);
    const outgoing = env.copy();
    const oldStartup = outgoing.start();
    await setImmediate();
    // This invokes final cleanup while init is pending, as happens after the
    // hook's bounded startup wait has expired. No real-time sleep is needed.
    let stopped = false;
    const shutdown = outgoing.stop().then(() => {
      stopped = true;
    });
    const incoming = env.copy();
    let started = false;
    const startup = incoming.start().then(async () => {
      started = true;
      incoming.config.update((draft) => {
        draft.tagRules = [{ prefix: "New session rule", color: "#123456" }];
      });
      await incoming.config.flush();
    });
    await setImmediate();
    assert.equal(stopped, false, "cleanup must still wait for config.init");
    assert.equal(
      started,
      false,
      "the incoming copy cannot bypass init recovery",
    );
    assert.equal(env.files.get(configPath), originalConfig);
    env.releaseConfigRead();
    await Promise.all([oldStartup, shutdown, startup]);
    assert.equal(env.diskConfig().tagRules[0].prefix, "New session rule");
    if (recover) {
      const backup = [...env.files.keys()].find((path) =>
        path.startsWith(`${configPath}.damaged-`),
      );
      assert.ok(backup, "the old unreadable config is preserved");
      assert.equal(env.files.get(backup), originalConfig);
    } else {
      assert.equal(env.diskConfig().datasets[0].name, "ShowJCR 2024");
    }
    await outgoing.datasets.finishDatasetSession();
    assert.equal(env.diskConfig().tagRules[0].prefix, "New session rule");
    await incoming.stop();
  }
});
