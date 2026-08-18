import { zestDB, type DayRow, type MetaRow, type PageRow } from "../core/db";
import { getNumPref } from "../utils/prefs";
import { setInterval, clearInterval } from "../utils/window";

/**
 * In-memory index of reading records, the only thing columns ever read
 * (renderCell / dataProvider must be sync O(1)). Writes go to a pending
 * delta buffer flushed to zest.sqlite every `tracker.flushSeconds`
 * (default 15 s) and on session boundaries / shutdown, so a hard kill
 * loses at most one flush interval.
 *
 * Keyed by `${libraryID}/${itemKey}` (item IDs are per-machine).
 */

export type ReadingKey = string;

export interface ItemReading {
  libraryID: number;
  itemKey: string;
  /** total pages known for the attachment (0 = unknown) */
  pages: number;
  /** 0-based page index → cumulative seconds */
  page: Map<number, number>;
  /** YYYY-MM-DD → seconds */
  days: Map<string, number>;
  total: number;
  firstRead: number; // epoch seconds, 0 = unknown
  lastRead: number; // epoch seconds
  /** render caches (invalidated on every update) */
  _heat?: string;
  _heatKey?: string;
}

export function readingKey(libraryID: number, itemKey: string): ReadingKey {
  return `${libraryID}/${itemKey}`;
}

export function keyOfItem(item: Zotero.Item): ReadingKey {
  return readingKey(item.libraryID, item.key);
}

