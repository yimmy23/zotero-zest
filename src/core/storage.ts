import { config } from "../../package.json";
import { setTimeout, clearTimeout } from "../utils/timers";

/**
 * `<dataDir>/zest-cache.json` — derived data only (journal ranks, annotation
 * density, page counts, citation back-off). Everything in here can be thrown
 * away and recomputed or refetched, which is why it is a plain JSON file and
 * not part of zest.sqlite.
 *
 * Rules (from Refs' storage.ts, kept deliberately):
 * - the file is never trusted: every entry is re-validated on the way in AND
 *   on the way out, so a hand-edited or corrupted cache cannot inject
 *   arbitrary payloads into the UI;
 * - reads are synchronous (column dataProviders must be O(1)); the file is
 *   loaded once at startup into memory;
 * - writes are debounced and serialise the whole file, so bursts coalesce;
 * - each namespace is capped (LRU by write time) so the file cannot grow
 *   without bound.
 *
 * Layout: { v, ns: { [namespace]: { [key]: { t: epochMs, d: <data> } } } }
 */

const SCHEMA_VERSION = 1;

export type Sanitizer<T> = (raw: unknown) => T | null;

interface Entry {
  t: number;
  d: unknown;
}

interface Namespace {
  entries: Map<string, Entry>;
  max: number;
}

class JsonCache {
  private ns = new Map<string, Namespace>();
  private path = "";
  private writeTimer?: number;
  private loaded = false;
  private ready: Promise<void> = Promise.resolve();

  /** must be awaited once during startup, before any sync read */
  init(): Promise<void> {
    if (this.loaded) return this.ready;
    this.ready = this.load();
    return this.ready;
  }

  private space(name: string): Namespace {
    let s = this.ns.get(name);
    if (!s) {
      s = { entries: new Map(), max: 5000 };
      this.ns.set(name, s);
    }
    return s;
  }

  /** cap a namespace's size; call once at startup for large namespaces */
  configure(name: string, max: number) {
    this.space(name).max = Math.max(10, max);
  }

  private async load() {
    try {
      this.path = PathUtils.join(
        Zotero.DataDirectory.dir,
        `${config.addonRef}-cache.json`,
      );
      if (await IOUtils.exists(this.path)) {
        const raw = (await Zotero.File.getContentsAsync(this.path)) as string;
        const parsed = JSON.parse(raw);
        if (parsed?.v === SCHEMA_VERSION && parsed.ns) {
          for (const [name, entries] of Object.entries<any>(parsed.ns)) {
            if (!entries || typeof entries !== "object") continue;
            const s = this.space(name);
            for (const [key, e] of Object.entries<any>(entries)) {
              if (typeof key !== "string" || key.length > 400) continue;
              if (!e || typeof e !== "object" || !("d" in e)) continue;
              s.entries.set(key, { t: Number(e.t) || 0, d: e.d });
            }
          }
        }
      }
    } catch (e) {
      ztoolkit.log("[zest] cache load failed", e);
    }
    this.loaded = true;
  }

  /**
   * Synchronous read. `sanitize` runs on every hit (the in-memory copy came
   * from disk), `maxAgeMs` = 0 disables expiry.
   */
  get<T>(
    ns: string,
    key: string,
    sanitize: Sanitizer<T>,
    maxAgeMs = 0,
  ): { data: T; age: number } | undefined {
    const space = this.ns.get(ns);
    const e = space?.entries.get(key);
    if (!e || !space) return undefined;
    const age = Date.now() - e.t;
    if (maxAgeMs > 0 && age > maxAgeMs) return undefined;
    const data = sanitize(e.d);
    if (data === null) return undefined;
    // keep it a true LRU: a read moves the entry to the end of the map, so
    // eviction drops the least recently USED entry, not the oldest write
    space.entries.delete(key);
    space.entries.set(key, e);
    return { data, age };
  }

  /** raw age of an entry regardless of validity (used for back-off) */
  ageOf(ns: string, key: string): number | undefined {
    const e = this.ns.get(ns)?.entries.get(key);
    return e ? Date.now() - e.t : undefined;
  }

  set(ns: string, key: string, data: unknown) {
    if (!key || key.length > 400) return;
    const s = this.space(ns);
    // Map preserves insertion order, but `set` on an existing key keeps the
    // old position — delete first so a rewrite moves to the back and the
    // eviction below really drops the least recently written
    s.entries.delete(key);
    s.entries.set(key, { t: Date.now(), d: data });
    if (s.entries.size > s.max) {
      const excess = s.entries.size - s.max;
      let i = 0;
      for (const k of s.entries.keys()) {
        if (i++ >= excess) break;
        s.entries.delete(k);
      }
    }
    this.scheduleWrite();
  }

  /** touch = keep the value, refresh its timestamp (successful revalidation) */
  touch(ns: string, key: string) {
    const e = this.ns.get(ns)?.entries.get(key);
    if (!e) return;
    e.t = Date.now();
    this.scheduleWrite();
  }

  remove(ns: string, key: string) {
    if (this.ns.get(ns)?.entries.delete(key)) this.scheduleWrite();
  }

  clear(ns: string) {
    const s = this.ns.get(ns);
    if (!s || !s.entries.size) return;
    s.entries.clear();
    this.scheduleWrite();
  }

  keys(ns: string): string[] {
    return [...(this.ns.get(ns)?.entries.keys() ?? [])];
  }

  size(ns: string): number {
    return this.ns.get(ns)?.entries.size ?? 0;
  }

  private scheduleWrite() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      this.flush().catch((e) => ztoolkit.log("[zest] cache write failed", e));
    }, 2000);
  }

  async flush() {
    if (!this.loaded || !this.path) return;
    const out: Record<string, Record<string, Entry>> = {};
    for (const [name, s] of this.ns) {
      if (!s.entries.size) continue;
      const o: Record<string, Entry> = {};
      for (const [k, e] of s.entries) o[k] = e;
      out[name] = o;
    }
    await Zotero.File.putContentsAsync(
      this.path,
      JSON.stringify({ v: SCHEMA_VERSION, ns: out }),
    );
  }

  async shutdown() {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    try {
      await this.flush();
    } catch (e) {
      ztoolkit.log("[zest] cache flush on shutdown failed", e);
    }
  }
}

export const cache = new JsonCache();
