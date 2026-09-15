import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";

/**
 * API keys (easyScholar today, others later).
 *
 * Keys go into Firefox's login manager, not into prefs: prefs are plain text
 * in prefs.js, get copied into bug reports and are included in profile
 * backups. If the login manager is unavailable we fall back to a pref and the
 * settings pane says so in red — silently storing a key in the clear would be
 * worse than telling the user.
 *
 * Nothing here is ever logged, and requests that carry a key must pass
 * `logBodyLength: 0` and keep the key out of the URL that gets logged.
 */

const ORIGIN = `chrome://${config.addonRef}`;

export type SecretName = "easyscholar" | "semanticscholar" | "openalex";
export type SecretStorage = "login-manager" | "prefs" | "clear-pending";

const writes = new Map<SecretName, Promise<SecretStorage>>();
const revisions = new Map<SecretName, number>();

function prefKeyFor(name: SecretName): string {
  return `secret.${name}` as const;
}

/** set while the PREF holds the newest value: a failed login-manager write
 *  leaves the old entry behind, and without this marker a later unlock
 *  would silently resurrect the stale key over the newer fallback */
function prefWinsKey(name: SecretName): string {
  return `secret.${name}PrefWins` as const;
}

export async function getSecret(name: SecretName): Promise<string> {
  // Reads already waiting on a locked manager must not resurrect an old key
  // after a newer save/clear. Retry against the latest completed intent.
  for (;;) {
    const revision = revisions.get(name);
    await writes.get(name)?.catch(() => undefined);
    if (revision !== revisions.get(name)) continue;
    const value = await readSecret(name);
    if (revision === revisions.get(name)) return value;
  }
}

async function readSecret(name: SecretName): Promise<string> {
  try {
    if (getPref(prefWinsKey(name) as any)) {
      const v = getPref(prefKeyFor(name) as any);
      return typeof v === "string" ? v : "";
    }
  } catch {
    // If the authority marker cannot be read, do not risk reviving a key the
    // user cleared while the login manager was locked.
    return "";
  }
  try {
    const logins = await Services.logins.searchLoginsAsync({
      origin: ORIGIN,
      httpRealm: name,
    });
    const hit = logins?.find((l: any) => l.username === name);
    if (hit?.password) return String(hit.password);
  } catch {
    // login manager locked or unavailable → fall through to the pref
  }
  try {
    const fallback = Zotero.Prefs.get(
      `${config.prefsPrefix}.${prefKeyFor(name)}`,
      true,
    );
    return typeof fallback === "string" ? fallback : "";
  } catch {
    return "";
  }
}

export async function setSecret(
  name: SecretName,
  value: string,
): Promise<SecretStorage> {
  const clean = value.trim();
  revisions.set(name, (revisions.get(name) ?? 0) + 1);
  const previous = writes.get(name);
  const pending = (async () => {
    if (previous) await previous.catch(() => undefined);
    return writeSecret(name, clean);
  })();
  writes.set(name, pending);
  try {
    return await pending;
  } finally {
    if (writes.get(name) === pending) writes.delete(name);
  }
}

async function writeSecret(
  name: SecretName,
  clean: string,
): Promise<SecretStorage> {
  try {
    const existing = await Services.logins.searchLoginsAsync({
      origin: ORIGIN,
      httpRealm: name,
    });
    for (const l of existing || []) {
      if (l.username === name) await Services.logins.removeLogin(l);
    }
    if (clean) {
      const LoginInfo = Components.Constructor(
        "@mozilla.org/login-manager/loginInfo;1",
        Ci.nsILoginInfo,
        "init",
      ) as any;
      const login = new LoginInfo(ORIGIN, null, name, name, clean, "", "");
      await Services.logins.addLoginAsync(login);
    }
    // Some managers can fail without throwing. Only remove the fallback
    // authority after read-back proves the requested state was persisted.
    const stored = await Services.logins.searchLoginsAsync({
      origin: ORIGIN,
      httpRealm: name,
    });
    const own = (stored || []).filter((l: any) => l.username === name);
    if (
      clean ? own.length !== 1 || own[0].password !== clean : own.length !== 0
    )
      throw new Error("Secret storage verification failed");
    // never leave a copy behind in prefs
    Zotero.Prefs.clear(`${config.prefsPrefix}.${prefKeyFor(name)}`, true);
    Zotero.Prefs.clear(`${config.prefsPrefix}.${prefWinsKey(name)}`, true);
    return "login-manager";
  } catch {
    // last resort: a pref, and the settings pane warns about it. The marker
    // makes the pref authoritative — the login manager may still hold the
    // OLD value (its removal just failed) and must not win a later read.
    try {
      setPref(prefKeyFor(name) as any, clean);
      setPref(prefWinsKey(name) as any, true);
    } catch {
      // Never propagate host errors that could contain the supplied key.
      throw new Error("Could not update secret storage");
    }
    return clean ? "prefs" : "clear-pending";
  }
}

export async function hasSecret(name: SecretName): Promise<boolean> {
  return !!(await getSecret(name));
}

/** true when the key had to be stored in the clear */
export function secretIsInPrefs(name: SecretName): boolean {
  try {
    return !!(getPref(prefKeyFor(name) as any) as string);
  } catch {
    return false;
  }
}

/** Logical clearing succeeded, but physical login-manager deletion is pending. */
export function secretClearPending(name: SecretName): boolean {
  try {
    return (
      !!getPref(prefWinsKey(name) as any) &&
      getPref(prefKeyFor(name) as any) === ""
    );
  } catch {
    return false;
  }
}
