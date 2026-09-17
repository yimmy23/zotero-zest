const test = require("node:test");
const assert = require("node:assert/strict");
const { Buffer } = require("node:buffer");
const { setImmediate } = require("node:timers");
const { createHarness } = require("./helpers.cjs");

const copy = (value) => JSON.parse(JSON.stringify(value));
const id = "showjcr-jcr";
const file = `/memory/zest-datasets/${id}.json`;
const parsed = (value = "8.1", year = 2025) => ({
  name: `ShowJCR ${year}`,
  fields: ["sciif", "sci"],
  rows: [
    {
      name: "Example",
      issn: "0340-7004, 1432-0851",
      fields: { sciif: value, sci: "Q1" },
      jcr: {
        year,
        impactFactor: Number(value),
        source: "dataset",
        provider: "showjcr",
        percentileMethod: "rank",
        categories: [
          {
            name: "Oncology",
            percentile: 80.5,
            rank: "20/100",
            quartile: "Q1",
          },
        ],
      },
    },
  ],
});
const metadata = (data, managedID = id) => ({
  id: managedID,
  name: data.name,
  rows: data.rows.length,
  fields: data.fields,
  updated: 1,
});

async function fixture({ existing, others = [], damaged = false } = {}) {
  let config = {
    datasets: [...others, ...(existing ? [metadata(existing)] : [])],
  };
  let durableConfig = copy(config);
  const files = new Map(
    existing
      ? [
          [
            file,
            JSON.stringify({ v: 1, name: existing.name, rows: existing.rows }),
          ],
        ]
      : [],
  );
  const counts = new Map();
  const failures = new Map();
  const hooks = new Map();
  const actions = [];
  const step = (operation) => {
    const count = (counts.get(operation) || 0) + 1;
    counts.set(operation, count);
    actions.push(operation);
    if (failures.get(operation) === count)
      throw new Error(`injected ${operation} failure`);
  };
  const configStore = {
    isDamaged: damaged,
    get: () => config,
    update(mutate) {
      step("update");
      const draft = copy(config);
      mutate(draft);
      config = draft;
    },
    async flush() {
      await hooks.get("flush")?.();
      step("flush");
      durableConfig = copy(config);
    },
  };
  const h = createHarness({
    mocks: {
      "src/core/config.ts": {
        zestConfig: configStore,
        ConfigStore: { LIMITS: { datasets: 20 } },
        newId: () => "unexpected-new-id",
      },
    },
    globals: {
      PathUtils: { join: (...parts) => parts.join("/") },
      IOUtils: {
        async exists(path) {
          return files.has(path);
        },
        async read(path) {
          step("read");
          if (!files.has(path)) throw new Error("file not found");
          return Buffer.from(files.get(path));
        },
        async makeDirectory() {
          step("makeDirectory");
        },
        async writeUTF8(path, value, options) {
          assert.equal(options.flush, true);
          assert.ok(options.tmpPath.startsWith(file));
          files.set(options.tmpPath, value);
          await hooks.get("writeUTF8")?.();
          step("writeUTF8");
          files.set(path, value);
          files.delete(options.tmpPath);
        },
        async write(path, bytes, options) {
          assert.equal(options.flush, true);
          step("restoreWrite");
          files.set(path, Buffer.from(bytes).toString());
          files.delete(options.tmpPath);
        },
        async remove(path) {
          await hooks.get("remove")?.(path);
          step("remove");
          files.delete(path);
        },
      },
      Zotero: {
        DataDirectory: { dir: "/memory" },
        File: {
          getContentsAsync: async (path) => {
            const contents = files.get(path);
            await hooks.get("getContentsAsync")?.(path);
            return contents;
          },
          putContentsAsync: async (path, contents) => {
            assert.notEqual(path, file, "managed saves must use atomic writes");
            step("putContentsAsync");
            files.set(path, contents);
          },
        },
      },
    },
  });
  const ds = h.load("src/rank/sources/localDataset.ts");
  await ds.loadDatasets();
  return {
    ds,
    files,
    actions,
    configStore,
    config: () => copy(config),
    durableConfig: () => copy(durableConfig),
    value: () => ds.lookupDatasetRecord("example", "1432-0851"),
    failNext(operation) {
      failures.set(operation, (counts.get(operation) || 0) + 1);
    },
    hook(operation, callback) {
      hooks.set(operation, callback);
    },
  };
}

