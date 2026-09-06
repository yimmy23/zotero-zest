import {
  zestDB,
  type AttRow,
  type DayRow,
  type MetaRow,
  type PageRow,
} from "../core/db";
import { getNumPref } from "../utils/prefs";
import { getString } from "../utils/locale";
import { setInterval, clearInterval } from "../utils/timers";
import { config } from "../../package.json";

let dbWarned = false;
/** one visible warning per session when zest.sqlite cannot be opened */
function warnDBUnavailable(e: unknown) {
  if (dbWarned) return;
  dbWarned = true;
  try {
    new ztoolkit.ProgressWindow(config.addonName, { closeTime: 8000 })
      .createLine({ text: getString("db-unavailable"), type: "fail" })
      .show();
  } catch {
    // UI is optional here
  }
  ztoolkit.log("[store] database unavailable", e);
}

/**
 * In-memory index of reading records, the only thing columns ever read
 * (renderCell / dataProvider must be sync O(1)). Writes go to a pending
 * delta buffer flushed to zest.sqlite every `tracker.flushSeconds`
 * (default 15 s) and on session boundaries / shutdown, so a hard kill
 * loses at most one flush interval.
 *
 * Model: one record per parent item (`${libraryID}/${itemKey}`) holding
 *  - `atts`: per-attachment page maps (attKey → {pages, page, total});
 *    attKey '' = unattributed (legacy imports, files without a key);
 *  - `days`: YYYY-MM-DD → seconds (all attachments);
 *  - `total` = Σ over every attachment and every page bucket, INCLUDING the
 *    page-less bucket pageIndex -1 (snapshots / readers without a page
 *    notion) — the same definition live, after reload and after import.
 * `page`/`pages` (used by heat + auto-read) are the PRIMARY attachment's map
 * (the one with the most time), with the legacy '' bucket merged in by max.
 */

export type ReadingKey = string;

export interface AttReading {
  pages: number;
  /** pageIndex (0-based; -1 = page-less) → seconds */
  page: Map<number, number>;
  total: number;
}

export interface ItemReading {
  libraryID: number;
  itemKey: string;
  atts: Map<string, AttReading>;
  /** YYYY-MM-DD → seconds */
  days: Map<string, number>;
  total: number;
  firstRead: number; // epoch seconds, 0 = unknown
  lastRead: number; // epoch seconds
  /** derived: primary attachment's pages / page map (see recompute) */
  pages: number;
  page: Map<number, number>;
  /** derived: key of the attachment the page map came from ("" = unknown) */
  primaryAtt: string;
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

/** pages actually seen (excludes the page-less bucket) */
export function pagesSeen(rec: ItemReading, minSeconds = 5): number {
  let n = 0;
  for (const [i, s] of rec.page) if (i >= 0 && s >= minSeconds) n++;
  return n;
}

interface Pending {
  /** attKey → pageIndex → delta seconds */
  page: Map<string, Map<number, number>>;
  /** attKey → pages */
  attPages: Map<string, number>;
  days: Map<string, number>;
  firstRead: number;
  lastRead: number;
}

type Listener = (keys: ReadingKey[]) => void;

function newAtt(): AttReading {
  return { pages: 0, page: new Map(), total: 0 };
}

function newItem(libraryID: number, itemKey: string): ItemReading {
  return {
    libraryID,
    itemKey,
    atts: new Map(),
    days: new Map(),
    total: 0,
    firstRead: 0,
    lastRead: 0,
    pages: 0,
    page: new Map(),
    primaryAtt: "",
  };
}

function copyItem(it: ItemReading): ItemReading {
  return {
    ...it,
    atts: new Map(
      [...it.atts].map(([key, a]) => [key, { ...a, page: new Map(a.page) }]),
    ),
    days: new Map(it.days),
    page: new Map(it.page),
  };
}

/** Recompute derived fields (total, primary page map) after any change. */
function recompute(it: ItemReading) {
  let total = 0;
  let primary: AttReading | undefined;
  let primaryKey = "";
  for (const [k, a] of it.atts) {
    let t = 0;
    for (const s of a.page.values()) t += s;
    a.total = t;
    total += t;
    if (k !== "" && (!primary || t > primary.total)) {
      primary = a;
      primaryKey = k;
    }
  }
  const legacy = it.atts.get("");
  if (!primary && legacy) {
    primary = legacy;
    primaryKey = "";
  }
  if (!total) {
    // no page rows at all (e.g. only day rows) — fall back to days
    for (const s of it.days.values()) total += s;
  }
  it.total = total;
  it.primaryAtt = primaryKey;
  if (!primary) {
    it.page = new Map();
    it.pages = 0;
  } else if (primaryKey !== "" && legacy) {
    // merge the unattributed bucket into the primary map by max
    const merged = new Map(primary.page);
    for (const [i, s] of legacy.page) {
      merged.set(i, Math.max(merged.get(i) || 0, s));
    }
    it.page = merged;
    it.pages = Math.max(primary.pages, legacy.pages);
  } else {
    it.page = primary.page;
    it.pages = primary.pages;
  }
  it._heat = undefined;
}

class ReadingStore {
  readonly items = new Map<ReadingKey, ItemReading>();
  loaded = false;
  private loadPromise?: Promise<void>;
  private pending = new Map<ReadingKey, Pending>();
  private flushTimer?: number;
  /** All DB operations share one queue; live samples remain synchronous. */
  private writes: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private listeners = new Set<Listener>();
  private lastFlushError = 0;

