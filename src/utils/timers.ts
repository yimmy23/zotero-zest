/**
 * Window-independent timers for background work (tracker sampling, store
 * flushing, debounced refreshes).
 *
 * DOM timers belong to a window and die with it — on macOS the main window
 * can be closed while Zotero (and stand-alone reader windows) keep running,
 * which would silently stop sampling/flushing. Timer.sys.mjs timers live in
 * the process instead. Zotero also injects these into the plugin sandbox
 * (plugins.js), but importing them explicitly avoids depending on that.
 */
const TimerModule = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs",
) as {
  setTimeout: (fn: () => void, ms?: number) => number;
  clearTimeout: (id?: number) => void;
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id?: number) => void;
};

export function setTimeout(fn: () => void, ms = 0): number {
  return TimerModule.setTimeout(fn, ms);
}
export function clearTimeout(id?: number) {
  if (id !== undefined) TimerModule.clearTimeout(id);
}
export function setInterval(fn: () => void, ms: number): number {
  return TimerModule.setInterval(fn, ms);
}
export function clearInterval(id?: number) {
  if (id !== undefined) TimerModule.clearInterval(id);
}