test("managed ShowJCR import writes complete data and updates the same id without accumulating entries", async () => {
  const h = await fixture();
  const original = parsed();
  const before = copy(original);
  const first = await h.ds.saveShowJCRDataset(original);
  assert.equal(first.id, id);
  assert.deepEqual(JSON.parse(h.files.get(file)), {
    v: 1,
    name: original.name,
    rows: original.rows,
  });
  assert.equal(h.config().datasets.length, 1);
  assert.deepEqual(h.durableConfig(), h.config());
  assert.equal(h.value().values[0].value, "8.1");
  assert.equal(h.value().jcr.categories[0].percentile, 80.5);
  assert.deepEqual(original, before);
  const second = await h.ds.saveShowJCRDataset(parsed("6.2", 2024));
  assert.equal(second.id, first.id);
  assert.equal(h.config().datasets.length, 1);
  assert.equal(h.config().datasets[0].name, "ShowJCR 2024");
  assert.equal(h.value().values[0].value, "6.2");
  assert.equal(h.value().jcr.year, 2024);
  assert.equal(h.files.has(`${file}.tmp`), false);
});

test("failed managed updates preserve old file bytes, metadata and active index", async () => {
  for (const operation of [
    "read",
    "makeDirectory",
    "writeUTF8",
    "update",
    "flush",
  ]) {
    const h = await fixture({ existing: parsed("3.4", 2024) });
    const oldDisk = h.files.get(file);
    const oldMeta = h.config();
    const oldIndex = copy(h.value());
    h.failNext(operation);
    await assert.rejects(
      h.ds.saveShowJCRDataset(parsed()),
      new RegExp(operation),
    );
    assert.equal(h.files.get(file), oldDisk, operation);
    assert.deepEqual(h.config(), oldMeta, operation);
    assert.deepEqual(h.durableConfig(), oldMeta, operation);
    assert.deepEqual(copy(h.value()), oldIndex, operation);
    assert.equal(h.files.has(`${file}.tmp`), false, operation);
  }
});

test("failed first managed imports leave no dataset, file, temporary file or active index", async () => {
  for (const operation of ["makeDirectory", "writeUTF8", "update", "flush"]) {
    const h = await fixture();
    h.failNext(operation);
    await assert.rejects(
      h.ds.saveShowJCRDataset(parsed()),
      new RegExp(operation),
    );
    assert.deepEqual(h.config().datasets, [], operation);
    assert.deepEqual(h.durableConfig().datasets, [], operation);
    assert.equal(h.files.has(file), false, operation);
    assert.equal(h.files.has(`${file}.tmp`), false, operation);
    assert.deepEqual(copy(h.value().values), [], operation);
  }
});

test("rollback preserves unrelated configuration changes made during the save", async () => {
  const h = await fixture({ existing: parsed("3.4", 2024) });
  const other = metadata(parsed(), "user-added-dataset");
  h.hook("flush", () => {
    h.hook("flush", undefined);
    h.configStore.update((draft) => {
      draft.datasets.push(other);
    });
  });
  h.failNext("flush");
  await assert.rejects(h.ds.saveShowJCRDataset(parsed()), /flush/);
  assert.equal(
    h.config().datasets.find((entry) => entry.id === id).name,
    "ShowJCR 2024",
  );
  assert.deepEqual(
    h.config().datasets.find((entry) => entry.id === other.id),
    other,
  );
  assert.deepEqual(h.durableConfig(), h.config());
  assert.equal(h.value().values[0].value, "3.4");
});