  /** Notified with the keys whose data changed. */
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
    if (this.loaded || this.stopped) return Promise.resolve();
    this.startFlushTimer();
    if (!this.loadPromise) {
      this.loadPromise = this.enqueue(() => this.loadIndex())
        .catch(warnDBUnavailable)
        .finally(() => {
          this.loadPromise = undefined;
        });
    }
    return this.loadPromise;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writes.then(fn);
    // A rejected operation must not poison later retries.
    this.writes = next.catch(() => undefined);
    return next;
  }

  private async loadIndex() {
    if (this.loaded) return;
    const { pages, atts, days, meta } = await zestDB.loadAll();
    const restored = new Map<ReadingKey, ItemReading>();
    const ensure = (lib: number, key: string) => {
      const id = readingKey(lib, key);
      let it = restored.get(id);
      if (!it) restored.set(id, (it = newItem(lib, key)));
      return it;
    };
    for (const r of pages) {
      const it = ensure(r.libraryID, r.itemKey);
      this.att(it, r.attKey).page.set(r.pageIndex, r.seconds);
    }
    for (const r of atts) {
      const it = ensure(r.libraryID, r.itemKey);
      this.att(it, r.attKey).pages = r.pages || 0;
    }
    for (const r of days) {
      ensure(r.libraryID, r.itemKey).days.set(r.day, r.seconds);
    }
    for (const r of meta) {
      const it = ensure(r.libraryID, r.itemKey);
      it.firstRead = r.firstRead || 0;
      it.lastRead = r.lastRead || 0;
    }
    // Samples may arrive before or during the read. They are not in the DB
    // yet; add them once to the fresh index, rather than overwriting them.
    for (const [key, pending] of this.pending) {
      const [lib, itemKey] = splitKey(key);
      this.applyPending(ensure(lib, itemKey), pending);
    }
    this.items.clear();
    for (const [key, it] of restored) {
      recompute(it);
      this.items.set(key, it);
    }
    this.loaded = true;
    this.emit([...this.items.keys()]);
  }

  private ensure(libraryID: number, itemKey: string): ItemReading {
    const key = readingKey(libraryID, itemKey);
    let it = this.items.get(key);
    if (!it) {
      it = newItem(libraryID, itemKey);
      this.items.set(key, it);
    }
    return it;
  }

