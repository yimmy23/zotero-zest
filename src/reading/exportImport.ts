import { csvCell } from "../utils/csv";
import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { readingStore, dayOf } from "./store";

/**
 * Reading data export / import — first-class citizens.
 *
 * JSON (lossless, importable):
 * { "format": "zest-reading", "version": 1, "exported": ISO,
 *   "items": [ { libraryID, itemKey, title?, pages, firstRead, lastRead,
 *                pages_seconds: { "<pageIndex>": sec }, days: { "YYYY-MM-DD": sec } } ] }
 * CSV (long format, importable): libraryID,itemKey,title,kind,key,seconds
 *   kind = "page" (key = 0-based page index) | "day" (key = YYYY-MM-DD) | "meta"
 *   (key = pages|firstRead|lastRead).
 * Import merges by (libraryID,itemKey): "max" (idempotent) or "sum".
 */

export interface ExportedAtt {
  pages: number;
  pages_seconds: Record<string, number>;
}
export interface ExportedItem {
  libraryID: number;
  itemKey: string;
  title?: string;
  /** primary attachment's page count / page map (display view) */
  pages: number;
  pages_seconds: Record<string, number>;
  /** per-attachment maps; attKey '' = unattributed (legacy imports) */
  attachments?: Record<string, ExportedAtt>;
  firstRead: number;
  lastRead: number;
  days: Record<string, number>;
}

function titleOf(libraryID: number, itemKey: string): string {
  try {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    return item ? (item.getField("title") as string) || "" : "";
  } catch {
    return "";
  }
}

export function collectExport(): ExportedItem[] {
  const out: ExportedItem[] = [];
  for (const it of readingStore.items.values()) {
    if (!it.total) continue;
    const pages_seconds: Record<string, number> = {};
    for (const [i, s] of it.page) pages_seconds[String(i)] = s;
    const attachments: Record<string, ExportedAtt> = {};
    for (const [ak, a] of it.atts) {
      const ps: Record<string, number> = {};
      for (const [i, s] of a.page) ps[String(i)] = s;
      attachments[ak] = { pages: a.pages, pages_seconds: ps };
    }
    const days: Record<string, number> = {};
    for (const [d, s] of it.days) days[d] = s;
    out.push({
      libraryID: it.libraryID,
      itemKey: it.itemKey,
      title: titleOf(it.libraryID, it.itemKey),
      pages: it.pages,
      pages_seconds,
      attachments,
      firstRead: it.firstRead,
      lastRead: it.lastRead,
      days,
    });
  }
  out.sort((a, b) => b.lastRead - a.lastRead);
  return out;
}

export function toJSON(items: ExportedItem[]): string {
  return JSON.stringify(
    {
      format: "zest-reading",
      version: 1,
      exported: new Date().toISOString(),
      items,
    },
    null,
    1,
  );
}

export function toCSV(items: ExportedItem[]): string {
  const rows = ["libraryID,itemKey,title,kind,key,seconds,attKey"];
  for (const it of items) {
    const base = `${it.libraryID},${it.itemKey},${csvCell(it.title || "")}`;
    rows.push(`${base},meta,firstRead,${it.firstRead},`);
    rows.push(`${base},meta,lastRead,${it.lastRead},`);
    const atts = it.attachments || {
      "": { pages: it.pages, pages_seconds: it.pages_seconds },
    };
    for (const [ak, a] of Object.entries(atts)) {
      rows.push(`${base},meta,pages,${a.pages},${ak}`);
      for (const [k, s] of Object.entries(a.pages_seconds))
        rows.push(`${base},page,${k},${s},${ak}`);
    }
    for (const [k, s] of Object.entries(it.days))
      rows.push(`${base},day,${k},${s},`);
  }
  return rows.join("\n") + "\n";
}

/** minimal RFC-4180 parser (quotes, escaped quotes, CRLF) */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((x) => x !== "")) rows.push(row);
  }
  return rows;
}

