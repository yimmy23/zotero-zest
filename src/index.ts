import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

const basicTool = new BasicTool();

// The guard is on OUR copy having an addon, not on the global being free.
// An upgrade loads the new copy while the old one is still registered, so a
// global that is already taken says nothing about whether this copy is set up
// — deferring to it would leave this copy with no `addon` at all, and every
// hook below would throw. The outgoing copy's shutdown hands the name back
// only if it still owns it (see hooks.onShutdown).
if (!_globalThis.addon) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => {
    return _globalThis.addon.data.ztoolkit;
  });
  // @ts-expect-error - Plugin instance is not typed
  Zotero[config.addonInstance] = addon;
}

function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}