test("distinct managed imports run in order and each returns its own saved year", async () => {
  const h = await fixture({ existing: parsed("3.4", 2023) });
  let release;
  h.hook("flush", () => {
    h.hook("flush", undefined);
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const first = h.ds.saveShowJCRDataset(parsed("8.1", 2024));
  const second = h.ds.saveShowJCRDataset(parsed("9.9", 2025));
  assert.notEqual(first, second);
  await new Promise(setImmediate);
  assert.equal(
    h.value().values[0].value,
    "3.4",
    "index stays old until the first durable commit",
  );
  assert.equal(
    JSON.parse(h.files.get(file)).name,
    "ShowJCR 2024",
    "the queued file cannot overwrite an unfinished write",
  );
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.name),
    ["ShowJCR 2024", "ShowJCR 2025"],
  );
  assert.equal(h.config().datasets.length, 1);
  assert.equal(h.config().datasets[0].name, "ShowJCR 2025");
  assert.equal(JSON.parse(h.files.get(file)).name, "ShowJCR 2025");
  assert.equal(h.value().jcr.year, 2025);
  assert.equal(h.value().values[0].value, "9.9");
  assert.deepEqual(h.durableConfig(), h.config());
});

test("a failed managed import rolls back before the next queued year is saved", async () => {
  const h = await fixture({ existing: parsed("3.4", 2023) });
  h.failNext("flush");
  const first = h.ds.saveShowJCRDataset(parsed("8.1", 2024));
  const second = h.ds.saveShowJCRDataset(parsed("9.9", 2025));
  const failed = assert.rejects(first, /injected flush failure/);
  const result = await second;
  await failed;
  assert.equal(result.name, "ShowJCR 2025");
  assert.equal(h.config().datasets.length, 1);
  assert.equal(h.config().datasets[0].name, "ShowJCR 2025");
  assert.equal(JSON.parse(h.files.get(file)).name, "ShowJCR 2025");
  assert.equal(h.value().jcr.year, 2025);
  assert.equal(h.value().values[0].value, "9.9");
  assert.deepEqual(h.durableConfig(), h.config());
  assert.equal(h.files.has(`${file}.tmp`), false);
});

test("removal waits for pending startup reads before removing either kind of dataset", async () => {
  for (const datasetID of [id, "custom-existing"]) {
    const h = await fixture({ existing: parsed() });
    const path = `/memory/zest-datasets/${datasetID}.json`;
    if (datasetID !== id) {
      h.files.set(path, h.files.get(file));
      h.files.delete(file);
      h.configStore.update((draft) => {
        draft.datasets[0].id = datasetID;
      });
    }
    let releaseRead;
    h.hook("getContentsAsync", () => {
      h.hook("getContentsAsync", undefined);
      return new Promise((resolve) => {
        releaseRead = resolve;
      });
    });
    const loading = h.ds.loadDatasets();
    await new Promise(setImmediate);
    let removed = false;
    const removing = h.ds.removeDataset(datasetID).then(() => {
      removed = true;
    });
    await new Promise(setImmediate);
    assert.equal(removed, false, datasetID);
    assert.equal(h.files.has(path), true, datasetID);
    assert.equal(h.config().datasets.length, 1, datasetID);
    releaseRead();
    await Promise.all([loading, removing]);
    assert.equal(h.files.has(path), false, datasetID);
    assert.deepEqual(h.config().datasets, [], datasetID);
    assert.deepEqual(copy(h.value().values), [], datasetID);
  }
});

