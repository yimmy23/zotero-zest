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

function prefKeyFor(name: SecretName): string {
  return `secret.${name}` as const;
}

export async function getSecret(name: SecretName): Promise<string> {
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
): Promise<"login-manager" | "prefs"> {
  const clean = value.trim();
  try {
    const existing = await Services.logins.searchLoginsAsync({
      origin: ORIGIN,
      httpRealm: name,
    });
    for (const l of existing || []) {
      try {
        Services.logins.removeLogin(l);
      } catch {
        // ignore
      }
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
    // never leave a copy behind in prefs
    try {
      Zotero.Prefs.clear(`${config.prefsPrefix}.${prefKeyFor(name)}`, true);
    } catch {
      // no pref set
    }
    return "login-manager";
  } catch {
    // last resort: a pref, and the settings pane warns about it
    setPref(prefKeyFor(name) as any, clean);
    return "prefs";
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
