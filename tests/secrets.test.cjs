const assert = require("node:assert/strict");
const test = require("node:test");
const { setImmediate } = require("node:timers/promises");
const { createHarness } = require("./helpers.cjs");

function fixture() {
  const prefs = new Map();
  const logins = [];
  const logs = [];
  const prefix = "extensions.zotero.zest.";
  const manager = {
    async searchLoginsAsync({ httpRealm }) {
      return logins.filter((login) => login.httpRealm === httpRealm);
    },
    removeLogin(login) {
      logins.splice(logins.indexOf(login), 1);
    },
    async addLoginAsync(login) {
      logins.push(login);
    },
  };
  const h = createHarness({
    globals: {
      ztoolkit: { log: (...args) => logs.push(args) },
      Zotero: {
        Prefs: {
          get: (key) => prefs.get(key),
          set: (key, value) => prefs.set(key, value),
          clear: (key) => prefs.delete(key),
        },
      },
      Services: { logins: manager },
      Ci: { nsILoginInfo: {} },
      Components: {
        Constructor: () =>
          class LoginInfo {
            constructor(
              origin,
              formActionOrigin,
              httpRealm,
              username,
              password,
            ) {
              Object.assign(this, { origin, httpRealm, username, password });
            }
          },
      },
    },
  });
  return {
    ...h,
    api: h.load("src/core/secrets.ts"),
    prefs,
    manager,
    logins,
    logs,
    pref: (key) => prefs.get(`${prefix}secret.${key}`),
    add(name, password) {
      logins.push({
        origin: "chrome://zest",
        httpRealm: name,
        username: name,
        password,
      });
    },
  };
}

test("failed login deletion disables the key and reports pending physical removal", async () => {
  const h = fixture();
  h.add("openalex", "fixture-old-secret");
  const remove = h.manager.removeLogin;
  h.manager.removeLogin = () => {
    throw new Error("Locked login manager");
  };
  assert.equal(await h.api.setSecret("openalex", ""), "clear-pending");
  assert.equal(h.logins.length, 1);
  assert.equal(h.pref("openalex"), "");
  assert.equal(h.pref("openalexPrefWins"), true);
  assert.equal(h.api.secretClearPending("openalex"), true);
  assert.equal(h.api.secretIsInPrefs("openalex"), false);
  assert.equal(await h.api.getSecret("openalex"), "");
  assert.equal(await h.api.hasSecret("openalex"), false);
  // The durable empty marker survives a new module instance and a later unlock.
  const reopened = createHarness({ globals: h.context }).load(
    "src/core/secrets.ts",
  );
  assert.equal(await reopened.getSecret("openalex"), "");
  h.manager.removeLogin = remove;
  assert.equal(await h.api.setSecret("openalex", ""), "login-manager");
  assert.equal(h.logins.length, 0);
  assert.equal(h.api.secretClearPending("openalex"), false);
  assert.equal(h.pref("openalexPrefWins"), undefined);
  assert.equal(await h.api.getSecret("openalex"), "");
  assert.deepEqual(h.logs, []);
});

test("a locked login search cannot revive the fallback value after clearing", async () => {
  const h = fixture();
  const search = h.manager.searchLoginsAsync;
  h.manager.searchLoginsAsync = async () => {
    throw new Error("Manager locked");
  };
  assert.equal(
    await h.api.setSecret("easyscholar", "fixture-fallback"),
    "prefs",
  );
  assert.equal(await h.api.getSecret("easyscholar"), "fixture-fallback");
  assert.equal(await h.api.setSecret("easyscholar", ""), "clear-pending");
  assert.equal(await h.api.getSecret("easyscholar"), "");
  h.add("easyscholar", "fixture-stale-login");
  h.manager.searchLoginsAsync = search;
  assert.equal(await h.api.getSecret("easyscholar"), "");
});

test("a manager that silently ignores removal fails read-back verification", async () => {
  const h = fixture();
  h.add("openalex", "fixture-stale-login");
  h.manager.removeLogin = () => {};
  assert.equal(await h.api.setSecret("openalex", ""), "clear-pending");
  assert.equal(await h.api.getSecret("openalex"), "");
  assert.equal(await h.api.setSecret("openalex", "fixture-new-key"), "prefs");
  assert.equal(await h.api.getSecret("openalex"), "fixture-new-key");
});

test("verified saves delete duplicate owned entries and leave other usernames alone", async () => {
  const h = fixture();
  h.add("semanticscholar", "fixture-old-1");
  h.add("semanticscholar", "fixture-old-2");
  const other = {
    httpRealm: "semanticscholar",
    username: "another-owner",
    password: "fixture-foreign-value",
  };
  h.logins.push(other);
  assert.equal(
    await h.api.setSecret("semanticscholar", "  fixture-new  "),
    "login-manager",
  );
  assert.equal(await h.api.getSecret("semanticscholar"), "fixture-new");
  assert.equal(h.logins.length, 2);
  assert.ok(h.logins.includes(other));
  assert.equal(await h.api.setSecret("semanticscholar", ""), "login-manager");
  assert.deepEqual(h.logins, [other]);
});

test("concurrent secret saves are serialized so the later key is authoritative", async () => {
  const h = fixture();
  const originalAdd = h.manager.addLoginAsync;
  let release;
  let additions = 0;
  h.manager.addLoginAsync = async (login) => {
    additions++;
    if (additions === 1) await new Promise((resolve) => (release = resolve));
    await originalAdd(login);
  };
  const first = h.api.setSecret("openalex", "fixture-first");
  await setImmediate();
  const second = h.api.setSecret("openalex", "fixture-second");
  const read = h.api.getSecret("openalex");
  await setImmediate();
  assert.equal(additions, 1);
  release();
  assert.equal(await first, "login-manager");
  assert.equal(await second, "login-manager");
  assert.equal(await read, "fixture-second");
  assert.equal(await h.api.getSecret("openalex"), "fixture-second");
  assert.equal(h.logins.length, 1);
});

test("a read begun before clearing cannot return its delayed stale login", async () => {
  const h = fixture();
  h.add("openalex", "fixture-old-key");
  const search = h.manager.searchLoginsAsync;
  let release;
  let searches = 0;
  h.manager.searchLoginsAsync = async (options) => {
    searches++;
    const snapshot = await search(options);
    if (searches === 1) await new Promise((resolve) => (release = resolve));
    return snapshot;
  };
  const staleRead = h.api.getSecret("openalex");
  await setImmediate();
  assert.equal(await h.api.setSecret("openalex", ""), "login-manager");
  release();
  assert.equal(await staleRead, "");
});

test("failed secret storage reports a sanitized error without credential output", async () => {
  const h = fixture();
  h.manager.searchLoginsAsync = async () => {
    throw new Error("fixture-sensitive-value");
  };
  h.context.Zotero.Prefs.set = () => {
    throw new Error("fixture-sensitive-value");
  };
  await assert.rejects(
    h.api.setSecret("openalex", "fixture-sensitive-value"),
    (error) => {
      assert.equal(error.message, "Could not update secret storage");
      return true;
    },
  );
  assert.deepEqual(h.logs, []);
});