/** local calendar day, YYYY-MM-DD */
export function dayOf(ts = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Pending {
  page: Map<number, number>;
  days: Map<string, number>;
  pages: number;
  firstRead: number;
  lastRead: number;
}

type Listener = (keys: ReadingKey[]) => void;

class ReadingStore {
  readonly items = new Map<ReadingKey, ItemReading>();
  loaded = false;
  private loadPromise?: Promise<void>;
  private pending = new Map<ReadingKey, Pending>();
  private flushTimer?: number;
  private flushing: Promise<void> | null = null;
  private listeners = new Set<Listener>();

  /** Notified (debounced by caller) with the keys whose data changed. */
  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(keys: ReadingKey[]) {
    for (const fn of this.listeners) {
      try {
        fn(keys);
      } catch (e) {
        ztoolkit.log("[store] listener failed", e);
      }
    }
  }

  load(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this._load();
    return this.loadPromise;
  }

  private async _load() {
    try {
      const { pages, days, meta } = await zestDB.loadAll();
      for (const r of pages) {
        const it = this.ensure(r.libraryID, r.itemKey);
        it.page.set(r.pageIndex, r.seconds);
        it.total += r.seconds;
      }
      for (const r of days) {
        this.ensure(r.libraryID, r.itemKey).days.set(r.day, r.seconds);
      }
      for (const r of meta) {
        const it = this.ensure(r.libraryID, r.itemKey);
        it.pages = r.pages || it.pages;
        it.firstRead = r.firstRead || 0;
        it.lastRead = r.lastRead || 0;
      }
      // total from pages, but items with only daily data still count
      for (const it of this.items.values()) {
        if (!it.total) {
          let t = 0;
          for (const s of it.days.values()) t += s;
          it.total = t;
        }
      }
    } catch (e) {
      ztoolkit.log("[store] load failed", e);
    }
    this.loaded = true;
    this.startFlushTimer();
    this.emit([...this.items.keys()]);
  }

  private ensure(libraryID: number, itemKey: string): ItemReading {
    const key = readingKey(libraryID, itemKey);
    let it = this.items.get(key);
    if (!it) {
      it = {
        libraryID,
        itemKey,
        pages: 0,
        page: new Map(),
        days: new Map(),
        total: 0,
        firstRead: 0,
        lastRead: 0,
      };
      this.items.set(key, it);
    }
    return it;
  }

  get(libraryID: number, itemKey: string): ItemReading | undefined {
    return this.items.get(readingKey(libraryID, itemKey));
  }

  getForItem(item: Zotero.Item): ItemReading | undefined {
    return this.items.get(keyOfItem(item));
  }

  /**
   * Live tracking increment: `seconds` more spent on `pageIndex` right now.
   * pageIndex < 0 means "no page notion" (snapshots): only totals/days move.
   */
  addSample(
    libraryID: number,
    itemKey: string,
    pageIndex: number,
    seconds: number,
    pagesCount: number,
    now = Date.now(),
  ) {
    if (!(seconds > 0)) return;
    const it = this.ensure(libraryID, itemKey);
    const nowSec = Math.floor(now / 1000);
    if (pageIndex >= 0) {
      it.page.set(pageIndex, (it.page.get(pageIndex) || 0) + seconds);
    }
    const day = dayOf(now);
    it.days.set(day, (it.days.get(day) || 0) + seconds);
    it.total += seconds;
    if (pagesCount > 0) it.pages = pagesCount;
    if (!it.firstRead) it.firstRead = nowSec;
    it.lastRead = nowSec;
    it._heat = undefined;

    const key = readingKey(libraryID, itemKey);
    let p = this.pending.get(key);
    if (!p) {
      p = {
        page: new Map(),
        days: new Map(),
        pages: 0,
        firstRead: 0,
        lastRead: 0,
      };
      this.pending.set(key, p);
    }
    if (pageIndex >= 0)
      p.page.set(pageIndex, (p.page.get(pageIndex) || 0) + seconds);
    p.days.set(day, (p.days.get(day) || 0) + seconds);
    if (pagesCount > 0) p.pages = pagesCount;
    if (!p.firstRead) p.firstRead = it.firstRead;
    p.lastRead = nowSec;
    this.emit([key]);
  }

  /**
   * Merge an imported / migrated record. mode "max" keeps the larger of
   * existing vs incoming per page/day (idempotent re-import); "sum" adds.
   * Written to the DB immediately (not through the pending buffer).
   */
  async mergeRecord(
    rec: {
      libraryID: number;
      itemKey: string;
      pages?: number;
      page?: Map<number, number> | Record<string, number>;
      days?: Map<string, number> | Record<string, number>;
      firstRead?: number;
      lastRead?: number;
    },
    mode: "max" | "sum",
  ): Promise<void> {
    const it = this.ensure(rec.libraryID, rec.itemKey);
    const pageEntries: Array<[number, number]> = rec.page
      ? rec.page instanceof Map
        ? [...rec.page.entries()]
        : Object.entries(rec.page).map(([k, v]) => [Number(k), Number(v)])
      : [];
    const dayEntries: Array<[string, number]> = rec.days
      ? rec.days instanceof Map
        ? [...rec.days.entries()]
        : Object.entries(rec.days).map(([k, v]) => [k, Number(v)])
      : [];
    const pageRows: PageRow[] = [];
    const dayRows: DayRow[] = [];
    for (const [idx, sec] of pageEntries) {
      if (!Number.isInteger(idx) || idx < 0 || !(sec > 0)) continue;
      const cur = it.page.get(idx) || 0;
      const next = mode === "sum" ? cur + sec : Math.max(cur, sec);
      if (next !== cur) {
        it.page.set(idx, next);
        pageRows.push({
          libraryID: rec.libraryID,
          itemKey: rec.itemKey,
          pageIndex: idx,
          seconds: mode === "sum" ? sec : next,
        });
      }
    }
    for (const [day, sec] of dayEntries) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(sec > 0)) continue;
      const cur = it.days.get(day) || 0;
      const next = mode === "sum" ? cur + sec : Math.max(cur, sec);
      if (next !== cur) {
        it.days.set(day, next);
        dayRows.push({
          libraryID: rec.libraryID,
          itemKey: rec.itemKey,
          day,
          seconds: mode === "sum" ? sec : next,
        });
      }
    }
    // recompute total from pages (fallback days)
    let t = 0;
    for (const s of it.page.values()) t += s;
    if (!t) for (const s of it.days.values()) t += s;
    it.total = t;
    if (rec.pages && rec.pages > it.pages) it.pages = rec.pages;
    if (rec.firstRead && (!it.firstRead || rec.firstRead < it.firstRead)) {
      it.firstRead = rec.firstRead;
    }
    if (rec.lastRead && rec.lastRead > it.lastRead) it.lastRead = rec.lastRead;
    it._heat = undefined;
    const metaRows: MetaRow[] = [
      {
        libraryID: rec.libraryID,
        itemKey: rec.itemKey,
        pages: it.pages,
        firstRead: it.firstRead,
        lastRead: it.lastRead,
      },
    ];
    await zestDB.writeBatch(
      { pages: pageRows, days: dayRows, meta: metaRows },
      mode === "sum" ? "add" : "max",
    );
    this.emit([readingKey(rec.libraryID, rec.itemKey)]);
  }

  async clearItem(libraryID: number, itemKey: string): Promise<void> {
    const key = readingKey(libraryID, itemKey);
    this.items.delete(key);
    this.pending.delete(key);
    await zestDB.deleteItem(libraryID, itemKey);
    this.emit([key]);
  }

  async clearAll(): Promise<void> {
    const keys = [...this.items.keys()];
    this.items.clear();
    this.pending.clear();
    await zestDB.deleteAll();
    this.emit(keys);
  }

  private startFlushTimer() {
    clearInterval(this.flushTimer);
    const sec = Math.max(5, getNumPref("tracker.flushSeconds", 15));
    this.flushTimer = setInterval(() => void this.flush(), sec * 1000);
  }

  /** Persist pending deltas. Safe to call often; concurrent calls coalesce. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.pending.size) return Promise.resolve();
    const batch = this.pending;
    this.pending = new Map();
    const pages: PageRow[] = [];
    const days: DayRow[] = [];
    const meta: MetaRow[] = [];
    for (const [key, p] of batch) {
      const [lib, itemKey] = splitKey(key);
      for (const [idx, sec] of p.page) {
        pages.push({ libraryID: lib, itemKey, pageIndex: idx, seconds: sec });
      }
      for (const [day, sec] of p.days) {
        days.push({ libraryID: lib, itemKey, day, seconds: sec });
      }
      meta.push({
        libraryID: lib,
        itemKey,
        pages: p.pages,
        firstRead: p.firstRead,
        lastRead: p.lastRead,
      });
    }
    this.flushing = zestDB
      .writeBatch({ pages, days, meta }, "add")
      .catch((e) => {
        ztoolkit.log("[store] flush failed; re-queueing", e);
        // put the deltas back so nothing is lost on a transient error
        for (const [key, p] of batch) {
          const cur = this.pending.get(key);
          if (!cur) {
            this.pending.set(key, p);
            continue;
          }
          for (const [i, s] of p.page)
            cur.page.set(i, (cur.page.get(i) || 0) + s);
          for (const [d, s] of p.days)
            cur.days.set(d, (cur.days.get(d) || 0) + s);
          cur.pages = cur.pages || p.pages;
          cur.firstRead = cur.firstRead || p.firstRead;
          cur.lastRead = Math.max(cur.lastRead, p.lastRead);
        }
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  async shutdown() {
    clearInterval(this.flushTimer);
    this.flushTimer = undefined;
    await this.flush();
    this.listeners.clear();
  }

  /** aggregate seconds per day across all items (calendar heatmap) */
  totalsByDay(): Map<string, number> {
    const out = new Map<string, number>();
    for (const it of this.items.values()) {
      for (const [d, s] of it.days) out.set(d, (out.get(d) || 0) + s);
    }
    return out;
  }
}

export function splitKey(key: ReadingKey): [number, string] {
  const i = key.indexOf("/");
  return [Number(key.slice(0, i)), key.slice(i + 1)];
}

export const readingStore = new ReadingStore();

/** "12 min", "1.5 h", "3 h" — compact duration for cells */
export function formatDuration(seconds: number): string {
  if (!(seconds > 0)) return "";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const m = seconds / 60;
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`;
}