  private att(it: ItemReading, attKey: string): AttReading {
    let a = it.atts.get(attKey || "");
    if (!a) {
      a = newAtt();
      it.atts.set(attKey || "", a);
    }
    return a;
  }

  private applyPending(it: ItemReading, p: Pending) {
    for (const [ak, pm] of p.page) {
      const a = this.att(it, ak);
      for (const [i, s] of pm) a.page.set(i, (a.page.get(i) || 0) + s);
    }
    for (const [ak, pages] of p.attPages) this.att(it, ak).pages = pages;
    for (const [day, sec] of p.days)
      it.days.set(day, (it.days.get(day) || 0) + sec);
    if (p.firstRead && (!it.firstRead || p.firstRead < it.firstRead))
      it.firstRead = p.firstRead;
    it.lastRead = Math.max(it.lastRead, p.lastRead);
  }

  get(libraryID: number, itemKey: string): ItemReading | undefined {
    return this.items.get(readingKey(libraryID, itemKey));
  }

  getForItem(item: Zotero.Item): ItemReading | undefined {
    return this.items.get(keyOfItem(item));
  }

  /**
   * Live tracking increment: `seconds` more spent on `pageIndex` of
   * attachment `attKey` right now. pageIndex < 0 → page-less bucket (-1).
   */
  addSample(
    libraryID: number,
    itemKey: string,
    attKey: string,
    pageIndex: number,
    seconds: number,
    pagesCount: number,
    now = Date.now(),
  ) {
    if (this.stopped || !Number.isFinite(seconds) || !(seconds > 0)) return;
    const idx = pageIndex >= 0 ? pageIndex : -1;
    const ak = attKey || "";
    const it = this.ensure(libraryID, itemKey);
    const nowSec = Math.floor(now / 1000);
    const a = this.att(it, ak);
    a.page.set(idx, (a.page.get(idx) || 0) + seconds);
    if (pagesCount > 0) a.pages = pagesCount;
    const day = dayOf(now);
    it.days.set(day, (it.days.get(day) || 0) + seconds);
    if (!it.firstRead) it.firstRead = nowSec;
    it.lastRead = nowSec;
    recompute(it);

    const key = readingKey(libraryID, itemKey);
    let p = this.pending.get(key);
    if (!p) {
      p = {
        page: new Map(),
        attPages: new Map(),
        days: new Map(),
        firstRead: 0,
        lastRead: 0,
      };
      this.pending.set(key, p);
    }
    let pm = p.page.get(ak);
    if (!pm) {
      pm = new Map();
      p.page.set(ak, pm);
    }
    pm.set(idx, (pm.get(idx) || 0) + seconds);
    if (pagesCount > 0) p.attPages.set(ak, pagesCount);
    p.days.set(day, (p.days.get(day) || 0) + seconds);
    if (!p.firstRead) p.firstRead = nowSec;
    p.lastRead = nowSec;
    this.emit([key]);
  }