export function fromCSV(text: string): ExportedItem[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iLib = col("libraryid"),
    iKey = col("itemkey"),
    iTitle = col("title"),
    iKind = col("kind"),
    iK = col("key"),
    iSec = col("seconds"),
    iAtt = col("attkey");
  if (iLib < 0 || iKey < 0 || iKind < 0 || iK < 0 || iSec < 0) {
    throw new Error(
      "CSV header must contain libraryID,itemKey,kind,key,seconds",
    );
  }
  const map = new Map<string, ExportedItem>();
  for (const r of rows.slice(1)) {
    const libraryID = Number(r[iLib]);
    const itemKey = (r[iKey] || "").trim();
    if (!Number.isInteger(libraryID) || !/^[A-Z0-9]{8}$/.test(itemKey))
      continue;
    const id = `${libraryID}/${itemKey}`;
    let it = map.get(id);
    if (!it) {
      it = {
        libraryID,
        itemKey,
        title: iTitle >= 0 ? r[iTitle] : "",
        pages: 0,
        pages_seconds: {},
        attachments: {},
        firstRead: 0,
        lastRead: 0,
        days: {},
      };
      map.set(id, it);
    }
    const kind = (r[iKind] || "").trim();
    const key = (r[iK] || "").trim();
    const sec = Number(r[iSec]);
    const ak = iAtt >= 0 ? (r[iAtt] || "").trim() : "";
    const att = (it.attachments![ak] ??= { pages: 0, pages_seconds: {} });
    if (kind === "page") {
      if (/^(-1|\d+)$/.test(key) && sec > 0) att.pages_seconds[key] = sec;
    } else if (kind === "day") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && sec > 0) it.days[key] = sec;
    } else if (kind === "meta") {
      if (key === "pages") att.pages = sec | 0;
      else if (key === "firstRead") it.firstRead = sec | 0;
      else if (key === "lastRead") it.lastRead = sec | 0;
    }
  }
  return [...map.values()];
}

export function fromJSON(text: string): ExportedItem[] {
  const data = JSON.parse(text);
  const list: any[] = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(list)) throw new Error("not a zest-reading export");
  const out: ExportedItem[] = [];
  const readPages = (src: any): Record<string, number> => {
    const ps: Record<string, number> = {};
    for (const [k, v] of Object.entries(src || {})) {
      if (/^(-1|\d+)$/.test(k) && Number(v) > 0) ps[k] = Number(v);
    }
    return ps;
  };
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const libraryID = Number(raw.libraryID);
    const itemKey = String(raw.itemKey || "");
    if (!Number.isInteger(libraryID) || !/^[A-Z0-9]{8}$/.test(itemKey))
      continue;
    const attachments: Record<string, ExportedAtt> = {};
    if (raw.attachments && typeof raw.attachments === "object") {
      for (const [ak, a] of Object.entries<any>(raw.attachments)) {
        attachments[ak] = {
          pages: Number(a?.pages) | 0,
          pages_seconds: readPages(a?.pages_seconds || a?.page),
        };
      }
    } else {
      attachments[""] = {
        pages: Number(raw.pages) | 0,
        pages_seconds: readPages(raw.pages_seconds || raw.page),
      };
    }
    const days: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.days || {})) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number(v) > 0) days[k] = Number(v);
    }
    out.push({
      libraryID,
      itemKey,
      title: typeof raw.title === "string" ? raw.title : "",
      pages: Number(raw.pages) | 0,
      pages_seconds: readPages(raw.pages_seconds || raw.page),
      attachments,
      firstRead: Number(raw.firstRead) | 0,
      lastRead: Number(raw.lastRead) | 0,
      days,
    });
  }
  return out;
}

