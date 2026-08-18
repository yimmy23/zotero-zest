import { config } from "../../package.json";

/**
 * Plugin-owned SQLite database (`<Zotero data dir>/zest.sqlite`) opened with
 * Zotero's own `Zotero.DBConnection` (same machinery as zotero.sqlite:
 * mozStorage async connection, EXCLUSIVE lock, cached statements, idle
 * backups to `.bak`). Reading records live here — never in the main
 * library database, never in hidden items or notes.
 *
 * Rules (from db.js 9.0.6 + Zotero 10 dev notes):
 * - `closeDatabase(true)` on shutdown (a hot-reload would otherwise open a
 *   second exclusive connection and stall on the lock); the idle-backup
 *   observer Zotero registers on open must be removed too, or it re-opens
 *   the connection after we are gone.
 * - `queryAsync` returns rows only for statements whose first token is
 *   select/pragma; upserts return undefined.
 * - Params: no booleans/undefined; use numbers/strings/null.
 * - Zotero 10 turns on WAL for named connections (extra `-wal` file) — the
 *   API is unchanged.
 */

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS page_time (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  pageIndex INTEGER NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey, pageIndex)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS daily_time (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  day       TEXT    NOT NULL,
  seconds   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey, day)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS item_meta (
  libraryID INTEGER NOT NULL,
  itemKey   TEXT    NOT NULL,
  pages     INTEGER NOT NULL DEFAULT 0,
  firstRead INTEGER NOT NULL DEFAULT 0,
  lastRead  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (libraryID, itemKey)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS daily_time_day ON daily_time (day);
`;

export interface PageRow {
  libraryID: number;
  itemKey: string;
  pageIndex: number;
  seconds: number;
}
export interface DayRow {
  libraryID: number;
  itemKey: string;
  day: string;
  seconds: number;
}
export interface MetaRow {
  libraryID: number;
  itemKey: string;
  pages: number;
  firstRead: number;
  lastRead: number;
}

class ZestDB {
  private conn: any = null;
  private initPromise?: Promise<boolean>;
  /** true once the schema is verified; false if the DB is unusable */
  ok = false;

  /** Idempotent. Resolves false (and logs) when the DB cannot be opened. */
  init(): Promise<boolean> {
    if (!this.initPromise) this.initPromise = this._init();
    return this.initPromise;
  }

  private async _init(): Promise<boolean> {
    try {
      this.conn = new (Zotero as any).DBConnection(config.addonRef);
      // one statement per call: executeCached rejects multi-statement SQL
      for (const stmt of SCHEMA.split(";")) {
        const sql = stmt.trim();
        if (sql) await this.conn.queryAsync(sql);
      }
      const v = await this.conn.valueQueryAsync(
        "SELECT value FROM meta WHERE key='schema'",
      );
      if (!v) {
        await this.conn.queryAsync(
          "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)",
          [String(SCHEMA_VERSION)],
        );
      } else if (Number(v) > SCHEMA_VERSION) {
        ztoolkit.log(
          `[db] schema ${v} is newer than this build (${SCHEMA_VERSION}); read-only caution`,
        );
      }
      this.ok = true;
    } catch (e) {
      ztoolkit.log("[db] init failed", e);
      Zotero.logError(e as any);
      this.ok = false;
    }
    return this.ok;
  }

  get path(): string {
    return this.conn?._dbPath || "";
  }

  async loadAll(): Promise<{
    pages: PageRow[];
    days: DayRow[];
    meta: MetaRow[];
  }> {
    if (!(await this.init())) return { pages: [], days: [], meta: [] };
    const pages: PageRow[] = [];
    const days: DayRow[] = [];
    const meta: MetaRow[] = [];
    // onRow avoids materialising proxy objects for large tables
    await this.conn.queryAsync(
      "SELECT libraryID, itemKey, pageIndex, seconds FROM page_time",
      [],
      {
        onRow: (row: any) =>
          pages.push({
            libraryID: row.getResultByIndex(0),
            itemKey: row.getResultByIndex(1),
            pageIndex: row.getResultByIndex(2),
            seconds: row.getResultByIndex(3),
          }),
      },
    );
    await this.conn.queryAsync(
      "SELECT libraryID, itemKey, day, seconds FROM daily_time",
      [],
      {
        onRow: (row: any) =>
          days.push({
            libraryID: row.getResultByIndex(0),
            itemKey: row.getResultByIndex(1),
            day: row.getResultByIndex(2),
            seconds: row.getResultByIndex(3),
          }),
      },
    );
    await this.conn.queryAsync(
      "SELECT libraryID, itemKey, pages, firstRead, lastRead FROM item_meta",
      [],
      {
        onRow: (row: any) =>
          meta.push({
            libraryID: row.getResultByIndex(0),
            itemKey: row.getResultByIndex(1),
            pages: row.getResultByIndex(2),
            firstRead: row.getResultByIndex(3),
            lastRead: row.getResultByIndex(4),
          }),
      },
    );
    return { pages, days, meta };
  }

  /**
   * Apply a batch of deltas atomically. `mode`:
   *  - "add": seconds += delta (live tracking)
   *  - "max": seconds = max(seconds, value) (imports / migration, idempotent)
   */
  async writeBatch(
    batch: {
      pages: PageRow[];
      days: DayRow[];
      meta: MetaRow[];
    },
    mode: "add" | "max",
  ): Promise<void> {
    if (!(await this.init())) return;
    if (!batch.pages.length && !batch.days.length && !batch.meta.length) return;
    const op =
      mode === "add"
        ? "seconds = seconds + excluded.seconds"
        : "seconds = max(seconds, excluded.seconds)";
    await this.conn.executeTransaction(async () => {
      for (const r of batch.pages) {
        await this.conn.queryAsync(
          `INSERT INTO page_time (libraryID, itemKey, pageIndex, seconds) VALUES (?, ?, ?, ?)
           ON CONFLICT(libraryID, itemKey, pageIndex) DO UPDATE SET ${op}`,
          [r.libraryID, r.itemKey, r.pageIndex, Math.round(r.seconds)],
        );
      }
      for (const r of batch.days) {
        await this.conn.queryAsync(
          `INSERT INTO daily_time (libraryID, itemKey, day, seconds) VALUES (?, ?, ?, ?)
           ON CONFLICT(libraryID, itemKey, day) DO UPDATE SET ${op}`,
          [r.libraryID, r.itemKey, r.day, Math.round(r.seconds)],
        );
      }
      for (const r of batch.meta) {
        await this.conn.queryAsync(
          `INSERT INTO item_meta (libraryID, itemKey, pages, firstRead, lastRead) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(libraryID, itemKey) DO UPDATE SET
             pages = CASE WHEN excluded.pages > 0 THEN excluded.pages ELSE pages END,
             firstRead = CASE WHEN firstRead = 0 THEN excluded.firstRead ELSE min(firstRead, CASE WHEN excluded.firstRead = 0 THEN firstRead ELSE excluded.firstRead END) END,
             lastRead = max(lastRead, excluded.lastRead)`,
          [
            r.libraryID,
            r.itemKey,
            r.pages | 0,
            r.firstRead | 0,
            r.lastRead | 0,
          ],
        );
      }
    });
  }

  async deleteItem(libraryID: number, itemKey: string): Promise<void> {
    if (!(await this.init())) return;
    await this.conn.executeTransaction(async () => {
      for (const t of ["page_time", "daily_time", "item_meta"]) {
        await this.conn.queryAsync(
          `DELETE FROM ${t} WHERE libraryID=? AND itemKey=?`,
          [libraryID, itemKey],
        );
      }
    });
  }

  async deleteAll(): Promise<void> {
    if (!(await this.init())) return;
    await this.conn.executeTransaction(async () => {
      for (const t of ["page_time", "daily_time", "item_meta"]) {
        await this.conn.queryAsync(`DELETE FROM ${t}`);
      }
    });
  }

  async close(): Promise<void> {
    const conn = this.conn;
    this.conn = null;
    this.initPromise = undefined;
    this.ok = false;
    if (!conn) return;
    // Zotero registers `conn` as an idle observer for backups when the
    // connection opens; drop it so a stray idle event cannot re-open the DB
    // after the plugin is gone.
    try {
      const idleService = (Components.classes as any)[
        "@mozilla.org/widget/useridleservice;1"
      ].getService(Components.interfaces.nsIUserIdleService);
      idleService.removeIdleObserver(conn, 300);
    } catch {
      // not registered (never opened) — fine
    }
    try {
      await conn.closeDatabase(true);
    } catch (e) {
      ztoolkit.log("[db] close failed", e);
    }
  }
}

export const zestDB = new ZestDB();