  /**
   * Merge an imported / migrated record. mode "max" keeps the larger of
   * existing vs incoming per page/day (idempotent re-import); "sum" adds.
   * Snapshot the visible record before draining live deltas. Publish the
   * merged snapshot only after commit, plus samples received during the write.
   * Written to the DB immediately (throws when the DB is unavailable).
   */
  async mergeRecord(
    rec: {
      libraryID: number;
      itemKey: string;
      /** attKey → {pages, page}; missing → everything goes to '' */
      atts?: Record<
        string,
        { pages?: number; page?: Map<number, number> | Record<string, number> }
      >;
      pages?: number;
      page?: Map<number, number> | Record<string, number>;
      days?: Map<string, number> | Record<string, number>;
      firstRead?: number;
      lastRead?: number;
    },
    mode: "max" | "sum",
  ): Promise<void> {
    if (this.stopped) throw new Error("reading store stopped");
    return this.enqueue(async () => {
      await this.loadIndex();
      const key = readingKey(rec.libraryID, rec.itemKey);
      const current = this.items.get(key);
      const it = current
        ? copyItem(current)
        : newItem(rec.libraryID, rec.itemKey);
      await this.flushPending();
      const pageRows: PageRow[] = [];
      const attRows: AttRow[] = [];
      const dayRows: DayRow[] = [];
      const toEntries = (
        m: Map<number, number> | Record<string, number> | undefined,
      ): Array<[number, number]> =>
        !m
          ? []
          : m instanceof Map
            ? [...m.entries()]
            : Object.entries(m).map(([k, v]) => [Number(k), Number(v)]);
      const attInputs: Array<
        [
          string,
          {
            pages?: number;
            page?: Map<number, number> | Record<string, number>;
          },
        ]
      > = rec.atts
        ? Object.entries(rec.atts)
        : [["", { pages: rec.pages, page: rec.page }]];
      for (const [ak, input] of attInputs) {
        const a = this.att(it, ak);
        for (const [idx, sec] of toEntries(input.page)) {
          if (
            !Number.isInteger(idx) ||
            idx < -1 ||
            !Number.isFinite(sec) ||
            !(sec > 0)
          )
            continue;
          const cur = a.page.get(idx) || 0;
          const next = mode === "sum" ? cur + sec : Math.max(cur, sec);
          if (next !== cur) {
            a.page.set(idx, next);
            pageRows.push({
              libraryID: rec.libraryID,
              itemKey: rec.itemKey,
              attKey: ak,
              pageIndex: idx,
              seconds: mode === "sum" ? sec : next,
            });
          }
        }
        if (input.pages && input.pages > a.pages) {
          a.pages = input.pages;
          attRows.push({
            libraryID: rec.libraryID,
            itemKey: rec.itemKey,
            attKey: ak,
            pages: a.pages,
          });
        }
      }
      const dayEntries: Array<[string, number]> = rec.days
        ? rec.days instanceof Map
          ? [...rec.days.entries()]
          : Object.entries(rec.days).map(([k, v]) => [k, Number(v)])
        : [];
      for (const [day, sec] of dayEntries) {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
          !Number.isFinite(sec) ||
          !(sec > 0)
        )
          continue;
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
      if (rec.firstRead && (!it.firstRead || rec.firstRead < it.firstRead)) {
        it.firstRead = rec.firstRead;
      }
      if (rec.lastRead && rec.lastRead > it.lastRead)
        it.lastRead = rec.lastRead;
      const metaRows: MetaRow[] = [
        {
          libraryID: rec.libraryID,
          itemKey: rec.itemKey,
          firstRead: it.firstRead,
          lastRead: it.lastRead,
        },
      ];
      await zestDB.writeBatch(
        { pages: pageRows, atts: attRows, days: dayRows, meta: metaRows },
        mode === "sum" ? "add" : "max",
      );
      const pending = this.pending.get(key);
      if (pending) this.applyPending(it, pending);
      recompute(it);
      this.items.set(key, it);
      this.emit([key]);
    });
  }

  async clearItem(libraryID: number, itemKey: string): Promise<void> {
    if (this.stopped) throw new Error("reading store stopped");
    return this.enqueue(async () => {
      await this.loadIndex();
      await this.flushPending();
      const key = readingKey(libraryID, itemKey);
      await zestDB.deleteItem(libraryID, itemKey);
      this.items.delete(key);
      const pending = this.pending.get(key);
      if (pending) {
        const it = this.ensure(libraryID, itemKey);
        this.applyPending(it, pending);
        recompute(it);
      }
      this.emit([key]);
    });
  }

