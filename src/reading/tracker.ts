import { config } from "../../package.json";
import { getPref, getNumPref } from "../utils/prefs";
import { setInterval, clearInterval } from "../utils/window";
import { readingStore, keyOfItem } from "./store";
import { onReadingProgress, onReadingStarted } from "./statusAuto";

/**
 * Reading-session tracker.
 *
 * Every `tracker.sampleSeconds` (default 5 s) it looks for the ONE reader
 * the user is actually looking at (front-most main window's selected tab,
 * or a focused stand-alone reader window), rejects the sample when the OS
 * says the user has been idle for `tracker.idleSeconds`, reads the current
 * page from the reader's internal state and credits the sample to the
 * parent item / page / day in the store.
 *
 * Page truth (Zotero 7.0.0 → 10-main, verified against source):
 *   reader._internalReader._state.{primary, primaryViewStats|secondaryViewStats}
 *   PDF/EPUB stats = {pageIndex (0-based), pagesCount, …}; snapshots have no
 *   page notion. `reader.state` (what zotero-style read) does not exist
 *   in Zotero 7+. `_state` is replaced by a new object on every update, so
 *   it is re-read on every sample, never cached.
 *
 * Boundaries: Notifier tab select/close and file close flush the store so a
 * crash loses at most one flush interval. The observer is registered with
 * priority 50 (< Zotero.Reader's default 100), so on `tab/close` the reader
 * instance is still resolvable if ever needed.
 */

interface ActiveReader {
  reader: any;
  win: Window;
}

class ReadingTracker {
  private timer?: number;
  private notifierID?: string;
  private startedKeys = new Set<string>();
  private lastProgressCheck = new Map<string, number>();
  private idleService: any = null;
  running = false;
  /** dev builds only: ignore OS focus/idle so headless probes can drive the tracker */
  debugForceActive = false;

  start() {
    if (this.running) return;
    this.running = true;
    try {
      this.idleService = (Components.classes as any)[
        "@mozilla.org/widget/useridleservice;1"
      ].getService(Components.interfaces.nsIUserIdleService);
    } catch (e) {
      ztoolkit.log("[tracker] idle service unavailable", e);
    }
    this.notifierID = Zotero.Notifier.registerObserver(
      {
        notify: (event: string, type: string, ids: any[], extra: any) => {
          try {
            this.onNotify(event, type, ids, extra);
          } catch (e) {
            ztoolkit.log("[tracker] notify failed", e);
          }
        },
      },
      ["tab", "file"],
      `${config.addonRef}-tracker`,
      50,
    );
    this.restartTimer();
  }

  restartTimer() {
    clearInterval(this.timer);
    const sec = Math.min(
      30,
      Math.max(2, getNumPref("tracker.sampleSeconds", 5)),
    );
    this.timer = setInterval(() => this.tick(sec), sec * 1000);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.notifierID) {
      Zotero.Notifier.unregisterObserver(this.notifierID);
      this.notifierID = undefined;
    }
  }

  private onNotify(event: string, type: string, _ids: any[], _extra: any) {
    if (type === "tab" && (event === "select" || event === "close")) {
      void readingStore.flush();
    } else if (type === "file" && event === "close") {
      void readingStore.flush();
    }
  }

  /** The reader the user is looking at right now, or null. */
  activeReader(): ActiveReader | null {
    let focused: Window | null;
    try {
      focused = Services.focus.activeWindow as unknown as Window | null;
    } catch {
      focused = null;
    }
    if (__env__ === "development" && this.debugForceActive) {
      focused = Zotero.getMainWindow() as unknown as Window;
    }
    if (!focused) return null;
    // main-window tab
    for (const win of Zotero.getMainWindows()) {
      if ((win as unknown as Window) !== focused) continue;
      const tabs = (win as any).Zotero_Tabs;
      const id = tabs?.selectedID;
      if (!id || id === "zotero-pane") return null;
      const reader = (Zotero.Reader as any).getByTabID?.(id);
      return reader ? { reader, win: win as unknown as Window } : null;
    }
    // stand-alone reader window
    for (const r of ((Zotero.Reader as any)._readers || []) as any[]) {
      if (!r?.tabID && r?._window && r._window === focused) {
        return { reader: r, win: r._window };
      }
    }
    return null;
  }

  private isIdle(reader: any): boolean {
    if (__env__ === "development" && this.debugForceActive) return false;
    const limit = Math.max(10, getNumPref("tracker.idleSeconds", 120)) * 1000;
    let idle: number;
    try {
      idle = this.idleService ? Number(this.idleService.idleTime) : 0;
    } catch {
      idle = 0;
    }
    if (idle < limit) return false;
    // Read Aloud keeps the user "active" without input (9.0+ audioStatus;
    // may be undefined on some builds — then it simply doesn't exempt)
    try {
      const tabID = reader?.tabID;
      const win = reader?._window;
      const tab = tabID && win?.Zotero_Tabs?._getTab?.(tabID)?.tab;
      if (tab?.audioStatus?.active) return false;
    } catch {
      // ignore
    }
    return true;
  }

  /** Read {pageIndex, pages} from the reader's internal state (sync). */
  static readPosition(reader: any): { pageIndex: number; pages: number } {
    const ir = reader?._internalReader;
    const st = ir?._state;
    if (!st) return { pageIndex: -1, pages: 0 };
    const primary = st.primary !== false;
    const stats = primary ? st.primaryViewStats : st.secondaryViewStats;
    const vs = primary ? st.primaryViewState : st.secondaryViewState;
    const type = reader?.type;
    if (type === "snapshot") return { pageIndex: -1, pages: 0 };
    let pageIndex = -1;
    if (Number.isInteger(stats?.pageIndex)) pageIndex = stats.pageIndex;
    else if (Number.isInteger(vs?.pageIndex)) pageIndex = vs.pageIndex;
    let pages = Number.isInteger(stats?.pagesCount) ? stats.pagesCount : 0;
    if (!pages && type === "pdf") {
      try {
        pages =
          ir?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfDocument
            ?.numPages || 0;
      } catch {
        pages = 0;
      }
    }
    return { pageIndex, pages };
  }

  private tick(seconds: number) {
    try {
      if (!getPref("tracker.enable")) return;
      if (!readingStore.loaded) return;
      const active = this.activeReader();
      if (!active) return;
      const { reader } = active;
      if (this.isIdle(reader)) return;
      const att = Zotero.Items.get(reader.itemID) as Zotero.Item | false;
      if (!att) return;
      const target = att.parentID
        ? (Zotero.Items.get(att.parentID) as Zotero.Item | false)
        : att;
      if (!target) return;
      const { pageIndex, pages } = ReadingTracker.readPosition(reader);
      readingStore.addSample(
        target.libraryID,
        target.key,
        pageIndex,
        seconds,
        pages,
      );
      const key = keyOfItem(target);
      if (!this.startedKeys.has(key)) {
        this.startedKeys.add(key);
        void onReadingStarted(target);
      }
      const now = Date.now();
      if ((this.lastProgressCheck.get(key) || 0) + 60_000 < now) {
        this.lastProgressCheck.set(key, now);
        void onReadingProgress(target);
      }
    } catch (e) {
      ztoolkit.log("[tracker] tick failed", e);
    }
  }
}

export const readingTracker = new ReadingTracker();