test("managed save, remove and save run in order without deleting the final replacement", async () => {
  const h = await fixture({ existing: parsed("3.4", 2023) });
  let releaseWrite;
  let releaseRemove;
  h.hook("writeUTF8", () => {
    h.hook("writeUTF8", undefined);
    return new Promise((resolve) => {
      releaseWrite = resolve;
    });
  });
  h.hook("remove", (path) => {
    if (path !== file) return;
    h.hook("remove", undefined);
    return new Promise((resolve) => {
      releaseRemove = resolve;
    });
  });
  const first = h.ds.saveShowJCRDataset(parsed("8.1", 2024));
  const removing = h.ds.removeDataset(id);
  let lastSaved = false;
  const last = h.ds.saveShowJCRDataset(parsed("9.9", 2025)).then((result) => {
    lastSaved = true;
    return result;
  });
  await new Promise(setImmediate);
  assert.equal(h.value().values[0].value, "3.4");
  assert.equal(
    releaseRemove,
    undefined,
    "remove cannot overtake the first save",
  );
  releaseWrite();
  assert.equal((await first).name, "ShowJCR 2024");
  await new Promise(setImmediate);
  assert.equal(typeof releaseRemove, "function");
  assert.equal(
    lastSaved,
    false,
    "the last save waits for file deletion to finish",
  );
  assert.equal(JSON.parse(h.files.get(file)).name, "ShowJCR 2024");
  assert.deepEqual(h.config().datasets, []);
  assert.deepEqual(copy(h.value().values), []);
  releaseRemove();
  await removing;
  assert.equal((await last).name, "ShowJCR 2025");
  assert.equal(h.config().datasets.length, 1);
  assert.equal(h.config().datasets[0].name, "ShowJCR 2025");
  assert.equal(JSON.parse(h.files.get(file)).name, "ShowJCR 2025");
  assert.equal(h.value().values[0].value, "9.9");
  assert.deepEqual(h.durableConfig(), h.config());
  await h.ds.loadDatasets();
  assert.equal(h.value().values[0].value, "9.9");
});

test("ordinary imports wait for startup indexing so source precedence is stable after reload", async () => {
  const h = await fixture({ existing: parsed("3.4", 2024) });
  let releaseRead;
  h.hook("getContentsAsync", () => {
    h.hook("getContentsAsync", undefined);
    return new Promise((resolve) => {
      releaseRead = resolve;
    });
  });
  const loading = h.ds.loadDatasets();
  await new Promise(setImmediate);
  const saving = h.ds.saveDataset("Custom", parsed("8.1"));
  await new Promise(setImmediate);
  assert.equal(h.config().datasets.length, 1);
  assert.equal(h.actions.includes("putContentsAsync"), false);
  releaseRead();
  const [, saved] = await Promise.all([loading, saving]);
  assert.deepEqual(
    h.config().datasets.map((entry) => entry.id),
    [id, saved.id],
  );
  assert.equal(h.value().values[0].value, "3.4");
  await h.ds.loadDatasets();
  assert.equal(h.value().values[0].value, "3.4");
});

test("damaged configuration and first-import limits fail before any writes, while an existing slot can update", async () => {
  const damaged = await fixture({ existing: parsed(), damaged: true });
  await assert.rejects(damaged.ds.saveShowJCRDataset(parsed("4.2")), /damaged/);
  assert.equal(damaged.actions.length, 0);
  const others = Array.from({ length: 20 }, (_, i) =>
    metadata(parsed(), `custom-${i}`),
  );
  const full = await fixture({ others });
  await assert.rejects(full.ds.saveShowJCRDataset(parsed()), /limit/);
  assert.equal(full.actions.length, 0);
  const update = await fixture({
    others: others.slice(0, 19),
    existing: parsed(),
  });
  await update.ds.saveShowJCRDataset(parsed("4.2"));
  assert.equal(update.config().datasets.length, 20);
  assert.equal(update.config().datasets.at(-1).id, id);
});

test("manual CSV import rejects malformed ShowJCR layouts but keeps ordinary custom tables", async () => {
  const h = await fixture();
  for (const header of [
    "Journal,ISSN,IF(2025),Category_1",
    "Journal,ISSN,IF(2025),Category_1,IF Quartile(2024)_1,IF Rank(2025)_1",
  ]) {
    assert.throws(
      () =>
        h.ds.parseDataset(
          `${header}\nExample,0340-7004,8.1,ONCOLOGY,Q1,20/100`,
          "csv",
        ),
      /Invalid.*ShowJCR/,
    );
  }
  const custom = h.ds.parseDataset("name,jcr,custom\nExample,Q1,A", "csv");
  assert.deepEqual(copy(custom.rows[0].fields), { jcr: "Q1", custom: "A" });
  assert.equal(custom.rows[0].jcr, undefined);
  assert.equal(h.actions.length, 0);
});