  async clearAll(): Promise<void> {
    if (this.stopped) throw new Error("reading store stopped");
    return this.enqueue(async () => {
      await this.loadIndex();
      await this.flushPending();
      const keys = new Set(this.items.keys());
      await zestDB.deleteAll();
      this.items.clear();
      for (const [key, pending] of this.pending) {
        const [lib, itemKey] = splitKey(key);
        const it = this.ensure(lib, itemKey);
        this.applyPending(it, pending);
        recompute(it);
        keys.add(key);
      }
      this.emit([...keys]);
    });
  }

  private startFlushTimer() {
    if (this.flushTimer !== undefined || this.stopped) return;
    try {
      if (!(addon as any)?.data?.alive) return;
    } catch {
      return;
    }
    const sec = Math.max(5, getNumPref("tracker.flushSeconds", 15));
    this.flushTimer = setInterval(() => void this.flush(), sec * 1000);
  }

  /**
   * Background callers can safely ignore the result. Mutations use the
   * throwing flushPending barrier instead, so a failed drain stops imports.
   */
  flush(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    return this.enqueue(async () => {
      await this.loadIndex();
      await this.flushPending();
      return true;
    }).catch((e) => {
      warnDBUnavailable(e);
      return false;
    });
  }

  private async flushPending(): Promise<void> {
    if (!this.pending.size) return;
    const batch = this.pending;
    this.pending = new Map();
    const pages: PageRow[] = [];
    const atts: AttRow[] = [];
    const days: DayRow[] = [];
    const meta: MetaRow[] = [];
    for (const [key, p] of batch) {
      const [lib, itemKey] = splitKey(key);
      for (const [ak, pm] of p.page) {
        for (const [idx, sec] of pm) {
          pages.push({
            libraryID: lib,
            itemKey,
            attKey: ak,
            pageIndex: idx,
            seconds: sec,
          });
        }
      }
      for (const [ak, n] of p.attPages) {
        atts.push({ libraryID: lib, itemKey, attKey: ak, pages: n });
      }
      for (const [day, sec] of p.days) {
        days.push({ libraryID: lib, itemKey, day, seconds: sec });
      }
      meta.push({
        libraryID: lib,
        itemKey,
        firstRead: p.firstRead,
        lastRead: p.lastRead,
      });
    }
    await zestDB.writeBatch({ pages, atts, days, meta }, "add").catch((e) => {
      const now = Date.now();
      if (now - this.lastFlushError > 60_000) {
        this.lastFlushError = now;
        ztoolkit.log("[store] flush failed; keeping deltas queued", e);
        warnDBUnavailable(e);
      }
      // put the deltas back so nothing is lost on a transient error
      for (const [key, p] of batch) {
        const cur = this.pending.get(key);
        if (!cur) {
          this.pending.set(key, p);
          continue;
        }
        for (const [ak, pm] of p.page) {
          let cm = cur.page.get(ak);
          if (!cm) {
            cm = new Map();
            cur.page.set(ak, cm);
          }
          for (const [i, s] of pm) cm.set(i, (cm.get(i) || 0) + s);
        }
        for (const [ak, n] of p.attPages) {
          if (!cur.attPages.has(ak)) cur.attPages.set(ak, n);
        }
        for (const [d, s] of p.days)
          cur.days.set(d, (cur.days.get(d) || 0) + s);
        if (p.firstRead && (!cur.firstRead || p.firstRead < cur.firstRead))
          cur.firstRead = p.firstRead;
        cur.lastRead = Math.max(cur.lastRead, p.lastRead);
      }
      throw e;
    });
  }

  async shutdown() {
    this.stopped = true;
    clearInterval(this.flushTimer);
    this.flushTimer = undefined;
    try {
      await this.enqueue(async () => {
        if (this.pending.size) {
          await this.loadIndex();
          await this.flushPending();
        }
      });
    } finally {
      this.listeners.clear();
    }
  }

  /** every tracked item, for the statistics panel */
  entries(): IterableIterator<[ReadingKey, ItemReading]> {
    return this.items.entries();
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
