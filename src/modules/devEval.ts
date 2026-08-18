/**
 * DEV-BUILD-ONLY remote eval endpoint for closed-loop debugging.
 *
 * Registered on Zotero's localhost-only connector server and ONLY when the
 * bundle was built with NODE_ENV=development — the production xpi never
 * contains an active endpoint (the whole function is a no-op there). A
 * shared-secret token is still required per request.
 *
 *   POST http://127.0.0.1:<connector port>/zest-dev/eval
 *   {"token": TOKEN, "code": "<async function body; Zotero, addon, dev in scope>"}
 */

import { readingStore } from "../reading/store";
import { readingTracker } from "../reading/tracker";
import { zestDB } from "../core/db";
import { cache } from "../core/storage";
import { zestConfig } from "../core/config";
import * as annots from "../annots/density";
import * as tagTree from "../tags/tree";
import * as tagRules from "../tags/rules";
import * as rankMap from "../rank/map";
import * as rankNormalize from "../rank/normalize";
import * as graphPane from "../graph/pane";
import * as graphBuild from "../graph/build";
import * as columns from "../columns";
import * as registry from "../columns/registry";
import * as migrate from "../reading/migrate";
import * as exportImport from "../reading/exportImport";
import * as extra from "../utils/extra";

const TOKEN = "zest-dev-5c1e9a27";

/** dev-only: capture console errors during startup with the debug-log tail at that moment */
export const startupConsole: string[] = [];
export function installStartupConsoleProbe() {
  if (__env__ !== "development") return;
  try {
    const listener = {
      QueryInterface: ChromeUtils.generateQI([
        Components.interfaces.nsIConsoleListener,
      ]),
      observe(m: any) {
        try {
          const msg = String(m.message || "");
          if (!/uncaught|TypeError|ReferenceError/.test(msg)) return;
          startupConsole.push(`${new Date().toISOString()} CONSOLE ${msg}`);
        } catch {
          // ignore
        }
      },
    };
    Services.console.registerListener(listener as any);
    (Zotero as any).__zestConsoleProbe = listener;
  } catch {
    // ignore
  }
}

export function devMark(name: string) {
  if (__env__ !== "development") return;
  startupConsole.push(`${new Date().toISOString()} MARK ${name}`);
}

export function registerDevEval() {
  if (__env__ !== "development") return;
  try {
    const endpoints = (Zotero as any).Server?.Endpoints;
    if (!endpoints) {
      ztoolkit.log("[devEval] Zotero.Server not available");
      return;
    }
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as any;
    const handler = function () {};
    handler.prototype = {
      supportedMethods: ["POST"],
      supportedDataTypes: ["application/json"],
      permitBookmarklet: false,
      init: async function (req: any) {
        try {
          const data = req.data || {};
          if (data.token !== TOKEN) {
            return [403, "text/plain", "forbidden"];
          }
          const fn = new AsyncFunction(
            "Zotero",
            "addon",
            "dev",
            String(data.code),
          );
          let result = await fn(Zotero, addon, {
            readingStore,
            readingTracker,
            zestDB,
            columns,
            registry,
            migrate,
            exportImport,
            extra,
            startupConsole,
            cache,
            zestConfig,
            annots,
            tagTree,
            tagRules,
            rankMap,
            rankNormalize,
            graphPane,
            graphBuild,
          });
          if (typeof result !== "string") {
            try {
              result = JSON.stringify(result);
            } catch {
              result = String(result);
            }
          }
          return [
            200,
            "application/json",
            JSON.stringify({ ok: true, result: String(result ?? "") }),
          ];
        } catch (e: any) {
          return [
            200,
            "application/json",
            JSON.stringify({
              ok: false,
              error: `${e}\n${e?.stack || ""}`,
            }),
          ];
        }
      },
    };
    endpoints["/zest-dev/eval"] = handler;
    ztoolkit.log("[devEval] endpoint registered");
  } catch (e) {
    ztoolkit.log("[devEval] register failed", e);
  }
}
