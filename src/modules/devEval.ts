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
import * as configModule from "../core/config";
import * as annots from "../annots/density";
import * as tagTree from "../tags/tree";
import * as tagRules from "../tags/rules";
import * as rankMap from "../rank/map";
import * as rankNormalize from "../rank/normalize";
import * as graphPane from "../graph/pane";
import * as graphBuild from "../graph/build";
import * as tagTreeUI from "../tags/nestedTree";
import * as tagScope from "../tags/scope";
import * as itemFilter from "../views/itemFilter";
import * as annotSection from "../panes/annotSection";
import * as rank from "../rank";
import * as rankRank from "../rank/rank";
import * as dataset from "../rank/sources/localDataset";
import * as secrets from "../core/secrets";
import * as easyscholarSrc from "../rank/sources/easyscholar";
import * as httpMod from "../core/http";
import * as authors from "../authors/pipeline";
import * as authorColumns from "../columns/authors";
import * as cite from "../cite";
import * as citeExtra from "../cite/extraFormat";
import * as infoSection from "../panes/infoSection";
import * as stats from "../panes/statsDialog";
import * as matrix from "../panes/annotMatrix";
import * as tabsSidebar from "../tabs/sidebar";
import * as reveal from "../views/reveal";
import * as csv from "../utils/csv";
import * as density from "../annots/density";
import * as counts from "../views/collectionCounts";
import * as tabsModel from "../tabs/model";
import * as remark from "../columns/remark";
import * as viewGroups from "../views/viewGroups";
import * as collectionCounts from "../views/collectionCounts";
import * as readerThemes from "../reader/themes";
import * as columns from "../columns";
import * as registry from "../columns/registry";
import * as migrate from "../reading/migrate";
import * as exportImport from "../reading/exportImport";
import * as extra from "../utils/extra";
import * as status from "../reading/status";
import * as statusMenu from "../reading/statusMenu";
import * as pubTags from "../columns/pubTags";

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

/** dev-only: remove the console probe and the eval endpoint (plugin shutdown) */
export function uninstallDevEval() {
  if (__env__ !== "development") return;
  try {
    const probe = (Zotero as any).__zestConsoleProbe;
    if (probe) {
      Services.console.unregisterListener(probe);
      delete (Zotero as any).__zestConsoleProbe;
    }
  } catch {
    // ignore
  }
  try {
    const endpoints = (Zotero as any).Server?.Endpoints;
    if (endpoints) delete endpoints["/zest-dev/eval"];
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
            status,
            statusMenu,
            pubTags,
            startupConsole,
            cache,
            zestConfig,
            configModule,
            annots,
            tagTree,
            tagRules,
            rankMap,
            rankNormalize,
            graphPane,
            graphBuild,
            tagTreeUI,
            tagScope,
            itemFilter,
            annotSection,
            rank,
            rankRank,
            dataset,
            secrets,
            easyscholarSrc,
            httpMod,
            authors,
            authorColumns,
            cite,
            citeExtra,
            infoSection,
            stats,
            matrix,
            tabsSidebar,
            reveal,
            csv,
            density,
            counts,
            tabsModel,
            remark,
            viewGroups,
            collectionCounts,
            readerThemes,
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