/** Merge exported items into the store. Returns counts. */
export async function importItems(
  items: ExportedItem[],
  mode: "max" | "sum",
  onProgress?: (done: number, total: number) => void,
): Promise<{ items: number; seconds: number }> {
  let seconds = 0;
  let n = 0;
  for (const it of items) {
    const atts = it.attachments || {
      "": { pages: it.pages, pages_seconds: it.pages_seconds },
    };
    await readingStore.mergeRecord(
      {
        libraryID: it.libraryID,
        itemKey: it.itemKey,
        atts: Object.fromEntries(
          Object.entries(atts).map(([ak, a]) => [
            ak,
            { pages: a.pages, page: a.pages_seconds },
          ]),
        ),
        days: it.days,
        firstRead: it.firstRead,
        lastRead: it.lastRead,
      },
      mode,
    );
    for (const a of Object.values(atts))
      for (const s of Object.values(a.pages_seconds)) seconds += s;
    n++;
    onProgress?.(n, items.length);
  }
  return { items: n, seconds };
}

/* ---------------- UI entry points (file pickers) ---------------- */

export async function exportReadingDataUI(format: "json" | "csv") {
  const items = collectExport();
  if (!items.length) {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({ text: getString("export-nothing"), type: "default" })
      .show();
    return;
  }
  const ext = format === "json" ? "json" : "csv";
  const name = `zest-reading-${dayOf()}.${ext}`;
  const picker = new ztoolkit.FilePicker(
    getString("export-title"),
    "save",
    [[format.toUpperCase(), `*.${ext}`]],
    name,
  );
  const path = await picker.open();
  if (!path) return;
  const text = format === "json" ? toJSON(items) : toCSV(items);
  await Zotero.File.putContentsAsync(path, text);
  new ztoolkit.ProgressWindow(config.addonName)
    .createLine({
      text: getString("export-done", { args: { count: items.length } }),
      type: "success",
    })
    .show();
}

/** Ask merge mode: 0 = max, 1 = sum, 2 = cancel */
export function askMergeMode(count: number): "max" | "sum" | null {
  const win = Zotero.getMainWindow();
  const ps = Services.prompt as any;
  const flags =
    ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING +
    ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING +
    ps.BUTTON_POS_2 * ps.BUTTON_TITLE_CANCEL;
  const idx = ps.confirmEx(
    win as any,
    getString("import-title"),
    getString("import-mode-question", { args: { count } }),
    flags,
    getString("import-mode-max"),
    getString("import-mode-sum"),
    "",
    "",
    {} as any,
  );
  return idx === 0 ? "max" : idx === 1 ? "sum" : null;
}

export async function importReadingDataUI() {
  const picker = new ztoolkit.FilePicker(getString("import-title"), "open", [
    ["JSON / CSV", "*.json; *.csv"],
  ]);
  const path = await picker.open();
  if (!path) return;
  let items: ExportedItem[];
  try {
    const text = (await Zotero.File.getContentsAsync(path)) as string;
    items = /\.csv$/i.test(path) ? fromCSV(text) : fromJSON(text);
  } catch (e) {
    Services.prompt.alert(
      Zotero.getMainWindow() as any,
      getString("import-title"),
      getString("import-parse-failed", { args: { error: String(e) } }),
    );
    return;
  }
  if (!items.length) {
    Services.prompt.alert(
      Zotero.getMainWindow() as any,
      getString("import-title"),
      getString("import-nothing"),
    );
    return;
  }
  const mode = askMergeMode(items.length);
  if (!mode) return;
  const pw = new ztoolkit.ProgressWindow(getString("import-title"), {
    closeTime: -1,
    closeOtherProgressWindows: true,
  })
    .createLine({ text: `0/${items.length}`, type: "default", progress: 0 })
    .show();
  const res = await importItems(items, mode, (done, total) =>
    pw.changeLine({ text: `${done}/${total}`, progress: (done / total) * 100 }),
  );
  pw.changeLine({
    text: getString("import-done", {
      args: { count: res.items, hours: (res.seconds / 3600).toFixed(1) },
    }),
    type: "success",
    progress: 100,
  });
  pw.startCloseTimer(4000);
}
